/**
 * Collections (late rent) notice kinds and Eviction handoff.
 * Cure days come from pack evictionNoticeDays (3-day pay-or-vacate).
 * Pack numbers are reference math, not legal advice. Do not copy RHAWA forms.
 */

import { calculateEvictionNoticePeriod } from './compliance-calculator.js';

export const COLLECTION_PAY_OR_VACATE = '3_day_pay_or_vacate';

export const COLLECTION_FDCPA_NOTICE =
  'If you communicate about a consumer debt, federal Fair Debt Collection Practices Act (FDCPA) rules may apply (15 U.S.C. §§ 1692–1692p). Not legal advice.';

const NOTICE_KIND_IDS = Object.freeze([COLLECTION_PAY_OR_VACATE]);

/**
 * Pack-driven late-rent notice options (pay-or-vacate only).
 * 10-day comply and 14-day unconditional stay on Eviction / Lease Violation.
 * @param {string} [packId]
 * @returns {{ value: string, days: number, label: string }[]}
 */
export function collectionNoticeKindOptions(packId) {
  return NOTICE_KIND_IDS.map((value) => {
    const days = calculateEvictionNoticePeriod({
      noticeType: value,
      jurisdiction: packId,
    });
    return {
      value,
      days,
      label: `${days}-Day Pay or Vacate`,
    };
  });
}

export function collectionNoticeKindLabel(packId, noticeKind) {
  const kind = normalizeCollectionNoticeType(noticeKind);
  const match = collectionNoticeKindOptions(packId).find((option) => option.value === kind);
  return match?.label || '';
}

export function collectionNoticeDays(packId, noticeKind) {
  return calculateEvictionNoticePeriod({
    noticeType: normalizeCollectionNoticeType(noticeKind),
    jurisdiction: packId,
  });
}

/**
 * Map stub values (`3_day`) onto Eviction's pay-or-vacate type.
 * Collections does not hand off 10-day or 14-day notices.
 * @param {unknown} [_value]
 * @returns {string}
 */
export function normalizeCollectionNoticeType(_value) {
  return COLLECTION_PAY_OR_VACATE;
}

export function parseAmountOwed(value) {
  if (value == null || value === '') return null;
  const amount = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(amount)) return null;
  return amount;
}

export function isPositiveAmountOwed(value) {
  const amount = parseAmountOwed(value);
  return amount != null && amount > 0;
}

function formatUsd(value) {
  const amount = parseAmountOwed(value);
  if (amount == null) return '';
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Prefill Eviction generate-then-serve from a completed collections row.
 * @param {Record<string, unknown>} [data]
 * @param {{ units?: { unit_id?: unknown, properties?: { property_id?: unknown } } }|null} [lease]
 * @returns {Record<string, unknown>}
 */
export function evictionHandoffFromCollections(data = {}, lease = null) {
  const amount = parseAmountOwed(data.amount_owed);
  const notes = String(data.collection_notes || data.notes || '').trim();
  const reasonParts = ['Nonpayment of rent.'];
  const amountLabel = formatUsd(amount);
  if (amountLabel) reasonParts.push(`Amount owed: ${amountLabel}.`);
  if (notes) reasonParts.push(notes);
  return {
    lease_id: data.lease_id ?? null,
    unit_id: data.unit_id || lease?.units?.unit_id || null,
    property_id: data.property_id || lease?.units?.properties?.property_id || null,
    notice_type: COLLECTION_PAY_OR_VACATE,
    amount_owed: amount,
    violation_reason: reasonParts.join(' '),
  };
}
