/**
 * Helpers for searchable lease pickers (compliance workflows, etc.).
 */

/**
 * @param {{ first_name?: string, middle_name?: string, last_name?: string, email?: string }} person
 * @returns {string}
 */
export function formatPersonDisplayName(person) {
  if (!person) return '';
  const first = (person.first_name || '').trim();
  const last = (person.last_name || '').trim();
  const middle = (person.middle_name || '').trim();
  if (first || last) {
    const middlePart = middle ? ` ${middle.charAt(0)}.` : '';
    return `${first}${middlePart} ${last}`.trim();
  }
  return (person.email || person.landlord_name || '').trim();
}

/**
 * @param {Array<{ first_name?: string, last_name?: string, email?: string }>} tenants
 * @returns {string}
 */
export function formatTenantNamesList(tenants = []) {
  if (!tenants.length) return '';
  return tenants
    .map((t) => formatPersonDisplayName(t) || 'Unknown')
    .filter(Boolean)
    .join(', ');
}

/**
 * @param {object} address
 * @returns {string}
 */
export function formatPropertyAddressLine(address) {
  if (!address) return '';
  return [
    address.address_line_1,
    address.city,
    address.state_province_region,
    address.postal_code,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Build a searchable haystack for a lease picker row.
 * @param {object} lease
 * @returns {string}
 */
export function leaseSearchHaystack(lease) {
  const property = lease?.units?.properties || lease?.unit?.properties || {};
  const unitNumber = lease?.units?.unit_number ?? lease?.unit?.unit_number ?? '';
  const parts = [
    property.property_name,
    unitNumber,
    lease.addressLine,
    lease.tenantNames,
    lease.landlordName,
    lease.status,
    lease.monthly_rent_amount != null ? String(lease.monthly_rent_amount) : '',
    ...(lease.tenants || []).flatMap((t) => [t.first_name, t.last_name, t.email]),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Filter leases by a free-text search term.
 * @param {object[]} leases
 * @param {string} searchTerm
 * @returns {object[]}
 */
export function filterLeasesBySearch(leases, searchTerm) {
  const list = Array.isArray(leases) ? leases : [];
  const q = String(searchTerm || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((lease) => leaseSearchHaystack(lease).includes(q));
}
