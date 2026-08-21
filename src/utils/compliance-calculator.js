/**
 * Compliance Calculator Utility
 * Calculates notice periods and validates compliance requirements
 * using jurisdiction pack resolvedRules (Workstream 2 / E1).
 *
 * Pack numbers are the source of truth for notice math. Database
 * compliance_rules rows are returned as supplemental context only.
 */

import { detectJurisdictionFromPropertyId } from './jurisdiction-detector.js';
import {
  DEFAULT_JURISDICTION_PACK_ID,
  getMaxRentIncreasePercent,
  getResolvedJurisdictionPack,
  getRuleCitations,
} from '../jurisdictions/index.js';
import {
  addDaysToWorkflowDate,
  calendarDaysBetween,
  parseWorkflowDateParts,
  todayWorkflowDate,
  toWorkflowDateString,
} from './workflow-date.js';

function resolvedRules(jurisdiction) {
  return getResolvedJurisdictionPack(jurisdiction || DEFAULT_JURISDICTION_PACK_ID).resolvedRules;
}

function resolvedPackId(jurisdiction) {
  return getResolvedJurisdictionPack(jurisdiction || DEFAULT_JURISDICTION_PACK_ID).id;
}

/**
 * @param {number|string|null|undefined} percentIncrease
 * @param {number|string|null|undefined} currentRent
 * @param {number|string|null|undefined} newRent
 * @returns {number|null}
 */
export function resolvePercentIncrease(percentIncrease, currentRent, newRent) {
  if (percentIncrease != null && percentIncrease !== '') {
    const parsed = Number(percentIncrease);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const current = Number(currentRent);
  const next = Number(newRent);
  if (Number.isFinite(current) && current > 0 && Number.isFinite(next)) {
    return ((next - current) / current) * 100;
  }
  return null;
}

/**
 * Pack-driven rent-increase notice days, including city percent tiers.
 * Subsidized income-based tenancies keep the pack's subsidized path.
 * Unknown percent uses defaultNoticeDays (does not assume a high-increase tier).
 * @param {object} rules resolved rentIncrease section
 * @param {{ subsidized?: boolean, percentIncrease?: number|null }} [options]
 * @returns {number}
 */
export function noticeDaysForRentIncrease(rules = {}, { subsidized = false, percentIncrease = null } = {}) {
  if (subsidized) return rules.subsidizedNoticeDays ?? 30;
  let days = rules.defaultNoticeDays ?? rules.monthToMonthNoticeDays ?? 90;
  const pct =
    percentIncrease == null || percentIncrease === '' ? null : Number(percentIncrease);
  if (!Number.isFinite(pct)) return days;

  if (rules.highIncreasePercentThreshold != null && rules.monthToMonthHighIncreaseNoticeDays != null) {
    const threshold = Number(rules.highIncreasePercentThreshold);
    const highDays = Number(rules.monthToMonthHighIncreaseNoticeDays);
    if (Number.isFinite(threshold) && Number.isFinite(highDays) && pct > threshold) {
      days = Math.max(days, highDays);
    }
  }

  for (const tier of rules.noticeTiers || []) {
    const min = Number(tier.minPercent);
    const tierDays = Number(tier.days);
    if (!Number.isFinite(min) || !Number.isFinite(tierDays)) continue;
    const hit = tier.minInclusive ? pct >= min : pct > min;
    if (hit) days = Math.max(days, tierDays);
  }
  return days;
}

function monthsBetween(start, end) {
  const a = parseWorkflowDateParts(toWorkflowDateString(start));
  const b = parseWorkflowDateParts(toWorkflowDateString(end));
  if (!a || !b) return null;
  return (b.year - a.year) * 12 + (b.month - a.month)
    + (b.day < a.day ? -1 : 0);
}

function calendarYear(value) {
  const parts = parseWorkflowDateParts(toWorkflowDateString(value));
  return parts ? parts.year : new Date().getFullYear();
}

/**
 * Full rent-increase evaluation against the resolved pack.
 * @returns {object}
 */
export function evaluateRentIncrease({
  leaseType,
  jurisdiction,
  currentRent,
  newRent,
  percentIncrease,
  subsidized = false,
  tenancyStartDate = null,
  effectiveDate = null,
  asOfYear = null,
} = {}) {
  const packId = resolvedPackId(jurisdiction);
  const rules = resolvedRules(packId).rentIncrease;
  const increase = resolvePercentIncrease(percentIncrease, currentRent, newRent);
  const noticePeriodDays = noticeDaysForRentIncrease(rules, {
    subsidized,
    percentIncrease: increase,
  });

  const year = asOfYear ?? (effectiveDate ? calendarYear(effectiveDate) : new Date().getFullYear());
  const maxIncreasePercent = getMaxRentIncreasePercent(packId, year);
  const exceedsCap = maxIncreasePercent != null && increase != null && increase > maxIncreasePercent;

  let firstTwelveMonthsBlocked = false;
  if (rules.firstTwelveMonthsNoIncrease && tenancyStartDate && effectiveDate) {
    const elapsedMonths = monthsBetween(tenancyStartDate, effectiveDate);
    firstTwelveMonthsBlocked = elapsedMonths != null && elapsedMonths < 12;
  }

  return {
    noticePeriodDays,
    percentIncrease: increase,
    maxIncreasePercent,
    exceedsCap,
    firstTwelveMonthsBlocked,
    excludeDayOfService: !!rules.excludeDayOfService,
    subsidized: !!subsidized,
    leaseType: leaseType || null,
    jurisdiction: packId,
    citations: getRuleCitations(packId, 'rentIncrease'),
  };
}

/**
 * Calculate required notice period for rent increase
 * @returns {number} - Required notice period in days
 */
export function calculateRentIncreaseNoticePeriod({
  leaseType,
  jurisdiction,
  currentRent,
  newRent,
  percentIncrease,
  subsidized = false,
} = {}) {
  return evaluateRentIncrease({
    leaseType,
    jurisdiction,
    currentRent,
    newRent,
    percentIncrease,
    subsidized,
  }).noticePeriodDays;
}

/**
 * Calculate required notice period for lease termination
 * @returns {number} - Required notice period in days
 */
export function calculateTerminationNoticePeriod({
  leaseType,
  jurisdiction,
  initiatedBy,
  hasCause = false,
} = {}) {
  const rules = resolvedRules(jurisdiction).termination;

  if (initiatedBy === 'tenant') {
    return leaseType === 'month_to_month'
      ? rules.tenantMonthToMonthNoticeDays
      : rules.tenantFixedTermNoticeDays;
  }

  if (initiatedBy === 'landlord') {
    if (hasCause) {
      return rules.landlordWithCauseNoticeDays;
    }

    if (leaseType === 'month_to_month') {
      // Just-cause packs still return the encoded notice days for permitted paths.
      return rules.landlordNoCauseMonthToMonthNoticeDays;
    }

    return rules.landlordNoCauseFixedTermNoticeDays
      ?? rules.landlordEndOfInitialTermNoticeDays;
  }

  return rules.landlordNoCauseMonthToMonthNoticeDays;
}

/**
 * Whether a lease looks fixed-term (has an end date) vs month-to-month.
 * @param {{ end_date?: unknown }|null|undefined} lease
 * @returns {'fixed_term'|'month_to_month'}
 */
export function leaseTypeFromLease(lease) {
  const end = lease?.end_date;
  return end != null && String(end).trim() !== '' ? 'fixed_term' : 'month_to_month';
}

/**
 * Pack evaluation for ending a tenancy (just cause / Seattle renewal-offer overlay).
 * @returns {object}
 */
export function evaluateLeaseTermination({
  leaseType,
  jurisdiction,
  initiatedBy = 'landlord',
  hasCause = false,
  leaseEndDate = null,
  asOfDate = null,
} = {}) {
  const packId = resolvedPackId(jurisdiction);
  const rules = resolvedRules(packId).termination || {};
  const noticePeriodDays = calculateTerminationNoticePeriod({
    leaseType,
    jurisdiction: packId,
    initiatedBy,
    hasCause,
  });

  const landlord = initiatedBy === 'landlord';
  const noCause = !hasCause;
  const monthToMonth = leaseType === 'month_to_month';
  const fixedTerm = leaseType === 'fixed_term';

  const justCauseRequiredForPath =
    landlord &&
    noCause &&
    ((monthToMonth && !!rules.requiresJustCauseForNoCauseMonthToMonth) ||
      (fixedTerm && !!rules.requiresJustCauseForFixedTermNonrenewal));

  const renewalOfferRequired =
    landlord && noCause && fixedTerm && !!rules.requiresRenewalOffer;

  const blocked = justCauseRequiredForPath || renewalOfferRequired;
  let blockReason = '';
  if (renewalOfferRequired) {
    blockReason =
      'This pack requires a renewal offer unless there is just cause for non-renewal. Use Lease Renewal, or mark this as for-cause.';
  } else if (justCauseRequiredForPath) {
    blockReason =
      'This pack requires just cause to end this tenancy except limited statutory paths.';
  }

  const minDays = rules.renewalOfferMinDaysBeforeEnd ?? null;
  const maxDays = rules.renewalOfferMaxDaysBeforeEnd ?? null;
  const asOf = asOfDate || todayWorkflowDate();
  const daysUntilLeaseEnd = leaseEndDate
    ? calendarDaysBetween(asOf, leaseEndDate)
    : null;
  const inRenewalOfferWindow =
    daysUntilLeaseEnd != null &&
    minDays != null &&
    maxDays != null &&
    daysUntilLeaseEnd >= minDays &&
    daysUntilLeaseEnd <= maxDays;

  return {
    noticePeriodDays,
    justCauseRequiredForPath,
    renewalOfferRequired,
    blocked,
    blockReason,
    renewalOfferMinDaysBeforeEnd: minDays,
    renewalOfferMaxDaysBeforeEnd: maxDays,
    daysUntilLeaseEnd,
    inRenewalOfferWindow,
    leaseType: leaseType || null,
    jurisdiction: packId,
    citations: getRuleCitations(packId, 'termination'),
  };
}

/**
 * Calculate required notice period for eviction notices
 * @returns {number} - Required notice period in days
 */
export function calculateEvictionNoticePeriod({ noticeType, jurisdiction } = {}) {
  const periods = resolvedRules(jurisdiction).evictionNoticeDays;
  return periods[noticeType] ?? periods['3_day_pay_or_vacate'] ?? 3;
}

/**
 * Calculate required notice period for security deposit return
 * @returns {number} - Required return period in days
 */
export function calculateDepositReturnPeriod(jurisdiction) {
  return resolvedRules(jurisdiction).depositReturnDays;
}

/**
 * Calculate required notice period for entry
 * @param {string} jurisdiction
 * @param {boolean|object} isEmergencyOrOptions
 * @param {string} [purpose] 'general' | 'showing' (when second arg is boolean)
 * @returns {number} hours (0 for emergency)
 */
export function calculateEntryNoticePeriod(
  jurisdiction,
  isEmergencyOrOptions = false,
  purpose = 'general'
) {
  const options = typeof isEmergencyOrOptions === 'object' && isEmergencyOrOptions != null
    ? isEmergencyOrOptions
    : { isEmergency: !!isEmergencyOrOptions, purpose };
  if (options.isEmergency) {
    return 0;
  }
  const rules = resolvedRules(jurisdiction);
  if (options.purpose === 'showing') {
    return rules.entryShowingNoticeHours ?? 24;
  }
  return rules.entryNoticeHours;
}

/**
 * Pack-driven notice days for a workflow type (used by calculateNoticePeriod).
 */
export function noticePeriodDaysFromPack({
  workflowType,
  leaseType,
  jurisdiction,
  context = {},
} = {}) {
  const packId = resolvedPackId(jurisdiction);
  if (workflowType === 'rent_increase') {
    return calculateRentIncreaseNoticePeriod({
      leaseType,
      jurisdiction: packId,
      currentRent: context.currentRent,
      newRent: context.newRent,
      percentIncrease: context.percent_increase ?? context.percentIncrease,
      subsidized: context.subsidized || context.incomeBasedRent || false,
    });
  }
  if (workflowType === 'lease_termination') {
    return calculateTerminationNoticePeriod({
      leaseType,
      jurisdiction: packId,
      initiatedBy: context.initiatedBy || 'landlord',
      hasCause: context.hasCause || false,
    });
  }
  if (workflowType === 'eviction') {
    return calculateEvictionNoticePeriod({
      noticeType: context.noticeType || '3_day_pay_or_vacate',
      jurisdiction: packId,
    });
  }
  if (workflowType === 'security_deposit') {
    return calculateDepositReturnPeriod(packId);
  }
  if (workflowType === 'entry' || workflowType === 'entry_notice') {
    return calculateEntryNoticePeriod(packId, {
      isEmergency: !!context.isEmergency,
      purpose: context.entryPurpose || context.purpose || 'general',
    });
  }
  return 30;
}

function citationsForWorkflow(jurisdiction, workflowType) {
  const section = {
    rent_increase: 'rentIncrease',
    lease_termination: 'termination',
    eviction: 'eviction',
    security_deposit: 'deposit',
    entry: 'entry',
    entry_notice: 'entry',
  }[workflowType];
  return getRuleCitations(jurisdiction, section);
}

/**
 * Calculate effective date from notice date and notice period.
 * @returns {string} YYYY-MM-DD, or '' when the notice date is not a calendar date
 */
export function calculateEffectiveDate(noticeDate, noticePeriodDays) {
  const iso = toWorkflowDateString(noticeDate);
  if (!iso) return '';
  return addDaysToWorkflowDate(iso, Number(noticePeriodDays) || 0);
}

/**
 * Calculate required notice date from effective date and notice period.
 * Returns YYYY-MM-DD (never a UTC Date — `new Date('YYYY-MM-DD')` shifts a day
 * west of UTC and is the usual source of 03/01 → 02/28 display bugs).
 * @returns {string}
 */
export function calculateRequiredNoticeDate(effectiveDate, noticePeriodDays, options = {}) {
  const iso = toWorkflowDateString(effectiveDate);
  if (!iso) return '';
  const extra = options.excludeDayOfService ? 1 : Number(options.extraDays) || 0;
  const days = (Number(noticePeriodDays) || 0) + extra;
  return addDaysToWorkflowDate(iso, -days);
}

/**
 * Check if a date meets the required notice period
 * @returns {Object} - { valid: boolean, daysDifference: number, message: string }
 */
export function validateNoticePeriod(noticeDate, effectiveDate, requiredDays) {
  const diffDays = calendarDaysBetween(noticeDate, effectiveDate);
  if (diffDays == null) {
    return {
      valid: false,
      daysDifference: 0,
      requiredDays,
      message: 'Notice or effective date is not a valid calendar date.',
    };
  }

  if (diffDays < requiredDays) {
    return {
      valid: false,
      daysDifference: diffDays,
      requiredDays,
      message: `Notice period of ${requiredDays} days required. Only ${diffDays} days between notice and effective date.`,
    };
  }

  return {
    valid: true,
    daysDifference: diffDays,
    requiredDays,
    message: `Notice period satisfied (${diffDays} days)`,
  };
}

/**
 * Calculate notice period using the jurisdiction pack, with optional DB rules
 * attached for display. Pack math wins so stale seed rows cannot override RCW values.
 */
export async function calculateNoticePeriod({
  workflowType,
  leaseType,
  propertyId = null,
  jurisdiction = null,
  context = {},
  supabase = null,
} = {}) {
  let detectedJurisdiction = jurisdiction;
  try {
    if (!detectedJurisdiction && propertyId) {
      detectedJurisdiction = await detectJurisdictionFromPropertyId(propertyId, supabase);
    }
  } catch (error) {
    console.error('Error detecting jurisdiction:', error);
  }
  if (!detectedJurisdiction) {
    detectedJurisdiction = DEFAULT_JURISDICTION_PACK_ID;
  }

  const noticePeriodDays = noticePeriodDaysFromPack({
    workflowType,
    leaseType,
    jurisdiction: detectedJurisdiction,
    context,
  });

  let applicableRules = [];
  let fetchError = null;
  try {
    const rulesUrl = `/api/compliance/rules?jurisdiction=${detectedJurisdiction}&applies_to=${workflowType}&is_active=true`;
    const response = await fetch(rulesUrl);
    if (response.ok) {
      const payload = await response.json();
      const rules = payload.rules || [];
      applicableRules = rules.filter((rule) => {
        if (!rule.rule_condition || Object.keys(rule.rule_condition).length === 0) {
          return true;
        }
        if (rule.rule_condition.lease_type && rule.rule_condition.lease_type !== leaseType) {
          return false;
        }
        if (rule.rule_condition.percent_increase && context.percent_increase !== undefined) {
          const condition = rule.rule_condition.percent_increase;
          if (condition.operator === 'lte' && context.percent_increase > condition.value) {
            return false;
          }
          if (condition.operator === 'gt' && context.percent_increase <= condition.value) {
            return false;
          }
        }
        return true;
      });
    } else {
      fetchError = 'Failed to fetch compliance rules';
    }
  } catch (error) {
    fetchError = error.message;
  }

  let requiredNoticeDate = null;
  if (context.effectiveDate) {
    const rentRules = resolvedRules(detectedJurisdiction).rentIncrease || {};
    requiredNoticeDate = calculateRequiredNoticeDate(
      context.effectiveDate,
      noticePeriodDays,
      {
        excludeDayOfService:
          workflowType === 'rent_increase' && !!rentRules.excludeDayOfService,
      }
    );
  }

  const result = {
    noticePeriodDays,
    requiredNoticeDate,
    jurisdiction: detectedJurisdiction,
    citations: citationsForWorkflow(detectedJurisdiction, workflowType),
    rules: applicableRules,
    effectiveDate: context.effectiveDate || null,
    source: 'jurisdiction_pack',
  };

  if (workflowType === 'rent_increase') {
    result.evaluation = evaluateRentIncrease({
      leaseType,
      jurisdiction: detectedJurisdiction,
      currentRent: context.currentRent,
      newRent: context.newRent,
      percentIncrease: context.percent_increase ?? context.percentIncrease,
      subsidized: context.subsidized || context.incomeBasedRent || false,
      tenancyStartDate: context.tenancyStartDate || context.leaseStartDate || null,
      effectiveDate: context.effectiveDate || null,
    });
  }

  if (fetchError) {
    result.rulesError = fetchError;
  }

  return result;
}
