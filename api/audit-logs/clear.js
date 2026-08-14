/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to clear audit logs
 * 
 * DELETE /api/audit-logs/clear
 * 
 * Query params:
 * - before_date: ISO date string (optional - delete records older than this date)
 * - all: Boolean (optional - if true, delete all records regardless of date)
 * 
 * Headers:
 * - x-user-id: Integer (required for authentication)
 * - x-user-role: String (required - must be global_admin or company_admin)
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
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, x-user-role');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use DELETE.'
    });
  }

  try {
    // Check authentication
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!userId || !userRole) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Only global_admin and company_admin can clear audit logs
    if (userRole !== 'global_admin' && userRole !== 'company_admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Global Admin or Company Admin privileges required.'
      });
    }

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

    // Get query parameters
    const { before_date, all } = req.query;

    // Determine the date cutoff
    let dateToUse;
    if (all === 'true' || all === true) {
      dateToUse = null; // Delete all
    } else if (before_date) {
      dateToUse = before_date;
    } else {
      // Default: delete records older than 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      dateToUse = ninetyDaysAgo.toISOString();
    }

    // First, count how many records will be deleted
    let countQuery = supabase.from('audit_logs').select('*', { count: 'exact', head: true });
    
    if (dateToUse) {
      countQuery = countQuery.lt('created_at', dateToUse);
    }
    // If dateToUse is null, countQuery already selects all records

    const { count } = await countQuery;

    // Now perform the delete
    let deleteQuery = supabase.from('audit_logs').delete();
    
    if (dateToUse) {
      deleteQuery = deleteQuery.lt('created_at', dateToUse);
    } else {
      // For deleting all records, use a condition that matches everything
      // Since Supabase requires a filter, use .neq() with a value that never exists
      deleteQuery = deleteQuery.neq('audit_id', -1); // This matches all records since audit_id is always >= 0
    }

    const { error } = await deleteQuery;

    if (error) {
      console.error('Error clearing audit logs:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to clear audit logs'
      });
    }

    return res.status(200).json({
      success: true,
      deleted_count: count || 0
    });
  } catch (error) {
    console.error('Unexpected error in audit-logs/clear:', error);
    return res.status(500).json({
      success: false,
    error: 'Internal server error'
    });
  }
}

