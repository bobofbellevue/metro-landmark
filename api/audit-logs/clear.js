/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';
import { applyCors } from '../utils/cors.js';
import { requireCompanyAdminUser, sendAuthError } from '../utils/session.js';

/**
 * Vercel serverless function to clear audit logs
 *
 * DELETE /api/audit-logs/clear
 *
 * Authorization: Bearer session token. Role is loaded from the users table.
 */
export default async function handler(req, res) {
  applyCors(req, res, 'DELETE, OPTIONS');

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
    let supabase;
    try {
      supabase = createSupabaseClient();
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Supabase configuration missing'
      });
    }

    const auth = await requireCompanyAdminUser(req, supabase);
    if (!auth.user) {
      sendAuthError(res, auth);
      return;
    }

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

