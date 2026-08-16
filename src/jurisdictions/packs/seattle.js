/**
 * City of Seattle jurisdiction pack (overlays Washington State).
 * Statewide RCW numbers inherit; Seattle adds housing-cost notice, just-cause,
 * and screening overlays.
 */
export const seattlePack = {
  id: 'seattle',
  displayName: 'City of Seattle',
  parentPackId: 'washington_state',
  cityMatchers: ['seattle'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  sourceUrls: [
    {
      label: 'Seattle housing cost increases (Renting in Seattle)',
      href: 'https://www.seattle.gov/rentinginseattle/housing-providers/managing-the-rental-relationship/housing-cost-increases',
    },
    {
      label: 'SMC 7.24.030 (housing cost increase notice)',
      href: 'https://library.municode.com/wa/seattle/codes/municipal_code?nodeId=TIT7COPR_CH7.24REAGRE',
    },
  ],
  statuteRefIds: ['SMC_22.206', 'SMC_22.206.160', 'SMC_14.09', 'SMC_7.24.030'],
  rules: {
    rentIncrease: {
      /** SMC 7.24.030 as amended (Ord. related to CB 119585); 180 days for ordinary tenancies. */
      defaultNoticeDays: 180,
      monthToMonthNoticeDays: 180,
      monthToMonthHighIncreaseNoticeDays: 180,
      fixedTermNoticeDays: 180,
      /**
       * Seattle.gov: service day does not count toward the 180 days
       * (e.g. June 1 increase → served no later than December 2).
       */
      excludeDayOfService: true,
      citationIds: [
        'RCW_59.18.140',
        'RCW_59.18.700',
        'RCW_59.18.720',
        'SMC_7.24.030',
      ],
      officialFormUrls: [
        {
          label: 'RCW 59.18.720 (required state notice form text)',
          href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.720',
        },
        {
          label: 'WA Dept. of Commerce HB 1217 Landlord Resource Center',
          href: 'https://www.commerce.wa.gov/housing-policy/hb1217-landlord-resource-center/',
        },
        {
          label: 'Seattle housing cost increases (required city language)',
          href: 'https://www.seattle.gov/rentinginseattle/housing-providers/managing-the-rental-relationship/housing-cost-increases',
        },
      ],
      requiredNoticeLanguage: [
        'If you need help understanding this notice or information about your renter rights, call the Renting in Seattle Helpline at (206) 684-5700 or visit www.seattle.gov/rentinginseattle.',
      ],
    },
    noticeService: {
      notes:
        'Seattle: personal delivery, or both posting the property and mailing by first class mail.',
      preferredMethodIds: ['in_person', 'posting_and_first_class_mail'],
      citationIds: ['RCW_59.12.040', 'SMC_7.24.030'],
    },
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
        'Statewide cap (RCW 59.18.700) plus Seattle 180-day housing-cost notice, just-cause, and renewal-offer overlay (SMC 7.24.030 / SMC 22.206.160).',
      citationIds: ['RCW_59.18.700', 'SMC_7.24.030', 'SMC_22.206.160'],
    },
    screening: {
      firstQualifiedApplicant: true,
      writtenCriteriaRequired: true,
      citationIds: ['SMC_14.09'],
    },
  },
};
