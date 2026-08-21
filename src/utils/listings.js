/**
 * Vacancy listings / syndication helpers (roadmap E5).
 * Units are vacant when they have no active or future lease and no current
 * tenant assignment without a lease. Listing is opt-in.
 */

export const OCCUPIED_LEASE_STATUSES = ['active', 'future'];

export function canViewListings(role) {
  return [
    'global_admin',
    'company_admin',
    'manager',
    'staff',
    'landlord',
  ].includes(role);
}

export function canEditListings(role) {
  return ['global_admin', 'company_admin', 'manager', 'landlord'].includes(role);
}

export function isOccupiedLeaseStatus(status) {
  return OCCUPIED_LEASE_STATUSES.includes(String(status || '').trim().toLowerCase());
}

export function occupiedUnitIds(leases = []) {
  const ids = new Set();
  for (const lease of leases) {
    if (!lease?.unit_id) continue;
    if (isOccupiedLeaseStatus(lease.status)) ids.add(Number(lease.unit_id));
  }
  return ids;
}

function isoDay(value) {
  if (value == null || value === '') return '';
  return String(value).slice(0, 10);
}

function todayIso(today) {
  if (today) return isoDay(today);
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function isOpenTenantAssignment(row, today) {
  if (!row || row.is_archived) return false;
  if (row.vacated_at) return false;
  const end = isoDay(row.end_date);
  if (end && end < todayIso(today)) return false;
  return true;
}

export function unitsAssignedWithoutLease(assignments = [], today) {
  const ids = new Set();
  const asOf = todayIso(today);
  for (const row of assignments) {
    if (!row?.unit_id) continue;
    if (row.lease_id) continue;
    if (!isOpenTenantAssignment(row, asOf)) continue;
    ids.add(Number(row.unit_id));
  }
  return ids;
}

export function lastRentByUnit(leases = []) {
  const best = new Map();
  for (const lease of leases) {
    const unitId = Number(lease?.unit_id);
    if (!Number.isInteger(unitId) || unitId <= 0) continue;
    const rent = Number(lease.monthly_rent_amount);
    if (!Number.isFinite(rent) || rent <= 0) continue;
    const start = String(lease.start_date || '');
    const prev = best.get(unitId);
    if (!prev || start > prev.start) {
      best.set(unitId, { start, rent });
    }
  }
  const rents = new Map();
  for (const [unitId, row] of best) rents.set(unitId, row.rent);
  return rents;
}

export function parseAskingRent(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function validateListingWrite(input = {}) {
  const unitId = Number(input.unitId ?? input.unit_id);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return { ok: false, error: 'Choose a unit.' };
  }
  const listed = input.listed === true || input.listed === 'true';
  const askingRent = parseAskingRent(input.askingRent ?? input.asking_rent);
  if (listed && askingRent == null) {
    return { ok: false, error: 'Asking rent is required to list a vacancy.' };
  }
  const description = String(input.description || '').trim();
  if (description.length > 2000) {
    return { ok: false, error: 'Description is too long.' };
  }
  const availableOn = String(input.availableOn ?? input.available_on ?? '').trim() || null;
  return {
    ok: true,
    value: {
      unitId,
      listed,
      askingRent,
      availableOn,
      description: description || null,
    },
  };
}

export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function mapPropertyType(typeName) {
  const key = String(typeName || '').trim().toLowerCase();
  if (!key) return 'APARTMENT';
  if (key.includes('house') && key.includes('town')) return 'TOWNHOUSE';
  if (key.includes('condo')) return 'CONDO';
  if (key.includes('house') || key.includes('sfr') || key.includes('single')) return 'HOUSE';
  if (key.includes('duplex') || key.includes('triplex') || key.includes('fourplex')) return 'MULTI_FAMILY';
  return 'APARTMENT';
}

export function listingStreet(row) {
  return [row.addressLine1, row.addressLine2].filter(Boolean).join(' ').trim();
}

export function listingLabel(row) {
  const unit = row.unitNumber ? ` #${row.unitNumber}` : '';
  const street = listingStreet(row);
  if (street) return `${street}${unit}`;
  return `${row.propertyName || 'Property'}${unit}`;
}

export function listingsToZillowXml(rows = []) {
  const listed = rows.filter((row) => row.listed);
  const items = listed.map((row) => {
    const price = row.askingRent ?? row.lastRent;
    return [
      '    <Listing>',
      `      <id>${xmlEscape(`unit-${row.unitId}`)}</id>`,
      `      <status>ACTIVE</status>`,
      `      <type>RENTAL</type>`,
      `      <propertyType>${xmlEscape(mapPropertyType(row.propertyType))}</propertyType>`,
      `      <title>${xmlEscape(listingLabel(row))}</title>`,
      `      <street>${xmlEscape(listingStreet(row))}</street>`,
      `      <city>${xmlEscape(row.city || '')}</city>`,
      `      <state>${xmlEscape(row.state || '')}</state>`,
      `      <zip>${xmlEscape(row.postalCode || '')}</zip>`,
      price != null ? `      <price>${xmlEscape(price)}</price>` : '',
      row.beds != null ? `      <bedrooms>${xmlEscape(row.beds)}</bedrooms>` : '',
      row.baths != null ? `      <baths>${xmlEscape(row.baths)}</baths>` : '',
      row.squareFootage != null ? `      <squareFeet>${xmlEscape(row.squareFootage)}</squareFeet>` : '',
      row.availableOn ? `      <dateAvailable>${xmlEscape(row.availableOn)}</dateAvailable>` : '',
      row.description ? `      <description>${xmlEscape(row.description)}</description>` : '',
      '    </Listing>',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<hotPadsItems>',
    ...items,
    '</hotPadsItems>',
    '',
  ].join('\n');
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function listingsToCsv(rows = []) {
  const listed = rows.filter((row) => row.listed);
  const header = [
    'property',
    'unit',
    'street',
    'city',
    'state',
    'zip',
    'beds',
    'baths',
    'sqft',
    'asking_rent',
    'last_rent',
    'available_on',
    'description',
  ];
  const lines = [header.join(',')];
  for (const row of listed) {
    lines.push(
      [
        csvEscape(row.propertyName),
        csvEscape(row.unitNumber),
        csvEscape(listingStreet(row)),
        csvEscape(row.city),
        csvEscape(row.state),
        csvEscape(row.postalCode),
        csvEscape(row.beds),
        csvEscape(row.baths),
        csvEscape(row.squareFootage),
        csvEscape(row.askingRent),
        csvEscape(row.lastRent),
        csvEscape(row.availableOn),
        csvEscape(row.description),
      ].join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

export function publicListing(row) {
  return {
    unitId: row.unitId,
    propertyId: row.propertyId,
    propertyName: row.propertyName || '',
    unitNumber: row.unitNumber || '',
    addressLine1: row.addressLine1 || '',
    addressLine2: row.addressLine2 || '',
    city: row.city || '',
    state: row.state || '',
    postalCode: row.postalCode || '',
    beds: row.beds ?? null,
    baths: row.baths ?? null,
    squareFootage: row.squareFootage ?? null,
    propertyType: row.propertyType || '',
    lastRent: row.lastRent ?? null,
    askingRent: row.askingRent ?? null,
    availableOn: row.availableOn || null,
    description: row.description || '',
    listed: Boolean(row.listed),
  };
}

export function filterListingsBySearch(rows, searchTerm) {
  const q = String(searchTerm || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const hay = [
      row.propertyName,
      row.unitNumber,
      row.addressLine1,
      row.city,
      row.state,
      row.postalCode,
      row.description,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function missingListingsTable(error) {
  const message = String(error?.message || error?.details || '');
  return /listings/i.test(message) && /does not exist|schema cache|could not find the table/i.test(message);
}

export function missingClientUnitsTable(error) {
  const message = String(error?.message || error?.details || '');
  return /client_units/i.test(message) && /does not exist|schema cache|could not find the table/i.test(message);
}
