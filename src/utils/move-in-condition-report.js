/**
 * Move-in condition report / checklist (RCW 59.18.260).
 * Pack numbers and this worksheet are reference math, not legal advice.
 * Do not copy RHAWA forms.
 */

export const CONDITION_OPTIONS = Object.freeze([
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'na', label: 'N/A' },
]);

const CONDITION_LABELS = Object.fromEntries(
  CONDITION_OPTIONS.map((option) => [option.value, option.label])
);

/**
 * Default checklist areas from RCW 59.18.260 (walls, floors, countertops,
 * carpets, drapes, furniture, appliances) plus common rooms and alarms.
 */
export const DEFAULT_MOVE_IN_CHECKLIST = Object.freeze([
  { area: 'Walls', condition: '', notes: '' },
  { area: 'Floors', condition: '', notes: '' },
  { area: 'Carpets', condition: '', notes: '' },
  { area: 'Countertops', condition: '', notes: '' },
  { area: 'Windows and doors', condition: '', notes: '' },
  { area: 'Appliances', condition: '', notes: '' },
  { area: 'Furniture and furnishings', condition: '', notes: '' },
  { area: 'Drapes and window coverings', condition: '', notes: '' },
  { area: 'Kitchen', condition: '', notes: '' },
  { area: 'Bathroom', condition: '', notes: '' },
  { area: 'Smoke and carbon monoxide alarms', condition: '', notes: '' },
]);

export function newChecklistRow(area = '') {
  return { key: `${Date.now()}-${Math.random()}`, area, condition: '', notes: '' };
}

export function defaultMoveInChecklistRows() {
  return DEFAULT_MOVE_IN_CHECKLIST.map((row) => ({
    ...newChecklistRow(row.area),
    condition: row.condition,
    notes: row.notes,
  }));
}

export function conditionLabel(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  return CONDITION_LABELS[key] || key;
}

/**
 * @param {Array<{ area?: string, condition?: string, notes?: string }>|null|undefined} rows
 * @returns {{ area: string, condition: string, notes: string }[]}
 */
export function normalizeChecklistItems(rows) {
  return (rows || [])
    .map((row) => ({
      area: String(row?.area || '').trim(),
      condition: String(row?.condition || '').trim(),
      notes: String(row?.notes || '').trim(),
    }))
    .filter((row) => row.area);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function tenantPresentFlag(value) {
  if (value === true || value === 'yes' || value === 'true') return true;
  return false;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function moveInReportFingerprint(data = {}) {
  const items = normalizeChecklistItems(data.checklist || data.items)
    .map((row) => `${row.area}:${row.condition}:${row.notes}`)
    .join(';');
  return [
    data.lease_id,
    data.inspection_date,
    tenantPresentFlag(data.tenant_present) ? 'yes' : 'no',
    String(data.overall_condition || '').trim(),
    String(data.condition_notes || data.notes || '').trim(),
    items,
  ].join('|');
}

/**
 * Tenant-facing body for the move-in condition report PDF.
 * @param {object} data
 * @returns {string[]}
 */
export function buildMoveInConditionReportLines(data = {}) {
  const unit = String(data.unitNumber || '').trim();
  const items = normalizeChecklistItems(data.checklist || data.items);
  const overall = conditionLabel(data.overallCondition);
  const notes = String(data.notes || '').trim();
  const lines = [
    `To: ${data.tenantNames || 'Tenant'}`,
    '',
    `Property: ${data.propertyName || 'N/A'}`,
  ];
  if (unit) lines.push(`Unit: ${unit}`);
  lines.push(
    '',
    `Inspection date: ${data.inspectionDateLabel || ''}`,
    `Tenant present: ${tenantPresentFlag(data.tenantPresent) ? 'Yes' : 'No'}`
  );
  if (overall) lines.push(`Overall condition: ${overall}`);
  lines.push('', 'Checklist:');
  if (items.length) {
    for (const row of items) {
      const condition = conditionLabel(row.condition) || '—';
      const notePart = row.notes ? ` — ${row.notes}` : '';
      lines.push(`${row.area}: ${condition}${notePart}`);
    }
  } else {
    lines.push('No checklist items recorded.');
  }
  if (notes) {
    lines.push('', `Notes: ${notes}`);
  }
  lines.push(
    '',
    'Give the tenant a copy of this report.',
    '',
    'Landlord signature: ________________________  Date: ____________',
    'Tenant signature: ________________________  Date: ____________',
    '',
    'Not legal advice. See RCW 59.18.260.'
  );
  return lines;
}
