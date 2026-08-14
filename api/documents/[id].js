/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to get/delete document metadata
 * 
 * GET /api/documents/:id - Get document metadata
 * DELETE /api/documents/:id - Delete document and storage file
 * 
 * Response (GET):
 * {
 *   success: boolean,
 *   document?: Object,
 *   error?: string
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
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

    // Get document ID from query
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Document ID is required'
      });
    }

    if (req.method === 'GET') {
      // Get document metadata
      const { data: document, error } = await supabase
        .from('documents')
        .select('*')
        .eq('document_id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            error: 'Document not found'
          });
        }
        console.error('Database error:', error);
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        document
      });

    } else if (req.method === 'PATCH') {
      const { action, archive_reason, archived_by_user_id } = req.body || {};

      if (action === 'archive') {
        const { data, error } = await supabase
          .from('documents')
          .update({
            is_archived: true,
            archived_at: new Date().toISOString(),
            archived_by_user_id: archived_by_user_id || null,
            archive_reason: archive_reason || 'No reason provided',
          })
          .eq('document_id', id)
          .select('document_id')
          .single();

        if (error) {
          return res.status(500).json({
            success: false,
            error: error.message || 'Failed to archive document. Ensure documents archive columns exist (migration 007).',
          });
        }

        return res.status(200).json({
          success: true,
          message: 'Document archived successfully',
          document_id: data?.document_id,
        });
      }

      if (action === 'unarchive') {
        const { data, error } = await supabase
          .from('documents')
          .update({
            is_archived: false,
            archived_at: null,
            archived_by_user_id: null,
            archive_reason: null,
          })
          .eq('document_id', id)
          .select('document_id')
          .single();

        if (error) {
          return res.status(500).json({
            success: false,
            error: error.message || 'Failed to unarchive document',
          });
        }

        return res.status(200).json({
          success: true,
          message: 'Document restored successfully',
          document_id: data?.document_id,
        });
      }

      return res.status(400).json({
        success: false,
        error: 'Unsupported PATCH action. Use action=archive or action=unarchive.',
      });

    } else if (req.method === 'DELETE') {
      // Get document first to get storage path
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

      // Delete from storage (use storage_path, fall back to file_path for backward compatibility)
      const storagePath = document.storage_path || document.file_path;
      if (storagePath) {
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove([storagePath]);

        if (storageError) {
          console.warn('Storage delete error (continuing with DB delete):', storageError);
        }
      }

      // Delete from database
      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('document_id', id);

      if (deleteError) {
        return res.status(500).json({
          success: false,
          error: deleteError.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Document deleted successfully'
      });

    } else {
      return res.status(405).json({
        success: false,
        error: 'Method not allowed'
      });
    }

  } catch (error) {
    console.error('Document operation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

