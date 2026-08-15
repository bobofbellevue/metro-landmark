/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to upload documents to Supabase Storage
 * 
 * POST /api/documents/upload
 * 
 * Body (multipart/form-data or JSON with base64):
 * - file: File or base64 string
 * - file_name: String
 * - file_type: String (MIME type)
 * - mime_type: String (MIME type, optional)
 * - document_type: String ('filled_application', 'signed_lease', etc.)
 * - user_id: Integer (uploaded_by_user_id)
 * - lease_id: Integer (optional, link to leases table)
 * - notice_id: Integer (optional, link to legal_notices table)
 * 
 * Response:
 * {
 *   success: boolean,
 *   document_id?: number,
 *   file_path?: string,
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
      console.error('Supabase configuration missing:', {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseKey,
        envKeys: Object.keys(process.env).filter(k => k.includes('SUPABASE'))
      });
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Supabase credentials not found. Please contact your administrator.'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Parse request body
    let { file, file_name, file_type, mime_type, document_type, user_id, lease_id, notice_id, tenant_user_id, unit_id, property_id, compliance_workflow_id } = req.body;
    
    console.log('[Document Upload] Received request body:', {
      has_file: !!file,
      file_name,
      document_type,
      user_id,
      tenant_user_id,
      lease_id,
      notice_id,
      unit_id,
      property_id
    });
    
    // Validate and convert user_id to integer if provided
    // user_id should be an integer from the users table, not a UUID
    if (user_id) {
      // If it's a string that looks like a UUID (contains hyphens), reject it
      if (typeof user_id === 'string' && user_id.includes('-')) {
        console.warn('[Document Upload] Received UUID instead of integer user_id:', user_id);
        console.warn('[Document Upload] Frontend should send integer user_id from AuthContext, not Supabase auth UUID');
        user_id = null; // Set to null - created_by_user_id can be nullable
      } else {
        // Try to parse as integer
        const parsedUserId = parseInt(user_id, 10);
        if (isNaN(parsedUserId)) {
          console.warn('[Document Upload] Invalid user_id format:', user_id);
          user_id = null;
        } else {
          user_id = parsedUserId;
        }
      }
    }

    // Validate required fields
    if (!file || !file_name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: file, file_name'
      });
    }

    // Convert base64 to buffer if needed
    let fileBuffer;
    let actualFileName = file_name;
    let actualMimeType = mime_type || file_type || 'application/pdf';
    let fileSize = 0;

    if (typeof file === 'string' && file.startsWith('data:')) {
      // Base64 data URL
      const base64Data = file.split(',')[1];
      fileBuffer = Buffer.from(base64Data, 'base64');
      fileSize = fileBuffer.length;
      
      // Extract mime type from data URL if not provided
      if (!mime_type && file.startsWith('data:')) {
        const mimeMatch = file.match(/data:([^;]+)/);
        if (mimeMatch) {
          actualMimeType = mimeMatch[1];
        }
      }
    } else if (Buffer.isBuffer(file)) {
      fileBuffer = file;
      fileSize = file.length;
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid file format. Expected base64 data URL or Buffer.'
      });
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (fileSize > maxSize) {
      return res.status(400).json({
        success: false,
        error: `File size exceeds maximum of ${maxSize / 1024 / 1024}MB`
      });
    }

    // Sanitize file name
    actualFileName = actualFileName.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Create storage path: documents/{document_type or generic}/{timestamped_file_name}
    const safeDocType = (document_type || 'generic').toString().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'generic';
    const storagePath = `documents/${safeDocType}/${Date.now()}-${actualFileName}`;

    // Upload to Supabase Storage
    let uploadError;
    
    // Try to upload first
    const uploadResult = await supabase.storage
      .from('documents')
      .upload(storagePath, fileBuffer, {
        contentType: actualMimeType,
        upsert: false // Don't overwrite existing files
      });
    
    uploadError = uploadResult.error;

    // If bucket doesn't exist, try to create it
    if (uploadError && uploadError.message.includes('Bucket not found')) {
      console.log('Documents bucket not found. Attempting to create it...');
      
      try {
        // Create the bucket using the storage API
        // Note: This requires service role key (which we should have)
        const { data: bucketData, error: bucketError } = await supabase.storage.createBucket('documents', {
          public: false, // Private bucket - use signed URLs for access
          fileSizeLimit: 10485760, // 10MB limit
          allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
        });

        if (bucketError) {
          console.error('Error creating bucket:', bucketError);
          // If bucket creation fails, provide helpful error message
          return res.status(500).json({
            success: false,
            error: `Storage bucket 'documents' does not exist and could not be created automatically. Please create it in your Supabase dashboard: Storage > New Bucket > Name: 'documents' > Public: false`
          });
        }

        console.log('Bucket created successfully:', bucketData);
        
        // Retry upload after creating bucket
        const retryResult = await supabase.storage
          .from('documents')
          .upload(storagePath, fileBuffer, {
            contentType: actualMimeType,
            upsert: false
          });
        
        uploadError = retryResult.error;
      } catch (createError) {
        console.error('Error during bucket creation:', createError);
        return res.status(500).json({
          success: false,
          error: `Storage bucket 'documents' does not exist and could not be created automatically. Please create it in your Supabase dashboard: Storage > New Bucket > Name: 'documents' > Public: false`
        });
      }
    }

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      return res.status(500).json({
        success: false,
        error: `Upload failed: ${uploadError.message}`
      });
    }

    // Create document record in database
    // Use file_name as document_name (display name) - remove extension for cleaner display
    const documentName = actualFileName.replace(/\.[^/.]+$/, ''); // Remove file extension
    
    // Build insert object with only provided fields
    const insertData = {
      document_name: documentName, // Required field - use file name without extension
      storage_path: storagePath, // Required field - path in Supabase Storage
      file_name: actualFileName,
      file_size: fileSize,
      mime_type: actualMimeType,
      document_type: document_type || null,
      created_by_user_id: user_id || null, // Use created_by_user_id (matches schema)
      metadata: {}
    };
    
    // Add entity-specific foreign keys if provided
    if (lease_id) insertData.lease_id = parseInt(lease_id, 10);
    if (tenant_user_id) {
      const parsedTenantUserId = parseInt(tenant_user_id, 10);
      if (!isNaN(parsedTenantUserId)) {
        insertData.tenant_user_id = parsedTenantUserId;
        console.log('[Document Upload] Setting tenant_user_id:', parsedTenantUserId);
      } else {
        console.warn('[Document Upload] Invalid tenant_user_id value:', tenant_user_id);
      }
    } else {
      console.log('[Document Upload] No tenant_user_id provided in request');
    }
    if (unit_id) insertData.unit_id = parseInt(unit_id, 10);
    if (property_id) insertData.property_id = parseInt(property_id, 10);
    if (compliance_workflow_id != null && compliance_workflow_id !== '') {
      const parsedWorkflowId = parseInt(compliance_workflow_id, 10);
      if (!isNaN(parsedWorkflowId)) {
        insertData.compliance_workflow_id = parsedWorkflowId;
      }
    }
    // documents has no notice_id column — store the link in metadata
    if (notice_id != null && notice_id !== '') {
      const parsedNoticeId = parseInt(notice_id, 10);
      if (!isNaN(parsedNoticeId)) {
        insertData.metadata = {
          ...insertData.metadata,
          notice_id: parsedNoticeId,
        };
      }
    }
    
    console.log('[Document Upload] Inserting document with data:', {
      document_name: insertData.document_name,
      document_type: insertData.document_type,
      tenant_user_id: insertData.tenant_user_id,
      created_by_user_id: insertData.created_by_user_id,
      lease_id: insertData.lease_id,
      unit_id: insertData.unit_id,
      property_id: insertData.property_id
    });
    
    const { data: documentData, error: dbError } = await supabase
      .from('documents')
      .insert(insertData)
      .select()
      .single();
    
    if (documentData) {
      console.log('[Document Upload] Document created successfully:', {
        document_id: documentData.document_id,
        tenant_user_id: documentData.tenant_user_id,
        created_by_user_id: documentData.created_by_user_id
      });
    }

    if (dbError) {
      // If document insert fails, try to delete uploaded file
      await supabase.storage.from('documents').remove([storagePath]);
      console.error('Database insert error:', dbError);
      return res.status(500).json({
        success: false,
        error: `Database error: ${dbError.message}`
      });
    }

    return res.status(200).json({
      success: true,
      document_id: documentData.document_id,
      file_path: storagePath,
      file_size: fileSize
    });

  } catch (error) {
    console.error('Document upload error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

