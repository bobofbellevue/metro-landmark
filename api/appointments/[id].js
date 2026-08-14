/**
 * Appointment by ID API
 * 
 * GET /api/appointments/[id] - Get single appointment
 * PUT /api/appointments/[id] - Update appointment
 * DELETE /api/appointments/[id] - Cancel appointment (soft delete)
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.SUPABASE_URL || !supabaseSecretKey) {
    return res.status(500).json({ error: 'Database credentials missing' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    supabaseSecretKey
  );

  const appointmentId = parseInt(req.query.id, 10);

  if (isNaN(appointmentId)) {
    return res.status(400).json({ error: 'Invalid appointment ID' });
  }

  try {
    if (req.method === 'GET') {
      // Get single appointment
      const { data: appointment, error } = await supabase
        .from('client_appointments')
        .select(`
          *,
          clients!inner(
            client_id,
            user_id
          ),
          vendors!inner(
            vendor_id,
            company_name,
            description
          ),
          maintenance_requests!inner(
            request_id,
            description,
            priority,
            status,
            units!inner(
              unit_number,
              properties!inner(
                property_name
              )
            )
          )
        `)
        .eq('appointment_id', appointmentId)
        .is('is_archived', false)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'Appointment not found' });
        }
        console.error('[Get Appointment] Error:', error);
        return res.status(500).json({
          error: 'Failed to fetch appointment',
          details: error.message
        });
      }

      return res.json({
        success: true,
        appointment
      });

    } else if (req.method === 'PUT') {
      // Update appointment
      const {
        scheduledDateTime,
        actualDateTime,
        estimatedDurationMinutes,
        status,
        result,
        resolvedIssue,
        notes,
        vendorContactId
      } = req.body;

      const updateData = {
        updated_at: new Date().toISOString()
      };

      if (scheduledDateTime !== undefined) {
        const scheduledDate = new Date(scheduledDateTime);
        if (isNaN(scheduledDate.getTime())) {
          return res.status(400).json({ error: 'Invalid scheduledDateTime format' });
        }
        updateData.scheduled_date_time = scheduledDate.toISOString();
      }

      if (actualDateTime !== undefined) {
        if (actualDateTime === null) {
          updateData.actual_date_time = null;
        } else {
          const actualDate = new Date(actualDateTime);
          if (isNaN(actualDate.getTime())) {
            return res.status(400).json({ error: 'Invalid actualDateTime format' });
          }
          updateData.actual_date_time = actualDate.toISOString();
        }
      }

      if (estimatedDurationMinutes !== undefined) {
        updateData.estimated_duration_minutes = estimatedDurationMinutes;
      }

      if (status !== undefined) {
        const validStatuses = ['scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled', 'in_progress'];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }
        updateData.status = status;
      }

      if (result !== undefined) {
        updateData.result = result;
      }

      if (resolvedIssue !== undefined) {
        updateData.resolved_issue = resolvedIssue;
      }

      if (notes !== undefined) {
        updateData.notes = notes;
      }

      if (vendorContactId !== undefined) {
        updateData.vendor_contact_id = vendorContactId;
      }

      const { data: appointment, error } = await supabase
        .from('client_appointments')
        .update(updateData)
        .eq('appointment_id', appointmentId)
        .select()
        .single();

      if (error) {
        console.error('[Update Appointment] Error:', error);
        return res.status(500).json({
          error: 'Failed to update appointment',
          details: error.message
        });
      }

      // If appointment is marked as completed with resolved_issue = true, trigger closure check
      if (updateData.status === 'completed' && updateData.resolved_issue === true) {
        // Trigger closure cron job (async - don't wait)
        fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/cron/close-resolved-requests`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
          }
        }).catch(err => {
          console.error('[Update Appointment] Error triggering closure check (non-blocking):', err);
        });
      }

      return res.json({
        success: true,
        appointment
      });

    } else if (req.method === 'DELETE') {
      // Cancel appointment (soft delete - set status to cancelled)
      const { cancelledReason, cancelledByUserId } = req.body;

      const { data: appointment, error } = await supabase
        .from('client_appointments')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by_user_id: cancelledByUserId || null,
          cancelled_reason: cancelledReason || null,
          updated_at: new Date().toISOString()
        })
        .eq('appointment_id', appointmentId)
        .select()
        .single();

      if (error) {
        console.error('[Cancel Appointment] Error:', error);
        return res.status(500).json({
          error: 'Failed to cancel appointment',
          details: error.message
        });
      }

      return res.json({
        success: true,
        appointment
      });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('[Appointment API] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

