/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { generateDepositReturnStatementPdf } from '../../../utils/document-generator.js';
import { fetchFirstTenantUserId } from '../../../src/utils/lease-tenants.js';
import { formatPersonDisplayName } from '../../../src/utils/lease-display.js';
import { unitNumberText } from '../../../src/utils/unit-display.js';
import { detectJurisdiction } from '../../../src/utils/jurisdiction-detector.js';
import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
  toWorkflowDateString,
} from '../../../src/utils/workflow-date.js';
import { calculateDepositReturnDeadline } from '../../../src/utils/compliance-calculator.js';
import {
  normalizeDepositDeductions,
  sumDepositDeductions,
} from '../../../src/utils/deposit-return-statement.js';

/**
 * POST /api/documents/generate/deposit-statement
 *
 * Body: lease_id, vacation_date, security_deposit, pet_deposit, deductions[],
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
      vacation_date,
      security_deposit,
      pet_deposit,
      deductions = [],
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

    if (!lease_id || !isCompleteWorkflowDate(vacation_date)) {
      return res.status(400).json({
        success: false,
        error: 'lease_id and termination/vacation date are required',
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
    const jurisdiction = detectJurisdiction(property);
    const vacationIso = toWorkflowDateString(vacation_date);
    const dueBy = calculateDepositReturnDeadline(vacationIso, jurisdiction);
    const locale = 'en-US';
    const vacationLabel = formatWorkflowDateForLocale(vacationIso, locale);
    const dueByLabel = dueBy ? formatWorkflowDateForLocale(dueBy, locale) : '';
    const securityAmount = Number(security_deposit);
    const petAmount = Number(pet_deposit) || 0;
    const deductionRows = normalizeDepositDeductions(deductions);

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

    const { pdfBytes } = await generateDepositReturnStatementPdf({
      tenantNames: tenant_names || resolvedNames.join(', ') || 'Tenant',
      propertyName: property?.property_name || '',
      unitNumber: unitNumberText(unit),
      securityDeposit: Number.isFinite(securityAmount) ? securityAmount : 0,
      petDeposit: petAmount,
      deductions: deductionRows,
      vacationDateLabel: vacationLabel,
      dueByLabel,
    });

    const fileName = `deposit_return_${lease_id}_${Date.now()}.pdf`;
    const storagePath = `documents/deposit_return/${lease_id}/${fileName}`;

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
      document_name: 'Security Deposit Return Statement',
      file_name: fileName,
      storage_path: storagePath,
      file_type: 'application/pdf',
      file_size: pdfBytes.length,
      mime_type: 'application/pdf',
      uploaded_by_user_id: user_id || null,
      document_type: 'deposit_return_statement',
      metadata: {
        vacation_date: vacationIso,
        statement_due_by: dueBy,
        generated_at: new Date().toISOString(),
      },
    };
    if (tenantUserId) insertPayload.tenant_user_id = tenantUserId;

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

    let depositId = null;
    const collected = toWorkflowDateString(lease.start_date) || vacationIso;
    const { data: depositRow, error: depositError } = await supabase
      .from('security_deposits')
      .insert({
        lease_id,
        general_deposit_amount: Number.isFinite(securityAmount) ? securityAmount : 0,
        pet_deposit_amount: petAmount,
        date_collected: collected,
        date_returned: null,
        status: 'statement_generated',
      })
      .select('deposit_id')
      .single();

    if (!depositError && depositRow?.deposit_id) {
      depositId = depositRow.deposit_id;
      if (deductionRows.length) {
        await supabase.from('deposit_deductions').insert(
          deductionRows.map((row) => ({
            deposit_id: depositId,
            amount: row.amount,
            reason: row.reason,
            deduction_type: 'General',
          }))
        );
      }
    } else if (depositError) {
      console.warn('[Deposit statement] security_deposits insert skipped:', depositError.message);
    }

    return res.status(200).json({
      success: true,
      document_id: documentData.document_id,
      deposit_id: depositId,
      statement_due_by: dueBy,
      total_deductions: sumDepositDeductions(deductionRows),
      file_path: storagePath,
    });
  } catch (error) {
    console.error('Deposit statement generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}