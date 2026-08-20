import { applyPeriodToPaymentForm } from '../../src/utils/payment-form.js';

describe('payment form helpers', () => {
  test('applyPeriodToPaymentForm fills start and end', () => {
    const next = applyPeriodToPaymentForm(
      { periodKey: '', periodStart: '', periodEnd: '', dueDate: '' },
      {
        id: '2026-08-15_2026-09-14',
        start: '2026-08-15',
        end: '2026-09-14',
      }
    );
    expect(next.periodStart).toBe('08-15-2026');
    expect(next.periodEnd).toBe('09-14-2026');
    expect(next.periodKey).toBe('2026-08-15_2026-09-14');
  });

  test('applyPeriodToPaymentForm derives end when only start is present', () => {
    const next = applyPeriodToPaymentForm(
      { periodKey: '', periodStart: '', periodEnd: '', dueDate: '' },
      { id: '2026-08-15', start: '2026-08-15' }
    );
    expect(next.periodStart).toBe('08-15-2026');
    expect(next.periodEnd).toBe('09-14-2026');
  });
});
