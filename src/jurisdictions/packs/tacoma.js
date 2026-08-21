/**
 * City of Tacoma jurisdiction pack (overlays Washington State).
 * TMC 1.95.060 (as amended Ord. 29086, effective 2026-01-01): 180-day
 * written notice of any housing-cost increase, except subsidized tenancies
 * under RCW 59.18.140(3)(b). City-established form and resource summary
 * are required. Pack numbers are calculator inputs — not legal advice.
 * Do not copy RHAWA or city fillable forms; link official sources.
 */
export const tacomaPack = {
  id: 'tacoma',
  displayName: 'City of Tacoma',
  parentPackId: 'washington_state',
  cityMatchers: ['tacoma'],
  defaultForUnmatchedInState: false,
  stateCode: 'WA',
  sourceUrls: [
    {
      label: 'Renting in Tacoma',
      href: 'https://www.tacoma.gov/government/departments/community-and-economic-development/housing-division/renting-in-tacoma/',
    },
    {
      label: 'TMC 1.95 Rental Housing Code (city PDF)',
      href: 'https://cms.tacoma.gov/OEHR/RentalHousing/Rental%20Housing%20Code%20TMC%201.95%20rev%2012.2025.pdf',
    },
  ],
  statuteRefIds: ['TMC_1.95.060', 'TMC_1.100.050'],
  rules: {
    rentIncrease: {
      /** TMC 1.95.060(A) — 180 days for ordinary tenancies. */
      defaultNoticeDays: 180,
      monthToMonthNoticeDays: 180,
      monthToMonthHighIncreaseNoticeDays: 180,
      fixedTermNoticeDays: 180,
      citationIds: [
        'RCW_59.18.140',
        'RCW_59.18.700',
        'RCW_59.18.720',
        'TMC_1.95.060',
        'TMC_1.100.050',
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
          label: 'City of Tacoma 180-day Notice of Rent Increase',
          href: 'https://cms.tacoma.gov/OEHR/RentalHousing/180-DAY%20NOTICE%20OF%20RENT%20INCREASE%20RHC%20rev%2012.25.pdf',
        },
        {
          label: 'Renting in Tacoma (city forms and resource notices)',
          href: 'https://www.tacoma.gov/government/departments/community-and-economic-development/housing-division/renting-in-tacoma/',
        },
      ],
      requiredNoticeLanguage: [
        'Tacoma requires the City-established 180-day rent-increase notice and a copy of the Rent Increase Notice of Resource (TMC 1.95.030 and 1.95.060).',
        'A rent increase of 5% or more may trigger relocation assistance under TMC 1.100.050. Use the current city forms linked from tacoma.gov.',
      ],
    },
    noticeService: {
      notes: 'Tacoma: serve in accordance with RCW 59.12.040 (TMC 1.95.060(C)).',
      preferredMethodIds: ['in_person', 'posting_and_first_class_mail', 'first_class_mail'],
      citationIds: ['RCW_59.12.040', 'TMC_1.95.060'],
    },
    rentControl: {
      enabled: true,
      notes:
        'Statewide cap (RCW 59.18.700) plus Tacoma 180-day housing-cost notice (TMC 1.95.060).',
      citationIds: ['RCW_59.18.700', 'TMC_1.95.060'],
    },
  },
};
