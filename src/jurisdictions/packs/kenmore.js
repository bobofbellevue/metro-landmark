/**
 * City of Kenmore jurisdiction pack (overlays Washington State).
 * KMC 8.55.030 (Ord. 22-0545, eff. 2022-04-07; later 22-0554, 24-0604):
 * 120 days when the increase is greater than 3%; 180 days when greater
 * than 10%; otherwise statewide 90 days (RCW 59.18.140). Exactly 10%
 * is 120 days. Subsidized income-based tenancies remain 30 days
 * (KMC 8.55.030 / RCW 59.18.140(3)(b)). Pack numbers are calculator
 * inputs — not legal advice. Do not copy RHAWA forms.
 */
export const kenmorePack = {
  id: 'kenmore',
  displayName: 'City of Kenmore',
  parentPackId: 'washington_state',
  cityMatchers: ['kenmore'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  sourceUrls: [
    {
      label: 'KMC 8.55 Tenant Protections',
      href: 'https://www.codepublishing.com/WA/Kenmore/html/Kenmore08/Kenmore0855.html',
    },
    {
      label: 'KMC 8.55 Tenant Protections (eCode360)',
      href: 'https://ecode360.com/49594463',
    },
    {
      label: 'City of Kenmore tenant protections bulletin',
      href: 'https://content.govdelivery.com/accounts/WAKENMORE/bulletins/3115559',
    },
  ],
  statuteRefIds: ['KMC_8.55.030'],
  rules: {
    rentIncrease: {
      /** Ordinary increases of 3% or less follow RCW 59.18.140 (90 days). */
      defaultNoticeDays: 90,
      monthToMonthNoticeDays: 90,
      fixedTermNoticeDays: 90,
      /**
       * KMC 8.55.030: greater than 3% → 120 days; greater than 10% → 180.
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
        'KMC_8.55.030',
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
          label: 'KMC 8.55 Tenant Protections',
          href: 'https://www.codepublishing.com/WA/Kenmore/html/Kenmore08/Kenmore0855.html',
        },
      ],
      requiredNoticeLanguage: [
        'Kenmore requires 120 days’ notice for increases greater than 3%, and 180 days for increases greater than 10% (KMC 8.55.030). Increases of 3% or less follow the statewide 90-day notice.',
      ],
    },
    noticeService: {
      notes: 'Kenmore: serve in accordance with RCW 59.12.040.',
      citationIds: ['RCW_59.12.040', 'KMC_8.55.030'],
    },
    rentControl: {
      enabled: true,
      notes:
        'Statewide cap (RCW 59.18.700) plus Kenmore notice-day tiers in KMC 8.55.030.',
      citationIds: ['RCW_59.18.700', 'KMC_8.55.030'],
    },
  },
};
