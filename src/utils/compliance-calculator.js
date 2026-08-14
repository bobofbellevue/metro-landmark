/**
 * Compliance Calculator Utility
 * Calculates notice periods and validates compliance requirements
 * using jurisdiction pack resolvedRules (Workstream 2).
 */

import { detectJurisdictionFromPropertyId } from './jurisdiction-detector.js';
import {
  DEFAULT_JURISDICTION_PACK_ID,
  getResolvedJurisdictionPack,
} from '../jurisdictions/index.js';

function resolvedRules(jurisdiction) {
  return getResolvedJurisdictionPack(jurisdiction || DEFAULT_JURISDICTION_PACK_ID).resolvedRules;
}

/**
 * Calculate required notice period for rent increase
 * @param {Object} params - Calculation parameters
 * @param {string} params.leaseType - 'month_to_month' or 'fixed_term'
 * @param {string} params.jurisdiction - Jurisdiction pack id
 * @param {number} params.currentRent - Current monthly rent
 * @param {number} params.newRent - New monthly rent
 * @param {number} params.percentIncrease - Percentage increase (optional, calculated if not provided)
 * @returns {number} - Required notice period in days
 */
export function calculateRentIncreaseNoticePeriod({
  leaseType,
  jurisdiction,
  currentRent,
  newRent,
  percentIncrease
}) {
  const rules = resolvedRules(jurisdiction).rentIncrease;
  const increase = percentIncrease ?? ((newRent - currentRent) / currentRent) * 100;

  if (leaseType === 'month_to_month') {
    if (increase > rules.highIncreasePercentThreshold) {
      return rules.monthToMonthHighIncreaseNoticeDays;
    }
    return rules.monthToMonthNoticeDays;
  }

  return rules.fixedTermNoticeDays;
}

/**
 * Calculate required notice period for lease termination
 * @param {Object} params - Calculation parameters
 * @param {string} params.leaseType - 'month_to_month' or 'fixed_term'
 * @param {string} params.jurisdiction - Jurisdiction pack id
 * @param {string} params.initiatedBy - 'landlord' or 'tenant'
 * @param {boolean} params.hasCause - Whether termination is for cause
 * @returns {number} - Required notice period in days
 */
export function calculateTerminationNoticePeriod({
  leaseType,
  jurisdiction,
  initiatedBy,
  hasCause = false
}) {
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
      // Packs like Seattle require just cause for no-cause MTM; notice days still apply.
      return rules.landlordNoCauseMonthToMonthNoticeDays;
    }

    return rules.landlordNoCauseFixedTermNoticeDays;
  }

  return rules.landlordNoCauseMonthToMonthNoticeDays;
}

/**
 * Calculate required notice period for eviction notices
 * @param {Object} params - Calculation parameters
 * @param {string} params.noticeType - '3_day_pay_or_vacate', '10_day_compliance', '14_day_unconditional', '20_day_violation'
 * @param {string} params.jurisdiction - Jurisdiction pack id
 * @returns {number} - Required notice period in days
 */
export function calculateEvictionNoticePeriod({ noticeType, jurisdiction }) {
  const periods = resolvedRules(jurisdiction).evictionNoticeDays;
  return periods[noticeType] ?? periods['3_day_pay_or_vacate'] ?? 3;
}

/**
 * Calculate required notice period for security deposit return
 * @param {string} jurisdiction - Jurisdiction pack id
 * @returns {number} - Required return period in days
 */
export function calculateDepositReturnPeriod(jurisdiction) {
  return resolvedRules(jurisdiction).depositReturnDays;
}

/**
 * Calculate required notice period for entry
 * @param {string} jurisdiction - Jurisdiction pack id
 * @param {boolean} isEmergency - Whether entry is for emergency
 * @returns {number} - Required notice period in hours (0 for emergency)
 */
export function calculateEntryNoticePeriod(jurisdiction, isEmergency = false) {
  if (isEmergency) {
    return 0;
  }
  return resolvedRules(jurisdiction).entryNoticeHours;
}

/**
 * Calculate effective date from notice date and notice period
 * @param {Date|string} noticeDate - Date notice is served
 * @param {number} noticePeriodDays - Required notice period in days
 * @returns {Date} - Effective date
 */
export function calculateEffectiveDate(noticeDate, noticePeriodDays) {
  const date = new Date(noticeDate);
  date.setDate(date.getDate() + noticePeriodDays);
  return date;
}

/**
 * Calculate required notice date from effective date and notice period
 * @param {Date|string} effectiveDate - Desired effective date
 * @param {number} noticePeriodDays - Required notice period in days
 * @returns {Date} - Latest date notice must be served
 */
export function calculateRequiredNoticeDate(effectiveDate, noticePeriodDays) {
  const date = new Date(effectiveDate);
  date.setDate(date.getDate() - noticePeriodDays);
  return date;
}

/**
 * Check if a date meets the required notice period
 * @param {Date|string} noticeDate - Date notice is/will be served
 * @param {Date|string} effectiveDate - Desired effective date
 * @param {number} requiredDays - Required notice period in days
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
      message: `Notice period of ${requiredDays} days required. Only ${diffDays} days between notice and effective date.`
    };
  }

  return {
    valid: true,
    daysDifference: diffDays,
    requiredDays,
    message: `Notice period satisfied (${diffDays} days)`
  };
}

/**
 * Calculate notice period using compliance rules from database
 * @param {Object} params - Calculation parameters
 * @param {string} params.workflowType - Type of workflow ('rent_increase', 'eviction', 'lease_termination', etc.)
 * @param {string} params.leaseType - 'month_to_month' or 'fixed_term'
 * @param {string|number} params.propertyId - Property ID (optional, for jurisdiction detection)
 * @param {string} params.jurisdiction - Pack id (optional, will detect from property if not provided)
 * @param {Object} params.context - Additional context for rule matching (e.g., { percent_increase: 15 })
 * @param {Object} params.supabase - Optional Supabase client
 * @returns {Promise<Object>} - { noticePeriodDays: number, requiredNoticeDate: Date, rules: Array }
 */
export async function calculateNoticePeriod({
  workflowType,
  leaseType,
  propertyId = null,
  jurisdiction = null,
  context = {},
  supabase = null
}) {
  try {
    // Detect jurisdiction if not provided
    let detectedJurisdiction = jurisdiction;
    if (!detectedJurisdiction && propertyId) {
      detectedJurisdiction = await detectJurisdictionFromPropertyId(propertyId, supabase);
    }
    if (!detectedJurisdiction) {
      detectedJurisdiction = DEFAULT_JURISDICTION_PACK_ID;
    }

    // Fetch applicable rules from API
    const rulesUrl = `/api/compliance/rules?jurisdiction=${detectedJurisdiction}&applies_to=${workflowType}&is_active=true`;
    const response = await fetch(rulesUrl);
    
    if (!response.ok) {
      throw new Error('Failed to fetch compliance rules');
    }

    const { rules = [] } = await response.json();

    // Filter and match rules based on conditions
    let applicableRules = rules.filter(rule => {
      if (!rule.rule_condition || Object.keys(rule.rule_condition).length === 0) {
        return true; // Rule applies to all cases
      }

      // Check lease_type condition
      if (rule.rule_condition.lease_type && rule.rule_condition.lease_type !== leaseType) {
        return false;
      }

      // Check percent_increase condition
      if (rule.rule_condition.percent_increase && context.percent_increase !== undefined) {
        const condition = rule.rule_condition.percent_increase;
        if (condition.operator === 'lte' && context.percent_increase > condition.value) {
          return false;
        }
        if (condition.operator === 'gt' && context.percent_increase <= condition.value) {
          return false;
        }
      }

      // Add more condition checks as needed
      return true;
    });

    // Find the rule with notice_period_days
    const noticePeriodRule = applicableRules.find(r => r.notice_period_days !== null && r.notice_period_days !== undefined);

    let noticePeriodDays = null;
    if (noticePeriodRule) {
      noticePeriodDays = noticePeriodRule.notice_period_days;
    } else {
      // Fallback to pack-based calculations if no rule found
      if (workflowType === 'rent_increase') {
        noticePeriodDays = calculateRentIncreaseNoticePeriod({
          leaseType,
          jurisdiction: detectedJurisdiction,
          currentRent: context.currentRent,
          newRent: context.newRent,
          percentIncrease: context.percent_increase
        });
      } else if (workflowType === 'lease_termination') {
        noticePeriodDays = calculateTerminationNoticePeriod({
          leaseType,
          jurisdiction: detectedJurisdiction,
          initiatedBy: context.initiatedBy || 'landlord',
          hasCause: context.hasCause || false
        });
      } else if (workflowType === 'eviction') {
        noticePeriodDays = calculateEvictionNoticePeriod({
          noticeType: context.noticeType || '3_day_pay_or_vacate',
          jurisdiction: detectedJurisdiction
        });
      } else if (workflowType === 'security_deposit') {
        noticePeriodDays = calculateDepositReturnPeriod(detectedJurisdiction);
      } else {
        // Default to 30 days
        noticePeriodDays = 30;
      }
    }

    // Calculate required notice date (if effective date is provided)
    let requiredNoticeDate = null;
    if (context.effectiveDate) {
      requiredNoticeDate = calculateRequiredNoticeDate(context.effectiveDate, noticePeriodDays);
    }

    return {
      noticePeriodDays,
      requiredNoticeDate,
      jurisdiction: detectedJurisdiction,
      rules: applicableRules,
      effectiveDate: context.effectiveDate || null
    };
  } catch (error) {
    console.error('Error calculating notice period:', error);
    // Fallback to pack-based calculation
    const fallbackJurisdiction = jurisdiction || DEFAULT_JURISDICTION_PACK_ID;
    const fallbackDays = workflowType === 'rent_increase' 
      ? calculateRentIncreaseNoticePeriod({
          leaseType,
          jurisdiction: fallbackJurisdiction,
          currentRent: context.currentRent,
          newRent: context.newRent,
          percentIncrease: context.percent_increase
        })
      : 30;

    return {
      noticePeriodDays: fallbackDays,
      requiredNoticeDate: context.effectiveDate 
        ? calculateRequiredNoticeDate(context.effectiveDate, fallbackDays)
        : null,
      jurisdiction: fallbackJurisdiction,
      rules: [],
      error: error.message
    };
  }
}
