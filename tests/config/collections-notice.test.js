import {
  COLLECTION_FDCPA_NOTICE,
  COLLECTION_PAY_OR_VACATE,
  collectionNoticeDays,
  collectionNoticeKindOptions,
  evictionHandoffFromCollections,
  isPositiveAmountOwed,
  normalizeCollectionNoticeType,
} from '../../src/utils/collections-notice.js';
import { noticePeriodDaysFromPack } from '../../src/utils/compliance-calculator.js';

describe('collections late-rent notice', () => {
  test('WA pack exposes 3-day pay-or-vacate, not comply or unconditional quit', () => {
    const kinds = collectionNoticeKindOptions('washington_state');
    expect(kinds.map((k) => k.value)).toEqual([COLLECTION_PAY_OR_VACATE]);
    expect(kinds[0].days).toBe(3);
    expect(kinds[0].label).toBe('3-Day Pay or Vacate');
    expect(kinds.some((k) => k.value === '10_day_compliance')).toBe(false);
    expect(kinds.some((k) => k.value === '14_day_unconditional')).toBe(false);
  });

  test('Seattle inherits the same pay-or-vacate days', () => {
    expect(collectionNoticeDays('seattle', '3_day_pay_or_vacate')).toBe(3);
  });

  test('stub 3_day maps onto Eviction pay-or-vacate', () => {
    expect(normalizeCollectionNoticeType('3_day')).toBe(COLLECTION_PAY_OR_VACATE);
    expect(normalizeCollectionNoticeType('10_day')).toBe(COLLECTION_PAY_OR_VACATE);
    expect(normalizeCollectionNoticeType('')).toBe(COLLECTION_PAY_OR_VACATE);
  });

  test('noticePeriodDaysFromPack uses pay-or-vacate for collections', () => {
    expect(
      noticePeriodDaysFromPack({
        workflowType: 'collections',
        jurisdiction: 'washington_state',
      })
    ).toBe(3);
    expect(
      noticePeriodDaysFromPack({
        workflowType: 'collections',
        jurisdiction: 'washington_state',
        context: { noticeType: '3_day_pay_or_vacate' },
      })
    ).toBe(3);
  });

  test('handoff prefills Eviction with lease, amount, and nonpayment reason', () => {
    const handoff = evictionHandoffFromCollections(
      {
        lease_id: 9,
        unit_id: 4,
        property_id: 2,
        amount_owed: '1250.5',
        notice_type: '3_day',
        collection_notes: 'Two months unpaid.',
      },
      { units: { unit_id: 99, properties: { property_id: 88 } } }
    );
    expect(handoff).toEqual({
      lease_id: 9,
      unit_id: 4,
      property_id: 2,
      notice_type: COLLECTION_PAY_OR_VACATE,
      amount_owed: 1250.5,
      violation_reason: 'Nonpayment of rent. Amount owed: $1,250.50. Two months unpaid.',
    });
  });

  test('handoff fills unit and property from the lease when the row omitted them', () => {
    const handoff = evictionHandoffFromCollections(
      { lease_id: 3, amount_owed: 800 },
      { units: { unit_id: 11, properties: { property_id: 22 } } }
    );
    expect(handoff.unit_id).toBe(11);
    expect(handoff.property_id).toBe(22);
    expect(handoff.notice_type).toBe(COLLECTION_PAY_OR_VACATE);
  });

  test('amount owed must be greater than zero', () => {
    expect(isPositiveAmountOwed(0)).toBe(false);
    expect(isPositiveAmountOwed('')).toBe(false);
    expect(isPositiveAmountOwed(1)).toBe(true);
  });

  test('FDCPA copy has no pack jargon', () => {
    expect(COLLECTION_FDCPA_NOTICE.toLowerCase()).toContain('fdcpa');
    expect(COLLECTION_FDCPA_NOTICE.toLowerCase()).not.toContain('pack');
  });
});
