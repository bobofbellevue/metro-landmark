/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to clean up storage files for documents associated with an entity
 * 
 * POST /api/documents/cleanup-by-entity
 * 
 * Body:
 * {
 *   table_name: string,  // e.g., 'clients', 'users'
 *   entity_id: number,   // ID of the entity being deleted
 *   user_id: number      // Optional: user performing the deletion
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   deleted_count?: number,
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

    const { table_name, entity_id } = req.body;

    if (!table_name || entity_id === undefined) {
      return res.status(400).json({
        success: false,
        error: 'table_name and entity_id are required'
      });
    }

    if (table_name === 'clients') {
      // For clients, we need to get the user_id first, then find documents
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('user_id')
        .eq('client_id', entity_id)
        .single();

      if (clientError && clientError.code !== 'PGRST116') {
        console.error('Error fetching client:', clientError);
      }

      const clientUserId = clientData?.user_id;

      // Documents are linked to clients via tenant_user_id
      // Find documents where tenant_user_id matches the client's user_id
      const { data: documents, error: userDocsError } = clientUserId
        ? await supabase
            .from('documents')
            .select('document_id, storage_path')
            .eq('tenant_user_id', clientUserId)
        : { data: [], error: null };

      if (userDocsError && userDocsError.code !== 'PGRST116') {
        console.error('Error fetching documents by user_id:', userDocsError);
      }

      // Use the documents found
      const uniqueDocuments = documents || [];

      // Delete storage files
      let deletedCount = 0;
      const storagePaths = uniqueDocuments
        .map(doc => doc.storage_path)
        .filter(Boolean);

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove(storagePaths);

        if (storageError) {
          console.warn('Some storage files could not be deleted:', storageError);
          // Continue anyway - we'll still delete the database records
        } else {
          deletedCount = storagePaths.length;
        }
      }

      return res.status(200).json({
        success: true,
        deleted_count: deletedCount,
        message: `Cleaned up ${deletedCount} document file(s) from storage`
      });

    } else if (table_name === 'users') {
      // For users, find documents where tenant_user_id or created_by_user_id matches
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('document_id, storage_path')
        .or(`tenant_user_id.eq.${entity_id},created_by_user_id.eq.${entity_id}`);

      if (docsError && docsError.code !== 'PGRST116') {
        console.error('Error fetching documents:', docsError);
        return res.status(500).json({
          success: false,
          error: docsError.message
        });
      }

      // Delete storage files
      const storagePaths = (documents || [])
        .map(doc => doc.storage_path)
        .filter(Boolean);

      let deletedCount = 0;
      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove(storagePaths);

        if (storageError) {
          console.warn('Some storage files could not be deleted:', storageError);
        } else {
          deletedCount = storagePaths.length;
        }
      }

      return res.status(200).json({
        success: true,
        deleted_count: deletedCount,
        message: `Cleaned up ${deletedCount} document file(s) from storage`
      });

    } else if (table_name === 'templates') {
      // For templates, find documents where template_id matches
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('document_id, storage_path')
        .eq('template_id', entity_id);

      if (docsError && docsError.code !== 'PGRST116') {
        console.error('Error fetching documents:', docsError);
        return res.status(500).json({
          success: false,
          error: docsError.message
        });
      }

      // Collect all storage paths to delete
      const storagePaths = (documents || [])
        .map(doc => doc.storage_path)
        .filter(Boolean);

      let deletedCount = 0;

      // Delete document files from storage
      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove(storagePaths);

        if (storageError) {
          console.warn('Some document storage files could not be deleted:', storageError);
        } else {
          deletedCount += storagePaths.length;
        }
      }

      // Also delete template image files from templates/{template_id}/images/ directory
      const templateImagesPath = `templates/${entity_id}/images/`;
      try {
        // List all files in the template images directory
        const { data: imageFiles, error: listError } = await supabase.storage
          .from('documents')
          .list(templateImagesPath);

        if (!listError && imageFiles && imageFiles.length > 0) {
          // Build paths for all image files
          const imagePaths = imageFiles.map(file => `${templateImagesPath}${file.name}`);
          
          // Delete all image files
          const { error: imageDeleteError } = await supabase.storage
            .from('documents')
            .remove(imagePaths);

          if (imageDeleteError) {
            console.warn('Some template image files could not be deleted:', imageDeleteError);
          } else {
            deletedCount += imagePaths.length;
            console.log(`Deleted ${imagePaths.length} template image file(s) from ${templateImagesPath}`);
          }
        }
      } catch (imageError) {
        console.warn('Error deleting template images:', imageError);
        // Continue - don't fail the whole operation
      }

      // Also try to delete the entire template directory (including any other files)
      try {
        const templateDirPath = `templates/${entity_id}/`;
        const { data: allTemplateFiles, error: dirListError } = await supabase.storage
          .from('documents')
          .list(templateDirPath, {
            limit: 1000,
            offset: 0
          });

        if (!dirListError && allTemplateFiles && allTemplateFiles.length > 0) {
          // Get all files in the template directory
          const allTemplatePaths = [];
          
          async function collectFiles(folder = '') {
            const fullPath = folder ? `${templateDirPath}${folder}` : templateDirPath;
            const { data: items, error } = await supabase.storage
              .from('documents')
              .list(fullPath, { limit: 1000, offset: 0 });

            if (error) {
              if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
                return;
              }
              console.warn(`Error listing ${fullPath}:`, error);
              return;
            }

            if (!items || items.length === 0) {
              return;
            }

            for (const item of items) {
              const itemPath = folder ? `${templateDirPath}${folder}/${item.name}` : `${templateDirPath}${item.name}`;
              if (item.id === null || (item.metadata === null && !item.updated_at)) {
                // It's a folder, recurse
                await collectFiles(folder ? `${folder}/${item.name}` : item.name);
              } else {
                // It's a file
                allTemplatePaths.push(itemPath);
              }
            }
          }

          await collectFiles();

          // Remove files that we already deleted
          const remainingPaths = allTemplatePaths.filter(path => 
            !storagePaths.includes(path) && 
            !path.startsWith(templateImagesPath)
          );

          if (remainingPaths.length > 0) {
            const { error: remainingDeleteError } = await supabase.storage
              .from('documents')
              .remove(remainingPaths);

            if (remainingDeleteError) {
              console.warn('Some remaining template files could not be deleted:', remainingDeleteError);
            } else {
              deletedCount += remainingPaths.length;
              console.log(`Deleted ${remainingPaths.length} additional template file(s)`);
            }
          }
        }
      } catch (dirError) {
        console.warn('Error deleting template directory:', dirError);
        // Continue - don't fail the whole operation
      }

      return res.status(200).json({
        success: true,
        deleted_count: deletedCount,
        message: `Cleaned up ${deletedCount} file(s) from template storage`
      });

    } else {
      return res.status(400).json({
        success: false,
        error: `Storage cleanup for table '${table_name}' is not yet implemented`
      });
    }

  } catch (error) {
    console.error('Error in cleanup-by-entity:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
