/**
 * Habitability issue record (RCW 59.18.070 commence-repair windows).
 * Pack numbers are reference math, not legal advice. Do not copy RHAWA forms.
 */

import { getResolvedJurisdictionPack, getRuleCitations } from '../jurisdictions/index.js';
import {
  addDaysToWorkflowDate,
  isCompleteWorkflowDate,
  toWorkflowDateString,
} from './workflow-date.js';

export const HABITABILITY_ISSUE_OPTIONS = Object.freeze([
  { value: 'imminent', label: 'Imminent hazard to life' },
  { value: 'utilities', label: 'Heat, hot water, or electricity' },
  { value: 'major_fixture', label: 'Refrigerator, range, or major plumbing' },
  { value: 'other', label: 'Other repair' },
]);

export const HABITABILITY_ISSUE_LABELS = Object.freeze(
  Object.fromEntries(HABITABILITY_ISSUE_OPTIONS.map((option) => [option.value, option.label]))
);

const STUB_ISSUE_TYPE_ALIASES = Object.freeze({
  repair: 'other',
  emergency: 'imminent',
  health_hazard: 'imminent',
  safety: 'imminent',
});

const HOURS_KEY_BY_TYPE = Object.freeze({
  imminent: 'imminentHours',
  utilities: 'utilitiesHours',
  major_fixture: 'majorFixtureHours',
  other: 'otherHours',
});

const DEFAULT_REPAIR_HOURS = Object.freeze({
  imminentHours: 24,
  utilitiesHours: 24,
  majorFixtureHours: 72,
  otherHours: 240,
});

export function normalizeHabitabilityIssueType(value) {
  const raw = String(value || '').trim();
  if (HABITABILITY_ISSUE_LABELS[raw]) return raw;
  return STUB_ISSUE_TYPE_ALIASES[raw] || '';
}

export function habitabilityIssueTypeLabel(value) {
  const kind = normalizeHabitabilityIssueType(value);
  return HABITABILITY_ISSUE_LABELS[kind] || '';
}

function repairRules(packId) {
  const rules = getResolvedJurisdictionPack(packId)?.resolvedRules?.habitabilityRepair || {};
  return { ...DEFAULT_REPAIR_HOURS, ...rules };
}

/**
 * Commence-repair window from the jurisdiction table (hours from written notice).
 * @param {string} [packId]
 * @param {string} [issueType]
 * @returns {{ hours: number, label: string, citations: Array<{ id: string, href?: string }> }}
 */
export function habitabilityRepairWindow(packId, issueType) {
  const kind = normalizeHabitabilityIssueType(issueType) || 'other';
  const rules = repairRules(packId);
  const hours = Number(rules[HOURS_KEY_BY_TYPE[kind]] ?? DEFAULT_REPAIR_HOURS.otherHours) || 240;
  return {
    hours,
    label: formatRepairWindowLabel(hours),
    citations: getRuleCitations(packId, 'habitability'),
  };
}

export function formatRepairWindowLabel(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 24) return '24 hours';
  if (n === 72) return '72 hours';
  if (n % 24 === 0) {
    const days = n / 24;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return `${n} hours`;
}

/**
 * Calendar reference date if the hour window is treated as whole days.
 * The statute counts hours from receipt of written notice.
 * @param {string} reportedDate
 * @param {number} hours
 * @returns {string} YYYY-MM-DD or ''
 */
export function habitabilityReferenceDeadline(reportedDate, hours) {
  const iso = toWorkflowDateString(reportedDate);
  if (!iso || !isCompleteWorkflowDate(iso)) return '';
  const n = Number(hours);
  if (!Number.isFinite(n) || n < 0) return '';
  return addDaysToWorkflowDate(iso, Math.ceil(n / 24));
}

/**
 * Operator-facing option label for a maintenance request (no internal ids).
 * @param {{ description?: string, status?: string, created_at?: string }} [request]
 * @param {string} [dateLabel]
 */
export function maintenanceRequestOptionLabel(request, dateLabel = '') {
  const desc = String(request?.description || '').replace(/\s+/g, ' ').trim();
  const clipped = desc.length > 80 ? `${desc.slice(0, 77)}…` : desc || 'Maintenance request';
  const status = String(request?.status || '').trim();
  return [clipped, status, dateLabel].filter(Boolean).join(' — ');
}

export function habitabilityRecordFingerprint(data = {}) {
  return [
    data.lease_id,
    normalizeHabitabilityIssueType(data.issue_type),
    data.reported_date,
    String(data.issue_description || '').trim(),
    data.maintenance_request_id || '',
    String(data.outcome_notes || '').trim(),
  ].join('|');
}

/**
 * Tenant-facing body for the habitability worksheet PDF.
 * @param {object} data
 * @returns {string[]}
 */
export function buildHabitabilityRecordLines(data = {}) {
  const unit = String(data.unitNumber || '').trim();
  const lines = [`To: ${data.tenantNames || 'Tenant'}`, '', `Property: ${data.propertyName || 'N/A'}`];
  if (unit) lines.push(`Unit: ${unit}`);
  lines.push(
    '',
    `Issue: ${data.issueTypeLabel || habitabilityIssueTypeLabel(data.issueType) || ''}`,
    `Written notice received: ${data.reportedDateLabel || ''}`
  );
  if (data.repairWindowLabel) {
    lines.push(`Commence remedial action within: ${data.repairWindowLabel}`);
  }
  if (data.deadlineLabel) {
    lines.push(`Reference date (calendar days): ${data.deadlineLabel}`);
  }
  const description = String(data.issueDescription || '').trim();
  if (description) {
    lines.push('', description);
  }
  const workOrder = String(data.maintenanceRequestLabel || '').trim();
  if (workOrder) {
    lines.push('', `Linked work order: ${workOrder}`);
  }
  const outcome = String(data.outcomeNotes || '').trim();
  if (outcome) {
    lines.push('', `Outcome: ${outcome}`);
  }
  lines.push(
    '',
    'This worksheet records the issue and the commence-repair window. It is not a statutory form.',
    '',
    'Not legal advice. See RCW 59.18.060 and RCW 59.18.070.'
  );
  return lines;
}
