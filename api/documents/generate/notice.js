/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { generateNoticeDocument } from '../../../utils/document-generator.js';
import { fetchFirstTenantUserId } from '../../../src/utils/lease-tenants.js';

/**
 * Vercel serverless function to generate legal notices
 * 
 * POST /api/documents/generate/notice
 * 
 * Body:
 * - notice_id: Integer (optional, for existing notice)
 * - lease_id: Integer
 * - notice_type: String ('rent_increase', 'eviction', etc.)
 * - template_id: Integer (optional)
 * - user_id: Integer
 * - notice_data: Object (additional data for the notice)
 * 
 * Response:
 * {
 *   success: boolean,
 *   document_id?: number,
 *   notice_id?: number,
 *   error?: string
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = 
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        success: false,
        error: 'Supabase configuration missing'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    let { notice_id, lease_id, notice_type, template_id, user_id, notice_data = {} } = req.body;

    // Validate and convert user_id to integer if provided
    // user_id should be an integer from the users table, not a UUID
    if (user_id) {
      // If it's a string that looks like a UUID (contains hyphens), reject it
      if (typeof user_id === 'string' && user_id.includes('-')) {
        console.warn('[Generate Notice] Received UUID instead of integer user_id:', user_id);
        console.warn('[Generate Notice] Frontend should send integer user_id from AuthContext, not Supabase auth UUID');
        user_id = null; // Set to null - uploaded_by_user_id can be nullable
      } else {
        // Try to parse as integer
        const parsedUserId = parseInt(user_id, 10);
        if (isNaN(parsedUserId)) {
          console.warn('[Generate Notice] Invalid user_id format:', user_id);
          user_id = null;
        } else {
          user_id = parsedUserId;
        }
      }
    }

    if (!lease_id || !notice_type) {
      return res.status(400).json({
        success: false,
        error: 'lease_id and notice_type are required'
      });
    }

    // Get or create legal notice record
    let noticeRecord;
    if (notice_id) {
      const { data: notice, error: noticeError } = await supabase
        .from('legal_notices')
        .select('*')
        .eq('notice_id', notice_id)
        .single();

      if (noticeError) {
        return res.status(404).json({
          success: false,
          error: 'Notice not found'
        });
      }
      noticeRecord = notice;
    } else {
      // Create new notice record
      const { data: newNotice, error: createError } = await supabase
        .from('legal_notices')
        .insert({
          lease_id,
          notice_type,
          date_generated: new Date().toISOString(),
          effective_date: notice_data.effective_date || new Date().toISOString().split('T')[0]
        })
        .select()
        .single();

      if (createError) {
        return res.status(500).json({
          success: false,
          error: `Failed to create notice record: ${createError.message}`
        });
      }
      noticeRecord = newNotice;
    }

    // Prepare notice data for document generator
    const noticeDocumentData = {
      lease_id,
      notice_type,
      effective_date: noticeRecord.effective_date,
      additional_data: notice_data
    };

    // Generate PDF using document generator
    const { pdfBytes, diagnostics: renderDiagnostics } = await generateNoticeDocument(
      noticeDocumentData,
      template_id,
      supabase
    );
    console.log('[RENDER_DIAG] /api/documents/generate/notice', renderDiagnostics);

    // Upload to Supabase Storage
    const fileName = `notice_${notice_type}_${noticeRecord.notice_id}_${Date.now()}.pdf`;
    const storagePath = `documents/legal_notice/${noticeRecord.notice_id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      return res.status(500).json({
        success: false,
        error: `Upload failed: ${uploadError.message}`
      });
    }

    // Template id from positioned render (or explicit request)
    const templateId = renderDiagnostics?.template_id || template_id || null;

    // Create document record
    // Format notice type for display (e.g., "rent_increase" -> "Rent Increase")
    const noticeTypeDisplay = notice_type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    // Link notice docs to a tenant user when possible (helps Review Documents / filters)
    const noticeLeaseId = lease_id || noticeRecord.lease_id || null;
    const tenantUserId = await fetchFirstTenantUserId(supabase, noticeLeaseId);

    // documents has no notice_id column — link via metadata (same as upload.js).
    const insertPayload = {
      lease_id: noticeLeaseId,
      document_name: `${noticeTypeDisplay} Notice`,
      file_name: fileName,
      storage_path: storagePath,
      file_type: 'application/pdf',
      file_size: pdfBytes.length,
      mime_type: 'application/pdf',
      uploaded_by_user_id: user_id || null,
      document_type: `${notice_type}_notice`,
      metadata: {
        notice_id: noticeRecord.notice_id,
        notice_type,
        template_id: templateId,
        generated_at: new Date().toISOString(),
        render: renderDiagnostics,
      }
    };
    if (tenantUserId) {
      insertPayload.tenant_user_id = tenantUserId;
    }

    const { data: documentData, error: dbError } = await supabase
      .from('documents')
      .insert(insertPayload)
      .select()
      .single();

    if (dbError) {
      await supabase.storage.from('documents').remove([storagePath]);
      return res.status(500).json({
        success: false,
        error: `Database error: ${dbError.message}`
      });
    }

    return res.status(200).json({
      success: true,
      document_id: documentData.document_id,
      notice_id: noticeRecord.notice_id,
      file_path: storagePath,
      // Visible in browser Network tab — how the PDF was rendered
      render: renderDiagnostics,
    });

  } catch (error) {
    console.error('Notice generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

