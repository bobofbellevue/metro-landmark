import {
  DEFAULT_JURISDICTION_PACK_ID,
  detectJurisdictionPackId,
  getJurisdictionDisplayName,
  getResolvedJurisdictionPack,
  isRentControlEnabled,
  listJurisdictionPacks,
  requiresJustCauseForNoCauseTermination,
} from '../../src/jurisdictions/index.js';
import {
  calculateDepositReturnPeriod,
  calculateEntryNoticePeriod,
  calculateEvictionNoticePeriod,
  calculateRentIncreaseNoticePeriod,
  calculateTerminationNoticePeriod,
} from '../../src/utils/compliance-calculator.js';

describe('jurisdiction packs', () => {
  test('registers WA and Seattle packs', () => {
    const ids = listJurisdictionPacks().map((p) => p.id).sort();
    expect(ids).toEqual(['seattle', 'washington_state']);
    expect(DEFAULT_JURISDICTION_PACK_ID).toBe('washington_state');
  });

  test('detects Seattle from city_of_jurisdiction', () => {
    expect(detectJurisdictionPackId({ city_of_jurisdiction: 'Seattle' })).toBe('seattle');
    expect(detectJurisdictionPackId({ address: { city: 'seattle' } })).toBe('seattle');
    expect(detectJurisdictionPackId({ city: 'Renton' })).toBe('washington_state');
    expect(detectJurisdictionPackId(null)).toBe('washington_state');
  });

  test('Seattle pack inherits WA and overlays rent control / just cause', () => {
    const seattle = getResolvedJurisdictionPack('seattle');
    expect(seattle.parentPackId).toBe('washington_state');
    expect(seattle.resolvedRules.depositReturnDays).toBe(14);
    expect(seattle.resolvedRules.rentControl.enabled).toBe(true);
    expect(seattle.resolvedRules.termination.requiresJustCauseForNoCauseMonthToMonth).toBe(true);

    const wa = getResolvedJurisdictionPack('washington_state');
    expect(wa.resolvedRules.rentControl.enabled).toBe(false);
    expect(wa.resolvedRules.termination.requiresJustCauseForNoCauseMonthToMonth).toBe(false);
  });

  test('helpers expose pack flags and display names', () => {
    expect(isRentControlEnabled('seattle')).toBe(true);
    expect(isRentControlEnabled('washington_state')).toBe(false);
    expect(requiresJustCauseForNoCauseTermination('seattle')).toBe(true);
    expect(getJurisdictionDisplayName('seattle')).toBe('City of Seattle');
    expect(getJurisdictionDisplayName('unknown')).toBe('Washington State');
  });
});

describe('compliance calculator (pack-driven)', () => {
  test('rent increase notice periods match pack rules', () => {
    expect(
      calculateRentIncreaseNoticePeriod({
        leaseType: 'month_to_month',
        jurisdiction: 'washington_state',
        currentRent: 1000,
        newRent: 1050,
      })
    ).toBe(30);

    expect(
      calculateRentIncreaseNoticePeriod({
        leaseType: 'month_to_month',
        jurisdiction: 'seattle',
        percentIncrease: 12,
      })
    ).toBe(60);

    expect(
      calculateRentIncreaseNoticePeriod({
        leaseType: 'fixed_term',
        jurisdiction: 'washington_state',
        percentIncrease: 5,
      })
    ).toBe(60);
  });

  test('termination, eviction, deposit, and entry use resolvedRules', () => {
    expect(
      calculateTerminationNoticePeriod({
        leaseType: 'month_to_month',
        jurisdiction: 'seattle',
        initiatedBy: 'tenant',
      })
    ).toBe(20);

    expect(
      calculateTerminationNoticePeriod({
        leaseType: 'month_to_month',
        jurisdiction: 'seattle',
        initiatedBy: 'landlord',
        hasCause: false,
      })
    ).toBe(20);

    expect(
      calculateEvictionNoticePeriod({
        noticeType: '10_day_compliance',
        jurisdiction: 'washington_state',
      })
    ).toBe(10);

    expect(calculateDepositReturnPeriod('seattle')).toBe(14);
    expect(calculateEntryNoticePeriod('washington_state')).toBe(24);
    expect(calculateEntryNoticePeriod('seattle', true)).toBe(0);
  });
});
