/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';
import {
  LEASE_SCOPED_WORKFLOW_TYPES,
  resolveWorkflowPostAction,
  workflowProgressStatus,
} from '../../src/utils/compliance-workflow-persistence.js';
import { COMPLIANCE_WORKFLOW_DETAIL_SELECT, fillWorkflowLeaseScope } from '../../src/utils/workflow-lease-context.js';

async function scopeFromLeaseId(supabase, fields) {
  const leaseId = fields?.lease_id;
  if (leaseId == null || leaseId === '') {
    return fillWorkflowLeaseScope(fields, null);
  }
  if (fields.unit_id && fields.property_id) {
    return fillWorkflowLeaseScope(fields, null);
  }
  const { data: lease } = await supabase
    .from('leases')
    .select('lease_id, unit_id, landlord_id')
    .eq('lease_id', leaseId)
    .maybeSingle();
  if (!lease) {
    return fillWorkflowLeaseScope(fields, null);
  }
  let unit = null;
  const unitId = fields.unit_id || lease.unit_id;
  if (unitId && !fields.property_id) {
    const { data: unitRow } = await supabase
      .from('units')
      .select('unit_id, property_id')
      .eq('unit_id', unitId)
      .maybeSingle();
    unit = unitRow;
  }
  return fillWorkflowLeaseScope(fields, { ...lease, units: unit });
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Database configuration error',
    });
  }

  try {
    const { method } = req;
    const { id } = req.query;

    // GET /api/compliance/workflows or /api/compliance/workflows/:id
    if (method === 'GET') {
      if (id) {
        // Get single workflow
        const { data, error } = await supabase
          .from('compliance_workflows')
          .select(COMPLIANCE_WORKFLOW_DETAIL_SELECT)
          .eq('workflow_id', id)
          .single();

        if (error) {
          return res.status(404).json({ success: false, error: error.message });
        }

        return res.status(200).json({ success: true, workflow: data });
      } else {
        // List workflows with filters
        const { lease_id, status, workflow_type, jurisdiction } = req.query;
        let query = supabase
          .from('compliance_workflows')
          .select(COMPLIANCE_WORKFLOW_DETAIL_SELECT)
          .order('created_at', { ascending: false });

        if (lease_id) query = query.eq('lease_id', lease_id);
        if (status) query = query.eq('status', status);
        if (workflow_type) query = query.eq('workflow_type', workflow_type);
        if (jurisdiction) query = query.eq('jurisdiction', jurisdiction);

        const { data, error } = await query;

        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }

        return res.status(200).json({ success: true, workflows: data || [] });
      }
    }

    // POST actions (complete / cancel) must be handled before create —
    // they share method=POST and were previously swallowed by the create branch.
    if (method === 'POST') {
      const postAction = resolveWorkflowPostAction(req.query);

      if (postAction === 'complete') {
        const { workflow_data, completed_at } = req.body || {};

        const updateData = {
          status: 'completed',
          current_step: 999,
          completed_at: completed_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        if (workflow_data) {
          const { data: existing } = await supabase
            .from('compliance_workflows')
            .select('workflow_data')
            .eq('workflow_id', id)
            .single();

          if (existing) {
            updateData.workflow_data = { ...existing.workflow_data, ...workflow_data };
          } else {
            updateData.workflow_data = workflow_data;
          }
        }

        const { data, error } = await supabase
          .from('compliance_workflows')
          .update(updateData)
          .eq('workflow_id', id)
          .select()
          .single();

        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }

        return res.status(200).json({ success: true, workflow: data });
      }

      if (postAction === 'cancel') {
        const { data, error } = await supabase
          .from('compliance_workflows')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('workflow_id', id)
          .select()
          .single();

        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }

        return res.status(200).json({ success: true, workflow: data });
      }

      // POST /api/compliance/workflows — create
      const {
        workflow_type,
        lease_id,
        unit_id,
        property_id,
        tenant_user_id,
        landlord_id,
        jurisdiction,
        total_steps,
        current_step,
        workflow_data,
        created_by_user_id
      } = req.body || {};

      if (!workflow_type || !total_steps) {
        return res.status(400).json({
          success: false,
          error: 'workflow_type and total_steps are required'
        });
      }

      if (
        LEASE_SCOPED_WORKFLOW_TYPES.has(workflow_type) &&
        (lease_id == null || lease_id === '')
      ) {
        return res.status(400).json({
          success: false,
          error: 'lease_id is required before creating this workflow'
        });
      }

      const step = Number(current_step);
      const scoped = await scopeFromLeaseId(supabase, {
        lease_id,
        unit_id,
        property_id,
        landlord_id,
      });
      const { data, error } = await supabase
        .from('compliance_workflows')
        .insert({
          workflow_type,
          lease_id: scoped.lease_id,
          unit_id: scoped.unit_id,
          property_id: scoped.property_id,
          tenant_user_id: tenant_user_id || null,
          landlord_id: scoped.landlord_id,
          jurisdiction: jurisdiction || 'washington_state',
          total_steps,
          current_step:
            Number.isFinite(step) && step >= 1 ? Math.min(step, total_steps) : 1,
          workflow_data: workflow_data || {},
          created_by_user_id: created_by_user_id || null,
          status: 'in_progress',
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(201).json({ success: true, workflow: data });
    }

    // PUT /api/compliance/workflows/:id
    if (method === 'PUT') {
      if (!id) {
        return res.status(400).json({ success: false, error: 'Workflow ID required' });
      }

      const {
        status,
        current_step,
        notice_period_days,
        required_notice_date,
        effective_date,
        served_date,
        served_method,
        proof_of_service,
        workflow_data,
        completed_at,
        lease_id,
        unit_id,
        property_id,
        landlord_id,
      } = req.body || {};

      const updateData = {};
      if (status !== undefined) updateData.status = status;
      if (current_step !== undefined) updateData.current_step = current_step;
      if (notice_period_days !== undefined) updateData.notice_period_days = notice_period_days;
      if (required_notice_date !== undefined) updateData.required_notice_date = required_notice_date;
      if (effective_date !== undefined) updateData.effective_date = effective_date;
      if (served_date !== undefined) updateData.served_date = served_date;
      if (served_method !== undefined) updateData.served_method = served_method;
      if (proof_of_service !== undefined) updateData.proof_of_service = proof_of_service;
      if (workflow_data !== undefined) updateData.workflow_data = workflow_data;
      if (completed_at !== undefined) updateData.completed_at = completed_at;

      const leaseId = lease_id ?? workflow_data?.lease_id;
      if (leaseId != null && leaseId !== '') {
        const scoped = await scopeFromLeaseId(supabase, {
          lease_id: leaseId,
          unit_id,
          property_id,
          landlord_id,
        });
        updateData.lease_id = scoped.lease_id;
        updateData.unit_id = scoped.unit_id;
        updateData.property_id = scoped.property_id;
        if (scoped.landlord_id != null) updateData.landlord_id = scoped.landlord_id;
      }

      const { data, error } = await supabase
        .from('compliance_workflows')
        .update(updateData)
        .eq('workflow_id', id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true, workflow: data });
    }

    // DELETE /api/compliance/workflows/:id
    if (method === 'DELETE') {
      if (!id) {
        return res.status(400).json({ success: false, error: 'Workflow ID required' });
      }

      const { error } = await supabase
        .from('compliance_workflows')
        .delete()
        .eq('workflow_id', id);

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Compliance workflows API error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
