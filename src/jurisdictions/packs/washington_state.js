/**
 * Washington State jurisdiction pack (RCW-oriented defaults).
 * Rule values mirror the prior hard-coded compliance-calculator logic.
 */
export const washingtonStatePack = {
  id: 'washington_state',
  displayName: 'Washington State',
  parentPackId: null,
  /** Cities that map directly to this pack (empty = default for WA properties) */
  cityMatchers: [],
  defaultForUnmatchedInState: true,
  stateCode: 'WA',
  statuteRefs: [
    { id: 'RCW_59.18', label: 'RCW 59.18 (Residential Landlord-Tenant Act)' },
  ],
  rules: {
    rentIncrease: {
      monthToMonthNoticeDays: 30,
      monthToMonthHighIncreaseNoticeDays: 60,
      highIncreasePercentThreshold: 10,
      fixedTermNoticeDays: 60,
    },
    termination: {
      tenantMonthToMonthNoticeDays: 20,
      tenantFixedTermNoticeDays: 0,
      landlordWithCauseNoticeDays: 20,
      landlordNoCauseMonthToMonthNoticeDays: 20,
      landlordNoCauseFixedTermNoticeDays: 0,
      requiresJustCauseForNoCauseMonthToMonth: false,
    },
    evictionNoticeDays: {
      '3_day_pay_or_vacate': 3,
      '10_day_compliance': 10,
      '14_day_unconditional': 14,
      '20_day_violation': 20,
    },
    depositReturnDays: 14,
    entryNoticeHours: 24,
    rentControl: {
      enabled: false,
    },
  },
};
