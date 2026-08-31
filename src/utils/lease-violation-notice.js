/**
 * Lease-violation notice kinds and labels.
 * Cure days come from pack evictionNoticeDays (10-day comply, 20-day other).
 * Pack numbers are reference math, not legal advice. Do not copy RHAWA forms.
 */

import { calculateEvictionNoticePeriod } from './compliance-calculator.js';

export const VIOLATION_TYPE_OPTIONS = Object.freeze([
  { value: 'noise', label: 'Noise Complaint' },
  { value: 'pet', label: 'Pet Policy Violation' },
  { value: 'unauthorized_occupant', label: 'Unauthorized Occupant' },
  { value: 'property_damage', label: 'Property Damage' },
  { value: 'nuisance', label: 'Nuisance' },
  { value: 'other', label: 'Other' },
]);

export const VIOLATION_TYPE_LABELS = Object.freeze(
  Object.fromEntries(VIOLATION_TYPE_OPTIONS.map((option) => [option.value, option.label]))
);

const NOTICE_KIND_IDS = Object.freeze(['10_day_compliance', '20_day_violation']);

/**
 * Pack-driven 10-day comply / 20-day notice options (not 3-day pay-or-vacate).
 * @param {string} [packId]
 * @returns {{ value: string, days: number, label: string }[]}
 */
export function violationNoticeKindOptions(packId) {
  return NOTICE_KIND_IDS.map((value) => {
    const days = calculateEvictionNoticePeriod({
      noticeType: value,
      jurisdiction: packId,
    });
    return {
      value,
      days,
      label:
        value === '10_day_compliance'
          ? `${days}-Day Comply or Vacate`
          : `${days}-Day Notice`,
    };
  });
}

export function violationNoticeKindLabel(packId, noticeKind) {
  const match = violationNoticeKindOptions(packId).find((kind) => kind.value === noticeKind);
  return match?.label || '';
}

export function violationCureDays(packId, noticeKind) {
  const kind = noticeKind || '10_day_compliance';
  return calculateEvictionNoticePeriod({
    noticeType: kind,
    jurisdiction: packId,
  });
}
