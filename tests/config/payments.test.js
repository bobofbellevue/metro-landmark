import {
  canEditPayments,
  canViewPayments,
  catalogCodeFromLabel,
  currentRentPeriodLabel,
  defaultAmountForKind,
  filterPaymentsBySearch,
  leaseLabelFromParts,
  mergePaymentCatalog,
  missingPaymentsColumn,
  missingPaymentsTable,
  parsePaymentAmount,
  paymentsSchemaWarning,
  paymentsWriteErrorMessage,
  restoreStatusForVoided,
  paymentDeleteConfirmName,
  publicPayment,
  stripeOnlineEnabled,
  stripeSecretKey,
  summarizePayments,
  validatePaymentWrite,
  PAYMENT_TYPES,
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

  test('period date range is stored and labeled', () => {
    const parsed = validatePaymentWrite(
      {
        leaseId: 1,
        type: 'late_fee',
        amount: 75,
        periodStart: '2026-08-15',
        periodEnd: '2026-09-14',
      },
      { requireAmount: true }
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.value.kind).toBe('late_fee');
    expect(parsed.value.periodStart).toBe('2026-08-15');
    expect(parsed.value.periodEnd).toBe('2026-09-14');
    expect(parsed.value.periodLabel).toMatch(/08-15-2026/);
    expect(
      validatePaymentWrite(
        {
          leaseId: 1,
          kind: 'rent',
          amount: 10,
          periodStart: '2026-09-14',
          periodEnd: '2026-08-15',
        },
        { requireAmount: true }
      ).ok
    ).toBe(false);
  });

  test('receipt date is distinct from due date', () => {
    const parsed = validatePaymentWrite(
      {
        leaseId: 1,
        kind: 'rent',
        amount: 1850,
        status: 'paid',
        method: 'check',
        receiptDate: '2026-08-18',
      },
      { requireAmount: true }
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.value.receiptDate).toBe('2026-08-18');
    expect(
      validatePaymentWrite(
        {
          leaseId: 1,
          kind: 'rent',
          amount: 10,
          receiptDate: 'not-a-date',
        },
        { requireAmount: true }
      ).error
    ).toMatch(/receipt/i);
  });

  test('missing-table detection does not treat missing 018 columns as 017', () => {
    const columnMissing = {
      message: "Could not find the 'period_start' column of 'payments' in the schema cache",
    };
    expect(missingPaymentsTable(columnMissing)).toBe(false);
    expect(missingPaymentsColumn(columnMissing)).toBe(true);
    expect(paymentsWriteErrorMessage(columnMissing)).toMatch(/018_payment_ledger_ux/);
    expect(paymentsWriteErrorMessage(columnMissing)).not.toMatch(/017_payments/);

    const tableMissing = {
      message: 'relation "payments" does not exist',
    };
    expect(missingPaymentsTable(tableMissing)).toBe(true);
    expect(paymentsWriteErrorMessage(tableMissing)).toMatch(/017_payments/);

    const receiptMissing = {
      message: "Could not find the 'receipt_date' column of 'payments' in the schema cache",
    };
    expect(paymentsWriteErrorMessage(receiptMissing)).toMatch(/019_payment_receipt_and_rls/);
    expect(paymentsSchemaWarning(['receipt_date'])).toMatch(/Date of receipt/);
  });

  test('mergePaymentCatalog appends company types', () => {
    const merged = mergePaymentCatalog(PAYMENT_TYPES, [
      { category: 'type', code: 'garage_remote', label: 'Garage remote', pmc_id: 9 },
    ], 'type');
    expect(merged.some((t) => t.id === 'garage_remote')).toBe(true);
    expect(catalogCodeFromLabel('Garage remote')).toBe('garage_remote');
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
    expect(row.receiptDate).toBeNull();
    expect(
      publicPayment({
        payment_id: 9,
        pmc_id: 2,
        lease_id: 4,
        kind: 'rent',
        amount: '1850.00',
        status: 'paid',
        due_date: '2026-09-01',
        receipt_date: '2026-08-18',
      }).receiptDate
    ).toBe('2026-08-18');
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

  test('void restore and delete confirmation name', () => {
    expect(restoreStatusForVoided({ status: 'void' })).toBe('due');
    expect(restoreStatusForVoided({ status: 'void', paid_at: '2026-08-18T12:00:00Z' })).toBe(
      'paid'
    );
    expect(restoreStatusForVoided({ receiptDate: '2026-08-18' })).toBe('paid');
    expect(
      paymentDeleteConfirmName({
        leaseLabel: 'Pine Court · Unit 2A',
        typeLabel: 'Rent',
        amount: 1850,
      })
    ).toBe('Pine Court · Unit 2A Rent 1850');
  });
});
