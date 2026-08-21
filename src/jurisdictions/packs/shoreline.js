/**
 * City of Shoreline jurisdiction pack (overlays Washington State).
 * SMC 9.35.030 (Ord. 996, 2023-12-11): 120 days when the base-rent
 * increase is greater than 3% and less than 10%; 180 days when the
 * increase is 10% or greater; otherwise statewide 90 days
 * (RCW 59.18.140). Exactly 10% is 180 days. The local 60-day
 * optional-rent figure is shorter than current state law and is not
 * encoded. Subsidized income-based tenancies remain 30 days
 * (SMC 9.35.030 / RCW 59.18.140(3)(b)). Pack numbers are calculator
 * inputs — not legal advice. Do not copy RHAWA forms.
 */
export const shorelinePack = {
  id: 'shoreline',
  displayName: 'City of Shoreline',
  parentPackId: 'washington_state',
  cityMatchers: ['shoreline'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  sourceUrls: [
    {
      label: 'City of Shoreline tenant protections',
      href: 'https://www.shorelinewa.gov/services/human-services/tenant-protections',
    },
    {
      label: 'SMC 9.35 Residential Tenant Protections',
      href: 'https://ecode360.com/49778599',
    },
  ],
  statuteRefIds: ['SMC_9.35.030'],
  rules: {
    rentIncrease: {
      /** Ordinary base-rent increases of 3% or less follow RCW 59.18.140 (90 days). */
      defaultNoticeDays: 90,
      monthToMonthNoticeDays: 90,
      fixedTermNoticeDays: 90,
      /**
       * SMC 9.35.030: greater than 3% and less than 10% → 120 days;
       * 10% or greater → 180 days. Exactly 10% is 180.
       */
      noticeTiers: [
        { minPercent: 3, minInclusive: false, days: 120 },
        { minPercent: 10, minInclusive: true, days: 180 },
      ],
      citationIds: [
        'RCW_59.18.140',
        'RCW_59.18.700',
        'RCW_59.18.720',
        'SMC_9.35.030',
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
          label: 'City of Shoreline tenant protections',
          href: 'https://www.shorelinewa.gov/services/human-services/tenant-protections',
        },
      ],
      requiredNoticeLanguage: [
        'Shoreline requires 120 days’ notice for base-rent increases greater than 3% and less than 10%, and 180 days for increases of 10% or more (SMC 9.35.030). Increases of 3% or less follow the statewide 90-day notice.',
        'A base-rent or optional-rent increase is not effective before the current rental-agreement term ends, except subsidized housing by mutual consent (SMC 9.35.030).',
      ],
    },
    noticeService: {
      notes: 'Shoreline: serve in accordance with RCW 59.12.040.',
      citationIds: ['RCW_59.12.040', 'SMC_9.35.030'],
    },
    rentControl: {
      enabled: true,
      notes:
        'Statewide cap (RCW 59.18.700) plus Shoreline notice-day tiers in SMC 9.35.030.',
      citationIds: ['RCW_59.18.700', 'SMC_9.35.030'],
    },
  },
};
