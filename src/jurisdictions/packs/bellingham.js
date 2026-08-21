/**
 * City of Bellingham jurisdiction pack (overlays Washington State).
 * BMC 6.12.020 (Ord. 2023-03-007): at least 120 days’ written notice
 * whenever periodic or monthly housing costs will increase. City FAQ
 * keeps the RCW 59.18.140(3)(b) 30-day subsidized path. Pack numbers
 * are calculator inputs — not legal advice. Do not copy RHAWA forms.
 */
export const bellinghamPack = {
  id: 'bellingham',
  displayName: 'City of Bellingham',
  parentPackId: 'washington_state',
  cityMatchers: ['bellingham'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  sourceUrls: [
    {
      label: 'BMC 6.12.020 (rental agreement / rent-increase notice)',
      href: 'https://bellingham.municipal.codes/BMC/6.12.020',
    },
    {
      label: 'City of Bellingham 120-day rent increase notice FAQs',
      href: 'https://cob.org/services/housing/housing-laws-tenant-and-landlord-support/2023-rent-increase-notification-faqs',
    },
  ],
  statuteRefIds: ['BMC_6.12.020'],
  rules: {
    rentIncrease: {
      /** BMC 6.12.020 — 120 days for ordinary tenancies. */
      defaultNoticeDays: 120,
      monthToMonthNoticeDays: 120,
      monthToMonthHighIncreaseNoticeDays: 120,
      fixedTermNoticeDays: 120,
      citationIds: [
        'RCW_59.18.140',
        'RCW_59.18.700',
        'RCW_59.18.720',
        'BMC_6.12.020',
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
          label: 'BMC 6.12.020 (120-day housing-cost notice)',
          href: 'https://bellingham.municipal.codes/BMC/6.12.020',
        },
      ],
      requiredNoticeLanguage: [
        'Bellingham requires at least 120 days’ written notice before any housing-cost increase (BMC 6.12.020).',
      ],
    },
    noticeService: {
      notes: 'Bellingham: serve in accordance with RCW 59.12.040.',
      citationIds: ['RCW_59.12.040', 'BMC_6.12.020'],
    },
    rentControl: {
      enabled: true,
      notes:
        'Statewide cap (RCW 59.18.700) plus Bellingham 120-day housing-cost notice (BMC 6.12.020).',
      citationIds: ['RCW_59.18.700', 'BMC_6.12.020'],
    },
  },
};
