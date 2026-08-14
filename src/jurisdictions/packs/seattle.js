/**
 * City of Seattle jurisdiction pack (overlays Washington State).
 * More restrictive local rules; statute refs include SMC where applicable.
 */
export const seattlePack = {
  id: 'seattle',
  displayName: 'City of Seattle',
  parentPackId: 'washington_state',
  cityMatchers: ['seattle'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  statuteRefs: [
    { id: 'RCW_59.18', label: 'RCW 59.18 (Residential Landlord-Tenant Act)' },
    { id: 'SMC_22.206', label: 'Seattle Municipal Code Title 22 (Housing)' },
  ],
  rules: {
    // Notice periods currently match WA for rent increase in existing calculator;
    // kept explicit so they can diverge without touching call sites.
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
      requiresJustCauseForNoCauseMonthToMonth: true,
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
      enabled: true,
      notes: 'Seattle rent control / just-cause overlays apply.',
    },
  },
};
