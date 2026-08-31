import {
  buildMoveInConditionReportLines,
  defaultMoveInChecklistRows,
  moveInReportFingerprint,
  normalizeChecklistItems,
  tenantPresentFlag,
} from '../../src/utils/move-in-condition-report.js';
import { getRuleCitations } from '../../src/jurisdictions/index.js';

describe('move-in condition report', () => {
  test('drops blank areas and keeps notes on filled rows', () => {
    expect(
      normalizeChecklistItems([
        { area: 'Walls', condition: 'good', notes: 'Hairline crack' },
        { area: '  ', condition: 'poor', notes: 'ignored' },
        { area: 'Floors', condition: '', notes: '' },
      ])
    ).toEqual([
      { area: 'Walls', condition: 'good', notes: 'Hairline crack' },
      { area: 'Floors', condition: '', notes: '' },
    ]);
  });

  test('default checklist includes statute example areas', () => {
    const areas = defaultMoveInChecklistRows().map((row) => row.area);
    expect(areas).toEqual(
      expect.arrayContaining([
        'Walls',
        'Floors',
        'Countertops',
        'Carpets',
        'Drapes and window coverings',
        'Furniture and furnishings',
        'Appliances',
      ])
    );
  });

  test('fingerprint changes when checklist, date, or presence changes', () => {
    const base = {
      lease_id: 9,
      inspection_date: '2026-09-01',
      tenant_present: 'yes',
      overall_condition: 'good',
      condition_notes: '',
      checklist: [{ area: 'Walls', condition: 'good', notes: '' }],
    };
    expect(moveInReportFingerprint(base)).not.toBe(
      moveInReportFingerprint({
        ...base,
        checklist: [{ area: 'Walls', condition: 'poor', notes: '' }],
      })
    );
    expect(moveInReportFingerprint(base)).not.toBe(
      moveInReportFingerprint({ ...base, inspection_date: '2026-09-02' })
    );
    expect(moveInReportFingerprint(base)).toBe(
      moveInReportFingerprint({ ...base, tenant_present: true })
    );
    expect(moveInReportFingerprint(base)).not.toBe(
      moveInReportFingerprint({ ...base, tenant_present: 'no' })
    );
  });

  test('tenant present treats only yes/true as present', () => {
    expect(tenantPresentFlag('yes')).toBe(true);
    expect(tenantPresentFlag(true)).toBe(true);
    expect(tenantPresentFlag('no')).toBe(false);
    expect(tenantPresentFlag('')).toBe(false);
  });

  test('report lines omit a blank unit and skip operator jargon', () => {
    const withUnit = buildMoveInConditionReportLines({
      tenantNames: 'Ada Lovelace',
      propertyName: 'Pine Court',
      unitNumber: 'B',
      inspectionDateLabel: '09/01/2026',
      tenantPresent: true,
      overallCondition: 'good',
      checklist: [
        { area: 'Walls', condition: 'good', notes: 'Hairline crack' },
        { area: 'Floors', condition: 'fair', notes: '' },
      ],
      notes: 'Keys issued.',
    });
    expect(withUnit).toContain('To: Ada Lovelace');
    expect(withUnit).toContain('Unit: B');
    expect(withUnit).toContain('Inspection date: 09/01/2026');
    expect(withUnit).toContain('Tenant present: Yes');
    expect(withUnit).toContain('Overall condition: Good');
    expect(withUnit).toContain('Walls: Good — Hairline crack');
    expect(withUnit).toContain('Floors: Fair');
    expect(withUnit).toContain('Notes: Keys issued.');
    expect(withUnit).toContain('Give the tenant a copy of this report.');
    expect(withUnit).toContain('Not legal advice. See RCW 59.18.260.');
    expect(withUnit.some((l) => l.toLowerCase().includes('pack'))).toBe(false);

    const unlabeled = buildMoveInConditionReportLines({
      tenantNames: 'Ada Lovelace',
      propertyName: 'Oak House',
      unitNumber: '',
      inspectionDateLabel: '09/01/2026',
      tenantPresent: false,
      checklist: [],
    });
    expect(unlabeled.some((l) => l.startsWith('Unit:'))).toBe(false);
    expect(unlabeled).toContain('No checklist items recorded.');
    expect(unlabeled).toContain('Tenant present: No');
  });

  test('WA and Seattle packs cite RCW 59.18.260 for move-in', () => {
    const wa = getRuleCitations('washington_state', 'moveIn');
    expect(wa.map((c) => c.id)).toContain('RCW_59.18.260');
    expect(wa[0].href).toContain('59.18.260');
    const seattle = getRuleCitations('seattle', 'moveIn');
    expect(seattle.map((c) => c.id)).toContain('RCW_59.18.260');
  });
});
