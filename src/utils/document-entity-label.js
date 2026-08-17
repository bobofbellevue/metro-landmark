/**
 * Human-readable entity labels for the staff Documents registry.
 * Never surface internal ids such as "(Lease: 72)" or "(User: 19)".
 */

import { formatPersonDisplayName } from './lease-display.js';

function firstRelation(value) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === 'object' ? value : null;
}

function present(value) {
  return value != null && String(value).trim() !== '';
}

/**
 * Nested select so Documents can label rows from lease/unit/property
 * without embedding users (documents has two FKs onto users).
 */
export const DOCUMENT_LIST_SELECT = `
  *,
  lease:leases(
    lease_id,
    units(
      unit_id,
      unit_number,
      properties(
        property_id,
        property_name
      )
    )
  ),
  unit:units(
    unit_id,
    unit_number,
    properties(
      property_id,
      property_name
    )
  ),
  property:properties(
    property_id,
    property_name
  )
`;

/**
 * Property + unit line from a documents row (and optional nested joins).
 *
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
export function documentLocationLabel(doc = {}) {
  const nestedUnit =
    firstRelation(doc.lease?.units) ||
    firstRelation(doc.lease?.unit) ||
    firstRelation(doc.unit);
  const nestedProperty =
    firstRelation(nestedUnit?.properties) ||
    firstRelation(nestedUnit?.property) ||
    firstRelation(doc.property);
  const propertyName = nestedProperty?.property_name || doc.property_name || '';
  const unitNumber = nestedUnit?.unit_number || doc.unit_number || '';

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
  const contact =
    doc.tenant_contact ||
    doc.tenant ||
    null;
  const name = formatPersonDisplayName(contact);
  if (present(name)) return name;
  const email = contact?.email || doc.tenant_email || '';
  return present(email) ? String(email).trim() : '';
}

/**
 * Entity column for a document: property/unit when linked to a lease or
 * property, otherwise the tenant's name. Empty when nothing resolvable —
 * do not fall back to internal ids.
 *
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
export function formatDocumentEntityLabel(doc = {}) {
  return documentLocationLabel(doc) || documentPersonLabel(doc) || '';
}

/**
 * Attach contact rows loaded for tenant_user_id onto document objects.
 *
 * @param {Record<string, unknown>[]} documents
 * @param {Record<string, unknown>[]} contacts
 * @returns {Record<string, unknown>[]}
 */
export function attachDocumentTenantContacts(documents = [], contacts = []) {
  const byUserId = new Map();
  for (const contact of contacts || []) {
    if (contact?.contactable_id == null) continue;
    byUserId.set(String(contact.contactable_id), contact);
  }
  return (documents || []).map((doc) => {
    const userId = doc?.tenant_user_id;
    if (userId == null || userId === '') return doc;
    const contact = byUserId.get(String(userId));
    if (!contact) return doc;
    return { ...doc, tenant_contact: contact };
  });
}
