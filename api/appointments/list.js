/**
 * List Appointments API
 * 
 * GET /api/appointments/list
 * Lists appointments with optional filtering.
 * 
 * Query parameters:
 * - clientId: Filter by client ID
 * - vendorId: Filter by vendor ID
 * - maintenanceRequestId: Filter by maintenance request ID
 * - status: Filter by status
 * - startDate: Filter appointments on or after this date (ISO 8601)
 * - endDate: Filter appointments on or before this date (ISO 8601)
 * - limit: Maximum number of results (default: 50)
 * - offset: Offset for pagination (default: 0)
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.SUPABASE_URL || !supabaseSecretKey) {
    return res.status(500).json({ error: 'Database credentials missing' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    supabaseSecretKey
  );

  try {
    const {
      clientId,
      vendorId,
      maintenanceRequestId,
      status,
      startDate,
      endDate,
      limit = 50,
      offset = 0
    } = req.query;

    // Build query
    let query = supabase
      .from('client_appointments')
      .select(`
        *,
        clients!inner(
          client_id,
          user_id
        ),
        vendors!inner(
          vendor_id,
          company_name
        ),
        maintenance_requests!inner(
          request_id,
          description,
          priority,
          status
        )
      `)
      .is('is_archived', false);

    // Apply filters
    if (clientId) {
      query = query.eq('client_id', clientId);
    }

    if (vendorId) {
      query = query.eq('vendor_id', vendorId);
    }

    if (maintenanceRequestId) {
      query = query.eq('maintenance_request_id', maintenanceRequestId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (startDate) {
      query = query.gte('scheduled_date_time', startDate);
    }

    if (endDate) {
      query = query.lte('scheduled_date_time', endDate);
    }

    // Order by scheduled date/time
    query = query.order('scheduled_date_time', { ascending: true });

    // Apply pagination
    const limitNum = parseInt(limit, 10);
    const offsetNum = parseInt(offset, 10);
    query = query.range(offsetNum, offsetNum + limitNum - 1);

    const { data: appointments, error, count } = await query;

    if (error) {
      console.error('[List Appointments] Error:', error);
      return res.status(500).json({
        error: 'Failed to fetch appointments',
        details: error.message
      });
    }

    return res.json({
      success: true,
      appointments: appointments || [],
      count: appointments?.length || 0,
      limit: limitNum,
      offset: offsetNum
    });

  } catch (error) {
    console.error('[List Appointments] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

