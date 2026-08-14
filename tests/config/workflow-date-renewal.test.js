import {
  leaseTermMonths,
  suggestRenewalEndDate,
  addDaysToWorkflowDate,
  todayWorkflowDate,
  toWorkflowDateString,
  formatWorkflowDateMMDDYYYY,
} from '../../src/utils/workflow-date.js';

describe('lease renewal date helpers', () => {
  test('Sep 1 – Aug 31 is a 12-month term', () => {
    expect(leaseTermMonths('2025-09-01', '2026-08-31')).toBe(12);
  });

  test('suggests renewal end as day before next anniversary', () => {
    // Prior term ends 2026-08-31 → renewal starts 2026-09-01 → ends 2027-08-31
    const start = addDaysToWorkflowDate('2026-08-31', 1);
    expect(start).toBe('2026-09-01');
    expect(suggestRenewalEndDate(start, '2025-09-01', '2026-08-31')).toBe(
      '2027-08-31'
    );
  });

  test('Oct 31 end renews to Nov 1 – Oct 31 next year', () => {
    const start = addDaysToWorkflowDate('2026-10-31', 1);
    expect(start).toBe('2026-11-01');
    expect(suggestRenewalEndDate(start, '2025-11-01', '2026-10-31')).toBe(
      '2027-10-31'
    );
  });

  test('todayWorkflowDate uses local calendar day not UTC', () => {
    const localEvening = new Date(2026, 7, 13, 20, 0, 0); // Aug 13, 8pm local
    expect(todayWorkflowDate(localEvening)).toBe('2026-08-13');
  });

  test('toWorkflowDateString and MM-DD-YYYY avoid UTC day shift', () => {
    expect(toWorkflowDateString('2026-11-01')).toBe('2026-11-01');
    expect(toWorkflowDateString('2026-11-01T00:00:00.000Z')).toBe('2026-11-01');
    expect(formatWorkflowDateMMDDYYYY('2026-11-01')).toBe('11-01-2026');
  });
});
