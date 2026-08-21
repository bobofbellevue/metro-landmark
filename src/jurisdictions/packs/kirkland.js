/**
 * City of Kirkland jurisdiction pack (overlays Washington State).
 * KMC 7.75.030 (Ord. O-4810, eff. 2022-09-17): 120 days when the
 * increase is greater than 3%; 180 days when greater than 10%;
 * otherwise statewide 90 days (RCW 59.18.140). Exactly 10% is 120
 * days. The city webpage table still lists 60 days for increases of
 * 3% or less — that figure is shorter than current state law and is
 * not encoded. Subsidized income-based tenancies remain 30 days
 * (KMC 7.75.030(b) / RCW 59.18.140(3)(b)). Pack numbers are
 * calculator inputs — not legal advice. Do not copy RHAWA forms.
 */
export const kirklandPack = {
  id: 'kirkland',
  displayName: 'City of Kirkland',
  parentPackId: 'washington_state',
  cityMatchers: ['kirkland'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  sourceUrls: [
    {
      label: 'City of Kirkland tenant protections',
      href: 'https://www.kirklandwa.gov/Government/City-Managers-Office/Tenant-Protections',
    },
    {
      label: 'KMC 7.75 Tenant Protections',
      href: 'https://www.codepublishing.com/WA/Kirkland/html/Kirkland07/Kirkland0775.html',
    },
  ],
  statuteRefIds: ['KMC_7.75.030'],
  rules: {
    rentIncrease: {
      /** Ordinary increases of 3% or less follow RCW 59.18.140 (90 days). */
      defaultNoticeDays: 90,
      monthToMonthNoticeDays: 90,
      fixedTermNoticeDays: 90,
      /**
       * KMC 7.75.030(a): greater than 3% → 120 days; greater than 10% → 180.
       * Exactly 10% hits the 120-day tier only.
       */
      noticeTiers: [
        { minPercent: 3, minInclusive: false, days: 120 },
        { minPercent: 10, minInclusive: false, days: 180 },
      ],
      citationIds: [
        'RCW_59.18.140',
        'RCW_59.18.700',
        'RCW_59.18.720',
        'KMC_7.75.030',
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
          label: 'City of Kirkland tenant protections',
          href: 'https://www.kirklandwa.gov/Government/City-Managers-Office/Tenant-Protections',
        },
      ],
      requiredNoticeLanguage: [
        'Kirkland requires 120 days’ notice for increases greater than 3%, and 180 days for increases greater than 10% (KMC 7.75.030). Increases of 3% or less follow the statewide 90-day notice.',
        'The notice must include the actual dollar amount of the new rent or rent increase (KMC 7.75.030(c)).',
      ],
    },
    noticeService: {
      notes: 'Kirkland: serve in accordance with RCW 59.12.040.',
      citationIds: ['RCW_59.12.040', 'KMC_7.75.030'],
    },
    rentControl: {
      enabled: true,
      notes:
        'Statewide cap (RCW 59.18.700) plus Kirkland notice-day tiers in KMC 7.75.030.',
      citationIds: ['RCW_59.18.700', 'KMC_7.75.030'],
    },
  },
};
