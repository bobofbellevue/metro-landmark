/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to export audit logs
 * 
 * GET /api/audit-logs/export
 * 
 * Query params:
 * - format: String ('csv' or 'json', default: 'csv')
 * - table_name: String (optional filter)
 * - record_id: Integer (optional filter)
 * - user_id: Integer (optional filter)
 * - action: String (optional filter)
 * - start_date: ISO date string (optional)
 * - end_date: ISO date string (optional)
 * 
 * Headers:
 * - x-user-id: Integer (required)
 * - x-user-role: String (required - must be admin)
 * 
 * Response:
 * - CSV: text/csv with audit log data
 * - JSON: application/json with audit log array
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

    // Only global_admin and company_admin can export audit logs
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
    const {
      format = 'csv',
      table_name,
      record_id,
      user_id,
      action,
      start_date,
      end_date
    } = req.query;

    // Build query (no limit for exports)
    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10000); // Max 10k records for export

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

    if (action) {
      query = query.eq('action', action.toUpperCase());
    }

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    // Execute query
    const { data: logs, error } = await query;

    if (error) {
      console.error('Error fetching audit logs for export:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch audit logs'
      });
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

    // Format response based on requested format
    if (format.toLowerCase() === 'csv') {
      // Generate CSV
      const headers = [
        'Audit ID',
        'Table Name',
        'Record ID',
        'Action',
        'User ID',
        'User Email',
        'User Role',
        'Changed Fields',
        'Created At'
      ];

      const rows = logs.map(log => {
        const user = log.user_id ? usersMap[log.user_id] : null;
        return [
          log.audit_id,
          log.table_name,
          log.record_id,
          log.action,
          log.user_id || '',
          user?.email || '',
          user?.role || '',
          (log.changed_fields || []).join('; '),
          log.created_at
        ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
      });

      const csv = [headers.join(','), ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.status(200).send(csv);
    } else {
      // Return JSON
      const enrichedLogs = logs.map(log => ({
        ...log,
        user: log.user_id ? usersMap[log.user_id] : null
      }));

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.json"`);
      return res.status(200).json({
        success: true,
        logs: enrichedLogs,
        exported_at: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Unexpected error in audit-logs/export:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

