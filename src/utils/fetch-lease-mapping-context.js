/**
 * Load lease + property + landlord + tenants context used to prefill
 * Fill Lease / Renewal Terms template fields.
 */
import { supabase } from '../lib/supabase.js';
import {
  formatPropertyAddressLine,
  formatTenantNamesList,
} from './lease-display.js';
import { convertDateToOrdinalWord, describeLeaseTerm } from './date-ordinal.js';
import { todayWorkflowDate } from './workflow-date.js';

function formatFullName(first_name, middle_name, last_name) {
  if (!first_name || !last_name) return '';
  let name = first_name;
  if (middle_name) {
    name += ` ${String(middle_name).charAt(0).toUpperCase()}.`;
  }
  name += ` ${last_name}`;
  return name.trim();
}

/**
 * @param {number|string} leaseId
 * @returns {Promise<object>}
 */
export async function fetchLeaseMappingContext(leaseId) {
  const { data: leaseData, error: leaseError } = await supabase
    .from('leases')
    .select(
      `
      *,
      units!inner(
        unit_id,
        unit_number,
        properties!inner(
          property_id,
          property_name,
          property_type,
          landlord_id,
          city_of_jurisdiction,
          county_of_jurisdiction
        )
      ),
      lease_clients(
        client_id,
        clients(
          client_id,
          user_id,
          users!clients_user_id_fkey(
            user_id,
            email
          )
        )
      )
    `
    )
    .eq('lease_id', leaseId)
    .single();

  if (leaseError) throw leaseError;

  const unit = leaseData.units;
  const property = unit?.properties || {};
  const propertyId = property.property_id;

  const { data: addressData } = propertyId
    ? await supabase
        .from('addresses')
        .select('*')
        .eq('addressable_id', propertyId)
        .eq('addressable_type', 'property')
        .maybeSingle()
    : { data: null };

  const landlordId = leaseData.landlord_id || property.landlord_id || null;
  let landlordData = null;
  let landlordName = '';
  if (landlordId) {
    const { data: landlord } = await supabase
      .from('landlords')
      .select('*')
      .eq('landlord_id', landlordId)
      .maybeSingle();

    const { data: contacts } = await supabase
      .from('contacts')
      .select('first_name, last_name, middle_name')
      .eq('contactable_id', landlordId)
      .eq('contactable_type', 'landlord')
      .limit(1);

    const contact = contacts?.[0] || null;
    landlordName =
      formatFullName(contact?.first_name, contact?.middle_name, contact?.last_name) ||
      '';
    landlordData = landlord
      ? {
          ...landlord,
          contacts: contact,
          formatted_name: landlordName,
        }
      : null;
  }

  const clientIds = (leaseData.lease_clients || [])
    .map((lc) => lc.client_id || lc.clients?.client_id)
    .filter((id) => id != null);
  const userIds = (leaseData.lease_clients || [])
    .map((lc) => lc.clients?.user_id)
    .filter((id) => id != null);

  const contactQueries = [];
  if (clientIds.length) {
    contactQueries.push(
      supabase
        .from('contacts')
        .select('*')
        .eq('contactable_type', 'client')
        .in('contactable_id', clientIds)
    );
  }
  if (userIds.length) {
    contactQueries.push(
      supabase
        .from('contacts')
        .select('*')
        .eq('contactable_type', 'client')
        .in('contactable_id', userIds)
    );
  }
  const contactResults = await Promise.all(contactQueries);
  const clientContacts = contactResults.flatMap((r) => r.data || []);

  const tenants = (leaseData.lease_clients || []).map((lc) => {
    const client = lc.clients || {};
    const user = client.users || {};
    const contact =
      clientContacts.find((c) => c.contactable_id === client.client_id) ||
      clientContacts.find((c) => c.contactable_id === client.user_id) ||
      null;
    return {
      client_id: client.client_id,
      user_id: user.user_id || client.user_id,
      email: user.email || '',
      first_name: contact?.first_name || '',
      middle_name: contact?.middle_name || '',
      last_name: contact?.last_name || '',
    };
  });

  const addressLine = formatPropertyAddressLine(addressData);
  const tenantNames = formatTenantNamesList(tenants);

  return {
    lease: leaseData,
    unit,
    property: {
      ...property,
      address: addressData,
    },
    landlord: landlordData,
    tenants,
    summary: {
      property_name: property.property_name || '',
      unit_number: unit?.unit_number || '',
      address_line: addressLine,
      county: property.county_of_jurisdiction || '',
      city: property.city_of_jurisdiction || '',
      landlord_name: landlordName,
      tenant_names: tenantNames,
      agreement_date: leaseData.date_of_agreement || '',
      start_date: leaseData.start_date || '',
      end_date: leaseData.end_date || '',
      monthly_rent_amount: leaseData.monthly_rent_amount,
      security_deposit_amount: leaseData.security_deposit_amount,
      pet_deposit_amount: leaseData.pet_deposit_amount,
      other_fee_amount: leaseData.other_fee_amount,
      rent_due_date: convertDateToOrdinalWord(leaseData.start_date),
      lease_term: describeLeaseTerm(leaseData.start_date, leaseData.end_date),
      pets: leaseData.pets || '',
      dependent_names: leaseData.dependent_names || '',
      status: leaseData.status || '',
    },
  };
}

/**
 * Values object for mapLeaseLikeDataToTemplate from mapping context + renewal overrides.
 * @param {object} context
 * @param {{
 *   start_date?: string,
 *   end_date?: string|null,
 *   monthly_rent_amount?: number|null,
 *   date_of_agreement?: string|null,
 * }} [overrides]
 */
export function mappingValuesFromContext(context, overrides = {}) {
  const summary = context?.summary || {};
  const start = overrides.start_date || summary.start_date;
  const end =
    overrides.end_date !== undefined ? overrides.end_date : summary.end_date;
  const rent =
    overrides.monthly_rent_amount != null && overrides.monthly_rent_amount !== ''
      ? overrides.monthly_rent_amount
      : summary.monthly_rent_amount;
  const agreement = overrides.date_of_agreement || todayWorkflowDate();

  return {
    date_of_agreement: agreement,
    start_date: start,
    end_date: end,
    monthly_rent_amount: rent,
    security_deposit_amount: summary.security_deposit_amount,
    pet_deposit_amount: summary.pet_deposit_amount,
    other_fee_amount: summary.other_fee_amount,
    landlord_name: summary.landlord_name,
    tenant_names: summary.tenant_names,
    property_address: summary.address_line,
    property_name: summary.property_name,
    unit_number: summary.unit_number,
    property_county: summary.county,
    county: summary.county,
    rent_due_date: convertDateToOrdinalWord(start),
    lease_term: describeLeaseTerm(start, end),
    pets: summary.pets,
    pets_allowed: summary.pets,
    dependent_names: summary.dependent_names,
  };
}
