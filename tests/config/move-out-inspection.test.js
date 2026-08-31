import {
  buildMoveOutInspectionLines,
  checklistFromMoveInReport,
  deductionsFromMoveOutInspection,
  deductionsNeedSeed,
  moveOutReportFingerprint,
  normalizeMoveOutChecklistItems,
} from '../../src/utils/move-out-inspection.js';
import { getRuleCitations } from '../../src/jurisdictions/index.js';

describe('move-out inspection', () => {
  test('seeds checklist areas from a move-in report and leaves move-out blank', () => {
    const rows = checklistFromMoveInReport({
      items: [
        { area: 'Walls', condition: 'good', notes: 'Hairline crack' },
        { area: '  ', condition: 'poor', notes: 'ignored' },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        area: 'Walls',
        condition: '',
        notes: '',
        moveInCondition: 'good',
        moveInNotes: 'Hairline crack',
      }),
    ]);
  });

  test('falls back to default areas when there is no move-in report', () => {
    const areas = checklistFromMoveInReport(null).map((row) => row.area);
    expect(areas).toEqual(expect.arrayContaining(['Walls', 'Carpets', 'Appliances']));
  });

  test('fingerprint changes when move-out condition or a deduction changes', () => {
    const base = {
      lease_id: 9,
      inspection_date: '2026-09-30',
      tenant_present: 'no',
      overall_condition: 'fair',
      checklist: [{ area: 'Walls', condition: 'fair', notes: '' }],
      deductions: [{ reason: 'Paint', amount: 50 }],
    };
    expect(moveOutReportFingerprint(base)).not.toBe(
      moveOutReportFingerprint({
        ...base,
        checklist: [{ area: 'Walls', condition: 'poor', notes: '' }],
      })
    );
    expect(moveOutReportFingerprint(base)).not.toBe(
      moveOutReportFingerprint({
        ...base,
        deductions: [{ reason: 'Paint', amount: 75 }],
      })
    );
  });

  test('reads proposed deductions from a stored move-out inspection', () => {
    expect(
      deductionsFromMoveOutInspection({
        condition_report: {
          deductions: [
            { reason: 'Carpet', amount: 125 },
            { reason: '  ', amount: 10 },
          ],
        },
      })
    ).toEqual([{ reason: 'Carpet', amount: 125 }]);
    expect(deductionsNeedSeed([{ reason: '', amount: null }])).toBe(true);
    expect(deductionsNeedSeed([{ reason: 'Carpet', amount: 125 }])).toBe(false);
  });

  test('report lines compare to move-in, omit a blank unit, and skip operator jargon', () => {
    const withUnit = buildMoveOutInspectionLines({
      tenantNames: 'Ada Lovelace',
      propertyName: 'Pine Court',
      unitNumber: 'B',
      inspectionDateLabel: '09/30/2026',
      moveInDateLabel: '09/01/2026',
      tenantPresent: false,
      overallCondition: 'fair',
      checklist: [
        {
          area: 'Walls',
          condition: 'fair',
          notes: 'New scratch',
          moveInCondition: 'good',
        },
      ],
      deductions: [{ reason: 'Paint', amount: 80 }],
      notes: 'Keys returned.',
    });
    expect(withUnit).toContain('To: Ada Lovelace');
    expect(withUnit).toContain('Unit: B');
    expect(withUnit).toContain('Inspection date: 09/30/2026');
    expect(withUnit).toContain('Move-in inspection: 09/01/2026');
    expect(withUnit).toContain('Walls: Fair (at move-in: Good) — New scratch');
    expect(withUnit).toContain('Paint: $80.00');
    expect(withUnit).toContain('Total proposed deductions: $80.00');
    expect(withUnit).toContain('These amounts can be used on the deposit return statement.');
    expect(withUnit).toContain('Not legal advice. See RCW 59.18.280.');
    expect(withUnit.some((l) => l.toLowerCase().includes('pack'))).toBe(false);

    const unlabeled = buildMoveOutInspectionLines({
      tenantNames: 'Ada Lovelace',
      propertyName: 'Oak House',
      unitNumber: '',
      inspectionDateLabel: '09/30/2026',
      tenantPresent: true,
      checklist: [],
      deductions: [],
    });
    expect(unlabeled.some((l) => l.startsWith('Unit:'))).toBe(false);
    expect(unlabeled).toContain('No checklist items recorded.');
    expect(unlabeled).toContain('Proposed deductions: none');
    expect(unlabeled).toContain('Tenant present: Yes');
  });

  test('drops blank move-out areas', () => {
    expect(
      normalizeMoveOutChecklistItems([
        { area: 'Floors', condition: 'good', notes: '', moveInCondition: 'good' },
        { area: '  ', condition: 'poor' },
      ])
    ).toEqual([
      {
        area: 'Floors',
        condition: 'good',
        notes: '',
        moveInCondition: 'good',
        moveInNotes: '',
      },
    ]);
  });

  test('deposit citation is the move-out reference', () => {
    const cites = getRuleCitations('washington_state', 'deposit');
    expect(cites.map((c) => c.id)).toContain('RCW_59.18.280');
  });
});
