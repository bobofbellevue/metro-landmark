import {
  calculateDepositReturnPeriod,
  calculateEffectiveDate,
  calculateEntryNoticePeriod,
  calculateEvictionNoticePeriod,
  calculateNoticePeriod,
  calculateRentIncreaseNoticePeriod,
  calculateRequiredNoticeDate,
  calculateTerminationNoticePeriod,
  evaluateRentIncrease,
  noticePeriodDaysFromPack,
  resolvePercentIncrease,
  validateNoticePeriod,
} from '../../src/utils/compliance-calculator.js';

describe('resolvePercentIncrease', () => {
  test('prefers an explicit percent', () => {
    expect(resolvePercentIncrease(12, 1000, 2000)).toBe(12);
  });

  test('computes from rents when current rent is positive', () => {
    expect(resolvePercentIncrease(undefined, 1000, 1100)).toBeCloseTo(10);
  });

  test('returns null when rents are missing or zero', () => {
    expect(resolvePercentIncrease(undefined, 0, 100)).toBeNull();
    expect(resolvePercentIncrease(undefined, null, null)).toBeNull();
  });
});

describe('evaluateRentIncrease / calculateRentIncreaseNoticePeriod', () => {
  test('ordinary tenancies require 90 days in both packs', () => {
    expect(
      calculateRentIncreaseNoticePeriod({
        leaseType: 'month_to_month',
        jurisdiction: 'washington_state',
        currentRent: 1000,
        newRent: 1050,
      })
    ).toBe(90);

    expect(
      calculateRentIncreaseNoticePeriod({
        leaseType: 'fixed_term',
        jurisdiction: 'seattle',
        percentIncrease: 5,
      })
    ).toBe(90);
  });

  test('subsidized income-based tenancies require 30 days', () => {
    expect(
      calculateRentIncreaseNoticePeriod({
        leaseType: 'month_to_month',
        jurisdiction: 'washington_state',
        percentIncrease: 8,
        subsidized: true,
      })
    ).toBe(30);
  });

  test('flags the 2026 statewide cap and first-twelve-months block', () => {
    const overCap = evaluateRentIncrease({
      jurisdiction: 'seattle',
      currentRent: 1000,
      newRent: 1100,
      asOfYear: 2026,
    });
    expect(overCap.percentIncrease).toBeCloseTo(10);
    expect(overCap.maxIncreasePercent).toBe(9.683);
    expect(overCap.exceedsCap).toBe(true);
    expect(overCap.citations.map((c) => c.id)).toContain('RCW_59.18.140');

    const blocked = evaluateRentIncrease({
      jurisdiction: 'washington_state',
      currentRent: 1000,
      newRent: 1030,
      tenancyStartDate: '2026-01-15',
      effectiveDate: '2026-08-15',
    });
    expect(blocked.firstTwelveMonthsBlocked).toBe(true);
    expect(blocked.exceedsCap).toBe(false);

    const allowed = evaluateRentIncrease({
      jurisdiction: 'washington_state',
      currentRent: 1000,
      newRent: 1030,
      tenancyStartDate: '2025-01-15',
      effectiveDate: '2026-08-15',
    });
    expect(allowed.firstTwelveMonthsBlocked).toBe(false);
  });
});

describe('termination, eviction, deposit, and entry', () => {
  test('tenant and landlord termination paths use resolvedRules', () => {
    expect(
      calculateTerminationNoticePeriod({
        leaseType: 'month_to_month',
        jurisdiction: 'seattle',
        initiatedBy: 'tenant',
      })
    ).toBe(20);

    expect(
      calculateTerminationNoticePeriod({
        leaseType: 'fixed_term',
        jurisdiction: 'washington_state',
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
      calculateTerminationNoticePeriod({
        leaseType: 'fixed_term',
        jurisdiction: 'washington_state',
        initiatedBy: 'landlord',
        hasCause: false,
      })
    ).toBe(60);

    expect(
      calculateTerminationNoticePeriod({
        leaseType: 'month_to_month',
        jurisdiction: 'washington_state',
        initiatedBy: 'landlord',
        hasCause: true,
      })
    ).toBe(20);
  });

  test('eviction notice types match pack days', () => {
    expect(
      calculateEvictionNoticePeriod({
        noticeType: '10_day_compliance',
        jurisdiction: 'washington_state',
      })
    ).toBe(10);
    expect(
      calculateEvictionNoticePeriod({
        noticeType: '3_day_pay_or_vacate',
        jurisdiction: 'seattle',
      })
    ).toBe(3);
    expect(
      calculateEvictionNoticePeriod({
        noticeType: 'unknown_type',
        jurisdiction: 'washington_state',
      })
    ).toBe(3);
  });

  test('deposit return is 30 days in both packs', () => {
    expect(calculateDepositReturnPeriod('seattle')).toBe(30);
    expect(calculateDepositReturnPeriod('washington_state')).toBe(30);
  });

  test('entry is 48 hours, 24 for showings, 0 for emergency', () => {
    expect(calculateEntryNoticePeriod('washington_state')).toBe(48);
    expect(calculateEntryNoticePeriod('seattle', false)).toBe(48);
    expect(calculateEntryNoticePeriod('seattle', true)).toBe(0);
    expect(calculateEntryNoticePeriod('washington_state', { purpose: 'showing' })).toBe(24);
    expect(
      calculateEntryNoticePeriod('washington_state', { isEmergency: true, purpose: 'showing' })
    ).toBe(0);
  });
});

describe('date helpers', () => {
  test('effective and required notice dates offset by whole days', () => {
    const notice = calculateEffectiveDate('2026-08-01T12:00:00', 90);
    expect(notice.getFullYear()).toBe(2026);
    expect(notice.getMonth()).toBe(9);
    expect(notice.getDate()).toBe(30);

    const latest = calculateRequiredNoticeDate('2026-11-01T12:00:00', 90);
    expect(latest.getMonth()).toBe(7);
    expect(latest.getDate()).toBe(3);
  });

  test('validateNoticePeriod accepts exact and longer windows', () => {
    const short = validateNoticePeriod('2026-08-01', '2026-08-15', 90);
    expect(short.valid).toBe(false);
    expect(short.daysDifference).toBeLessThan(90);

    const ok = validateNoticePeriod('2026-08-01', '2026-10-30', 90);
    expect(ok.valid).toBe(true);
  });
});

describe('noticePeriodDaysFromPack / calculateNoticePeriod', () => {
  test('maps workflow types onto pack functions', () => {
    expect(
      noticePeriodDaysFromPack({
        workflowType: 'rent_increase',
        leaseType: 'month_to_month',
        jurisdiction: 'washington_state',
        context: { subsidized: true },
      })
    ).toBe(30);
    expect(
      noticePeriodDaysFromPack({
        workflowType: 'security_deposit',
        jurisdiction: 'seattle',
      })
    ).toBe(30);
    expect(
      noticePeriodDaysFromPack({
        workflowType: 'entry_notice',
        jurisdiction: 'washington_state',
        context: { entryPurpose: 'showing' },
      })
    ).toBe(24);
  });

  test('calculateNoticePeriod uses pack days even when DB rules disagree', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        rules: [
          {
            rule_name: 'stale 30-day rent increase',
            notice_period_days: 30,
            rule_condition: {},
          },
        ],
      }),
    });

    const result = await calculateNoticePeriod({
      workflowType: 'rent_increase',
      leaseType: 'month_to_month',
      jurisdiction: 'washington_state',
      context: { currentRent: 1000, newRent: 1050, effectiveDate: '2026-12-01' },
    });

    expect(result.noticePeriodDays).toBe(90);
    expect(result.source).toBe('jurisdiction_pack');
    expect(result.citations.map((c) => c.id)).toContain('RCW_59.18.140');
    expect(result.rules[0].rule_name).toBe('stale 30-day rent increase');
    expect(result.evaluation.noticePeriodDays).toBe(90);
    expect(result.requiredNoticeDate).toBeInstanceOf(Date);
  });

  test('calculateNoticePeriod still returns pack days when fetch fails', async () => {
    globalThis.fetch = async () => {
      throw new Error('network down');
    };

    const result = await calculateNoticePeriod({
      workflowType: 'security_deposit',
      leaseType: 'month_to_month',
      jurisdiction: 'seattle',
    });

    expect(result.noticePeriodDays).toBe(30);
    expect(result.rulesError).toBe('network down');
    expect(result.citations.map((c) => c.id)).toContain('RCW_59.18.280');
  });
});
