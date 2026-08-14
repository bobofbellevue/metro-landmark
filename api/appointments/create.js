/**
 * Create Appointment API
 * 
 * POST /api/appointments/create
 * Creates a new appointment between a tenant and vendor for a maintenance request.
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
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
      scheduledDateTime,
      estimatedDurationMinutes,
      notes,
      vendorContactId,
      createdByUserId
    } = req.body;

    // Validate required fields
    if (!clientId || !vendorId || !maintenanceRequestId || !scheduledDateTime) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientId', 'vendorId', 'maintenanceRequestId', 'scheduledDateTime']
      });
    }

    // Validate date/time
    const scheduledDate = new Date(scheduledDateTime);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid scheduledDateTime format. Must be ISO 8601 format.'
      });
    }

    // Verify maintenance request exists
    const { data: maintenanceRequest, error: requestError } = await supabase
      .from('maintenance_requests')
      .select('request_id, tenant_user_id')
      .eq('request_id', maintenanceRequestId)
      .single();

    if (requestError || !maintenanceRequest) {
      return res.status(404).json({ error: 'Maintenance request not found' });
    }

    // Verify client exists
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('client_id')
      .eq('client_id', clientId)
      .single();

    if (clientError || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Verify vendor exists
    const { data: vendor, error: vendorError } = await supabase
      .from('vendors')
      .select('vendor_id')
      .eq('vendor_id', vendorId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    // Create appointment
    const { data: appointment, error: appointmentError } = await supabase
      .from('client_appointments')
      .insert([{
        client_id: clientId,
        vendor_id: vendorId,
        maintenance_request_id: maintenanceRequestId,
        scheduled_date_time: scheduledDate.toISOString(),
        estimated_duration_minutes: estimatedDurationMinutes || null,
        notes: notes || null,
        vendor_contact_id: vendorContactId || null,
        status: 'scheduled',
        created_by_user_id: createdByUserId || null
      }])
      .select()
      .single();

    if (appointmentError) {
      console.error('[Create Appointment] Error:', appointmentError);
      return res.status(500).json({
        error: 'Failed to create appointment',
        details: appointmentError.message
      });
    }

    // Send notification to tenant (async - don't wait)
    fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/notifications/send-appointment-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
      },
      body: JSON.stringify({
        appointmentId: appointment.appointment_id
      })
    }).catch(err => {
      console.error('[Create Appointment] Error sending notification (non-blocking):', err);
    });

    return res.status(201).json({
      success: true,
      appointment
    });

  } catch (error) {
    console.error('[Create Appointment] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

