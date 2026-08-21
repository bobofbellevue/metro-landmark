/**
 * City of Federal Way jurisdiction pack (overlays Washington State).
 * Rent-increase notice follows statewide RCW 59.18.140 (90 days). The
 * 2019 local 60-day figure is shorter than current state law and is not
 * encoded. FWRC 20.05 overlays good-cause eviction and a 60–90 day
 * renewal offer (20.05.050). Pack numbers are calculator inputs — not
 * legal advice. Do not copy RHAWA forms.
 */
export const federalWayPack = {
  id: 'federal_way',
  displayName: 'City of Federal Way',
  parentPackId: 'washington_state',
  cityMatchers: ['federal way'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  sourceUrls: [
    {
      label: 'FWRC 20.05 Good Cause Eviction Ordinance',
      href: 'https://www.codepublishing.com/WA/FederalWay/html/FederalWay20/FederalWay2005.html',
    },
  ],
  statuteRefIds: ['FWRC_20.05', 'FWRC_20.05.050'],
  rules: {
    rentIncrease: {
      citationIds: ['RCW_59.18.140', 'RCW_59.18.700', 'RCW_59.18.720'],
      officialFormUrls: [
        {
          label: 'RCW 59.18.720 (required state notice form text)',
          href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.720',
        },
        {
          label: 'WA Dept. of Commerce HB 1217 Landlord Resource Center',
          href: 'https://www.commerce.wa.gov/housing-policy/hb1217-landlord-resource-center/',
        },
      ],
      requiredNoticeLanguage: [
        'Federal Way rent-increase notice follows statewide RCW 59.18.140 (90 days). FWRC 20.05 requires good cause to end a tenancy and a renewal offer 60–90 days before term end unless good cause applies.',
      ],
    },
    termination: {
      requiresJustCauseForNoCauseMonthToMonth: true,
      requiresJustCauseForFixedTermNonrenewal: true,
      requiresRenewalOffer: true,
      renewalOfferMinDaysBeforeEnd: 60,
      renewalOfferMaxDaysBeforeEnd: 90,
      citationIds: ['RCW_59.18.650', 'FWRC_20.05', 'FWRC_20.05.050'],
    },
    noticeService: {
      notes:
        'Federal Way: written notices under FWRC 20.05 must be served consistent with RCW 59.12.040.',
      citationIds: ['RCW_59.12.040', 'FWRC_20.05'],
    },
  },
};
