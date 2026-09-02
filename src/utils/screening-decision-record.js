/**
 * Screening decision worksheet (internal record of the application outcome).
 * Not an adverse-action notice and not a statutory form.
 */

const DECISION_LABELS = Object.freeze({
  approved: 'Approved',
  rejected: 'Rejected',
  conditional: 'Conditional',
});

/**
 * @param {string} [value]
 * @returns {string}
 */
export function screeningDecisionLabel(value) {
  const key = String(value || '').trim().toLowerCase();
  return DECISION_LABELS[key] || '';
}

/**
 * @param {object} [data]
 * @returns {string}
 */
export function screeningDecisionFingerprint(data = {}) {
  return [
    data.application_id,
    data.decision,
    String(data.decision_reason || '').trim(),
    data.meets_written_criteria || '',
    String(data.written_criteria_notes || '').trim(),
  ].join('|');
}

function yesNo(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'yes' || raw === 'true') return 'Yes';
  if (raw === 'no' || raw === 'false') return 'No';
  return '';
}

/**
 * Body lines for the screening decision worksheet PDF.
 * @param {object} data
 * @returns {string[]}
 */
export function buildScreeningDecisionLines(data = {}) {
  const lines = [
    `Applicant: ${data.applicantName || 'Applicant'}`,
    '',
    `Property: ${data.propertyName || 'N/A'}`,
  ];
  const place = String(data.unitOrAddress || '').trim();
  if (place) lines.push(place);
  if (data.appliedDateLabel) {
    lines.push(`Applied: ${data.appliedDateLabel}`);
  }
  if (data.jurisdictionName) {
    lines.push(`Jurisdiction: ${data.jurisdictionName}`);
  }
  if (data.firstQualifiedApplicant) {
    lines.push(
      'First-qualified: offer housing to the first pending applicant who meets the published written criteria.'
    );
  }
  const meets = yesNo(data.meetsWrittenCriteria);
  if (meets) {
    lines.push(`Meets written screening criteria: ${meets}`);
  }
  const criteria = String(data.writtenCriteriaNotes || '').trim();
  if (criteria) {
    lines.push('', 'Written criteria used:', criteria);
  }
  const decision = screeningDecisionLabel(data.decision) || String(data.decision || '').trim();
  if (decision) {
    lines.push('', `Decision: ${decision}`);
  }
  const reason = String(data.decisionReason || '').trim();
  if (reason) {
    lines.push('', 'Decision reason:', reason);
  }
  lines.push(
    '',
    'This worksheet records the screening decision. It is not an adverse-action notice or a statutory form.',
    '',
    data.disclaimer || 'Not legal advice.'
  );
  return lines;
}
