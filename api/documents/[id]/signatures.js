/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to get all signatures for a document
 * 
 * GET /api/documents/:id/signatures
 * 
 * Response:
 * {
 *   success: boolean,
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

    // Get all signatures for document
    const { data: signatures, error } = await supabase
      .from('document_signatures')
      .select(`
        *,
        signer:users(user_id, email)
      `)
      .eq('document_id', id)
      .order('signed_at', { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.status(200).json({
      success: true,
      signatures: signatures || []
    });

  } catch (error) {
    console.error('Get signatures error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

