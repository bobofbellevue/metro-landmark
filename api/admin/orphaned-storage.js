/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to find orphaned storage files
 * 
 * GET /api/admin/orphaned-storage - Find orphaned storage files
 * DELETE /api/admin/orphaned-storage - Delete selected orphaned files
 * 
 * Body (DELETE):
 * {
 *   files: [{ path: string }]
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
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

    if (req.method === 'GET') {
      // Get all files in the documents bucket
      const { data: storageFiles, error: storageError } = await supabase.storage
        .from('documents')
        .list('', {
          limit: 10000,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' }
        });

      if (storageError) {
        return res.status(500).json({
          success: false,
          error: `Failed to list storage files: ${storageError.message}`
        });
      }

      // Get all document records from database
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('storage_path, file_path, document_id');

      if (docsError) {
        return res.status(500).json({
          success: false,
          error: `Failed to fetch documents: ${docsError.message}`
        });
      }

      // Build set of valid storage paths
      const validPaths = new Set();
      (documents || []).forEach(doc => {
        if (doc.storage_path) validPaths.add(doc.storage_path);
        if (doc.file_path) validPaths.add(doc.file_path);
      });

      // Recursively list all files in storage
      async function listAllFiles(folder = '', allFiles = []) {
        const { data: items, error } = await supabase.storage
          .from('documents')
          .list(folder, {
            limit: 1000,
            offset: 0
          });

        if (error) {
          console.error(`Error listing folder ${folder}:`, error);
          return allFiles;
        }

        for (const item of items || []) {
          const fullPath = folder ? `${folder}/${item.name}` : item.name;
          
          if (item.id === null) {
            // It's a folder, recurse
            await listAllFiles(fullPath, allFiles);
          } else {
            // It's a file
            allFiles.push(fullPath);
          }
        }

        return allFiles;
      }

      const allStorageFiles = await listAllFiles();

      // Find orphaned files (files in storage but not referenced in database)
      const orphanedFiles = allStorageFiles
        .filter(filePath => !validPaths.has(filePath))
        .map(filePath => ({
          path: filePath,
          type: 'storage_file',
          description: `Storage file "${filePath}" is not referenced in any document record`
        }));

      return res.status(200).json({
        success: true,
        files: orphanedFiles,
        count: orphanedFiles.length
      });

    } else if (req.method === 'DELETE') {
      const { files } = req.body;

      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'files array is required'
        });
      }

      const paths = files.map(f => f.path || f).filter(Boolean);

      if (paths.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid file paths provided'
        });
      }

      const { error: deleteError } = await supabase.storage
        .from('documents')
        .remove(paths);

      if (deleteError) {
        return res.status(500).json({
          success: false,
          error: deleteError.message
        });
      }

      return res.status(200).json({
        success: true,
        deleted_count: paths.length,
        message: `Deleted ${paths.length} file(s) from storage`
      });
    }

  } catch (error) {
    console.error('Error in orphaned-storage:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
