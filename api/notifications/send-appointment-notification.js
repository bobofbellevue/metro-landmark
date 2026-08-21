/**
 * Send Appointment Notification
 * 
 * Sends appointment confirmation notifications to tenants based on their notification preferences.
 * Called after an appointment is scheduled (by voice bot, cron job, or admin).
 */

import { createClient } from '@supabase/supabase-js';
import { sendNotification } from '../utils/notification-service.js';

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

  // Verify authorization (optional - can be called internally)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Allow if no secret is set (for internal calls)
    if (cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.SUPABASE_URL || !supabaseSecretKey) {
    console.error('[Send Appointment Notification] Supabase credentials not set');
    return res.status(500).json({ error: 'Database credentials missing' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    supabaseSecretKey
  );

  try {
    const { appointmentId } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ error: 'appointmentId is required' });
    }

    console.log('[Send Appointment Notification] Sending notification for appointment:', appointmentId);

    // Get appointment details with related data
    const { data: appointment, error: appointmentError } = await supabase
      .from('client_appointments')
      .select(`
        appointment_id,
        scheduled_date_time,
        estimated_duration_minutes,
        notes,
        client_id,
        vendor_id,
        maintenance_request_id,
        vendors!inner(
          company_name
        ),
        maintenance_requests!inner(
          description,
          priority,
          units!inner(
            unit_number,
            properties!inner(
              property_name
            )
          )
        )
      `)
      .eq('appointment_id', appointmentId)
      .single();

    if (appointmentError || !appointment) {
      console.error('[Send Appointment Notification] Error fetching appointment:', appointmentError);
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Get client's user_id
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('user_id')
      .eq('client_id', appointment.client_id)
      .single();

    if (clientError || !client) {
      console.error('[Send Appointment Notification] Error fetching client:', clientError);
      return res.status(404).json({ error: 'Client not found' });
    }

    const userId = client.user_id;

    // Format appointment date/time
    const scheduledDate = new Date(appointment.scheduled_date_time);
    const formattedDate = scheduledDate.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    // Format duration
    const durationText = appointment.estimated_duration_minutes
      ? `approximately ${appointment.estimated_duration_minutes} minutes`
      : 'a standard service visit';

    // Build notification message
    const unitNumber = appointment.maintenance_requests?.units?.unit_number || '';
    const propertyName = appointment.maintenance_requests?.units?.properties?.property_name || '';
    const location = [unitNumber ? `Unit ${unitNumber}` : '', propertyName].filter(Boolean).join(' at ');
    const vendorName = appointment.vendors?.company_name || 'Vendor';
    const issueDescription = appointment.maintenance_requests?.description || 'Maintenance issue';
    const priority = appointment.maintenance_requests?.priority || 'Not specified';

    const subject = `Maintenance Appointment Scheduled - ${formattedDate}`;
    
    const message = `Your maintenance appointment has been scheduled.

**Appointment Details:**
- Date & Time: ${formattedDate}
- Duration: ${durationText}
- Vendor: ${vendorName}
- Location: ${location || propertyName}

**Maintenance Issue:**
- Description: ${issueDescription}
- Priority: ${priority}
${appointment.notes ? `\n**Notes:** ${appointment.notes}` : ''}

Please be available at the scheduled time. If you need to reschedule or have questions, please contact your property manager.

Thank you!`;

    // Send notifications via all enabled channels
    const results = [];
    const notificationTypes = ['email', 'sms', 'push'];

    for (const notificationType of notificationTypes) {
      try {
        const result = await sendNotification({
          userId,
          notificationType,
          category: 'maintenance',
          subject,
          message,
          metadata: {
            appointment_id: appointmentId,
            maintenance_request_id: appointment.maintenance_request_id,
            scheduled_date_time: appointment.scheduled_date_time
          }
        }, supabase);

        results.push({
          type: notificationType,
          success: result.success,
          notificationId: result.notificationId,
          error: result.error
        });

        if (result.success) {
          console.log(`[Send Appointment Notification] ${notificationType} notification sent successfully`);
        } else {
          console.log(`[Send Appointment Notification] ${notificationType} notification skipped: ${result.error}`);
        }
      } catch (error) {
        console.error(`[Send Appointment Notification] Error sending ${notificationType} notification:`, error);
        results.push({
          type: notificationType,
          success: false,
          error: error.message
        });
      }
    }

    // Return success if at least one notification was sent
    const successCount = results.filter(r => r.success).length;
    const success = successCount > 0;

    return res.json({
      success,
      appointmentId,
      userId,
      notificationsSent: successCount,
      results
    });

  } catch (error) {
    console.error('[Send Appointment Notification] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

