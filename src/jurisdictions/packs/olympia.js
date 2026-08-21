/**
 * City of Olympia jurisdiction pack (overlays Washington State).
 * OMC 5.82.030: 120 days when the increase is more than 5%; 180 days
 * when the increase is 10% or more; otherwise statewide 90 days.
 * Subsidized income-based tenancies remain 30 days (OMC 5.82.030(D) /
 * RCW 59.18.140(3)(b)). Pack numbers are calculator inputs — not legal
 * advice. Do not copy RHAWA forms.
 */
export const olympiaPack = {
  id: 'olympia',
  displayName: 'City of Olympia',
  parentPackId: 'washington_state',
  cityMatchers: ['olympia'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  sourceUrls: [
    {
      label: 'Olympia tenant protections (rent-increase notice table)',
      href: 'https://www.olympiawa.gov/community/housing___homelessness/tenant_protections.php',
    },
    {
      label: 'OMC 5.82 Rental Housing Code',
      href: 'https://www.codepublishing.com/WA/Olympia/html/Olympia05/Olympia0582.html',
    },
  ],
  statuteRefIds: ['OMC_5.82.030', 'OMC_5.82.040'],
  rules: {
    rentIncrease: {
      /** Ordinary increases of 5% or less follow RCW 59.18.140 (90 days). */
      defaultNoticeDays: 90,
      monthToMonthNoticeDays: 90,
      fixedTermNoticeDays: 90,
      /**
       * OMC 5.82.030(A)/(C): more than 5% → 120 days; 10% or more → 180 days.
       * Trailing 12-month 7% stacking (OMC 5.82.030(B)) is not computed here.
       */
      noticeTiers: [
        { minPercent: 5, minInclusive: false, days: 120 },
        { minPercent: 10, minInclusive: true, days: 180 },
      ],
      citationIds: [
        'RCW_59.18.140',
        'RCW_59.18.700',
        'RCW_59.18.720',
        'OMC_5.82.030',
        'OMC_5.82.040',
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
          label: 'Olympia landlord rent-increase notice information',
          href: 'https://www.olympiawa.gov/community/housing___homelessness/landlord_information.php',
        },
      ],
      requiredNoticeLanguage: [
        'Olympia requires 120 days’ notice for increases of more than 5%, and 180 days for increases of 10% or more (OMC 5.82.030). Increases of 5% or less follow the statewide 90-day notice.',
        'Notices for increases of more than 5% must include the amount, new rent, effective date, rationale, and economic-displacement relocation rights (OMC 5.82.030(H) / 5.82.040).',
      ],
    },
    noticeService: {
      notes: 'Olympia: serve in accordance with RCW 59.12.040 (OMC 5.82.030(E)).',
      citationIds: ['RCW_59.12.040', 'OMC_5.82.030'],
    },
    rentControl: {
      enabled: true,
      notes:
        'Statewide cap (RCW 59.18.700) plus Olympia notice-day tiers in OMC 5.82.030.',
      citationIds: ['RCW_59.18.700', 'OMC_5.82.030'],
    },
  },
};
