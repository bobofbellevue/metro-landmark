/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { generateScreeningDecisionPdf } from '../../../utils/document-generator.js';
import { formatPersonDisplayName } from '../../../src/utils/lease-display.js';
import { formatUnitAddressLine, formatUnitOrAddress } from '../../../src/utils/unit-display.js';
import { formatWorkflowDateForLocale, toWorkflowDateString } from '../../../src/utils/workflow-date.js';
import {
  evaluateFirstQualifiedScreening,
} from '../../../src/utils/first-qualified-screening.js';
import {
  getJurisdictionDisplayName,
  detectJurisdictionPackId,
} from '../../../src/jurisdictions/index.js';

/**
 * POST /api/documents/generate/screening-record
 *
 * Body: property_id, unit_id, application_id, applicant_name, decision,
 * decision_reason, meets_written_criteria, written_criteria_notes,
 * applied_at, unit_or_address, user_id
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
      property_id,
      unit_id,
      application_id,
      applicant_name,
      decision,
      decision_reason,
      meets_written_criteria,
      written_criteria_notes,
      applied_at,
      unit_or_address,
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

    if (!property_id || !application_id || !String(decision || '').trim()) {
      return res.status(400).json({
        success: false,
        error: 'property_id, application_id, and decision are required',
      });
    }

    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('property_id, property_name, city_of_jurisdiction, landlord_id')
      .eq('property_id', property_id)
      .single();

    if (propertyError || !property) {
      return res.status(404).json({
        success: false,
        error: `Property not found: ${propertyError?.message || 'Unknown error'}`,
      });
    }

    let unit = null;
    if (unit_id) {
      const { data: unitRow } = await supabase
        .from('units')
        .select('unit_id, unit_number, property_id')
        .eq('unit_id', unit_id)
        .maybeSingle();
      unit = unitRow || null;
    }

    const { data: addressRow } = await supabase
      .from('addresses')
      .select(
        'address_line_1, address_line_2, city, state_province_region, postal_code'
      )
      .eq('addressable_type', 'property')
      .eq('addressable_id', property.property_id)
      .maybeSingle();

    const { data: application } = await supabase
      .from('client_applications')
      .select('application_id, client_id, unit_id, applied_at, status')
      .eq('application_id', application_id)
      .maybeSingle();

    let resolvedApplicantName = String(applicant_name || '').trim();
    let applicantUserId = null;
    if (application?.client_id) {
      const { data: client } = await supabase
        .from('clients')
        .select('client_id, user_id')
        .eq('client_id', application.client_id)
        .maybeSingle();
      applicantUserId = client?.user_id || null;
      if (applicantUserId && !resolvedApplicantName) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('first_name, middle_name, last_name')
          .eq('contactable_type', 'client')
          .eq('contactable_id', applicantUserId)
          .maybeSingle();
        resolvedApplicantName = formatPersonDisplayName(contact);
      }
    }

    const packId = detectJurisdictionPackId(property);
    const evaluation = evaluateFirstQualifiedScreening({
      jurisdiction: packId,
      queue: [],
      selectedApplicationId: application_id,
      decision,
    });
    const disclaimer = evaluation.firstQualifiedApplicant
      ? 'Not legal advice. See SMC 14.09.'
      : 'Not legal advice.';

    const appliedIso =
      toWorkflowDateString(applied_at) ||
      toWorkflowDateString(application?.applied_at) ||
      '';
    const locale = 'en-US';
    const unitOrAddress =
      String(unit_or_address || '').trim() ||
      formatUnitOrAddress(unit, addressRow) ||
      formatUnitAddressLine(addressRow);

    const { pdfBytes } = await generateScreeningDecisionPdf({
      applicantName: resolvedApplicantName || 'Applicant',
      propertyName: property.property_name || '',
      unitOrAddress,
      appliedDateLabel: appliedIso
        ? formatWorkflowDateForLocale(appliedIso, locale)
        : '',
      jurisdictionName: getJurisdictionDisplayName(packId),
      firstQualifiedApplicant: evaluation.firstQualifiedApplicant,
      meetsWrittenCriteria: meets_written_criteria,
      writtenCriteriaNotes: written_criteria_notes,
      decision,
      decisionReason: decision_reason,
      disclaimer,
    });

    const fileName = `screening_decision_${application_id}_${Date.now()}.pdf`;
    const storagePath = `documents/screening/${property.property_id}/${fileName}`;
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

    const insertPayload = {
      document_name: 'Screening Decision Worksheet',
      file_name: fileName,
      storage_path: storagePath,
      file_type: 'application/pdf',
      file_size: pdfBytes.length,
      mime_type: 'application/pdf',
      uploaded_by_user_id: user_id || null,
      document_type: 'screening_decision_record',
      property_id: property.property_id,
      metadata: {
        application_id,
        decision: String(decision || '').trim().toLowerCase(),
        generated_at: new Date().toISOString(),
      },
    };
    if (unit?.unit_id) insertPayload.unit_id = unit.unit_id;
    else if (application?.unit_id) insertPayload.unit_id = application.unit_id;
    if (property.landlord_id) insertPayload.landlord_id = property.landlord_id;
    if (applicantUserId) insertPayload.tenant_user_id = applicantUserId;

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
    console.error('Screening record generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
