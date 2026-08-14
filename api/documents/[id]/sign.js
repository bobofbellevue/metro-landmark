/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { addSignatureToPDF } from '../../utils/pdf-generator.js';
import { notifyDocumentFullySigned } from '../../utils/email-notifications.js';

/**
 * Validate if a user has permission to sign a document based on their role
 * @param {Object} supabase - Supabase client
 * @param {Object} signerUser - User object with user_id, role, email
 * @param {String} signerRole - Role being used to sign ('manager', 'landlord', 'tenant', 'applicant')
 * @param {Object} document - Document object with lease_id, property_id, tenant_user_id, etc.
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
async function validateSigningPermission(supabase, signerUser, signerRole, document) {
  const userRole = signerUser.role;
  const userId = signerUser.user_id;

  // Managers can sign on behalf of company
  if (signerRole === 'manager' && (userRole === 'manager' || userRole === 'company_admin' || userRole === 'global_admin')) {
    return { allowed: true };
  }

  // Landlords can sign their own documents
  if (signerRole === 'landlord' && userRole === 'landlord') {
    // Check property documents
    if (document.property_id) {
      const { data: property } = await supabase
        .from('properties')
        .select('landlord_id')
        .eq('property_id', document.property_id)
        .single();
      
      if (property && property.landlord_id) {
        const { data: landlord } = await supabase
          .from('landlords')
          .select('landlord_id')
          .eq('landlord_id', property.landlord_id)
          .eq('user_id', userId)
          .single();
        
        if (landlord) {
          return { allowed: true };
        }
      }
    }
    
    // Check lease documents
    if (document.lease_id) {
      const { data: lease } = await supabase
        .from('leases')
        .select('unit_id')
        .eq('lease_id', document.lease_id)
        .single();
      
      if (lease) {
        const { data: unit } = await supabase
          .from('units')
          .select('property_id')
          .eq('unit_id', lease.unit_id)
          .single();
        
        if (unit) {
          const { data: property } = await supabase
            .from('properties')
            .select('landlord_id')
            .eq('property_id', unit.property_id)
            .single();
          
          if (property && property.landlord_id) {
            const { data: landlord } = await supabase
              .from('landlords')
              .select('landlord_id')
              .eq('landlord_id', property.landlord_id)
              .eq('user_id', userId)
              .single();
            
            if (landlord) {
              return { allowed: true };
            }
          }
        }
      }
    }
    
    return { allowed: false, reason: 'You do not own this property/lease' };
  }

  // Tenants can sign documents related to their leases
  if (signerRole === 'tenant' && userRole !== 'global_admin' && userRole !== 'company_admin' && userRole !== 'manager' && userRole !== 'staff') {
    if (document.lease_id) {
      // Check if user is a tenant on this lease
      const { data: client } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', userId)
        .single();
      
      if (client) {
        const { data: leaseClient } = await supabase
          .from('lease_clients')
          .select('lease_client_id')
          .eq('lease_id', document.lease_id)
          .eq('client_id', client.client_id)
          .single();
        
        if (leaseClient) {
          return { allowed: true };
        }
      }
    }
    return { allowed: false, reason: 'You are not a tenant on this lease' };
  }

  // Applicants can sign their application documents
  if (signerRole === 'applicant' && userRole !== 'global_admin' && userRole !== 'company_admin' && userRole !== 'manager' && userRole !== 'staff') {
    // For application documents, check if tenant_user_id matches the signer
    // Applications are linked via tenant_user_id (which is the user_id from clients table)
    if (document.tenant_user_id === userId) {
      // Additional check: verify this is actually an application document
      if (document.document_type && (document.document_type.includes('application') || document.document_type.includes('rental'))) {
        return { allowed: true };
      }
    }
    return { allowed: false, reason: 'You are not the applicant for this application' };
  }

  // Global admins and company admins can sign any document
  if (userRole === 'global_admin' || userRole === 'company_admin') {
    return { allowed: true };
  }

  return { allowed: false, reason: 'You do not have permission to sign this document' };
}

/**
 * Vercel serverless function to add signature to a document
 * 
 * POST /api/documents/:id/sign
 * 
 * Body:
 * - signature_image: String (base64 encoded signature image)
 * - signer_user_id: Integer
 * - signer_role: String ('manager', 'landlord', 'tenant', 'applicant')
 * - signature_position: Object { x, y, width, height, pageIndex }
 * - ip_address: String (optional)
 * - user_agent: String (optional)
 * 
 * Response:
 * {
 *   success: boolean,
 *   document_id?: number,
 *   signature_id?: number,
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

    const { id } = req.query;
    const {
      signature_image,
      signer_user_id,
      signer_role,
      signature_position = {},
      ip_address,
      user_agent
    } = req.body;

    if (!signature_image || !signer_user_id || !signer_role) {
      return res.status(400).json({
        success: false,
        error: 'signature_image, signer_user_id, and signer_role are required'
      });
    }

    // Get document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('document_id', id)
      .single();

    if (docError || !document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // Get signer user info
    const { data: signerUser, error: userError } = await supabase
      .from('users')
      .select('user_id, role, email')
      .eq('user_id', signer_user_id)
      .single();

    if (userError || !signerUser) {
      return res.status(404).json({
        success: false,
        error: 'Signer user not found'
      });
    }

    // Validate role-based signing permissions
    const hasPermission = await validateSigningPermission(
      supabase,
      signerUser,
      signer_role,
      document
    );

    if (!hasPermission.allowed) {
      return res.status(403).json({
        success: false,
        error: hasPermission.reason || 'You do not have permission to sign this document'
      });
    }

    // Use storage_path (preferred) or fall back to file_path for backward compatibility
    const currentStoragePath = document.storage_path || document.file_path;
    if (!currentStoragePath) {
      return res.status(500).json({
        success: false,
        error: 'Document is missing storage path information'
      });
    }

    // Download current PDF from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(currentStoragePath);

    if (downloadError) {
      return res.status(500).json({
        success: false,
        error: `Failed to download document: ${downloadError.message}`
      });
    }

    // Convert to buffer
    const arrayBuffer = await fileData.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);

    // Add signature to PDF
    const signedPdfBytes = await addSignatureToPDF(
      pdfBytes,
      signature_image,
      signature_position
    );

    // Create new file name for signed version
    const fileName = document.file_name.replace('.pdf', '_signed.pdf');
    const storagePath = currentStoragePath.replace(document.file_name, fileName);

    // Upload signed PDF
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, signedPdfBytes, {
        contentType: 'application/pdf',
        upsert: true // Overwrite if exists
      });

    if (uploadError) {
      return res.status(500).json({
        success: false,
        error: `Upload failed: ${uploadError.message}`
      });
    }

    // Create signature record
    const { data: signatureData, error: sigError } = await supabase
      .from('document_signatures')
      .insert({
        document_id: id,
        signer_user_id,
        signer_role,
        signature_image: signature_image, // Store base64 signature
        signature_method: 'electronic',
        ip_address: ip_address || null,
        user_agent: user_agent || null,
        metadata: {
          signature_position,
          signed_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (sigError) {
      // Try to delete uploaded file
      await supabase.storage.from('documents').remove([storagePath]);
      return res.status(500).json({
        success: false,
        error: `Failed to create signature record: ${sigError.message}`
      });
    }

    // Update document record
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        file_path: storagePath,
        file_name: fileName,
        is_signed: true,
        signed_at: new Date().toISOString(),
        signed_by_user_id: signer_user_id,
        signature_metadata: {
          ip_address: ip_address || null,
          user_agent: user_agent || null,
          signature_method: 'electronic',
          signed_at: new Date().toISOString()
        }
      })
      .eq('document_id', id);

    if (updateError) {
      console.warn('Failed to update document record:', updateError);
    }

    // Check if document is fully signed and notify all parties
    // Note: This is a simplified check - you may want to add metadata about required signers
    try {
      const { data: allSignatures } = await supabase
        .from('document_signatures')
        .select('signer_user_id')
        .eq('document_id', id);

      // Get document download URL for notification
      const { data: signedUrlData } = await supabase.storage
        .from('documents')
        .createSignedUrl(storagePath, 3600); // 1 hour expiry

      if (signedUrlData?.signedUrl && allSignatures) {
        // Get all unique signer user IDs
        const signerUserIds = [...new Set(allSignatures.map(s => s.signer_user_id))];
        
        // For now, we'll notify all signers when any signature is added
        // In production, you may want to check if all required signers have signed
        // based on document metadata or type-specific requirements
        const notificationResult = await notifyDocumentFullySigned({
          documentId: id,
          documentName: document.file_name,
          documentUrl: signedUrlData.signedUrl,
          partyUserIds: signerUserIds
        });

        if (!notificationResult.success && notificationResult.errors) {
          console.warn('Some email notifications failed:', notificationResult.errors);
        }
      }
    } catch (notificationError) {
      // Don't fail the signing if notification fails
      console.warn('Failed to send email notifications:', notificationError);
    }

    return res.status(200).json({
      success: true,
      document_id: id,
      signature_id: signatureData.signature_id,
      file_path: storagePath
    });

  } catch (error) {
    console.error('Document signing error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

