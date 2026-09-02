import {
  buildScreeningDecisionLines,
  screeningDecisionFingerprint,
  screeningDecisionLabel,
} from '../../src/utils/screening-decision-record.js';

describe('screening decision worksheet', () => {
  test('labels decisions', () => {
    expect(screeningDecisionLabel('approved')).toBe('Approved');
    expect(screeningDecisionLabel('rejected')).toBe('Rejected');
    expect(screeningDecisionLabel('conditional')).toBe('Conditional');
  });

  test('fingerprint changes when the decision or reason changes', () => {
    const base = {
      application_id: 9,
      decision: 'approved',
      decision_reason: 'Meets income and history',
      meets_written_criteria: 'yes',
      written_criteria_notes: '3x rent',
    };
    expect(screeningDecisionFingerprint(base)).not.toBe(
      screeningDecisionFingerprint({ ...base, decision: 'rejected' })
    );
    expect(screeningDecisionFingerprint(base)).not.toBe(
      screeningDecisionFingerprint({ ...base, decision_reason: 'Other' })
    );
  });

  test('worksheet lines include the address when there is no unit name, and no pack jargon', () => {
    const lines = buildScreeningDecisionLines({
      applicantName: 'Sally Auburn',
      propertyName: 'Sally Auburn',
      unitOrAddress: '9 Oak Ave, Auburn',
      appliedDateLabel: '08/22/2026',
      jurisdictionName: 'City of Auburn',
      firstQualifiedApplicant: false,
      meetsWrittenCriteria: 'yes',
      decision: 'approved',
      decisionReason: 'Meets published criteria.',
      disclaimer: 'Not legal advice.',
    });
    expect(lines).toContain('Applicant: Sally Auburn');
    expect(lines).toContain('9 Oak Ave, Auburn');
    expect(lines.some((line) => /^Unit:/.test(line))).toBe(false);
    expect(lines).toContain('Jurisdiction: City of Auburn');
    expect(lines).toContain('Decision: Approved');
    expect(lines.some((line) => /first-qualified/i.test(line))).toBe(false);
    expect(lines.some((line) => line.toLowerCase().includes('pack'))).toBe(false);
    expect(lines.some((line) => line.toLowerCase().includes('math'))).toBe(false);
  });
});
