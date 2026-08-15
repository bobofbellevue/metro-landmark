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

function monthsBetween(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
    + (b.getDate() < a.getDate() ? -1 : 0);
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
  const noticePeriodDays = subsidized
    ? (rules.subsidizedNoticeDays ?? 30)
    : (rules.defaultNoticeDays ?? rules.monthToMonthNoticeDays ?? 90);

  const year = asOfYear
    ?? (effectiveDate ? new Date(effectiveDate).getFullYear() : new Date().getFullYear());
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
 * Calculate effective date from notice date and notice period
 * @returns {Date}
 */
export function calculateEffectiveDate(noticeDate, noticePeriodDays) {
  const date = new Date(noticeDate);
  date.setDate(date.getDate() + noticePeriodDays);
  return date;
}

/**
 * Calculate required notice date from effective date and notice period
 * @returns {Date}
 */
export function calculateRequiredNoticeDate(effectiveDate, noticePeriodDays) {
  const date = new Date(effectiveDate);
  date.setDate(date.getDate() - noticePeriodDays);
  return date;
}

/**
 * Check if a date meets the required notice period
 * @returns {Object} - { valid: boolean, daysDifference: number, message: string }
 */
export function validateNoticePeriod(noticeDate, effectiveDate, requiredDays) {
  const notice = new Date(noticeDate);
  const effective = new Date(effectiveDate);
  const diffTime = effective - notice;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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
    requiredNoticeDate = calculateRequiredNoticeDate(context.effectiveDate, noticePeriodDays);
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
