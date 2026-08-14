/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to get signed URL for document download
 * 
 * GET /api/documents/:id/download
 * 
 * Query params:
 * - expiresIn: Number (seconds, default 3600)
 * 
 * Response:
 * {
 *   success: boolean,
 *   url?: string,
 *   expires_at?: string,
 *   error?: string
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use GET.'
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

    // Get document ID from query
    const { id } = req.query;
    const expiresIn = parseInt(req.query.expiresIn) || 3600; // Default 1 hour

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Document ID is required'
      });
    }

    // Get document to retrieve storage path
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('storage_path, file_path')
      .eq('document_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Document not found'
        });
      }
      return res.status(500).json({
        success: false,
        error: fetchError.message
      });
    }

    // Use storage_path (preferred) or fall back to file_path for backward compatibility
    const storagePath = document.storage_path || document.file_path;
    
    if (!storagePath) {
      console.error('Document missing storage_path:', { document_id: id, document });
      return res.status(500).json({
        success: false,
        error: 'Document is missing storage path information'
      });
    }

    // Generate signed URL
    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, expiresIn);

    if (urlError) {
      console.error('Signed URL generation error:', urlError);
      return res.status(500).json({
        success: false,
        error: `Failed to generate signed URL: ${urlError.message}`
      });
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    return res.status(200).json({
      success: true,
      url: signedUrlData.signedUrl,
      expires_at: expiresAt,
      expires_in: expiresIn
    });

  } catch (error) {
    console.error('Document download error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

