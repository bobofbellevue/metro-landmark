/* eslint-env node */
import { generatePDFFromTemplate } from '../api/utils/pdf-generator.js';
import {
  addDaysToWorkflowDate,
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
  parseWorkflowDateParts,
  suggestRenewalEndDate,
  todayWorkflowDate,
} from '../src/utils/workflow-date.js';
import { formatPersonDisplayName } from '../src/utils/lease-display.js';
import {
  buildQuestionsContactLines,
  contactFromLandlord,
  isOwnerManagedProperty,
  resolveNoticeQuestionsContact,
} from '../src/utils/notice-questions-contact.js';
import {
  deepMergeObjects,
  mapLeaseLikeDataToTemplate,
} from './map-template-fields.js';
import { renderFilledTemplatePdf } from './template-pdf-render.js';
import { stripInternalIdFieldsFromDocumentData } from '../src/utils/template-field-filter.js';
import {
  convertDateToOrdinalWord,
  describeLeaseTerm,
} from '../src/utils/date-ordinal.js';
import {
  detectJurisdictionPackId,
  getJurisdictionDisplayName,
  getRentIncreaseNoticeResources,
} from '../src/jurisdictions/index.js';
import { buildOfficialFormReferralLines, wrapNoticeText, buildRequiredNoticeLanguageLines, simpleNoticeWorksheetDisclaimerLine } from '../src/utils/notice-official-resources.js';
import { brand } from '../api/utils/brand.js';

/**
 * Format date as MM/DD/YYYY (timezone-safe for YYYY-MM-DD strings).
 */
function formatDateMMDDYYYY(dateString) {
  if (!dateString) return '';
  if (isCompleteWorkflowDate(dateString)) {
    return formatWorkflowDateForLocale(dateString, 'en-US');
  }
  const parts = parseWorkflowDateParts(dateString);
  if (parts) {
    const m = String(parts.month).padStart(2, '0');
    const d = String(parts.day).padStart(2, '0');
    return `${m}/${d}/${parts.year}`;
  }
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Format a notice date using the requester locale when provided.
 */
function formatNoticeDate(dateString, locale = 'en-US') {
  if (!dateString) return '';
  if (isCompleteWorkflowDate(dateString)) {
    return formatWorkflowDateForLocale(dateString, locale || 'en-US');
  }
  return formatDateMMDDYYYY(dateString);
}

/**
 * Format currency as $1,234.56
 */
function formatCurrency(amount) {
  if (!amount && amount !== 0) return '';
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

/**
 * Format full name with period after middle initial
 */
function formatFullName(firstName, middleName, lastName) {
  if (!firstName || !lastName) return '';
  let name = firstName;
  if (middleName) {
    const middleInitial = middleName.charAt(0).toUpperCase();
    name += ` ${middleInitial}.`;
  }
  name += ` ${lastName}`;
  return name.trim();
}

export { formatLandlordFormattedName } from '../src/utils/notice-questions-contact.js';

/**
 * Load client contacts keyed by client_id or user_id (both used in the app).
 * @param {object} supabase
 * @param {Array<{ client_id?: number, user_id?: number, user?: { user_id?: number } }>} clients
 * @returns {Promise<object[]>}
 */
async function fetchClientContactsForClients(supabase, clients) {
  const clientIds = clients.map((c) => c?.client_id).filter(Boolean);
  const userIds = clients
    .map((c) => c?.user_id || c?.users?.user_id || c?.user?.user_id)
    .filter(Boolean);
  const contactableIds = [...new Set([...clientIds, ...userIds])];
  if (contactableIds.length === 0) return [];

  const { data } = await supabase
    .from('contacts')
    .select('*')
    .eq('contactable_type', 'client')
    .in('contactable_id', contactableIds);

  return data || [];
}

/**
 * Format address as a single line
 */
function formatAddress(address) {
  if (!address) return '';
  const parts = [
    address.address_line_1,
    address.address_line_2,
    address.city,
    address.state_province_region,
    address.postal_code
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Generate lease document from template
 * @param {number} leaseId - Lease ID
 * @param {number} templateId - Template ID (optional)
 * @param {Object} supabase - Supabase client
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generateLeaseDocument(leaseId, templateId, supabase) {
  // Fetch lease with all related data
  const { data: lease, error: leaseError } = await supabase
    .from('leases')
    .select(`
      *,
      unit:units(
        *,
        property:properties(*)
      ),
      lease_clients(
        *,
        client:clients!inner(
          *,
          users!clients_user_id_fkey(*)
        )
      )
    `)
    .eq('lease_id', leaseId)
    .single();

  if (leaseError || !lease) {
    throw new Error(`Lease not found: ${leaseError?.message || 'Unknown error'}`);
  }

  // Get template
  let template;
  if (templateId) {
    const { data: templateData, error: templateError } = await supabase
      .from('templates')
      .select('*')
      .eq('template_id', templateId)
      .eq('template_type', 'Lease')
      .single();

    if (templateError || !templateData) {
      throw new Error(`Template not found: ${templateError?.message || 'Unknown error'}`);
    }
    template = templateData;
  } else {
    // Get default lease template
    const { data: templateData, error: templateError } = await supabase
      .from('templates')
      .select('*')
      .eq('template_type', 'Lease')
      .eq('is_default', true)
      .order('template_level', { ascending: true }) // Prefer system > company > landlord
      .limit(1)
      .single();

    if (templateError || !templateData) {
      throw new Error(`No default lease template found: ${templateError?.message || 'Unknown error'}`);
    }
    template = templateData;
  }

  // Fetch tenant contacts
  const clientIds = lease.lease_clients?.map(lc => lc.client_id).filter(Boolean) || [];
  let tenantContacts = [];
  
  if (clientIds.length > 0) {
    const { data: contactData } = await supabase
      .from('contacts')
      .select('*')
      .eq('contactable_type', 'client')
      .in('contactable_id', clientIds);
    tenantContacts = contactData || [];
  }

  // Fetch property address
  let propertyAddress = null;
  if (lease.unit?.property?.property_id) {
    const { data: addressData } = await supabase
      .from('addresses')
      .select('*')
      .eq('addressable_type', 'property')
      .eq('addressable_id', lease.unit.property.property_id)
      .single();
    propertyAddress = addressData;
  }

  // Map lease data to template form data
  const tenants = lease.lease_clients?.map(lc => {
    const client = lc.client;
    const contact = tenantContacts.find(c => c.contactable_id === client?.client_id);
    return {
      first_name: contact?.first_name || '',
      middle_name: contact?.middle_name || '',
      last_name: contact?.last_name || '',
      full_name: formatFullName(contact?.first_name, contact?.middle_name, contact?.last_name),
      email: client?.user?.email || '',
      phone: contact?.phone || '',
      date_of_birth: contact?.date_of_birth || '',
      ssn: contact?.ssn || ''
    };
  }) || [];

  const formData = {
    // Lease dates
    lease_start_date: formatDateMMDDYYYY(lease.start_date),
    lease_end_date: formatDateMMDDYYYY(lease.end_date),
    date_of_agreement: formatDateMMDDYYYY(lease.date_of_agreement),
    
    // Lease amounts
    monthly_rent_amount: formatCurrency(lease.monthly_rent_amount),
    monthly_rent: formatCurrency(lease.monthly_rent_amount),
    security_deposit_amount: formatCurrency(lease.security_deposit_amount),
    security_deposit: formatCurrency(lease.security_deposit_amount),
    pet_deposit_amount: formatCurrency(lease.pet_deposit_amount),
    pet_deposit: formatCurrency(lease.pet_deposit_amount),
    other_fee_amount: formatCurrency(lease.other_fee_amount),
    other_fee: formatCurrency(lease.other_fee_amount),
    
    // Property and unit information
    property_name: lease.unit?.property?.property_name || '',
    property_id: lease.unit?.property?.property_id || '',
    unit_number: lease.unit?.unit_number || '',
    unit_id: lease.unit?.unit_id || '',
    beds: lease.unit?.beds || '',
    baths: lease.unit?.baths || '',
    square_footage: lease.unit?.square_footage || '',
    
    // Property address
    property_address: formatAddress(propertyAddress),
    property_address_line_1: propertyAddress?.address_line_1 || '',
    property_address_line_2: propertyAddress?.address_line_2 || '',
    property_city: propertyAddress?.city || '',
    property_state: propertyAddress?.state_province_region || '',
    property_zip: propertyAddress?.postal_code || '',
    
    // Tenant information
    tenants: tenants,
    tenant_count: tenants.length,
    primary_tenant: tenants[0] || {},
    primary_tenant_name: tenants[0]?.full_name || '',
    primary_tenant_email: tenants[0]?.email || '',
    primary_tenant_phone: tenants[0]?.phone || '',
    
    // Additional lease information
    dependent_names: lease.dependent_names || '',
    pets: lease.pets || '',
    comment: lease.comment || '',
    status: lease.status || '',
    
    // Lease duration calculation
    lease_duration_months: lease.start_date && lease.end_date 
      ? Math.round((new Date(lease.end_date) - new Date(lease.start_date)) / (1000 * 60 * 60 * 24 * 30.44))
      : '',
    lease_duration_years: lease.start_date && lease.end_date
      ? ((new Date(lease.end_date) - new Date(lease.start_date)) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1)
      : '',
    
    // Generation metadata
    generated_date: formatDateMMDDYYYY(new Date().toISOString()),
    generated_at: new Date().toISOString()
  };

  // Get document_data from lease (filled in Fill Lease modal)
  const { data: leaseData } = await supabase
    .from('leases')
    .select('document_data')
    .eq('lease_id', leaseId)
    .single();

  // Prefer template source PDF / page images with stored field positions.
  // Avoid the sequential schema dump unless positioned render is unavailable.
  const { pdfBytes: positionedPdf, diagnostics } = await renderFilledTemplatePdf({
    supabase,
    template,
    formData,
    documentData: leaseData?.document_data || {},
  });
  if (positionedPdf) {
    console.log('[RENDER_DIAG] generateLeaseDocument positioned OK', diagnostics);
    return positionedPdf;
  }

  console.warn(
    '[RENDER_DIAG] generateLeaseDocument falling back to sequential schema layout',
    diagnostics
  );
  const pdfBytes = await generatePDFFromTemplate(template.template_data, formData);
  return pdfBytes;
}

/**
 * Generate renewal document from template
 * @param {number} leaseId - Original lease ID
 * @param {number} templateId - Template ID (optional)
 * @param {Object} supabase - Supabase client
 * @param {Object} renewalData - Renewal data (new_start_date, new_end_date, new_monthly_rent, etc.)
 * @returns {Promise<Uint8Array>} PDF bytes
 */
/**
 * Resolve a Lease template for document generation.
 * Prefers an explicit id, then is_default, then any non-archived Lease template.
 * Avoids .single() (fails with 0 rows even when .limit(1) is used).
 * @param {object} supabase
 * @param {number|null|undefined} templateId
 * @returns {Promise<object|null>}
 */
export async function resolveLeaseTemplate(supabase, templateId = null) {
  if (templateId) {
    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .eq('template_id', templateId)
      .eq('template_type', 'Lease')
      .maybeSingle();
    if (error) {
      console.error('[resolveLeaseTemplate] explicit template lookup failed:', error);
    }
    if (data) return data;
  }

  // Prefer default, non-archived
  const { data: defaults, error: defaultError } = await supabase
    .from('templates')
    .select('*')
    .eq('template_type', 'Lease')
    .eq('is_default', true)
    .eq('is_archived', false)
    .order('template_level', { ascending: true })
    .limit(1);
  if (defaultError) {
    console.error('[resolveLeaseTemplate] default template lookup failed:', defaultError);
  }
  if (defaults?.[0]) return defaults[0];

  // Any non-archived Lease template (default flag may be unset)
  const { data: anyLease, error: anyError } = await supabase
    .from('templates')
    .select('*')
    .eq('template_type', 'Lease')
    .eq('is_archived', false)
    .order('template_level', { ascending: true })
    .order('template_id', { ascending: true })
    .limit(1);
  if (anyError) {
    console.error('[resolveLeaseTemplate] fallback lease template lookup failed:', anyError);
  }
  if (anyLease?.[0]) return anyLease[0];

  // Last resort: default even if archived flag differs / missing
  const { data: looseDefaults } = await supabase
    .from('templates')
    .select('*')
    .eq('template_type', 'Lease')
    .eq('is_default', true)
    .order('template_level', { ascending: true })
    .limit(1);
  return looseDefaults?.[0] || null;
}

/**
 * Resolve a Notice template for document generation.
 * @param {object} supabase
 * @param {number|null|undefined} templateId
 * @returns {Promise<object|null>}
 */
export async function resolveNoticeTemplate(supabase, templateId = null) {
  if (templateId) {
    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .eq('template_id', templateId)
      .eq('template_type', 'Notice')
      .maybeSingle();
    if (error) {
      console.error('[resolveNoticeTemplate] explicit template lookup failed:', error);
    }
    if (data) return data;
  }

  const { data: defaults, error: defaultError } = await supabase
    .from('templates')
    .select('*')
    .eq('template_type', 'Notice')
    .eq('is_default', true)
    .eq('is_archived', false)
    .order('template_level', { ascending: true })
    .limit(1);
  if (defaultError) {
    console.error('[resolveNoticeTemplate] default template lookup failed:', defaultError);
  }
  if (defaults?.[0]) return defaults[0];

  const { data: anyNotice, error: anyError } = await supabase
    .from('templates')
    .select('*')
    .eq('template_type', 'Notice')
    .eq('is_archived', false)
    .order('template_level', { ascending: true })
    .order('template_id', { ascending: true })
    .limit(1);
  if (anyError) {
    console.error('[resolveNoticeTemplate] fallback notice template lookup failed:', anyError);
  }
  return anyNotice?.[0] || null;
}

/**
 * Body lines for a template-less renewal PDF.
 * @param {object} formData
 * @returns {string[]}
 */
export function buildSimpleRenewalContentLines(formData = {}) {
  const tenantLine =
    formData.primary_tenant_name ||
    (Array.isArray(formData.tenants)
      ? formData.tenants.map((t) => t.full_name).filter(Boolean).join(', ')
      : '') ||
    'Tenant';

  const lines = [
    `To: ${tenantLine}`,
    '',
    `Property: ${formData.property_name || 'N/A'}`,
    `Unit: ${formData.unit_number || 'N/A'}`,
    '',
    'This document confirms the renewal of your lease agreement.',
    '',
    `Original Lease Start: ${formData.original_lease_start_date || 'N/A'}`,
    `Original Lease End: ${formData.original_lease_end_date || 'N/A'}`,
    '',
    `Renewal Start Date: ${formData.renewal_start_date || formData.lease_start_date || ''}`,
    `Renewal End Date: ${formData.renewal_end_date || formData.lease_end_date || ''}`,
    '',
  ];

  if (formData.original_monthly_rent) {
    lines.push(`Previous Monthly Rent: ${formData.original_monthly_rent}`);
  }
  if (formData.monthly_rent || formData.monthly_rent_amount) {
    lines.push(
      `New Monthly Rent: ${formData.monthly_rent || formData.monthly_rent_amount}`
    );
  }
  if (formData.security_deposit || formData.security_deposit_amount) {
    lines.push(
      `Security Deposit: ${formData.security_deposit || formData.security_deposit_amount}`
    );
  }

  lines.push(
    '',
    '',
    'Signature: ________________________________',
    '',
    'Printed Name: _____________________________',
    '',
    'Date: ____________________________________'
  );

  return lines;
}

async function generateSimpleRenewalPdf(formData) {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([612, 792]);
  const { height } = page.getSize();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = height - 50;
  const margin = 50;

  page.drawText('LEASE RENEWAL', {
    x: margin,
    y,
    size: 18,
    font: helveticaBoldFont,
  });
  y -= 40;

  page.drawText(`Date: ${formData.generated_date || formData.renewal_date || ''}`, {
    x: margin,
    y,
    size: 12,
    font: helveticaFont,
  });
  y -= 30;

  for (const line of buildSimpleRenewalContentLines(formData)) {
    if (y < 100) {
      page = pdfDoc.addPage([612, 792]);
      y = height - 50;
    }
    page.drawText(line, { x: margin, y, size: 12, font: helveticaFont });
    y -= 20;
  }

  return pdfDoc.save();
}

/**
 * Generate renewal document from template.
 * @returns {Promise<{ pdfBytes: Uint8Array, diagnostics: object }>}
 */
export async function generateRenewalDocument(leaseId, templateId, supabase, renewalData = {}) {
  const diagnostics = {
    template_id: templateId || null,
    mode: null,
    fallback_reason: null,
    errors: [],
  };

  // Fetch original lease (units/properties naming matches the rest of the app)
  const { data: lease, error: leaseError } = await supabase
    .from('leases')
    .select(`
      *,
      units(
        *,
        properties(*)
      ),
      lease_clients(
        *,
        client:clients!inner(
          *,
          users!clients_user_id_fkey(*)
        )
      )
    `)
    .eq('lease_id', leaseId)
    .single();

  if (leaseError || !lease) {
    throw new Error(`Lease not found: ${leaseError?.message || 'Unknown error'}`);
  }

  // Template is preferred but not required — fall back to a simple renewal PDF
  const template = await resolveLeaseTemplate(supabase, templateId);
  if (!template) {
    diagnostics.fallback_reason = 'no_lease_template';
    console.warn(
      '[RENDER_DIAG] generateRenewalDocument: no Lease template found; using simple renewal PDF'
    );
  } else {
    diagnostics.template_id = template.template_id;
  }

  // Calculate renewal dates if not provided
  // End date = start + term months - 1 day (e.g. 09/01/2026 → 08/31/2027)
  let renewalStartDate = renewalData.new_start_date || '';
  if (!isCompleteWorkflowDate(renewalStartDate)) {
    renewalStartDate = isCompleteWorkflowDate(lease.end_date)
      ? addDaysToWorkflowDate(lease.end_date, 1)
      : todayWorkflowDate();
  }

  let renewalEndDate = renewalData.new_end_date || '';
  if (!isCompleteWorkflowDate(renewalEndDate)) {
    renewalEndDate = suggestRenewalEndDate(
      renewalStartDate,
      lease.start_date,
      lease.end_date
    );
  }

  const newMonthlyRent =
    renewalData.new_monthly_rent != null && renewalData.new_monthly_rent !== ''
      ? renewalData.new_monthly_rent
      : lease.monthly_rent_amount;

  // Resolve unit/property from embed or unit_id
  let unit = lease.unit || lease.units || null;
  if (Array.isArray(unit)) unit = unit[0] || null;
  if (!unit && lease.unit_id) {
    const { data: unitRow } = await supabase
      .from('units')
      .select('*')
      .eq('unit_id', lease.unit_id)
      .maybeSingle();
    unit = unitRow;
  }
  let property = unit?.property || unit?.properties || null;
  if (Array.isArray(property)) property = property[0] || null;
  const propertyId = property?.property_id || unit?.property_id || null;
  if (
    propertyId &&
    (!property?.property_name || property?.landlord_id == null)
  ) {
    const { data: propertyRow } = await supabase
      .from('properties')
      .select(
        'property_id, property_name, landlord_id, manager_id, pmc_id, county_of_jurisdiction, city_of_jurisdiction'
      )
      .eq('property_id', propertyId)
      .maybeSingle();
    if (propertyRow) property = { ...(property || {}), ...propertyRow };
  }

  // Fetch tenant contacts (client_id and/or user_id)
  const renewalClients =
    lease.lease_clients?.map((lc) => lc.client).filter(Boolean) || [];
  const tenantContacts = await fetchClientContactsForClients(
    supabase,
    renewalClients
  );

  // Fetch property address
  let propertyAddress = null;
  if (propertyId) {
    const { data: addressData } = await supabase
      .from('addresses')
      .select('*')
      .eq('addressable_type', 'property')
      .eq('addressable_id', propertyId)
      .single();
    propertyAddress = addressData;
  }

  // Map lease data to template form data
  const tenants = lease.lease_clients?.map((lc) => {
    const client = lc.client;
    const nestedUser = client?.users || client?.user || null;
    const userId = client?.user_id || nestedUser?.user_id;
    const contact =
      tenantContacts.find((c) => c.contactable_id === client?.client_id) ||
      tenantContacts.find((c) => c.contactable_id === userId) ||
      null;
    const email = nestedUser?.email || '';
    return {
      first_name: contact?.first_name || '',
      middle_name: contact?.middle_name || '',
      last_name: contact?.last_name || '',
      full_name:
        formatPersonDisplayName({
          first_name: contact?.first_name,
          middle_name: contact?.middle_name,
          last_name: contact?.last_name,
          email,
        }) ||
        formatFullName(
          contact?.first_name,
          contact?.middle_name,
          contact?.last_name
        ),
      email,
      phone: contact?.phone || '',
    };
  }) || [];

  const tenantNamesJoined = tenants
    .map((t) => t.full_name)
    .filter(Boolean)
    .join(', ');

  // Landlord name from contacts (landlords.landlord_name column does not exist)
  const renewalLandlordId =
    property?.landlord_id || lease.landlord_id || null;
  const landlordContact = renewalLandlordId
    ? await contactFromLandlord(supabase, renewalLandlordId)
    : null;
  const landlordName = landlordContact?.name || '';

  const formData = {
    // Renewal dates
    lease_start_date: formatDateMMDDYYYY(renewalStartDate),
    lease_end_date: formatDateMMDDYYYY(renewalEndDate),
    renewal_date: formatDateMMDDYYYY(new Date().toISOString()),
    
    // Original lease dates
    original_lease_start_date: formatDateMMDDYYYY(lease.start_date),
    original_lease_end_date: formatDateMMDDYYYY(lease.end_date),
    
    // Renewal amounts
    monthly_rent_amount: formatCurrency(newMonthlyRent),
    monthly_rent: formatCurrency(newMonthlyRent),
    original_monthly_rent: formatCurrency(lease.monthly_rent_amount),
    security_deposit_amount: formatCurrency(lease.security_deposit_amount),
    security_deposit: formatCurrency(lease.security_deposit_amount),
    pet_deposit_amount: formatCurrency(lease.pet_deposit_amount),
    pet_deposit: formatCurrency(lease.pet_deposit_amount),
    other_fee_amount: formatCurrency(lease.other_fee_amount),
    other_fee: formatCurrency(lease.other_fee_amount),
    
    // Property and unit information
    property_name: property?.property_name || '',
    unit_number: unit?.unit_number || '',
    beds: unit?.beds || '',
    baths: unit?.baths || '',
    square_footage: unit?.square_footage || '',
    
    // Property address
    property_address: formatAddress(propertyAddress),
    property_address_line_1: propertyAddress?.address_line_1 || '',
    property_city: propertyAddress?.city || '',
    property_state: propertyAddress?.state_province_region || '',
    property_zip: propertyAddress?.postal_code || '',
    
    // Tenant information
    tenants: tenants,
    primary_tenant_name: tenants[0]?.full_name || '',
    tenant_names: tenantNamesJoined,
    tenant_name: tenants[0]?.full_name || '',
    lessee: tenantNamesJoined,
    lessee_name: tenantNamesJoined,

    // Landlord / lessor (from contacts)
    landlord_name: landlordName,
    lessor: landlordName,
    lessor_name: landlordName,
    
    // Renewal flags
    is_renewal: true,
    renewal_start_date: formatDateMMDDYYYY(renewalStartDate),
    renewal_end_date: formatDateMMDDYYYY(renewalEndDate),
    
    // Additional information
    dependent_names: lease.dependent_names || '',
    pets: lease.pets || '',
    comment: lease.comment || '',
    
    // Generation metadata
    generated_date: formatDateMMDDYYYY(new Date().toISOString())
  };

  // Prefer image/overlay generation (same path as lease docs) with renewal values
  // patched into document_data. Do NOT fall back to schema-only generatePDFFromTemplate
  // — that prints field descriptions with empty values for this template shape.
  if (template?.template_id) {
    const mappedTemplateValues = mapLeaseLikeDataToTemplate(
      template.template_data,
      {
        date_of_agreement: formData.renewal_date,
        start_date: formData.lease_start_date,
        end_date: formData.lease_end_date,
        monthly_rent_amount: formData.monthly_rent_amount,
        security_deposit_amount: formData.security_deposit_amount,
        pet_deposit_amount: formData.pet_deposit_amount,
        other_fee_amount: formData.other_fee_amount,
        landlord_name: landlordName,
        tenant_names: tenantNamesJoined,
        property_address: formData.property_address,
        property_name: formData.property_name,
        unit_number: formData.unit_number,
        property_county: property?.county_of_jurisdiction || '',
        rent_due_date: convertDateToOrdinalWord(renewalStartDate),
        lease_term: describeLeaseTerm(renewalStartDate, renewalEndDate),
        pets: lease.pets || '',
        dependent_names: lease.dependent_names || '',
      }
    );

    // Optional user edits from Renewal Terms "Edit More..." win over auto-map,
    // but core renewal rent/dates from the workflow are re-applied on top.
    const userDocumentData = stripInternalIdFieldsFromDocumentData(
      renewalData.document_data && typeof renewalData.document_data === 'object'
        ? renewalData.document_data
        : {}
    );
    let patchedDocumentData = deepMergeObjects(
      mappedTemplateValues,
      userDocumentData || {}
    );
    const coreOverrides = mapLeaseLikeDataToTemplate(template.template_data, {
      date_of_agreement: formData.renewal_date,
      start_date: formData.lease_start_date,
      end_date: formData.lease_end_date,
      monthly_rent_amount: formData.monthly_rent_amount,
      rent_due_date: convertDateToOrdinalWord(renewalStartDate),
      lease_term: describeLeaseTerm(renewalStartDate, renewalEndDate),
    });
    patchedDocumentData = deepMergeObjects(patchedDocumentData, coreOverrides);

    console.log('[RENDER_DIAG] renewal mapped template fields', {
      mapped_paths: Object.keys(mappedTemplateValues),
      mapped: mappedTemplateValues,
      user_document_data_keys: Object.keys(userDocumentData || {}),
    });

    const positioned = await renderFilledTemplatePdf({
      supabase,
      template,
      formData: {},
      documentData: patchedDocumentData,
    });
    Object.assign(diagnostics, positioned.diagnostics || {});
    if (positioned.pdfBytes) {
      console.log('[RENDER_DIAG] generateRenewalDocument positioned OK', diagnostics);
      return {
        pdfBytes: positioned.pdfBytes,
        diagnostics,
        documentData: patchedDocumentData,
        formData,
        renewalStartDate,
        renewalEndDate,
        newMonthlyRent,
        template,
      };
    }

    diagnostics.mode = 'simple_renewal_fallback';
    diagnostics.fallback_reason =
      diagnostics.fallback_reason || 'positioned_render_unavailable';
    console.warn(
      '[RENDER_DIAG] generateRenewalDocument using simple renewal PDF fallback',
      diagnostics
    );
  }

  // Guaranteed data-filled renewal summary (avoids empty label-only schema dumps)
  const simpleBytes = await generateSimpleRenewalPdf(formData);
  if (!diagnostics.mode) diagnostics.mode = 'simple_renewal_fallback';
  return {
    pdfBytes: simpleBytes,
    diagnostics,
    documentData: renewalData.document_data || null,
    formData,
    renewalStartDate,
    renewalEndDate,
    newMonthlyRent,
    template,
  };
}

/**
 * Generate legal notice document
 * @param {Object} noticeData - Notice data (type, recipient, dates, amounts, etc.)
 * @param {number} templateId - Template ID (optional)
 * @param {Object} supabase - Supabase client
 * @returns {Promise<Uint8Array>} PDF bytes
 */
/**
 * Generate a legal notice PDF.
 * @returns {Promise<{ pdfBytes: Uint8Array, diagnostics: object }>}
 */
export async function generateNoticeDocument(noticeData, templateId, supabase) {
  const { lease_id, notice_type, effective_date, additional_data = {} } = noticeData;
  const diagnostics = {
    template_id: templateId || null,
    mode: null,
    fallback_reason: null,
    errors: [],
  };

  if (!lease_id || !notice_type) {
    throw new Error('lease_id and notice_type are required');
  }

  // Fetch lease data (use units/properties names that match the rest of the app)
  const { data: lease, error: leaseError } = await supabase
    .from('leases')
    .select(`
      *,
      units(
        *,
        properties(*)
      ),
      lease_clients(
        *,
        client:clients!inner(
          *,
          users!clients_user_id_fkey(*)
        )
      )
    `)
    .eq('lease_id', lease_id)
    .single();

  if (leaseError || !lease) {
    throw new Error(`Lease not found: ${leaseError?.message || 'Unknown error'}`);
  }

  // Fetch tenant contacts (by client_id and/or user_id)
  const noticeClients =
    lease.lease_clients?.map((lc) => lc.client).filter(Boolean) || [];
  const tenantContacts = await fetchClientContactsForClients(
    supabase,
    noticeClients
  );

  // Resolve unit/property even if nested embeds came back empty
  let unit = lease.unit || lease.units || null;
  if (Array.isArray(unit)) unit = unit[0] || null;
  if (!unit && lease.unit_id) {
    const { data: unitRow } = await supabase
      .from('units')
      .select('*')
      .eq('unit_id', lease.unit_id)
      .maybeSingle();
    unit = unitRow;
  }

  let property = unit?.property || unit?.properties || null;
  if (Array.isArray(property)) property = property[0] || null;
  const propertyId = property?.property_id || unit?.property_id || null;
  // Re-fetch property row so manager/pmc/landlord ids are always present
  if (propertyId) {
    const { data: propertyRow } = await supabase
      .from('properties')
      .select('property_id, property_name, manager_id, pmc_id, landlord_id, city_of_jurisdiction')
      .eq('property_id', propertyId)
      .maybeSingle();
    if (propertyRow) {
      property = { ...(property || {}), ...propertyRow };
    }
  }
  let propertyAddress = null;
  if (propertyId) {
    const { data: addressData } = await supabase
      .from('addresses')
      .select('*')
      .eq('addressable_type', 'property')
      .eq('addressable_id', propertyId)
      .single();
    propertyAddress = addressData;
  }

  // Map tenant data — prefer display names that work with partial contacts / email
  const tenants =
    lease.lease_clients?.map((lc) => {
      const client = lc.client;
      const nestedUser = client?.users || client?.user || null;
      const userId = client?.user_id || nestedUser?.user_id;
      const contact =
        tenantContacts.find((c) => c.contactable_id === client?.client_id) ||
        tenantContacts.find((c) => c.contactable_id === userId) ||
        null;
      const email = nestedUser?.email || '';
      const full_name = formatPersonDisplayName({
        first_name: contact?.first_name,
        middle_name: contact?.middle_name,
        last_name: contact?.last_name,
        email,
      });
      return {
        first_name: contact?.first_name || '',
        middle_name: contact?.middle_name || '',
        last_name: contact?.last_name || '',
        full_name,
        email,
        phone: contact?.phone || '',
      };
    }) || [];

  const tenantNames = tenants
    .map((t) => t.full_name)
    .filter(Boolean)
    .join(', ');

  // PMC name + questions contact (PM → PMC → landlord)
  let pmcName = '';
  if (property?.pmc_id) {
    const { data: pmc } = await supabase
      .from('pm_companies')
      .select('company_name')
      .eq('pmc_id', property.pmc_id)
      .maybeSingle();
    pmcName = pmc?.company_name || '';
  }
  let noticeLandlordId =
    property?.landlord_id ||
    property?.building_owner_landlord_id ||
    lease.landlord_id ||
    additional_data.landlord_id ||
    null;

  // If property embed lacked landlord_id, fetch it directly from the property row
  if (!noticeLandlordId && propertyId) {
    const { data: landlordIdRow } = await supabase
      .from('properties')
      .select('landlord_id')
      .eq('property_id', propertyId)
      .maybeSingle();
    noticeLandlordId = landlordIdRow?.landlord_id || null;
  }

  const questionsContact = await resolveNoticeQuestionsContact(
    supabase,
    property,
    noticeLandlordId
  );

  const ownerManaged = isOwnerManagedProperty(property);
  // Landlord identity is only for self-managed properties. PM/PMC-managed
  // notices must not fall back to the landlord as the questions contact.
  const landlordContact =
    ownerManaged && noticeLandlordId
      ? await contactFromLandlord(supabase, noticeLandlordId)
      : null;

  const ensuredQuestionsContact = questionsContact || landlordContact || null;

  const showLandlord = ensuredQuestionsContact?.role === 'Landlord';
  const landlordName = showLandlord ? landlordContact?.name || '' : '';
  const resolvedUnitNumber =
    unit?.unit_number ||
    additional_data.unit_number ||
    '';
  const resolvedPropertyName =
    property?.property_name ||
    additional_data.property_name ||
    '';

  console.log('[generateNoticeDocument] Notice parties resolved', {
    lease_id,
    unit_id: unit?.unit_id || lease.unit_id || null,
    unit_number: resolvedUnitNumber,
    property_id: propertyId,
    property_name: resolvedPropertyName,
    notice_landlord_id: noticeLandlordId,
    landlord_name: landlordName,
    questions_contact: ensuredQuestionsContact
      ? {
          role: ensuredQuestionsContact.role,
          name: ensuredQuestionsContact.name,
          phone: ensuredQuestionsContact.phone,
          email: ensuredQuestionsContact.email,
        }
      : null,
  });

  // Prepare form data for notice
  const locale = additional_data.locale || 'en-US';
  const currentRentRaw =
    additional_data.current_rent ?? additional_data.currentRent ?? null;
  const newRentRaw = additional_data.new_rent ?? additional_data.newRent ?? null;
  const percentIncreaseRaw =
    additional_data.percent_increase ?? additional_data.percentIncrease ?? null;

  const packId = detectJurisdictionPackId(property);
  const noticeResources =
    notice_type === 'rent_increase'
      ? getRentIncreaseNoticeResources(packId)
      : { officialFormUrls: [], requiredNoticeLanguage: [] };

  const formData = {
    notice_type: notice_type.replace(/_/g, ' ').toUpperCase(),
    notice_type_key: notice_type,
    date_generated: formatNoticeDate(new Date().toISOString(), locale),
    
    // Lease information
    lease_start_date: formatNoticeDate(lease.start_date, locale),
    lease_end_date: formatNoticeDate(lease.end_date, locale),
    monthly_rent_amount: formatCurrency(lease.monthly_rent_amount),
    monthly_rent: formatCurrency(lease.monthly_rent_amount),
    
    // Property and unit (from resolved unit — not lease.unit, which is undefined
    // when the embed is named `units`). Names/numbers are set again after
    // additional_data so client placeholders cannot override resolved values.
    property_address: formatAddress(propertyAddress),
    
    // Tenants
    tenants: tenants,
    primary_tenant_name: tenants[0]?.full_name || '',
    
    // Additional notice data (may include raw dates/amounts)
    ...additional_data,
    
    // Generation metadata — applied after spread so formatted values win
    generated_date: formatNoticeDate(new Date().toISOString(), locale),
    effective_date: formatNoticeDate(
      effective_date || additional_data.effective_date || new Date().toISOString(),
      locale
    ),
    current_rent:
      currentRentRaw != null && currentRentRaw !== ''
        ? formatCurrency(currentRentRaw)
        : '',
    new_rent:
      newRentRaw != null && newRentRaw !== '' ? formatCurrency(newRentRaw) : '',
    percent_increase:
      percentIncreaseRaw != null && percentIncreaseRaw !== ''
        ? Number(percentIncreaseRaw)
        : null,
    locale,
    property_name: resolvedPropertyName,
    unit_number: resolvedUnitNumber,
    tenant_names: tenantNames || additional_data.tenant_names || '',
    pmc_name: pmcName || additional_data.pmc_name || '',
    landlord_name: landlordName,
    landlord_address: '',
    lessor_name: landlordName,
    lessor_address: '',
    landlord_phone: showLandlord ? landlordContact?.phone || '' : '',
    landlord_email: showLandlord ? landlordContact?.email || '' : '',
    questions_contact:
      ensuredQuestionsContact || additional_data.questions_contact || null,
    questions_phone:
      ensuredQuestionsContact?.phone || additional_data.questions_phone || '',
    questions_email:
      ensuredQuestionsContact?.email || additional_data.questions_email || '',
    pack_id: packId,
    pack_display_name: getJurisdictionDisplayName(packId),
    official_form_urls: noticeResources.officialFormUrls,
    required_notice_language: noticeResources.requiredNoticeLanguage,
    preferred_landlord_association: noticeResources.preferredLandlordAssociation,
    product_name: brand.productName,
  };

  // Prefer a Notice template with stored field positions (same path as lease/renewal).
  const template = await resolveNoticeTemplate(supabase, templateId);
  if (template?.template_id) {
    diagnostics.template_id = template.template_id;
    const mappedTemplateValues = mapLeaseLikeDataToTemplate(template.template_data, {
      date_of_agreement: formData.date_generated,
      start_date: formData.lease_start_date,
      end_date: formData.lease_end_date,
      monthly_rent_amount: formData.new_rent || formData.monthly_rent,
      landlord_name: formData.landlord_name,
      tenant_names: formData.tenant_names,
      property_address: formData.property_address,
      property_name: formData.property_name,
      unit_number: formData.unit_number,
      current_rent: formData.current_rent,
      new_rent: formData.new_rent,
      effective_date: formData.effective_date,
      notice_type: formData.notice_type,
      percent_increase: formData.percent_increase,
      questions_contact_name: ensuredQuestionsContact?.name || '',
      questions_phone: ensuredQuestionsContact?.phone || '',
      questions_email: ensuredQuestionsContact?.email || '',
      pmc_name: formData.pmc_name,
    });

    const documentData = deepMergeObjects(mappedTemplateValues, {
      ...formData,
      questions_contact_name: ensuredQuestionsContact?.name || '',
    });

    const positioned = await renderFilledTemplatePdf({
      supabase,
      template,
      formData,
      documentData,
    });
    Object.assign(diagnostics, positioned.diagnostics || {});
    if (positioned.pdfBytes) {
      console.log('[RENDER_DIAG] generateNoticeDocument positioned OK', diagnostics);
      let pdfBytes = await appendQuestionsContactPage(
        positioned.pdfBytes,
        formData.questions_contact
      );
      pdfBytes = await appendOfficialFormReferralPage(pdfBytes, formData);
      return { pdfBytes, diagnostics };
    }
    diagnostics.fallback_reason =
      diagnostics.fallback_reason || 'positioned_render_unavailable';
    console.warn(
      '[RENDER_DIAG] generateNoticeDocument template found but positioned render failed; using simple notice PDF',
      diagnostics
    );
  } else {
    diagnostics.fallback_reason = 'no_notice_template';
    console.warn(
      '[RENDER_DIAG] generateNoticeDocument: no Notice template found; using simple notice PDF'
    );
  }

  // Simple sequential notice PDF (no template positions)
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([612, 792]);
  const { height } = page.getSize();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = height - 50;
  const margin = 50;
  const isRentIncreaseWorksheet = formData.notice_type_key === 'rent_increase';
  const title = isRentIncreaseWorksheet
    ? 'RENT INCREASE NOTICE WORKSHEET'
    : `${formData.notice_type} NOTICE`;

  page.drawText(title, {
    x: margin,
    y,
    size: 16,
    font: helveticaBoldFont,
  });
  y -= 28;

  if (isRentIncreaseWorksheet) {
    const disclaimerParts = wrapNoticeText(simpleNoticeWorksheetDisclaimerLine());
    for (const part of disclaimerParts) {
      page.drawText(part, { x: margin, y, size: 10, font: helveticaFont });
      y -= 14;
    }
    y -= 12;
  }

  page.drawText(`Date: ${formData.date_generated}`, {
    x: margin,
    y,
    size: 12,
    font: helveticaFont,
  });
  y -= 24;

  const drawn = drawNoticeBodyLines(
    pdfDoc,
    page,
    isRentIncreaseWorksheet
      ? buildSimpleNoticeTenantLines(formData)
      : buildSimpleNoticeContentLines(formData),
    { y, margin, height, font: helveticaFont }
  );
  page = drawn.page;
  y = drawn.y;

  if (isRentIncreaseWorksheet) {
    page = pdfDoc.addPage([612, 792]);
    y = height - 50;
    page.drawText('Disclaimer and resources', {
      x: margin,
      y,
      size: 14,
      font: helveticaBoldFont,
    });
    y -= 28;
    drawNoticeBodyLines(
      pdfDoc,
      page,
      buildSimpleNoticeResourceLines(formData),
      { y, margin, height, font: helveticaFont }
    );
  }

  const pdfBytes = await pdfDoc.save();
  diagnostics.mode = 'simple_notice_fallback';
  return { pdfBytes, diagnostics };
}

/**
 * Draw wrapped body lines, adding pages when the cursor runs out of room.
 */
function drawNoticeBodyLines(pdfDoc, startPage, lines, { y, margin, height, font, size = 11, lineHeight = 16 }) {
  let page = startPage;
  let cursorY = y;
  for (const line of lines) {
    const wrapped = line === '' ? [''] : wrapNoticeText(line);
    for (const part of wrapped) {
      if (cursorY < 60) {
        page = pdfDoc.addPage([612, 792]);
        cursorY = height - 50;
      }
      page.drawText(part, { x: margin, y: cursorY, size, font });
      cursorY -= lineHeight;
    }
  }
  return { page, y: cursorY };
}

function noticeResourceOptions(formData = {}) {
  return {
    officialFormUrls: formData.official_form_urls,
    requiredNoticeLanguage: formData.required_notice_language,
    packDisplayName: formData.pack_display_name,
    preferredLandlordAssociation: formData.preferred_landlord_association,
    productName: formData.product_name,
  };
}

/**
 * Tenant-facing body for page 1 of the rent-increase worksheet.
 * @param {object} formData
 * @returns {string[]}
 */
export function buildSimpleNoticeTenantLines(formData = {}) {
  const lines = [
    `To: ${formData.tenant_names || 'Tenant'}`,
    '',
    `Property: ${formData.property_name || 'N/A'}`,
    `Unit: ${formData.unit_number || 'N/A'}`,
    '',
    `This notice is regarding your lease agreement.`,
    '',
  ];

  if (formData.notice_type_key === 'rent_increase') {
    if (formData.current_rent) {
      lines.push(`Current Monthly Rent: ${formData.current_rent}`);
    }
    if (formData.new_rent) {
      lines.push(`New Monthly Rent: ${formData.new_rent}`);
    }
    if (
      formData.percent_increase != null &&
      !Number.isNaN(Number(formData.percent_increase))
    ) {
      lines.push(
        `Increase: ${Number(formData.percent_increase).toFixed(1)}%`
      );
    }
    if (formData.current_rent || formData.new_rent) {
      lines.push('');
    }
  }

  lines.push(`Effective Date: ${formData.effective_date || ''}`);

  if (formData.additional_text) {
    lines.push('', formData.additional_text);
  }

  const questionsLines = buildQuestionsContactLines(formData.questions_contact, {
    pmc_name: formData.pmc_name,
    landlord_name: formData.landlord_name,
  });
  if (questionsLines.length) {
    lines.push('', ...questionsLines);
  }

  if (formData.notice_type_key === 'rent_increase') {
    const requiredLanguage = buildRequiredNoticeLanguageLines({
      ...noticeResourceOptions(formData),
      includeHeading: false,
    });
    if (requiredLanguage.length) {
      lines.push('', ...requiredLanguage);
    }
  }

  lines.push(
    '',
    '',
    'Signature: ________________________________',
    '',
    'Printed Name: _____________________________',
    '',
    'Date: ____________________________________'
  );

  return lines;
}

/**
 * Full disclaimer, official URLs, association referral, and required language
 * for page 2 of the rent-increase worksheet.
 * @param {object} formData
 * @returns {string[]}
 */
export function buildSimpleNoticeResourceLines(formData = {}) {
  return buildOfficialFormReferralLines({
    ...noticeResourceOptions(formData),
    includeRequiredLanguage: true,
  });
}

/**
 * Build body lines for a template-less notice PDF.
 * Rent-increase worksheets concatenate tenant page then resource page.
 * Exported for unit tests.
 * @param {object} formData
 * @returns {string[]}
 */
export function buildSimpleNoticeContentLines(formData = {}) {
  if (formData.notice_type_key === 'rent_increase') {
    return [
      simpleNoticeWorksheetDisclaimerLine(),
      '',
      ...buildSimpleNoticeTenantLines(formData),
      '',
      ...buildSimpleNoticeResourceLines(formData),
    ];
  }
  return buildSimpleNoticeTenantLines(formData);
}

/**
 * Add a questions-contact page so overlay templates still tell the tenant
 * whom to call (many Notice templates have no questions-contact fields).
 * @param {Uint8Array} pdfBytes
 * @param {object|null} questionsContact
 * @returns {Promise<Uint8Array>}
 */
async function appendQuestionsContactPage(pdfBytes, questionsContact) {
  const lines = buildQuestionsContactLines(questionsContact);
  if (!lines.length) return pdfBytes;

  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();
  let y = height - 72;
  page.drawText('Questions about this notice', {
    x: 50,
    y,
    size: 14,
    font: bold,
  });
  y -= 28;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 20;
  }
  return pdfDoc.save();
}

/**
 * Append official-form referral and required local language (e.g. Seattle helpline).
 * @param {Uint8Array} pdfBytes
 * @param {object} formData
 * @returns {Promise<Uint8Array>}
 */
async function appendOfficialFormReferralPage(pdfBytes, formData) {
  if (formData?.notice_type_key !== 'rent_increase') return pdfBytes;
  const lines = buildOfficialFormReferralLines({
    officialFormUrls: formData.official_form_urls,
    requiredNoticeLanguage: formData.required_notice_language,
    packDisplayName: formData.pack_display_name,
    preferredLandlordAssociation: formData.preferred_landlord_association,
    productName: formData.product_name,
  });
  if (!lines.length) return pdfBytes;

  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();
  let y = height - 72;
  page.drawText('Official form required', {
    x: 50,
    y,
    size: 14,
    font: bold,
  });
  y -= 28;
  for (const line of lines) {
    if (y < 60) break;
    page.drawText(line, { x: 50, y, size: 11, font });
    y -= 16;
  }
  return pdfDoc.save();
}

