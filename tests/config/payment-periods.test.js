import {
  addMonthsClamped,
  currentLeasePeriod,
  formatPeriodRangeLabel,
  leaseAlignedPeriods,
  periodFromStart,
} from '../../src/utils/payment-periods.js';

describe('lease-aligned payment periods', () => {
  test('addMonthsClamped keeps the start day when the month is long enough', () => {
    expect(addMonthsClamped('2026-08-15', 1)).toBe('2026-09-15');
  });

  test('addMonthsClamped clamps 31 Jan into February', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
  });

  test('periodFromStart runs from start day through the day before next start', () => {
    expect(periodFromStart('2026-08-15')).toEqual({
      start: '2026-08-15',
      end: '2026-09-14',
    });
  });

  test('leaseAlignedPeriods follows the lease start, not calendar months', () => {
    const periods = leaseAlignedPeriods(
      { start_date: '2026-08-15', end_date: '2027-08-14' },
      { today: '2026-08-20' }
    );
    expect(periods[0]).toMatchObject({
      start: '2026-08-15',
      end: '2026-09-14',
      current: true,
    });
    expect(periods[1].start).toBe('2026-09-15');
    expect(currentLeasePeriod(periods, '2026-08-20').start).toBe('2026-08-15');
    expect(formatPeriodRangeLabel('2026-08-15', '2026-09-14')).toBe(
      '08-15-2026 – 09-14-2026'
    );
  });
});
