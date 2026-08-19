import {
  canEditPayments,
  canViewPayments,
  currentRentPeriodLabel,
  defaultAmountForKind,
  filterPaymentsBySearch,
  leaseLabelFromParts,
  parsePaymentAmount,
  publicPayment,
  stripeOnlineEnabled,
  stripeSecretKey,
  summarizePayments,
  validatePaymentWrite,
} from '../../src/utils/payments.js';

describe('payment helpers', () => {
  test('role gates', () => {
    expect(canViewPayments('global_admin')).toBe(true);
    expect(canViewPayments('landlord')).toBe(true);
    expect(canViewPayments('staff')).toBe(false);
    expect(canEditPayments('manager')).toBe(true);
    expect(canEditPayments('landlord')).toBe(false);
  });

  test('parsePaymentAmount', () => {
    expect(parsePaymentAmount('1,200.50')).toBe(1200.5);
    expect(parsePaymentAmount(0)).toBeNull();
    expect(parsePaymentAmount(-5)).toBeNull();
    expect(parsePaymentAmount('nope')).toBeNull();
  });

  test('defaultAmountForKind uses lease fields', () => {
    const lease = {
      monthly_rent_amount: 1850,
      security_deposit_amount: 1850,
      other_fee_amount: 50,
    };
    expect(defaultAmountForKind(lease, 'rent')).toBe(1850);
    expect(defaultAmountForKind(lease, 'deposit')).toBe(1850);
    expect(defaultAmountForKind(lease, 'fee')).toBe(50);
    expect(defaultAmountForKind(lease, 'other')).toBeNull();
  });

  test('validatePaymentWrite requires lease, kind, amount', () => {
    expect(validatePaymentWrite({}, { requireAmount: true }).ok).toBe(false);
    expect(
      validatePaymentWrite(
        { leaseId: 3, kind: 'rent', amount: 100 },
        { requireAmount: true }
      ).value
    ).toMatchObject({ leaseId: 3, kind: 'rent', amount: 100, status: 'due' });
    expect(
      validatePaymentWrite(
        { leaseId: 3, kind: 'rent', amount: 100, status: 'paid' },
        { requireAmount: true }
      ).error
    ).toMatch(/method/i);
  });

  test('period label rejects junk', () => {
    expect(
      validatePaymentWrite(
        { leaseId: 1, kind: 'rent', amount: 10, periodLabel: '<script>' },
        { requireAmount: true }
      ).ok
    ).toBe(false);
    expect(
      validatePaymentWrite(
        { leaseId: 1, kind: 'rent', amount: 10, periodLabel: '2026-08' },
        { requireAmount: true }
      ).value.periodLabel
    ).toBe('2026-08');
  });

  test('stripeOnlineEnabled requires sk_ secret', () => {
    expect(stripeSecretKey({ STRIPE_SECRET_KEY: 'pk_test' })).toBeNull();
    expect(stripeSecretKey({ STRIPE_SECRET_KEY: 'sk_test_123' })).toBe('sk_test_123');
    expect(stripeOnlineEnabled({ STRIPE_SECRET_KEY: 'sk_live_x' })).toBe(true);
    expect(stripeOnlineEnabled({})).toBe(false);
  });

  test('publicPayment and summary', () => {
    const row = publicPayment(
      {
        payment_id: 9,
        pmc_id: 2,
        lease_id: 4,
        kind: 'rent',
        amount: '1850.00',
        status: 'due',
        due_date: '2026-09-01',
      },
      { propertyName: 'Pine Court', unitNumber: '2A', tenantNames: 'Ada Lovelace' }
    );
    expect(row.leaseLabel).toBe('Pine Court · Unit 2A · Ada Lovelace');
    expect(row.kindLabel).toBe('Rent');
    expect(summarizePayments([row, { status: 'paid', amount: 50 }])).toEqual({
      dueCount: 1,
      dueAmount: 1850,
      paidCount: 1,
      paidAmount: 50,
    });
    expect(filterPaymentsBySearch([row], 'pine')).toHaveLength(1);
    expect(filterPaymentsBySearch([row], 'zzz')).toHaveLength(0);
    expect(leaseLabelFromParts({ propertyName: 'Oak' })).toBe('Oak');
    expect(currentRentPeriodLabel(new Date(2026, 7, 19))).toBe('2026-08');
  });
});
