/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to check signature status for a document
 * 
 * GET /api/documents/:id/signature-status
 * 
 * Response:
 * {
 *   success: boolean,
 *   is_fully_signed?: boolean,
 *   signatures_count?: number,
 *   required_signatures?: number,
 *   signatures?: Array,
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

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Document ID is required'
      });
    }

    // Get document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('document_id, document_type, metadata')
      .eq('document_id', id)
      .single();

    if (docError || !document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // Get all signatures for document
    const { data: signatures, error: sigError } = await supabase
      .from('document_signatures')
      .select(`
        signature_id,
        signer_user_id,
        signer_role,
        signed_at,
        signer:users(user_id, email, first_name, last_name)
      `)
      .eq('document_id', id)
      .order('signed_at', { ascending: true });

    if (sigError) {
      return res.status(500).json({
        success: false,
        error: sigError.message
      });
    }

    const signaturesCount = signatures?.length || 0;
    
    // Determine required signatures based on document type
    // This is a simplified check - you may want to store required_signers in document metadata
    let requiredSignatures = 1; // Default to 1
    const metadata = document.metadata || {};
    
    if (metadata.required_signers) {
      requiredSignatures = metadata.required_signers;
    } else {
      // Default logic based on document type
      if (document.document_type === 'lease_document') {
        requiredSignatures = 2; // Typically landlord and tenant
      } else if (document.document_type === 'application') {
        requiredSignatures = 1; // Just applicant
      }
    }

    const isFullySigned = signaturesCount >= requiredSignatures;

    return res.status(200).json({
      success: true,
      is_fully_signed: isFullySigned,
      signatures_count: signaturesCount,
      required_signatures: requiredSignatures,
      signatures: signatures || []
    });

  } catch (error) {
    console.error('Get signature status error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

