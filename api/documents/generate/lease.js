/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { generateLeaseDocument } from '../../../utils/document-generator.js';

/**
 * Vercel serverless function to generate lease documents
 * 
 * POST /api/documents/generate/lease
 * 
 * Body:
 * - lease_id: Integer
 * - template_id: Integer (optional, will use default if not provided)
 * - user_id: Integer (user generating the document)
 * 
 * Response:
 * {
 *   success: boolean,
 *   document_id?: number,
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
    // Initialize Supabase client with service role key (bypasses RLS)
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

    let { lease_id, template_id, user_id } = req.body;

    // Validate and convert user_id to integer if provided
    // user_id should be an integer from the users table, not a UUID
    if (user_id) {
      // If it's a string that looks like a UUID (contains hyphens), reject it
      if (typeof user_id === 'string' && user_id.includes('-')) {
        console.warn('[Generate Lease] Received UUID instead of integer user_id:', user_id);
        console.warn('[Generate Lease] Frontend should send integer user_id from AuthContext, not Supabase auth UUID');
        user_id = null; // Set to null - uploaded_by_user_id can be nullable
      } else {
        // Try to parse as integer
        const parsedUserId = parseInt(user_id, 10);
        if (isNaN(parsedUserId)) {
          console.warn('[Generate Lease] Invalid user_id format:', user_id);
          user_id = null;
        } else {
          user_id = parsedUserId;
        }
      }
    }

    if (!lease_id) {
      return res.status(400).json({
        success: false,
        error: 'lease_id is required'
      });
    }

    // Validate required data before generation
    const { data: leaseCheck } = await supabase
      .from('leases')
      .select('lease_id')
      .eq('lease_id', lease_id)
      .single();

    if (!leaseCheck) {
      return res.status(404).json({
        success: false,
        error: 'Lease not found'
      });
    }

    // Generate PDF using document generator
    const pdfBytes = await generateLeaseDocument(lease_id, template_id, supabase);

    // Upload to Supabase Storage
    const fileName = `lease_${lease_id}_${Date.now()}.pdf`;
    const storagePath = `documents/lease/${lease_id}/${fileName}`;

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

    // Get template ID for metadata
    let templateId = template_id;
    if (!templateId) {
      const { data: defaultTemplate } = await supabase
        .from('templates')
        .select('template_id')
        .eq('template_type', 'Lease')
        .eq('is_default', true)
        .order('template_level', { ascending: true })
        .limit(1)
        .single();
      templateId = defaultTemplate?.template_id;
    }

    // Create document record
    const { data: documentData, error: dbError } = await supabase
      .from('documents')
      .insert({
        lease_id: lease_id,
        document_name: `Lease Agreement - Lease #${lease_id}`, // Required field
        file_name: fileName,
        storage_path: storagePath, // Use storage_path to match schema
        file_type: 'application/pdf',
        file_size: pdfBytes.length,
        mime_type: 'application/pdf',
        uploaded_by_user_id: user_id || null,
        document_type: 'lease_document',
        metadata: {
          template_id: templateId,
          generated_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (dbError) {
      // Try to delete uploaded file
      await supabase.storage.from('documents').remove([storagePath]);
      return res.status(500).json({
        success: false,
        error: `Database error: ${dbError.message}`
      });
    }

    return res.status(200).json({
      success: true,
      document_id: documentData.document_id,
      file_path: storagePath
    });

  } catch (error) {
    console.error('Lease generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

