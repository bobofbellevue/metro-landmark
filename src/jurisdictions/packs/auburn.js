/**
 * City of Auburn jurisdiction pack (overlays Washington State).
 * ACC 5.23.040 (Ord. 6786, 2020-09-08): 120 days when the increase is
 * more than 5%; otherwise statewide 90 days (RCW 59.18.140). Serve
 * per RCW 59.12.040. ACC 5.23.040 cites “RCW 58.19.140” for the
 * subsidized 30-day path; that cite is treated as RCW 59.18.140.
 * Pack numbers are calculator inputs — not legal advice. Do not copy
 * RHAWA forms.
 */
export const auburnPack = {
  id: 'auburn',
  displayName: 'City of Auburn',
  parentPackId: 'washington_state',
  cityMatchers: ['auburn'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  sourceUrls: [
    {
      label: 'ACC 5.23.040 (deposit and rent-increase notice)',
      href: 'https://auburn.municipal.codes/ACC/5.23.040',
    },
    {
      label: 'City of Auburn landlord and tenant information',
      href: 'https://www.auburnwa.gov/city_hall/community_development/landlord_tenant_info',
    },
  ],
  statuteRefIds: ['ACC_5.23.040'],
  rules: {
    rentIncrease: {
      /** Ordinary increases of 5% or less follow RCW 59.18.140 (90 days). */
      defaultNoticeDays: 90,
      monthToMonthNoticeDays: 90,
      fixedTermNoticeDays: 90,
      /** ACC 5.23.040(A)(1): more than 5% → 120 days. */
      noticeTiers: [
        { minPercent: 5, minInclusive: false, days: 120 },
      ],
      citationIds: [
        'RCW_59.18.140',
        'RCW_59.18.700',
        'RCW_59.18.720',
        'ACC_5.23.040',
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
          label: 'City of Auburn landlord and tenant information',
          href: 'https://www.auburnwa.gov/city_hall/community_development/landlord_tenant_info',
        },
      ],
      requiredNoticeLanguage: [
        'Auburn requires 120 days’ notice for increases of more than 5% (ACC 5.23.040). Increases of 5% or less follow the statewide 90-day notice.',
      ],
    },
    noticeService: {
      notes: 'Auburn: serve in accordance with RCW 59.12.040 (ACC 5.23.040).',
      citationIds: ['RCW_59.12.040', 'ACC_5.23.040'],
    },
    rentControl: {
      enabled: true,
      notes:
        'Statewide cap (RCW 59.18.700) plus Auburn 120-day notice for increases of more than 5% (ACC 5.23.040).',
      citationIds: ['RCW_59.18.700', 'ACC_5.23.040'],
    },
  },
};
