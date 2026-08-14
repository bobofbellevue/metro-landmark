/**
 * Close Resolved Maintenance Requests Cron Job
 * 
 * This job runs periodically to automatically close maintenance requests
 * when appointments are marked as completed with resolved_issue = true.
 * 
 * Setup in Vercel:
 * - Add to vercel.json cron jobs
 * - Schedule: Every hour (0 * * * *)
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Verify this is a cron job request
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.SUPABASE_URL || !supabaseSecretKey) {
    console.error('[Close Resolved Requests] Supabase credentials not set');
    return res.status(500).json({ error: 'Database credentials missing' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    supabaseSecretKey
  );

  try {
    console.log('[Close Resolved Requests] Starting job...');

    // Find appointments that should close maintenance requests:
    // - status = 'completed'
    // - resolved_issue = true
    // - maintenance request status != 'Completed'
    const { data: appointments, error: appointmentsError } = await supabase
      .from('client_appointments')
      .select(`
        appointment_id,
        maintenance_request_id,
        actual_date_time,
        scheduled_date_time,
        result,
        maintenance_requests!inner(
          request_id,
          status,
          description
        )
      `)
      .eq('status', 'completed')
      .eq('resolved_issue', true)
      .neq('maintenance_requests.status', 'Completed')
      .is('is_archived', false);

    if (appointmentsError) {
      console.error('[Close Resolved Requests] Error fetching appointments:', appointmentsError);
      return res.status(500).json({ error: 'Error fetching appointments' });
    }

    if (!appointments || appointments.length === 0) {
      console.log('[Close Resolved Requests] No resolved appointments found');
      return res.json({
        success: true,
        message: 'No resolved appointments found',
        processed: 0
      });
    }

    console.log(`[Close Resolved Requests] Found ${appointments.length} resolved appointments`);

    const results = [];

    for (const appointment of appointments) {
      try {
        const maintenanceRequestId = appointment.maintenance_request_id;
        const completionDate = appointment.actual_date_time || appointment.scheduled_date_time;

        // Update maintenance request
        const updateData = {
          status: 'Completed',
          completed_at: completionDate
        };

        // Add note about which appointment resolved it
        const { data: currentRequest } = await supabase
          .from('maintenance_requests')
          .select('admin_notes')
          .eq('request_id', maintenanceRequestId)
          .single();

        const appointmentNote = `Resolved by appointment on ${new Date(completionDate).toLocaleString()}. Appointment ID: ${appointment.appointment_id}.${appointment.result ? ` Result: ${appointment.result}` : ''}`;
        
        updateData.admin_notes = currentRequest?.admin_notes
          ? `${currentRequest.admin_notes}\n\n${appointmentNote}`
          : appointmentNote;

        const { error: updateError } = await supabase
          .from('maintenance_requests')
          .update(updateData)
          .eq('request_id', maintenanceRequestId);

        if (updateError) {
          console.error(`[Close Resolved Requests] Error updating request ${maintenanceRequestId}:`, updateError);
          results.push({
            appointment_id: appointment.appointment_id,
            maintenance_request_id: maintenanceRequestId,
            success: false,
            error: updateError.message
          });
        } else {
          console.log(`[Close Resolved Requests] Successfully closed request ${maintenanceRequestId}`);
          results.push({
            appointment_id: appointment.appointment_id,
            maintenance_request_id: maintenanceRequestId,
            success: true
          });
        }
      } catch (error) {
        console.error(`[Close Resolved Requests] Error processing appointment ${appointment.appointment_id}:`, error);
        results.push({
          appointment_id: appointment.appointment_id,
          maintenance_request_id: appointment.maintenance_request_id,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return res.json({
      success: successCount > 0,
      processed: results.length,
      successful: successCount,
      failed: results.length - successCount,
      results
    });

  } catch (error) {
    console.error('[Close Resolved Requests] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

