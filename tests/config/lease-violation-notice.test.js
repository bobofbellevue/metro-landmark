import {
  violationCureDays,
  violationNoticeKindOptions,
} from '../../src/utils/lease-violation-notice.js';
import { noticePeriodDaysFromPack } from '../../src/utils/compliance-calculator.js';
import { leaseViolationNoticeFingerprint } from '../../src/utils/notice-service-workflow.js';

describe('lease violation notice kinds', () => {
  test('WA pack exposes 10-day comply and 20-day notice, not pay-or-vacate', () => {
    const kinds = violationNoticeKindOptions('washington_state');
    expect(kinds.map((k) => k.value)).toEqual(['10_day_compliance', '20_day_violation']);
    expect(kinds[0].days).toBe(10);
    expect(kinds[0].label).toBe('10-Day Comply or Vacate');
    expect(kinds[1].days).toBe(20);
    expect(kinds[1].label).toBe('20-Day Notice');
    expect(kinds.some((k) => k.value === '3_day_pay_or_vacate')).toBe(false);
  });

  test('Seattle inherits the same cure days', () => {
    expect(violationCureDays('seattle', '10_day_compliance')).toBe(10);
    expect(violationCureDays('seattle', '20_day_violation')).toBe(20);
  });

  test('noticePeriodDaysFromPack uses the selected notice kind', () => {
    expect(
      noticePeriodDaysFromPack({
        workflowType: 'lease_violation',
        jurisdiction: 'washington_state',
        context: { noticeType: '20_day_violation' },
      })
    ).toBe(20);
    expect(
      noticePeriodDaysFromPack({
        workflowType: 'lease_violation',
        jurisdiction: 'washington_state',
      })
    ).toBe(10);
  });

  test('fingerprint changes when type, kind, date, or description changes', () => {
    const base = {
      lease_id: 9,
      violation_type: 'noise',
      notice_kind: '10_day_compliance',
      effective_date: '2026-09-15',
      violation_description: 'Loud after 10pm',
    };
    expect(leaseViolationNoticeFingerprint(base)).not.toBe(
      leaseViolationNoticeFingerprint({ ...base, violation_type: 'pet' })
    );
    expect(leaseViolationNoticeFingerprint(base)).not.toBe(
      leaseViolationNoticeFingerprint({ ...base, notice_kind: '20_day_violation' })
    );
    expect(leaseViolationNoticeFingerprint(base)).not.toBe(
      leaseViolationNoticeFingerprint({ ...base, effective_date: '2026-09-20' })
    );
    expect(leaseViolationNoticeFingerprint(base)).not.toBe(
      leaseViolationNoticeFingerprint({ ...base, violation_description: 'Different' })
    );
  });
});
