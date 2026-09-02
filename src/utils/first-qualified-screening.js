/**
 * Seattle first-qualified screening (SMC 14.09 / pack screening rules).
 * Process pending applications in applied_at order; do not approve a later
 * applicant while an earlier one is still pending.
 */

import {
  DEFAULT_JURISDICTION_PACK_ID,
  getResolvedJurisdictionPack,
  getRuleCitations,
} from '../jurisdictions/index.js';

const OPEN_APPLICATION_STATUSES = new Set(['pending', 'submitted']);

function packIdOf(jurisdiction) {
  return getResolvedJurisdictionPack(jurisdiction || DEFAULT_JURISDICTION_PACK_ID)
    .id;
}

function appliedAtMs(row) {
  const value = row?.applied_at || row?.submitted_at || row?.created_at;
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Pending/submitted applications in first-qualified order (earliest applied first).
 * @param {Array<Record<string, unknown>>} queue
 * @returns {Array<Record<string, unknown>>}
 */
export function pendingApplicationsInOrder(queue = []) {
  return (queue || [])
    .filter((row) =>
      OPEN_APPLICATION_STATUSES.has(
        String(row?.status || 'pending').toLowerCase()
      )
    )
    .slice()
    .sort((a, b) => appliedAtMs(a) - appliedAtMs(b) || a.application_id - b.application_id);
}

/**
 * @param {{
 *   jurisdiction?: string,
 *   queue?: Array<Record<string, unknown>>,
 *   selectedApplicationId?: number|string|null,
 *   decision?: string|null,
 * }} [opts]
 */
export function evaluateFirstQualifiedScreening({
  jurisdiction,
  queue = [],
  selectedApplicationId,
  decision,
} = {}) {
  const packId = packIdOf(jurisdiction);
  const screening =
    getResolvedJurisdictionPack(packId).resolvedRules.screening || {};
  const firstQualifiedApplicant = !!screening.firstQualifiedApplicant;
  const writtenCriteriaRequired = !!screening.writtenCriteriaRequired;

  const pending = pendingApplicationsInOrder(queue);
  const selectedIndex = pending.findIndex(
    (row) => String(row.application_id) === String(selectedApplicationId)
  );
  const earlierPending =
    selectedIndex > 0
      ? pending.slice(0, selectedIndex)
      : selectedIndex < 0
        ? pending
        : [];

  const approving = String(decision || '').toLowerCase() === 'approved';
  const skippedEarlier =
    firstQualifiedApplicant &&
    approving &&
    selectedApplicationId != null &&
    earlierPending.length > 0;

  return {
    firstQualifiedApplicant,
    writtenCriteriaRequired,
    blocked: skippedEarlier,
    blockReason: skippedEarlier ? firstQualifiedBlockReason() : '',
    earlierPendingCount: earlierPending.length,
    pendingCount: pending.length,
    jurisdiction: packId,
    citations: getRuleCitations(packId, 'screening'),
  };
}

/** Operator copy: decide earlier pending files first. */
export function firstQualifiedBlockReason() {
  return 'Decide earlier pending applications before approving a later one (first-qualified order).';
}

/** Operator copy when written criteria must be noted. */
export function writtenCriteriaRequiredMessage() {
  return 'Note the published written screening criteria used for this decision.';
}

/**
 * Queue banner: jurisdiction name plus how to work the list.
 * @param {string} [jurisdictionName]
 * @param {{ firstQualifiedApplicant?: boolean }} [opts]
 */
export function screeningQueueNote(jurisdictionName, { firstQualifiedApplicant } = {}) {
  const place = String(jurisdictionName || '').trim().replace(/\.$/, '');
  const rule = firstQualifiedApplicant
    ? 'Offer housing to the first pending applicant who meets the published written criteria.'
    : 'Review pending applications in the order they were received.';
  return [place, rule].filter(Boolean).join('. ');
}

/** Operator copy on the Complete step. */
export function screeningReferenceDisclaimer() {
  return 'These screening steps are a reference, not a substitute for legal counsel.';
}
