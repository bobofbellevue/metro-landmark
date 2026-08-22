/**
 * Helpers for searchable unit pickers (Add Lease, Edit Lease, etc.).
 *
 * A property always has at least one unit. Unit # may be blank when there is
 * only one unit (a whole house). Blank is not shown as "N/A" or a stand-in.
 */

/**
 * Visible unit number, or '' when unlabeled.
 * Accepts a unit object or a raw number/string.
 * @param {object|string|number|null|undefined} unitOrNumber
 * @returns {string}
 */
export function unitNumberText(unitOrNumber) {
  if (unitOrNumber == null || unitOrNumber === '') return '';
  if (typeof unitOrNumber === 'string' || typeof unitOrNumber === 'number') {
    return String(unitOrNumber).trim();
  }
  const raw = unitOrNumber.unit_number ?? unitOrNumber.unitNumber;
  if (raw == null || raw === '') return '';
  return String(raw).trim();
}

/** Persist empty labels as null, not ''. */
export function normalizeStoredUnitNumber(value) {
  const text = unitNumberText(value);
  return text === '' ? null : text;
}

/** "Unit 2B" or '' when the dwelling has no apartment-style number. */
export function formatUnitQualifier(unitOrNumber) {
  const text = unitNumberText(unitOrNumber);
  return text ? `Unit ${text}` : '';
}

/**
 * Bath counts are quarter-steps (1.75), not tenths (1.8).
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatBathCount(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value).trim();
  return n.toFixed(2);
}

/**
 * "Unit 2B - 123 Main St, Seattle, WA" or just the place when unlabeled.
 * @param {object|null|undefined} unit
 * @param {{ missingPlace?: string }} [options]
 */
export function formatUnitLocationLine(unit, { missingPlace = '' } = {}) {
  if (!unit) return missingPlace;
  const qualifier = formatUnitQualifier(unit);
  const address = unit.property_address || unit.address;
  const place = [
    address?.address_line_1,
    address?.address_line_2,
    address?.city,
    address?.state_province_region,
  ]
    .filter(Boolean)
    .join(', ') || unit.properties?.property_name || missingPlace;
  return [qualifier, place].filter(Boolean).join(' - ');
}

/**
 * @param {object|null|undefined} unit
 * @param {{ missingPlace?: string }} [options]
 * @returns {string[]}
 */
export function formatUnitLocationLines(unit, { missingPlace = '' } = {}) {
  if (!unit) return missingPlace ? [missingPlace] : [];
  const lines = [];
  const qualifier = formatUnitQualifier(unit);
  if (qualifier) lines.push(qualifier);
  const address = unit.property_address || unit.address;
  if (address) {
    if (address.address_line_1) lines.push(address.address_line_1);
    if (address.address_line_2) lines.push(address.address_line_2);
    const cityState = [address.city, address.state_province_region].filter(Boolean).join(', ');
    if (cityState) lines.push(cityState);
  } else if (unit.properties?.property_name) {
    lines.push(unit.properties.property_name);
  } else if (missingPlace) {
    lines.push(missingPlace);
  }
  return lines;
}

/** "Unit 2B at Oak House" or just the property when unlabeled. */
export function formatUnitAtProperty(unitOrNumber, propertyName) {
  const qualifier = formatUnitQualifier(unitOrNumber);
  const name = String(propertyName || '').trim();
  if (qualifier && name) return `${qualifier} at ${name}`;
  return qualifier || name;
}

/** "123 Main St - Unit 2B" or just the place when unlabeled. */
export function formatPlaceWithUnit(place, unitOrNumber) {
  return [place, formatUnitQualifier(unitOrNumber)].filter(Boolean).join(' - ');
}

/**
 * Two or more units on a property must each have a distinct number.
 * @param {Array<{ unit_number?: string|null, unitNumber?: string|null }>} units
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validatePropertyUnitNumbers(units) {
  const list = Array.isArray(units) ? units : [];
  if (list.length <= 1) return { ok: true };
  const numbers = list.map((u) => unitNumberText(u));
  if (numbers.some((n) => !n)) {
    return { ok: false, message: 'Give each unit a number before adding another.' };
  }
  const seen = new Set();
  for (const n of numbers) {
    const key = n.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, message: 'Unit numbers on a property must be different.' };
    }
    seen.add(key);
  }
  return { ok: true };
}

export function defaultUnlabeledUnit() {
  return {
    unit_number: null,
    beds: null,
    baths: null,
    square_footage: null,
    parking: {
      parking_rule: 'dedicated',
      dedicated_garage_spaces: '',
      dedicated_carport_spaces: '',
      dedicated_paved_driveway_spaces: '',
      dedicated_off_street_spaces: '',
    },
  };
}

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
  return [propertyName, unitNumberText(unit)].filter(Boolean).join(' · ');
}
