import {
  DEFAULT_JURISDICTION_PACK_ID,
  detectJurisdictionPackId,
  getJurisdictionDisplayName,
  getMaxRentIncreasePercent,
  getResolvedJurisdictionPack,
  getRuleCitations,
  getNoticeServiceMethods,
  getRentIncreaseNoticeResources,
  isRentControlEnabled,
  listJurisdictionPacks,
  requiresJustCauseForNoCauseTermination,
  requiresRenewalOffer,
} from '../../src/jurisdictions/index.js';

describe('jurisdiction packs', () => {
  test('registers WA state and city packs', () => {
    const ids = listJurisdictionPacks().map((p) => p.id).sort();
    expect(ids).toEqual([
      'auburn',
      'bellingham',
      'federal_way',
      'kenmore',
      'kirkland',
      'olympia',
      'seattle',
      'shoreline',
      'tacoma',
      'washington_state',
    ]);
    expect(DEFAULT_JURISDICTION_PACK_ID).toBe('washington_state');
  });

  test('detects city packs from city_of_jurisdiction', () => {
    expect(detectJurisdictionPackId({ city_of_jurisdiction: 'Seattle' })).toBe('seattle');
    expect(detectJurisdictionPackId({ address: { city: 'seattle' } })).toBe('seattle');
    expect(detectJurisdictionPackId({ city: 'Tacoma' })).toBe('tacoma');
    expect(detectJurisdictionPackId({ city: 'Bellingham' })).toBe('bellingham');
    expect(detectJurisdictionPackId({ city: 'Olympia' })).toBe('olympia');
    expect(detectJurisdictionPackId({ city_of_jurisdiction: 'Federal Way' })).toBe('federal_way');
    expect(detectJurisdictionPackId({ city: 'Kirkland' })).toBe('kirkland');
    expect(detectJurisdictionPackId({ city: 'Kenmore' })).toBe('kenmore');
    expect(detectJurisdictionPackId({ city_of_jurisdiction: 'Shoreline' })).toBe('shoreline');
    expect(detectJurisdictionPackId({ address: { city: 'Auburn' } })).toBe('auburn');
    expect(detectJurisdictionPackId({ city: 'Renton' })).toBe('washington_state');
    expect(detectJurisdictionPackId(null)).toBe('washington_state');
  });

  test('unknown pack id falls back to Washington State', () => {
    const unknown = getResolvedJurisdictionPack('michigan');
    expect(unknown.id).toBe('washington_state');
    expect(getJurisdictionDisplayName('unknown')).toBe('Washington State');
  });

  test('WA pack encodes 2025/2026 RCW notice math and citations', () => {
    const wa = getResolvedJurisdictionPack('washington_state');
    expect(wa.resolvedRules.rentIncrease.defaultNoticeDays).toBe(90);
    expect(wa.resolvedRules.rentIncrease.subsidizedNoticeDays).toBe(30);
    expect(wa.resolvedRules.rentIncrease.firstTwelveMonthsNoIncrease).toBe(true);
    expect(wa.resolvedRules.depositReturnDays).toBe(30);
    expect(wa.resolvedRules.entryNoticeHours).toBe(48);
    expect(wa.resolvedRules.entryShowingNoticeHours).toBe(24);
    expect(wa.resolvedRules.termination.tenantFixedTermNoticeDays).toBe(20);
    expect(wa.resolvedRules.termination.landlordEndOfInitialTermNoticeDays).toBe(60);
    expect(wa.resolvedRules.termination.requiresJustCauseForNoCauseMonthToMonth).toBe(true);
    expect(wa.resolvedRules.termination.requiresJustCauseForFixedTermNonrenewal).toBe(false);
    expect(wa.resolvedRules.rentControl.enabled).toBe(true);
    expect(wa.resolvedRules.rentControl.annualMaxIncreasePercentByYear[2026]).toBe(9.683);
    expect(wa.resolvedStatuteRefs.map((r) => r.id)).toEqual(
      expect.arrayContaining(['RCW_59.18.140', 'RCW_59.18.280', 'RCW_59.18.650', 'RCW_59.18.700'])
    );
  });

  test('Seattle pack overlays 180-day housing-cost notice on WA numbers', () => {
    const seattle = getResolvedJurisdictionPack('seattle');
    expect(seattle.parentPackId).toBe('washington_state');
    expect(seattle.resolvedRules.depositReturnDays).toBe(30);
    expect(seattle.resolvedRules.rentIncrease.defaultNoticeDays).toBe(180);
    expect(seattle.resolvedRules.rentIncrease.excludeDayOfService).toBe(true);
    expect(seattle.resolvedRules.rentIncrease.subsidizedNoticeDays).toBe(30);
    expect(seattle.resolvedRules.entryNoticeHours).toBe(48);
    expect(seattle.resolvedRules.rentControl.enabled).toBe(true);
    expect(seattle.resolvedRules.termination.requiresJustCauseForNoCauseMonthToMonth).toBe(true);
    expect(seattle.resolvedRules.termination.requiresJustCauseForFixedTermNonrenewal).toBe(true);
    expect(seattle.resolvedRules.termination.requiresRenewalOffer).toBe(true);
    expect(seattle.resolvedRules.termination.renewalOfferMinDaysBeforeEnd).toBe(60);
    expect(seattle.resolvedRules.screening.firstQualifiedApplicant).toBe(true);
    expect(seattle.resolvedStatuteRefs.map((r) => r.id)).toEqual(
      expect.arrayContaining(['RCW_59.18.140', 'SMC_22.206.160', 'SMC_14.09', 'SMC_7.24.030'])
    );
    expect(seattle.resolvedRules.noticeService.preferredMethodIds).toEqual(
      expect.arrayContaining(['in_person', 'posting_and_first_class_mail'])
    );
    expect(
      seattle.resolvedRules.noticeService.methods.map((m) => m.id)
    ).toEqual(expect.arrayContaining(['first_class_mail', 'posting_and_first_class_mail']));
  });

  test('helpers expose pack flags, cap, and display names', () => {
    expect(isRentControlEnabled('seattle')).toBe(true);
    expect(isRentControlEnabled('washington_state')).toBe(true);
    expect(requiresJustCauseForNoCauseTermination('washington_state')).toBe(true);
    expect(requiresRenewalOffer('seattle')).toBe(true);
    expect(requiresRenewalOffer('washington_state')).toBe(false);
    expect(getMaxRentIncreasePercent('washington_state', 2025)).toBe(10);
    expect(getMaxRentIncreasePercent('seattle', 2026)).toBe(9.683);
    expect(getMaxRentIncreasePercent('washington_state', 2027)).toBe(10);
    expect(getMaxRentIncreasePercent('washington_state', 2099)).toBe(10);
    expect(getJurisdictionDisplayName('seattle')).toBe('City of Seattle');
  });

  test('rule citations resolve official labels', () => {
    const rent = getRuleCitations('washington_state', 'rentIncrease');
    expect(rent.map((c) => c.id)).toEqual(
      expect.arrayContaining(['RCW_59.18.140', 'RCW_59.18.700', 'RCW_59.18.720'])
    );
    expect(rent.every((c) => c.href && c.label)).toBe(true);

    const screening = getRuleCitations('seattle', 'screening');
    expect(screening.map((c) => c.id)).toContain('SMC_14.09');
  });

  test('pack-driven service methods and official form URLs', () => {
    const methods = getNoticeServiceMethods('seattle').map((m) => m.id);
    expect(methods).toEqual(
      expect.arrayContaining(['in_person', 'first_class_mail', 'posting_and_first_class_mail', 'other'])
    );
    const resources = getRentIncreaseNoticeResources('seattle');
    expect(resources.excludeDayOfService).toBe(true);
    expect(resources.requiredNoticeLanguage[0]).toMatch(/Renting in Seattle Helpline/);
    expect(resources.officialFormUrls.some((u) => u.href.includes('59.18.720'))).toBe(true);
    expect(resources.officialFormUrls.some((u) => u.href.includes('seattle.gov'))).toBe(true);
    expect(resources.preferredLandlordAssociation?.id).toBe('rhawa');
    expect(getResolvedJurisdictionPack('seattle').preferredLandlordAssociation?.id).toBe(
      'rhawa'
    );
  });

  test('Tacoma overlays 180-day notice and city form URLs', () => {
    const tacoma = getResolvedJurisdictionPack('tacoma');
    expect(tacoma.parentPackId).toBe('washington_state');
    expect(tacoma.resolvedRules.rentIncrease.defaultNoticeDays).toBe(180);
    expect(tacoma.resolvedRules.rentIncrease.subsidizedNoticeDays).toBe(30);
    expect(tacoma.resolvedRules.depositReturnDays).toBe(30);
    expect(tacoma.resolvedStatuteRefs.map((r) => r.id)).toEqual(
      expect.arrayContaining(['RCW_59.18.140', 'TMC_1.95.060', 'TMC_1.100.050'])
    );
    const resources = getRentIncreaseNoticeResources('tacoma');
    expect(resources.officialFormUrls.some((u) => u.href.includes('tacoma.gov') || u.href.includes('cms.tacoma.gov'))).toBe(
      true
    );
    expect(resources.requiredNoticeLanguage[0]).toMatch(/TMC 1\.95/);
    expect(resources.preferredLandlordAssociation?.id).toBe('rhawa');
  });

  test('Bellingham overlays 120-day notice', () => {
    const bellingham = getResolvedJurisdictionPack('bellingham');
    expect(bellingham.resolvedRules.rentIncrease.defaultNoticeDays).toBe(120);
    expect(bellingham.resolvedRules.rentIncrease.subsidizedNoticeDays).toBe(30);
    expect(bellingham.resolvedStatuteRefs.map((r) => r.id)).toContain('BMC_6.12.020');
  });

  test('Olympia keeps 90-day default and percent notice tiers', () => {
    const olympia = getResolvedJurisdictionPack('olympia');
    expect(olympia.resolvedRules.rentIncrease.defaultNoticeDays).toBe(90);
    expect(olympia.resolvedRules.rentIncrease.noticeTiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ minPercent: 5, days: 120 }),
        expect.objectContaining({ minPercent: 10, days: 180 }),
      ])
    );
    expect(olympia.resolvedStatuteRefs.map((r) => r.id)).toEqual(
      expect.arrayContaining(['OMC_5.82.030', 'RCW_59.18.140'])
    );
  });

  test('Federal Way inherits 90-day rent notice and encodes renewal offer', () => {
    const federalWay = getResolvedJurisdictionPack('federal_way');
    expect(federalWay.resolvedRules.rentIncrease.defaultNoticeDays).toBe(90);
    expect(requiresRenewalOffer('federal_way')).toBe(true);
    expect(federalWay.resolvedRules.termination.requiresJustCauseForFixedTermNonrenewal).toBe(true);
    expect(federalWay.resolvedRules.termination.renewalOfferMinDaysBeforeEnd).toBe(60);
    expect(federalWay.resolvedStatuteRefs.map((r) => r.id)).toContain('FWRC_20.05.050');
  });

  test('Kirkland and Kenmore keep 90-day default and >3% / >10% notice tiers', () => {
    for (const id of ['kirkland', 'kenmore']) {
      const pack = getResolvedJurisdictionPack(id);
      expect(pack.parentPackId).toBe('washington_state');
      expect(pack.resolvedRules.rentIncrease.defaultNoticeDays).toBe(90);
      expect(pack.resolvedRules.rentIncrease.noticeTiers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ minPercent: 3, minInclusive: false, days: 120 }),
          expect.objectContaining({ minPercent: 10, minInclusive: false, days: 180 }),
        ])
      );
      expect(pack.preferredLandlordAssociation?.id).toBe('rhawa');
    }
    expect(getResolvedJurisdictionPack('kirkland').resolvedStatuteRefs.map((r) => r.id)).toContain(
      'KMC_7.75.030'
    );
    expect(getResolvedJurisdictionPack('kenmore').resolvedStatuteRefs.map((r) => r.id)).toContain(
      'KMC_8.55.030'
    );
  });

  test('Shoreline keeps 90-day default and encodes ≥10% as 180 days', () => {
    const shoreline = getResolvedJurisdictionPack('shoreline');
    expect(shoreline.resolvedRules.rentIncrease.defaultNoticeDays).toBe(90);
    expect(shoreline.resolvedRules.rentIncrease.noticeTiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ minPercent: 3, minInclusive: false, days: 120 }),
        expect.objectContaining({ minPercent: 10, minInclusive: true, days: 180 }),
      ])
    );
    expect(shoreline.resolvedStatuteRefs.map((r) => r.id)).toContain('SMC_9.35.030');
    expect(getRentIncreaseNoticeResources('shoreline').requiredNoticeLanguage[0]).toMatch(
      /SMC 9\.35/
    );
  });

  test('Auburn keeps 90-day default and >5% 120-day overlay', () => {
    const auburn = getResolvedJurisdictionPack('auburn');
    expect(auburn.resolvedRules.rentIncrease.defaultNoticeDays).toBe(90);
    expect(auburn.resolvedRules.rentIncrease.noticeTiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ minPercent: 5, minInclusive: false, days: 120 }),
      ])
    );
    expect(auburn.resolvedStatuteRefs.map((r) => r.id)).toContain('ACC_5.23.040');
    expect(auburn.resolvedRules.noticeService.notes).toMatch(/RCW 59\.12\.040/);
  });
});
