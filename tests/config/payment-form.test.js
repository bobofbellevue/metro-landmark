import {
  applyPeriodToPaymentForm,
  paymentFormFromRow,
  paymentWritePayload,
} from '../../src/utils/payment-form.js';

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

  test('paymentWritePayload fills period end from start for an open charge', () => {
    const payload = paymentWritePayload({
      intent: 'charge',
      leaseId: 4,
      kind: 'rent',
      amount: 1850,
      dueDate: '09-01-2026',
      receiptDate: '',
      method: '',
      memo: '',
      periodStart: '09-01-2026',
      periodEnd: '',
      collectOnline: false,
      proof: null,
    });
    expect(payload.status).toBe('due');
    expect(payload.periodStart).toBe('09-01-2026');
    expect(payload.periodEnd).toBe('09-30-2026');
  });

  test('paymentFormFromRow fills a missing period end from start', () => {
    const form = paymentFormFromRow({
      status: 'due',
      leaseId: 4,
      kind: 'rent',
      amount: 1850,
      dueDate: '2026-09-01',
      periodStart: '2026-09-01',
      periodEnd: null,
    });
    expect(form.periodStart).toBe('09-01-2026');
    expect(form.periodEnd).toBe('09-30-2026');
  });
});
