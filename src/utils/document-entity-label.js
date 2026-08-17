/**
 * Human-readable entity labels for the staff Documents registry.
 * Never surface internal ids such as "(Lease: 72)" or "(User: 19)".
 */

import { formatPersonDisplayName } from './lease-display.js';
import { flattenLeaseClientRows } from './lease-tenants.js';

function firstRelation(value) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === 'object' ? value : null;
}

function present(value) {
  return value != null && String(value).trim() !== '';
}

function uniqueIds(values) {
  return [
    ...new Set(
      (values || [])
        .filter((id) => id != null && id !== '')
        .map((id) => id)
    ),
  ];
}

export function indexContactsById(contacts = []) {
  const map = {};
  for (const contact of contacts || []) {
    if (contact?.contactable_id == null) continue;
    map[String(contact.contactable_id)] = contact;
  }
  return map;
}

function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  for (const name of names || []) {
    const trimmed = String(name || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * Nested select so Documents can label rows from lease/unit/property
 * without embedding users (documents has two FKs onto users) or the
 * landlords table (names live on contacts).
 */
export const DOCUMENT_LIST_SELECT = `
  *,
  lease:leases(
    lease_id,
    landlord_id,
    units(
      unit_id,
      unit_number,
      properties(
        property_id,
        property_name,
        landlord_id
      )
    )
  ),
  unit:units(
    unit_id,
    unit_number,
    properties(
      property_id,
      property_name,
      landlord_id
    )
  ),
  property:properties(
    property_id,
    property_name,
    landlord_id
  )
`;

function nestedUnit(doc = {}) {
  return (
    firstRelation(doc.lease?.units) ||
    firstRelation(doc.lease?.unit) ||
    firstRelation(doc.unit)
  );
}

function nestedProperty(doc = {}) {
  const unit = nestedUnit(doc);
  return (
    firstRelation(unit?.properties) ||
    firstRelation(unit?.property) ||
    firstRelation(doc.property)
  );
}

/**
 * Property + unit line from a documents row (and optional nested joins).
 *
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
export function documentLocationLabel(doc = {}) {
  const unit = nestedUnit(doc);
  const property = nestedProperty(doc);
  const propertyName = property?.property_name || doc.property_name || '';
  const unitNumber = unit?.unit_number || doc.unit_number || '';

  if (present(propertyName) && present(unitNumber)) {
    return `${propertyName} — Unit ${unitNumber}`;
  }
  if (present(propertyName)) return String(propertyName).trim();
  if (present(unitNumber)) return `Unit ${unitNumber}`;
  return '';
}

/**
 * Person line from a tenant user contact (names live on contacts, not users).
 *
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
export function documentPersonLabel(doc = {}) {
  if (present(doc.tenant_names)) return String(doc.tenant_names).trim();
  const contact = doc.tenant_contact || doc.tenant || null;
  const name = formatPersonDisplayName(contact);
  if (present(name)) return name;
  const email = contact?.email || doc.tenant_email || '';
  return present(email) ? String(email).trim() : '';
}

/**
 * Landlord display name from an attached contact (not landlords.landlord_name).
 *
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
export function documentLandlordLabel(doc = {}) {
  if (present(doc.landlord_name)) return String(doc.landlord_name).trim();
  return formatPersonDisplayName(doc.landlord_contact) || '';
}

/**
 * Labeled entity lines for the Documents Entity column.
 * Typical lease documents have property, tenant(s), and landlord.
 *
 * @param {Record<string, unknown>} doc
 * @returns {{ role: string, label: string }[]}
 */
export function documentEntityLines(doc = {}) {
  const lines = [];
  const location = documentLocationLabel(doc);
  if (location) {
    lines.push({ role: 'Property', label: location });
  }

  const tenants = documentPersonLabel(doc);
  if (tenants) {
    lines.push({
      role: tenants.includes(',') ? 'Tenants' : 'Tenant',
      label: tenants,
    });
  }

  const landlord = documentLandlordLabel(doc);
  if (landlord) {
    lines.push({ role: 'Landlord', label: landlord });
  }

  return lines;
}

/**
 * Search haystack for a document's entities (all labels, no ids).
 *
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
export function formatDocumentEntityLabel(doc = {}) {
  return documentEntityLines(doc)
    .map((line) => line.label)
    .join(' · ');
}

/**
 * Landlord id from the document row or nested lease/property joins.
 *
 * @param {Record<string, unknown>} doc
 * @returns {number|string|null}
 */
export function documentLandlordId(doc = {}) {
  const property = nestedProperty(doc);
  const id =
    doc.landlord_id ??
    doc.lease?.landlord_id ??
    property?.landlord_id ??
    null;
  return id == null || id === '' ? null : id;
}

/**
 * Map lease_clients + client contacts to tenant name lists keyed by lease_id.
 * Contacts may be keyed by client_id or by user_id (TenantsPage uses user_id).
 *
 * @param {Array<{ lease_id?: unknown, client_id?: unknown, user_id?: unknown, clients?: unknown }>} leaseClients
 * @param {Array<Record<string, unknown>>} clientContacts
 * @returns {Record<string, string[]>}
 */
export function tenantNamesByLeaseId(leaseClients = [], clientContacts = []) {
  const contactById = indexContactsById(clientContacts);
  const namesByLease = {};
  for (const row of flattenLeaseClientRows(leaseClients)) {
    if (row?.lease_id == null) continue;
    const key = String(row.lease_id);
    const contact =
      (row.client_id != null && contactById[String(row.client_id)]) ||
      (row.user_id != null && contactById[String(row.user_id)]) ||
      null;
    const name = formatPersonDisplayName(contact);
    if (!name) continue;
    if (!namesByLease[key]) namesByLease[key] = [];
    namesByLease[key].push(name);
  }
  for (const key of Object.keys(namesByLease)) {
    namesByLease[key] = uniqueNames(namesByLease[key]);
  }
  return namesByLease;
}

/**
 * Attach tenant and landlord names onto document rows.
 *
 * @param {Record<string, unknown>[]} documents
 * @param {{
 *   tenantsByLeaseId?: Record<string, string[]>,
 *   landlordContactsById?: Record<string, Record<string, unknown>>,
 *   tenantContactsByUserId?: Record<string, Record<string, unknown>>,
 * }} [parties]
 * @returns {Record<string, unknown>[]}
 */
export function attachDocumentEntityParties(
  documents = [],
  {
    tenantsByLeaseId = {},
    landlordContactsById = {},
    tenantContactsByUserId = {},
  } = {}
) {
  return (documents || []).map((doc) => {
    const leaseNames = tenantsByLeaseId[String(doc.lease_id)] || [];
    const userContact =
      doc.tenant_user_id != null
        ? tenantContactsByUserId[String(doc.tenant_user_id)]
        : null;
    const fromUser = formatPersonDisplayName(userContact);
    const tenantNames = uniqueNames([...leaseNames, fromUser]);
    const landlordId = documentLandlordId(doc);
    const landlordContact =
      landlordId != null ? landlordContactsById[String(landlordId)] : null;

    return {
      ...doc,
      tenant_contact: userContact || doc.tenant_contact || null,
      tenant_names: tenantNames.join(', '),
      landlord_contact: landlordContact || doc.landlord_contact || null,
    };
  });
}

/**
 * @deprecated use attachDocumentEntityParties
 */
export function attachDocumentTenantContacts(documents = [], contacts = []) {
  return attachDocumentEntityParties(documents, {
    tenantContactsByUserId: indexContactsById(contacts),
  });
}

export { uniqueIds };
