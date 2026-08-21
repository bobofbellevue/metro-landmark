import {
  calculateDepositReturnPeriod,
  calculateEffectiveDate,
  calculateEntryNoticePeriod,
  calculateEvictionNoticePeriod,
  calculateNoticePeriod,
  calculateRentIncreaseNoticePeriod,
  calculateRequiredNoticeDate,
  calculateTerminationNoticePeriod,
  evaluateLeaseTermination,
  evaluateRentIncrease,
  noticeDaysForRentIncrease,
  noticePeriodDaysFromPack,
  resolvePercentIncrease,
  validateNoticePeriod,
} from '../../src/utils/compliance-calculator.js';
import { formatWorkflowDateForLocale } from '../../src/utils/workflow-date.js';

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
  test('ordinary tenancies require 90 days statewide and 180 days in Seattle', () => {
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
    ).toBe(180);
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

  test('Seattle 180-day clock excludes the day of service', () => {
    const seattle = evaluateRentIncrease({
      jurisdiction: 'seattle',
      currentRent: 1000,
      newRent: 1050,
    });
    expect(seattle.noticePeriodDays).toBe(180);
    expect(seattle.excludeDayOfService).toBe(true);

    const latestServe = calculateRequiredNoticeDate('2026-06-01', 180, {
      excludeDayOfService: true,
    });
    expect(latestServe).toBe('2025-12-02');
  });

  test('Tacoma and Bellingham overlay longer default notice; Federal Way stays at 90', () => {
    expect(
      calculateRentIncreaseNoticePeriod({
        jurisdiction: 'tacoma',
        currentRent: 1000,
        newRent: 1030,
      })
    ).toBe(180);
    expect(
      calculateRentIncreaseNoticePeriod({
        jurisdiction: 'bellingham',
        currentRent: 1000,
        newRent: 1030,
      })
    ).toBe(120);
    expect(
      calculateRentIncreaseNoticePeriod({
        jurisdiction: 'federal_way',
        currentRent: 1000,
        newRent: 1030,
      })
    ).toBe(90);
    expect(
      calculateRentIncreaseNoticePeriod({
        jurisdiction: 'tacoma',
        subsidized: true,
        percentIncrease: 8,
      })
    ).toBe(30);
  });

  test('Olympia notice days follow OMC 5.82.030 percent tiers', () => {
    expect(
      calculateRentIncreaseNoticePeriod({
        jurisdiction: 'olympia',
        currentRent: 1000,
        newRent: 1050,
      })
    ).toBe(90);
    expect(
      calculateRentIncreaseNoticePeriod({
        jurisdiction: 'olympia',
        currentRent: 1000,
        newRent: 1051,
      })
    ).toBe(120);
    expect(
      calculateRentIncreaseNoticePeriod({
        jurisdiction: 'olympia',
        percentIncrease: 10,
      })
    ).toBe(180);
    expect(
      noticeDaysForRentIncrease(
        {
          defaultNoticeDays: 90,
          noticeTiers: [
            { minPercent: 5, minInclusive: false, days: 120 },
            { minPercent: 10, minInclusive: true, days: 180 },
          ],
        },
        { percentIncrease: 5 }
      )
    ).toBe(90);
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

  test('just-cause and Seattle renewal-offer overlays gate landlord no-cause endings', () => {
    const waMtm = evaluateLeaseTermination({
      leaseType: 'month_to_month',
      jurisdiction: 'washington_state',
      initiatedBy: 'landlord',
      hasCause: false,
    });
    expect(waMtm.blocked).toBe(true);
    expect(waMtm.justCauseRequiredForPath).toBe(true);
    expect(waMtm.renewalOfferRequired).toBe(false);

    const waFixed = evaluateLeaseTermination({
      leaseType: 'fixed_term',
      jurisdiction: 'washington_state',
      initiatedBy: 'landlord',
      hasCause: false,
    });
    expect(waFixed.blocked).toBe(false);
    expect(waFixed.noticePeriodDays).toBe(60);

    const seattleFixed = evaluateLeaseTermination({
      leaseType: 'fixed_term',
      jurisdiction: 'seattle',
      initiatedBy: 'landlord',
      hasCause: false,
      leaseEndDate: '2026-12-01',
      asOfDate: '2026-09-15',
    });
    expect(seattleFixed.blocked).toBe(true);
    expect(seattleFixed.renewalOfferRequired).toBe(true);
    expect(seattleFixed.inRenewalOfferWindow).toBe(true);

    const seattleCause = evaluateLeaseTermination({
      leaseType: 'fixed_term',
      jurisdiction: 'seattle',
      initiatedBy: 'landlord',
      hasCause: true,
    });
    expect(seattleCause.blocked).toBe(false);

    const tenantEnd = evaluateLeaseTermination({
      leaseType: 'month_to_month',
      jurisdiction: 'seattle',
      initiatedBy: 'tenant',
      hasCause: false,
    });
    expect(tenantEnd.blocked).toBe(false);
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
  test('effective and required notice dates offset by whole calendar days', () => {
    expect(calculateEffectiveDate('2026-08-01', 90)).toBe('2026-10-30');
    expect(calculateRequiredNoticeDate('2026-11-01', 90)).toBe('2026-08-03');
  });

  test('ISO date-only strings do not shift a day west of UTC', () => {
    expect(calculateRequiredNoticeDate('2027-03-01', 180, { excludeDayOfService: true }))
      .toBe('2026-09-01');
    expect(formatWorkflowDateForLocale('2027-03-01', 'en-US')).toBe('03/01/2027');
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
    expect(result.requiredNoticeDate).toBe('2026-09-02');
  });

  test('Seattle 180-day overlay keeps 2027-03-01 on the local calendar', async () => {
    globalThis.fetch = async () => ({ ok: false });

    const result = await calculateNoticePeriod({
      workflowType: 'rent_increase',
      leaseType: 'month_to_month',
      jurisdiction: 'seattle',
      context: { currentRent: 1000, newRent: 1050, effectiveDate: '2027-03-01' },
    });

    expect(result.noticePeriodDays).toBe(180);
    expect(result.effectiveDate).toBe('2027-03-01');
    expect(result.requiredNoticeDate).toBe('2026-09-01');
    expect(formatWorkflowDateForLocale(result.effectiveDate, 'en-US')).toBe(
      '03/01/2027'
    );
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
