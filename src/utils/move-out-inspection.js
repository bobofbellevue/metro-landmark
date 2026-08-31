/**
 * Move-out inspection: compare to the move-in checklist and capture proposed
 * deposit deductions (RCW 59.18.280). Not legal advice. Do not copy RHAWA forms.
 */

import {
  conditionLabel,
  defaultMoveInChecklistRows,
  newChecklistRow,
  normalizeChecklistItems,
  tenantPresentFlag,
} from './move-in-condition-report.js';
import {
  normalizeDepositDeductions,
  sumDepositDeductions,
} from './deposit-return-statement.js';

function money(amount) {
  const n = Number(amount);
  const value = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function newDeductionRow() {
  return { key: `${Date.now()}-${Math.random()}`, reason: '', amount: null };
}

/**
 * @param {Array<{ area?: string, condition?: string, notes?: string, moveInCondition?: string, moveInNotes?: string }>|null|undefined} rows
 * @returns {{ area: string, condition: string, notes: string, moveInCondition: string, moveInNotes: string }[]}
 */
export function normalizeMoveOutChecklistItems(rows) {
  return (rows || [])
    .map((row) => ({
      area: String(row?.area || '').trim(),
      condition: String(row?.condition || '').trim(),
      notes: String(row?.notes || '').trim(),
      moveInCondition: String(row?.moveInCondition || '').trim(),
      moveInNotes: String(row?.moveInNotes || '').trim(),
    }))
    .filter((row) => row.area);
}

/**
 * Seed move-out rows from a stored move-in condition_report.
 * @param {{ items?: unknown[] }|null|undefined} conditionReport
 */
export function checklistFromMoveInReport(conditionReport) {
  const source = normalizeChecklistItems(conditionReport?.items);
  if (!source.length) return defaultMoveInChecklistRows();
  return source.map((row) => ({
    ...newChecklistRow(row.area),
    condition: '',
    notes: '',
    moveInCondition: row.condition || '',
    moveInNotes: row.notes || '',
  }));
}

export function deductionsNeedSeed(rows) {
  return normalizeDepositDeductions(rows).length === 0;
}

/**
 * @param {Record<string, unknown>|null|undefined} inspection
 * @returns {{ reason: string, amount: number }[]}
 */
export function deductionsFromMoveOutInspection(inspection) {
  const report = inspection?.condition_report;
  return normalizeDepositDeductions(report?.deductions);
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function moveOutReportFingerprint(data = {}) {
  const items = normalizeMoveOutChecklistItems(data.checklist || data.items)
    .map((row) => `${row.area}:${row.condition}:${row.notes}`)
    .join(';');
  const deductions = normalizeDepositDeductions(data.deductions)
    .map((row) => `${row.reason}:${row.amount}`)
    .join(';');
  return [
    data.lease_id,
    data.inspection_date,
    tenantPresentFlag(data.tenant_present) ? 'yes' : 'no',
    String(data.overall_condition || '').trim(),
    String(data.condition_notes || data.notes || '').trim(),
    items,
    deductions,
  ].join('|');
}

function checklistLine(row) {
  const condition = conditionLabel(row.condition) || '—';
  const moveIn = conditionLabel(row.moveInCondition);
  const moveInPart = moveIn ? ` (at move-in: ${moveIn})` : '';
  const notePart = row.notes ? ` — ${row.notes}` : '';
  return `${row.area}: ${condition}${moveInPart}${notePart}`;
}

/**
 * Tenant-facing body for the move-out inspection PDF.
 * @param {object} data
 * @returns {string[]}
 */
export function buildMoveOutInspectionLines(data = {}) {
  const unit = String(data.unitNumber || '').trim();
  const items = normalizeMoveOutChecklistItems(data.checklist || data.items);
  const overall = conditionLabel(data.overallCondition);
  const notes = String(data.notes || '').trim();
  const deductions = normalizeDepositDeductions(data.deductions);
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
  if (data.moveInDateLabel) {
    lines.push(`Move-in inspection: ${data.moveInDateLabel}`);
  }
  lines.push('', 'Checklist:');
  if (items.length) {
    for (const row of items) {
      lines.push(checklistLine(row));
    }
  } else {
    lines.push('No checklist items recorded.');
  }
  if (notes) {
    lines.push('', `Notes: ${notes}`);
  }
  lines.push('');
  if (deductions.length) {
    lines.push('Proposed deductions:');
    for (const row of deductions) {
      lines.push(`${row.reason}: ${money(row.amount)}`);
    }
    lines.push(`Total proposed deductions: ${money(sumDepositDeductions(deductions))}`);
  } else {
    lines.push('Proposed deductions: none');
  }
  lines.push(
    '',
    'These amounts can be used on the deposit return statement.',
    'Give the tenant a copy of this report.',
    '',
    'Landlord signature: ________________________  Date: ____________',
    'Tenant signature: ________________________  Date: ____________',
    '',
    'Not legal advice. See RCW 59.18.280.'
  );
  return lines;
}

export { tenantPresentFlag, conditionLabel, newChecklistRow };
