/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { generateHabitabilityRecordPdf } from '../../../utils/document-generator.js';
import { fetchFirstTenantUserId } from '../../../src/utils/lease-tenants.js';
import { formatPersonDisplayName } from '../../../src/utils/lease-display.js';
import { unitNumberText } from '../../../src/utils/unit-display.js';
import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
  toWorkflowDateString,
} from '../../../src/utils/workflow-date.js';
import {
  habitabilityIssueTypeLabel,
  habitabilityReferenceDeadline,
  habitabilityRepairWindow,
  normalizeHabitabilityIssueType,
} from '../../../src/utils/habitability-issue.js';
import { detectJurisdictionPackId } from '../../../src/jurisdictions/index.js';

/**
 * POST /api/documents/generate/habitability-record
 *
 * Body: lease_id, reported_date, issue_type, issue_description,
 * repair_window_hours, outcome_notes, maintenance_request_id,
 * maintenance_request_label, tenant_names, user_id
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        success: false,
        error: 'Supabase configuration missing',
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let {
      lease_id,
      reported_date,
      issue_type,
      issue_type_label,
      issue_description,
      repair_window_hours,
      repair_window_label,
      repair_deadline,
      outcome_notes,
      maintenance_request_id,
      maintenance_request_label,
      tenant_names,
      user_id,
    } = req.body || {};

    if (user_id) {
      if (typeof user_id === 'string' && user_id.includes('-')) {
        user_id = null;
      } else {
        const parsedUserId = parseInt(user_id, 10);
        user_id = Number.isNaN(parsedUserId) ? null : parsedUserId;
      }
    }

    const issueKind = normalizeHabitabilityIssueType(issue_type);
    if (!lease_id || !isCompleteWorkflowDate(reported_date) || !issueKind) {
      return res.status(400).json({
        success: false,
        error: 'lease_id, written-notice date, and issue type are required',
      });
    }

    const { data: lease, error: leaseError } = await supabase
      .from('leases')
      .select(`
        *,
        units(
          unit_id,
          unit_number,
          properties(property_id, property_name, city_of_jurisdiction)
        )
      `)
      .eq('lease_id', lease_id)
      .single();

    if (leaseError || !lease) {
      return res.status(404).json({
        success: false,
        error: `Lease not found: ${leaseError?.message || 'Unknown error'}`,
      });
    }

    const unit = Array.isArray(lease.units) ? lease.units[0] : lease.units;
    const property = Array.isArray(unit?.properties) ? unit.properties[0] : unit?.properties;
    const packId = detectJurisdictionPackId(property);
    const window = habitabilityRepairWindow(packId, issueKind);
    const reportedIso = toWorkflowDateString(reported_date);
    const locale = 'en-US';
    const deadlineIso =
      toWorkflowDateString(repair_deadline) ||
      habitabilityReferenceDeadline(reportedIso, Number(repair_window_hours) || window.hours);

    const { data: leaseClients } = await supabase
      .from('lease_clients')
      .select(`
        client_id,
        clients (
          client_id,
          user_id,
          users:users!clients_user_id_fkey ( email )
        )
      `)
      .eq('lease_id', lease_id);
    const contactableIds = [];
    for (const row of leaseClients || []) {
      const client = row.clients;
      if (client?.user_id) contactableIds.push(client.user_id);
      if (client?.client_id) contactableIds.push(client.client_id);
    }
    let contactById = new Map();
    if (contactableIds.length) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('first_name, middle_name, last_name, contactable_id')
        .in('contactable_id', [...new Set(contactableIds)]);
      contactById = new Map(
        (contacts || []).map((c) => [String(c.contactable_id), c])
      );
    }
    const resolvedNames = [];
    for (const row of leaseClients || []) {
      const client = row.clients;
      const contact =
        contactById.get(String(client?.user_id)) ||
        contactById.get(String(client?.client_id));
      const label = formatPersonDisplayName({
        first_name: contact?.first_name,
        middle_name: contact?.middle_name,
        last_name: contact?.last_name,
        email: client?.users?.email,
      });
      if (label) resolvedNames.push(label);
    }

    const { pdfBytes } = await generateHabitabilityRecordPdf({
      tenantNames: String(tenant_names || '').trim() || resolvedNames.join(', ') || 'Tenant',
      propertyName: property?.property_name || '',
      unitNumber: unitNumberText(unit),
      issueType: issueKind,
      issueTypeLabel: issue_type_label || habitabilityIssueTypeLabel(issueKind),
      reportedDateLabel: formatWorkflowDateForLocale(reportedIso, locale),
      repairWindowLabel: repair_window_label || window.label,
      deadlineLabel: deadlineIso ? formatWorkflowDateForLocale(deadlineIso, locale) : '',
      issueDescription: String(issue_description || '').trim(),
      outcomeNotes: String(outcome_notes || '').trim(),
      maintenanceRequestLabel: String(maintenance_request_label || '').trim(),
    });

    const fileName = `habitability_record_${lease_id}_${Date.now()}.pdf`;
    const storagePath = `documents/habitability/${lease_id}/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      return res.status(500).json({
        success: false,
        error: `Upload failed: ${uploadError.message}`,
      });
    }

    const tenantUserId = await fetchFirstTenantUserId(supabase, lease_id);
    const insertPayload = {
      lease_id,
      document_name: 'Habitability Issue Worksheet',
      file_name: fileName,
      storage_path: storagePath,
      file_type: 'application/pdf',
      file_size: pdfBytes.length,
      mime_type: 'application/pdf',
      uploaded_by_user_id: user_id || null,
      document_type: 'habitability_record',
      metadata: {
        reported_date: reportedIso,
        issue_type: issueKind,
        repair_window_hours: Number(repair_window_hours) || window.hours,
        maintenance_request_id: maintenance_request_id || null,
        generated_at: new Date().toISOString(),
      },
    };
    if (tenantUserId) insertPayload.tenant_user_id = tenantUserId;
    if (unit?.unit_id) insertPayload.unit_id = unit.unit_id;
    if (property?.property_id) insertPayload.property_id = property.property_id;

    const { data: documentData, error: dbError } = await supabase
      .from('documents')
      .insert(insertPayload)
      .select()
      .single();

    if (dbError) {
      await supabase.storage.from('documents').remove([storagePath]);
      return res.status(500).json({
        success: false,
        error: `Database error: ${dbError.message}`,
      });
    }

    return res.status(200).json({
      success: true,
      document_id: documentData.document_id,
      file_path: storagePath,
    });
  } catch (error) {
    console.error('Habitability record generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
