/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to list audit logs
 * 
 * GET /api/audit-logs/list
 * 
 * Query params:
 * - table_name: String (optional filter)
 * - record_id: Integer (optional filter)
 * - user_id: Integer (optional filter)
 * - action: String (optional filter: INSERT, UPDATE, DELETE)
 * - start_date: ISO date string (optional)
 * - end_date: ISO date string (optional)
 * - limit: Integer (default: 100, max: 1000)
 * - offset: Integer (default: 0)
 * - search: String (optional - searches in changed_fields)
 * 
 * Headers:
 * - x-user-id: Integer (required for authentication)
 * - x-user-role: String (required - must be admin)
 * 
 * Response:
 * {
 *   success: boolean,
 *   logs?: Array,
 *   total?: number,
 *   error?: string
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, x-user-role');

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
    // Check authentication
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!userId || !userRole) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Only global_admin and company_admin can view audit logs
    if (userRole !== 'global_admin' && userRole !== 'company_admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Global Admin or Company Admin privileges required.'
      });
    }

    // Initialize Supabase client
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

