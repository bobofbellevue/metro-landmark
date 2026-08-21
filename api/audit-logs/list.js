/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';
import { applyCors } from '../utils/cors.js';
import { requireCompanyAdminUser, sendAuthError } from '../utils/session.js';

/**
 * Vercel serverless function to list audit logs
 *
 * GET /api/audit-logs/list
 *
 * Authorization: Bearer session token. Role is loaded from the users table;
 * client x-user-role headers are ignored.
 */
export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');

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
    const {
      table_name,
      record_id,
      user_id,
      action,
      start_date,
      end_date,
      limit = 100,
      offset = 0,
      search
    } = req.query;

    // Build query
    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    // Apply filters
    if (table_name) {
      query = query.eq('table_name', table_name);
    }

    if (record_id) {
      query = query.eq('record_id', parseInt(record_id));
    }

    if (user_id) {
      query = query.eq('user_id', parseInt(user_id));
    }

    // Track if we need to filter Archive/Reinstate after fetching
    let filterArchiveReinstate = null;
    
    if (action) {
      const actionUpper = action.toUpperCase();
      // Handle Archive and Reinstate as special cases (UPDATE actions with is_archived changes)
      if (actionUpper === 'ARCHIVE' || actionUpper === 'REINSTATE') {
        // Fetch UPDATE records with is_archived in changed_fields, filter in JavaScript
        query = query.eq('action', 'UPDATE');
        query = query.contains('changed_fields', ['is_archived']);
        filterArchiveReinstate = actionUpper;
      } else {
        // Standard actions: INSERT, UPDATE, DELETE
        query = query.eq('action', actionUpper);
      }
    }

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    // Search in changed_fields (array search)
    if (search) {
      query = query.contains('changed_fields', [search]);
    }

    // Limit max results
    const maxLimit = Math.min(parseInt(limit), 1000);
    query = query.limit(maxLimit);

    // Execute query
    let { data: logs, error, count } = await query;

    if (error) {
      console.error('Error fetching audit logs:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch audit logs'
      });
    }

    // Filter Archive/Reinstate if needed
    if (filterArchiveReinstate && logs) {
      logs = logs.filter(log => {
        const oldArchived = log.old_values?.is_archived;
        const newArchived = log.new_values?.is_archived;
        
        if (filterArchiveReinstate === 'ARCHIVE') {
          // Archive: is_archived changed from false to true
          return oldArchived === false && newArchived === true;
        } else if (filterArchiveReinstate === 'REINSTATE') {
          // Reinstate: is_archived changed from true to false
          return oldArchived === true && newArchived === false;
        }
        return false;
      });
      // Update count to reflect filtered results
      count = logs.length;
    }

    // Enrich logs with user information
    const userIds = [...new Set(logs.filter(log => log.user_id).map(log => log.user_id))];
    let usersMap = {};

    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('user_id, email, role')
        .in('user_id', userIds);

      if (users) {
        usersMap = users.reduce((acc, user) => {
          acc[user.user_id] = user;
          return acc;
        }, {});
      }
    }

    // Enrich logs with user info
    const enrichedLogs = logs.map(log => ({
      ...log,
      user: log.user_id ? usersMap[log.user_id] : null
    }));

    return res.status(200).json({
      success: true,
      logs: enrichedLogs,
      total: count,
      limit: maxLimit,
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Unexpected error in audit-logs/list:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

