/**
 * Load leases enriched with tenant names, landlord, and property address
 * for searchable lease pickers.
 */
import { supabase } from '../lib/supabase.js';
import {
  formatPersonDisplayName,
  formatPropertyAddressLine,
  formatTenantNamesList,
} from './lease-display.js';

const DEFAULT_STATUSES = ['active', 'pending', 'future'];

const LEASE_PICKER_SELECT = `
      lease_id,
      monthly_rent_amount,
      security_deposit_amount,
      start_date,
      end_date,
      status,
      landlord_id,
      units!inner(
        unit_id,
        unit_number,
        properties!inner(
          property_id,
          property_name,
          city_of_jurisdiction,
          landlord_id
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
    `;

function enrichLeaseRows(leases, { addresses, clientContacts, landlordContacts }) {
  return leases.map((lease) => {
    const property = lease.units?.properties || {};
    const propertyId = property.property_id;
    const address = addresses.find(
      (a) => a.addressable_id === propertyId && a.addressable_type === 'property'
    );
    const addressLine = formatPropertyAddressLine(address);

    const tenants = (lease.lease_clients || []).map((lc) => {
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

    const landlordId = lease.landlord_id || property.landlord_id;
    const landlordContact = landlordContacts.find(
      (c) => c.contactable_id === landlordId
    );
    const landlordName =
      formatPersonDisplayName({
        first_name: landlordContact?.first_name,
        middle_name: landlordContact?.middle_name,
        last_name: landlordContact?.last_name,
      }) || '';

    const tenantNames = formatTenantNamesList(tenants);

    return {
      ...lease,
      tenants,
      tenantNames,
      landlordName,
      addressLine,
      address,
    };
  });
}

/**
 * Load leases for the given statuses and enrich with tenants, landlord, address.
 * @param {string[]|null} [statuses]
 * @param {{ leaseIds?: Array<number|string> }} [options]
 */
export async function fetchEnrichedLeases(statuses = DEFAULT_STATUSES, options = {}) {
  const leaseIds = (options.leaseIds || []).filter((id) => id != null && id !== '');
  let query = supabase.from('leases').select(LEASE_PICKER_SELECT).eq('is_archived', false);
  if (leaseIds.length) {
    query = query.in('lease_id', leaseIds);
  } else {
    const statusList = Array.isArray(statuses) && statuses.length ? statuses : DEFAULT_STATUSES;
    query = query.in('status', statusList);
  }
  const { data: leaseRows, error: leaseError } = await query;

  if (leaseError) throw leaseError;

  const leases = leaseRows || [];
  if (leases.length === 0) return [];

  const propertyIds = [
    ...new Set(
      leases
        .map((l) => l.units?.properties?.property_id)
        .filter((id) => id != null)
    ),
  ];
  const landlordIds = [
    ...new Set(
      leases
        .map((l) => l.landlord_id || l.units?.properties?.landlord_id)
        .filter((id) => id != null)
    ),
  ];
  const clientIds = [
    ...new Set(
      leases.flatMap((l) =>
        (l.lease_clients || []).map((lc) => lc.client_id || lc.clients?.client_id)
      ).filter((id) => id != null)
    ),
  ];
  const userIds = [
    ...new Set(
      leases.flatMap((l) =>
        (l.lease_clients || []).map((lc) => lc.clients?.user_id)
      ).filter((id) => id != null)
    ),
  ];

  // landlords table has no landlord_name column — names live on contacts.
  const [addressesResult, clientContactsResult, userContactsResult, landlordContactsResult] =
    await Promise.all([
      propertyIds.length
        ? supabase
            .from('addresses')
            .select('*')
            .eq('addressable_type', 'property')
            .in('addressable_id', propertyIds)
        : Promise.resolve({ data: [] }),
      clientIds.length
        ? supabase
            .from('contacts')
            .select('*')
            .eq('contactable_type', 'client')
            .in('contactable_id', clientIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase
            .from('contacts')
            .select('*')
            .eq('contactable_type', 'client')
            .in('contactable_id', userIds)
        : Promise.resolve({ data: [] }),
      landlordIds.length
        ? supabase
            .from('contacts')
            .select('*')
            .eq('contactable_type', 'landlord')
            .in('contactable_id', landlordIds)
        : Promise.resolve({ data: [] }),
    ]);

  return enrichLeaseRows(leases, {
    addresses: addressesResult.data || [],
    clientContacts: [
      ...(clientContactsResult.data || []),
      ...(userContactsResult.data || []),
    ],
    landlordContacts: landlordContactsResult.data || [],
  });
}

/**
 * One lease for a picker chip, regardless of status (resume / prior selection).
 * @param {number|string|null|undefined} leaseId
 * @returns {Promise<object|null>}
 */
export async function fetchEnrichedLeaseById(leaseId) {
  if (leaseId == null || leaseId === '') return null;
  const rows = await fetchEnrichedLeases(null, { leaseIds: [leaseId] });
  return rows[0] || null;
}
