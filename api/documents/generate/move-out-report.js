/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { generateMoveOutInspectionPdf } from '../../../utils/document-generator.js';
import { fetchFirstTenantUserId } from '../../../src/utils/lease-tenants.js';
import { formatPersonDisplayName } from '../../../src/utils/lease-display.js';
import { unitNumberText } from '../../../src/utils/unit-display.js';
import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
  toWorkflowDateString,
} from '../../../src/utils/workflow-date.js';
import { tenantPresentFlag } from '../../../src/utils/move-in-condition-report.js';
import { normalizeMoveOutChecklistItems } from '../../../src/utils/move-out-inspection.js';
import { normalizeDepositDeductions } from '../../../src/utils/deposit-return-statement.js';

/**
 * POST /api/documents/generate/move-out-report
 *
 * Body: lease_id, inspection_date, tenant_present, overall_condition,
 * condition_notes, checklist[], deductions[], move_in_inspection_date,
 * tenant_names, user_id
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
      inspection_date,
      tenant_present,
      overall_condition,
      condition_notes,
      checklist = [],
      deductions = [],
      move_in_inspection_date,
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

    if (!lease_id || !isCompleteWorkflowDate(inspection_date)) {
      return res.status(400).json({
        success: false,
        error: 'lease_id and inspection date are required',
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
    const inspectionIso = toWorkflowDateString(inspection_date);
    const locale = 'en-US';
    const inspectionLabel = formatWorkflowDateForLocale(inspectionIso, locale);
    const moveInIso = isCompleteWorkflowDate(move_in_inspection_date)
      ? toWorkflowDateString(move_in_inspection_date)
      : '';
    const moveInLabel = moveInIso ? formatWorkflowDateForLocale(moveInIso, locale) : '';
    const items = normalizeMoveOutChecklistItems(checklist);
    const deductionRows = normalizeDepositDeductions(deductions);
    const tenantWasPresent = tenantPresentFlag(tenant_present);
    const overall = String(overall_condition || '').trim() || null;
    const notes = String(condition_notes || '').trim() || null;

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

    const { pdfBytes } = await generateMoveOutInspectionPdf({
      tenantNames: tenant_names || resolvedNames.join(', ') || 'Tenant',
      propertyName: property?.property_name || '',
      unitNumber: unitNumberText(unit),
      inspectionDateLabel: inspectionLabel,
      moveInDateLabel: moveInLabel,
      tenantPresent: tenantWasPresent,
      overallCondition: overall,
      checklist: items,
      deductions: deductionRows,
      notes,
    });

    const fileName = `move_out_inspection_${lease_id}_${Date.now()}.pdf`;
    const storagePath = `documents/move_out/${lease_id}/${fileName}`;

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
      document_name: 'Move-Out Inspection Report',
      file_name: fileName,
      storage_path: storagePath,
      file_type: 'application/pdf',
      file_size: pdfBytes.length,
      mime_type: 'application/pdf',
      uploaded_by_user_id: user_id || null,
      document_type: 'move_out_inspection_report',
      metadata: {
        inspection_date: inspectionIso,
        tenant_present: tenantWasPresent,
        overall_condition: overall,
        deduction_count: deductionRows.length,
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

    let inspectionId = null;
    if (unit?.unit_id) {
      const { data: inspectionRow, error: inspectionError } = await supabase
        .from('property_inspections')
        .insert({
          lease_id,
          unit_id: unit.unit_id,
          inspection_type: 'move_out',
          inspection_date: inspectionIso,
          conducted_by_user_id: user_id || null,
          tenant_present: tenantWasPresent,
          tenant_user_id: tenantUserId || null,
          condition_report: {
            items,
            overall_condition: overall,
            notes,
            deductions: deductionRows,
            move_in_inspection_date: moveInIso || null,
          },
          notes,
          overall_condition: overall,
        })
        .select('inspection_id')
        .single();

      if (!inspectionError && inspectionRow?.inspection_id) {
        inspectionId = inspectionRow.inspection_id;
      } else if (inspectionError) {
        console.warn('[Move-out report] property_inspections insert skipped:', inspectionError.message);
      }
    }

    return res.status(200).json({
      success: true,
      document_id: documentData.document_id,
      inspection_id: inspectionId,
      file_path: storagePath,
    });
  } catch (error) {
    console.error('Move-out inspection generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
