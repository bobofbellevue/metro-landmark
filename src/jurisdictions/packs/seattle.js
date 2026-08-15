/**
 * City of Seattle jurisdiction pack (overlays Washington State).
 * Statewide RCW numbers inherit; Seattle adds just-cause / screening overlays.
 */
export const seattlePack = {
  id: 'seattle',
  displayName: 'City of Seattle',
  parentPackId: 'washington_state',
  cityMatchers: ['seattle'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  statuteRefIds: ['SMC_22.206', 'SMC_22.206.160', 'SMC_14.09'],
  rules: {
    termination: {
      requiresJustCauseForNoCauseMonthToMonth: true,
      requiresJustCauseForFixedTermNonrenewal: true,
      requiresRenewalOffer: true,
      renewalOfferMinDaysBeforeEnd: 60,
      renewalOfferMaxDaysBeforeEnd: 90,
      citationIds: ['RCW_59.18.650', 'SMC_22.206.160'],
    },
    rentControl: {
      enabled: true,
      notes:
        'Statewide cap (RCW 59.18.700) plus Seattle just-cause and renewal-offer overlay (SMC 22.206.160).',
      citationIds: ['RCW_59.18.700', 'SMC_22.206.160'],
    },
    screening: {
      firstQualifiedApplicant: true,
      writtenCriteriaRequired: true,
      citationIds: ['SMC_14.09'],
    },
  },
};
