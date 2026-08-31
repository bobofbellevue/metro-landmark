import {
  buildHabitabilityRecordLines,
  formatRepairWindowLabel,
  habitabilityRecordFingerprint,
  habitabilityReferenceDeadline,
  habitabilityRepairWindow,
  maintenanceRequestOptionLabel,
  normalizeHabitabilityIssueType,
} from '../../src/utils/habitability-issue.js';
import { getRuleCitations, getResolvedJurisdictionPack } from '../../src/jurisdictions/index.js';

describe('habitability issue record', () => {
  test('WA pack encodes 24 / 72 hour and 10-day commence windows', () => {
    const rules = getResolvedJurisdictionPack('washington_state').resolvedRules.habitabilityRepair;
    expect(rules.utilitiesHours).toBe(24);
    expect(rules.imminentHours).toBe(24);
    expect(rules.majorFixtureHours).toBe(72);
    expect(rules.otherHours).toBe(240);
    expect(habitabilityRepairWindow('washington_state', 'utilities').hours).toBe(24);
    expect(habitabilityRepairWindow('washington_state', 'major_fixture').label).toBe('72 hours');
    expect(habitabilityRepairWindow('washington_state', 'other').label).toBe('10 days');
  });

  test('Seattle inherits the same repair windows', () => {
    expect(habitabilityRepairWindow('seattle', 'utilities').hours).toBe(24);
    expect(habitabilityRepairWindow('seattle', 'other').hours).toBe(240);
  });

  test('stub issue types map onto statute buckets', () => {
    expect(normalizeHabitabilityIssueType('emergency')).toBe('imminent');
    expect(normalizeHabitabilityIssueType('repair')).toBe('other');
    expect(normalizeHabitabilityIssueType('health_hazard')).toBe('imminent');
  });

  test('reference deadline uses whole days from the hour window', () => {
    expect(habitabilityReferenceDeadline('2026-09-01', 24)).toBe('2026-09-02');
    expect(habitabilityReferenceDeadline('2026-09-01', 72)).toBe('2026-09-04');
    expect(habitabilityReferenceDeadline('2026-09-01', 240)).toBe('2026-09-11');
  });

  test('citations resolve RCW 59.18.070', () => {
    const ids = getRuleCitations('washington_state', 'habitability').map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['RCW_59.18.060', 'RCW_59.18.070']));
  });

  test('fingerprint changes when type, date, description, or work order changes', () => {
    const base = {
      lease_id: 9,
      issue_type: 'utilities',
      reported_date: '2026-09-01',
      issue_description: 'No hot water',
      maintenance_request_id: 4,
      outcome_notes: 'Plumber dispatched',
    };
    expect(habitabilityRecordFingerprint(base)).not.toBe(
      habitabilityRecordFingerprint({ ...base, issue_type: 'other' })
    );
    expect(habitabilityRecordFingerprint(base)).not.toBe(
      habitabilityRecordFingerprint({ ...base, reported_date: '2026-09-02' })
    );
    expect(habitabilityRecordFingerprint(base)).not.toBe(
      habitabilityRecordFingerprint({ ...base, issue_description: 'No heat' })
    );
    expect(habitabilityRecordFingerprint(base)).not.toBe(
      habitabilityRecordFingerprint({ ...base, maintenance_request_id: 8 })
    );
  });

  test('worksheet lines include issue, window, work order, and no pack jargon', () => {
    const lines = buildHabitabilityRecordLines({
      tenantNames: 'Ada Lovelace',
      propertyName: 'Pine Court',
      unitNumber: 'B',
      issueTypeLabel: 'Heat, hot water, or electricity',
      reportedDateLabel: '09/01/2026',
      repairWindowLabel: '24 hours',
      deadlineLabel: '09/02/2026',
      issueDescription: 'No hot water since morning.',
      maintenanceRequestLabel: 'No hot water — In Progress — 09/01/2026',
      outcomeNotes: 'Plumber scheduled.',
    });
    expect(lines).toContain('To: Ada Lovelace');
    expect(lines).toContain('Unit: B');
    expect(lines).toContain('Issue: Heat, hot water, or electricity');
    expect(lines).toContain('Commence remedial action within: 24 hours');
    expect(lines).toContain('No hot water since morning.');
    expect(lines).toContain('Linked work order: No hot water — In Progress — 09/01/2026');
    expect(lines).toContain('Outcome: Plumber scheduled.');
    expect(lines.some((l) => l.toLowerCase().includes('pack'))).toBe(false);
    expect(lines.join(' ')).not.toMatch(/request_id|#\d+/);
  });

  test('work-order labels omit internal ids', () => {
    expect(
      maintenanceRequestOptionLabel(
        { request_id: 99, description: 'Leaky faucet', status: 'New' },
        '09/01/2026'
      )
    ).toBe('Leaky faucet — New — 09/01/2026');
    expect(formatRepairWindowLabel(240)).toBe('10 days');
  });
});
