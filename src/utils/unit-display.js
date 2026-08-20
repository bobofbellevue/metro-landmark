/**
 * Helpers for searchable unit pickers (Add Lease, Edit Lease, etc.).
 */

/**
 * @param {object} address
 * @returns {string}
 */
export function formatUnitAddressLine(address) {
  if (!address) return '';
  return [
    address.address_line_1,
    address.address_line_2,
    address.city,
    address.state_province_region,
    address.postal_code,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Build a searchable haystack for a unit picker row.
 * @param {object} unit
 * @returns {string}
 */
export function unitSearchHaystack(unit) {
  const property = unit?.properties || {};
  const address = unit?.property_address || unit?.address || {};
  const parts = [
    property.property_name,
    unit?.unit_number,
    address.address_line_1,
    address.address_line_2,
    address.city,
    address.state_province_region,
    address.postal_code,
    unit?.addressLine,
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Filter units by a free-text search term.
 * @param {object[]} units
 * @param {string} searchTerm
 * @returns {object[]}
 */
export function filterUnitsBySearch(units, searchTerm) {
  const list = Array.isArray(units) ? units : [];
  const q = String(searchTerm || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((unit) => unitSearchHaystack(unit).includes(q));
}

/**
 * Sort units by property name, then unit number.
 * @param {object[]} units
 * @returns {object[]}
 */
export function sortUnitsForPicker(units) {
  return [...(units || [])].sort((a, b) => {
    const aName = (a.properties?.property_name || '').toLowerCase();
    const bName = (b.properties?.property_name || '').toLowerCase();
    const byProperty = aName.localeCompare(bName);
    if (byProperty !== 0) return byProperty;
    return String(a.unit_number || '').localeCompare(String(b.unit_number || ''), undefined, {
      numeric: true,
    });
  });
}

/**
 * Compact picker line: property name · unit name.
 * @param {object} unit
 * @returns {string}
 */
export function formatUnitPickerLabel(unit) {
  const propertyName = unit?.properties?.property_name || 'Property';
  const unitName =
    unit?.unit_number != null && String(unit.unit_number).trim() !== ''
      ? String(unit.unit_number).trim()
      : '';
  return [propertyName, unitName].filter(Boolean).join(' · ');
}
