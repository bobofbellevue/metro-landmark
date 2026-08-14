/* eslint-env node */
/* global process */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to list documents
 * 
 * GET /api/documents/list
 * 
 * Query params:
 * - document_type: String (optional filter, matched case-insensitively and by substring)
 * - lease_id: Integer (optional filter, documents linked to a lease)
 * - notice_id: Integer (optional filter, documents linked to a legal notice)
 * - is_signed: Boolean (optional filter)
 * 
 * Response:
 * {
 *   success: boolean,
 *   documents?: Array,
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
    // Initialize Supabase client with service role key (bypasses RLS)
    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL;

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

    // Build query with filters
    let query = supabase.from('documents').select('*');

    // Filter by document_type (substring match, case-insensitive)
    if (req.query.document_type) {
      const docType = String(req.query.document_type).trim();
      if (docType) {
        query = query.ilike('document_type', `%${docType}%`);
      }
    }

    // Entity filters: when more than one identity filter is present, OR them
    // so lease-linked notices still appear alongside tenant-linked uploads.
    const orClauses = [];

    if (req.query.lease_id) {
      const leaseId = parseInt(req.query.lease_id, 10);
      if (!Number.isNaN(leaseId)) {
        orClauses.push(`lease_id.eq.${leaseId}`);
      }
    }

    if (req.query.lease_ids) {
      const leaseIds = String(req.query.lease_ids)
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      if (leaseIds.length > 0) {
        orClauses.push(`lease_id.in.(${leaseIds.join(',')})`);
      }
    }

    if (req.query.tenant_user_id) {
      const tenantUserId = parseInt(req.query.tenant_user_id, 10);
      if (!Number.isNaN(tenantUserId)) {
        orClauses.push(`tenant_user_id.eq.${tenantUserId}`);
      }
    }

    if (req.query.unit_id) {
      const unitId = parseInt(req.query.unit_id, 10);
      if (!Number.isNaN(unitId)) {
        orClauses.push(`unit_id.eq.${unitId}`);
      }
    }

    if (req.query.property_id) {
      const propertyId = parseInt(req.query.property_id, 10);
      if (!Number.isNaN(propertyId)) {
        orClauses.push(`property_id.eq.${propertyId}`);
      }
    }

    if (orClauses.length > 0) {
      query = query.or(orClauses.join(','));
    }

    // Note: notice_id is not a direct FK in documents table, it's stored in metadata
    // If filtering by notice_id is needed, it would require a metadata query

    if (req.query.is_signed !== undefined) {
      query = query.eq('is_signed', req.query.is_signed === 'true');
    }

    // Order by created_at descending
    query = query.order('created_at', { ascending: false });

    const { data: documents, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.status(200).json({
      success: true,
      documents: documents || []
    });

  } catch (error) {
    console.error('Document list error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

