/**
 * Washington State jurisdiction pack (RCW-oriented defaults).
 *
 * Encoded values follow RCW 59.18 / 59.12 as amended through the 2025
 * session (including EHB 1217 rent-increase notice and RCW 59.18.700 cap).
 * Commerce publishes the annual cap figure; 2026 is stored as 9.683%.
 * Pack numbers are the reference deployment's calculator inputs — not legal advice.
 */
export const washingtonStatePack = {
  id: 'washington_state',
  displayName: 'Washington State',
  parentPackId: null,
  /** Cities that map directly to this pack (empty = default for WA properties) */
  cityMatchers: [],
  defaultForUnmatchedInState: true,
  stateCode: 'WA',
  /**
   * WA pack favors RHAWA as the landlord-association template source.
   * Operators join and import forms themselves. No in-app association picker;
   * a different association means a source-code fork / custom pack.
   */
  preferredLandlordAssociation: {
    id: 'rhawa',
    name: 'Rental Housing Association of Washington (RHAWA)',
    membershipUrl: 'https://www.rhawa.org/',
    formsUrl: 'https://www.rhawa.org/rent-increase-notices',
    recommendation:
      'Join RHAWA and import their current city-specific rent-increase templates into Documents.',
  },
  sourceUrls: [
    {
      label: 'RCW 59.18.140 (notice period)',
      href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.140',
    },
    {
      label: 'RCW 59.18.720 (required rent-increase form)',
      href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.720',
    },
    {
      label: 'WA Dept. of Commerce HB 1217 Landlord Resource Center',
      href: 'https://www.commerce.wa.gov/housing-policy/hb1217-landlord-resource-center/',
    },
  ],
  statuteRefIds: [
    'RCW_59.18',
    'RCW_59.18.140',
    'RCW_59.18.150',
    'RCW_59.18.200',
    'RCW_59.18.280',
    'RCW_59.18.650',
    'RCW_59.18.700',
    'RCW_59.18.710',
    'RCW_59.18.720',
    'RCW_59.12.030',
    'RCW_59.12.040',
  ],
  rules: {
    rentIncrease: {
      /** RCW 59.18.140(3)(a) — 90 days for ordinary tenancies */
      defaultNoticeDays: 90,
      /** RCW 59.18.140(3)(b) — income-based subsidized tenancies */
      subsidizedNoticeDays: 30,
      /** Kept for merge/call-site compatibility; same as defaultNoticeDays. */
      monthToMonthNoticeDays: 90,
      monthToMonthHighIncreaseNoticeDays: 90,
      highIncreasePercentThreshold: null,
      fixedTermNoticeDays: 90,
      firstTwelveMonthsNoIncrease: true,
      citationIds: ['RCW_59.18.140', 'RCW_59.18.700', 'RCW_59.18.720'],
      officialFormUrls: [
        {
          label: 'RCW 59.18.720 (required notice form text)',
          href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.720',
        },
        {
          label: 'WA Dept. of Commerce HB 1217 Landlord Resource Center',
          href: 'https://www.commerce.wa.gov/housing-policy/hb1217-landlord-resource-center/',
        },
      ],
    },
    noticeService: {
      methods: [
        { id: 'in_person', label: 'In Person', needsPrint: true },
        { id: 'first_class_mail', label: 'First Class Mail', needsPrint: true },
        { id: 'certified_mail', label: 'Certified Mail', needsPrint: true },
        { id: 'posting', label: 'Posting on Door', needsPrint: true },
        {
          id: 'posting_and_first_class_mail',
          label: 'Posting and First Class Mail',
          needsPrint: true,
          compound: true,
        },
        { id: 'email', label: 'Email', needsPrint: false },
        { id: 'other', label: 'Other (describe in notes)', needsPrint: true },
      ],
      citationIds: ['RCW_59.12.040'],
    },
    termination: {
      tenantMonthToMonthNoticeDays: 20,
      /** RCW 59.18.650(1)(f) — notice before the scheduled end date */
      tenantFixedTermNoticeDays: 20,
      landlordWithCauseNoticeDays: 20,
      /**
       * Statewide just cause (RCW 59.18.650) bars ordinary no-cause MTM
       * endings. Days remain for permitted-cause / limited end-of-term paths.
       */
      landlordNoCauseMonthToMonthNoticeDays: 20,
      landlordNoCauseFixedTermNoticeDays: 60,
      landlordEndOfInitialTermNoticeDays: 60,
      requiresJustCauseForNoCauseMonthToMonth: true,
      requiresJustCauseForFixedTermNonrenewal: false,
      requiresRenewalOffer: false,
      citationIds: ['RCW_59.18.200', 'RCW_59.18.650'],
    },
    evictionNoticeDays: {
      '3_day_pay_or_vacate': 3,
      '10_day_compliance': 10,
      '14_day_unconditional': 14,
      '20_day_violation': 20,
    },
    evictionCitationIds: ['RCW_59.12.030', 'RCW_59.18.650'],
    /** RCW 59.18.280 — 30 days after termination and vacation */
    depositReturnDays: 30,
    depositCitationIds: ['RCW_59.18.280'],
    /** RCW 59.18.150(6) — at least two days' written notice */
    entryNoticeHours: 48,
    /** One day's notice to exhibit to purchasers or prospective tenants */
    entryShowingNoticeHours: 24,
    entryCitationIds: ['RCW_59.18.150'],
    rentControl: {
      enabled: true,
      /** Commerce-published annual maximums (lesser of 7% + Seattle CPI or 10%). */
      annualMaxIncreasePercentByYear: {
        2025: 10,
        2026: 9.683,
        2027: 10,
      },
      defaultMaxIncreasePercent: 10,
      notes:
        'Statewide cap under RCW 59.18.700. Commerce publishes the calendar-year figure (2026: 9.683%; 2027: 10%).',
      citationIds: ['RCW_59.18.700'],
    },
    screening: {
      firstQualifiedApplicant: false,
      writtenCriteriaRequired: false,
    },
  },
};
