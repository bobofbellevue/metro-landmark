import {
  buildDepositReturnStatementLines,
  depositReturnAmount,
  depositReturnFingerprint,
  heldDepositTotal,
  normalizeDepositDeductions,
  sumDepositDeductions,
} from '../../src/utils/deposit-return-statement.js';
import { calculateDepositReturnDeadline } from '../../src/utils/compliance-calculator.js';

describe('deposit return statement math', () => {
  test('drops empty deduction rows and sums the rest', () => {
    const rows = [
      { reason: 'Carpet', amount: 125 },
      { reason: '  ', amount: 10 },
      { reason: 'Keys', amount: 0 },
      { reason: 'Cleaning', amount: '40.5' },
    ];
    expect(normalizeDepositDeductions(rows)).toEqual([
      { reason: 'Carpet', amount: 125 },
      { reason: 'Cleaning', amount: 40.5 },
    ]);
    expect(sumDepositDeductions(rows)).toBe(165.5);
  });

  test('held total includes pet deposit and return can be negative', () => {
    expect(heldDepositTotal({ securityDeposit: 1000, petDeposit: 300 })).toBe(1300);
    expect(depositReturnAmount(1000, [{ reason: 'Damage', amount: 1200 }])).toBe(-200);
  });

  test('deadline is 30 days after vacation in WA and Seattle', () => {
    expect(calculateDepositReturnDeadline('2026-08-01', 'washington_state')).toBe(
      '2026-08-31'
    );
    expect(calculateDepositReturnDeadline('2026-08-01', 'seattle')).toBe('2026-08-31');
    expect(calculateDepositReturnDeadline('', 'seattle')).toBe('');
  });

  test('fingerprint changes when a deduction or held amount changes', () => {
    const base = {
      lease_id: 9,
      vacation_date: '2026-08-01',
      original_deposit: 1000,
      deductions: [{ reason: 'Paint', amount: 50 }],
    };
    expect(depositReturnFingerprint(base)).not.toBe(
      depositReturnFingerprint({
        ...base,
        deductions: [{ reason: 'Paint', amount: 75 }],
      })
    );
    expect(depositReturnFingerprint(base)).not.toBe(
      depositReturnFingerprint({ ...base, original_deposit: 1200 })
    );
    expect(
      depositReturnFingerprint({
        lease_id: 9,
        vacation_date: '2026-08-01',
        original_deposit: 1000,
      })
    ).toBe(
      depositReturnFingerprint({
        lease_id: 9,
        vacation_date: '2026-08-01',
        security_deposit: 1000,
      })
    );
  });

  test('statement lines omit a blank unit and skip operator jargon', () => {
    const withUnit = buildDepositReturnStatementLines({
      tenantNames: 'Ada Lovelace',
      propertyName: 'Pine Court',
      unitNumber: 'B',
      securityDeposit: 1200,
      petDeposit: 200,
      deductions: [{ reason: 'Cleaning', amount: 80 }],
      vacationDateLabel: '08/01/2026',
      dueByLabel: '08/31/2026',
    });
    expect(withUnit).toContain('To: Ada Lovelace');
    expect(withUnit).toContain('Unit: B');
    expect(withUnit).toContain('Pet deposit held: $200.00');
    expect(withUnit).toContain('Cleaning: $80.00');
    expect(withUnit).toContain('Amount to return: $1,320.00');
    expect(withUnit).toContain('Not legal advice. See RCW 59.18.280.');
    expect(withUnit.some((l) => l.toLowerCase().includes('pack'))).toBe(false);

    const unlabeled = buildDepositReturnStatementLines({
      tenantNames: 'Ada Lovelace',
      propertyName: 'Oak House',
      unitNumber: '',
      securityDeposit: 800,
      deductions: [],
      vacationDateLabel: '08/01/2026',
      dueByLabel: '08/31/2026',
    });
    expect(unlabeled.some((l) => l.startsWith('Unit:'))).toBe(false);
    expect(unlabeled).toContain('Deductions: none');
    expect(unlabeled).toContain('Amount to return: $800.00');
  });
});
