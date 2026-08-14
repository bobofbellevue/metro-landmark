import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
  parseWorkflowDateParts,
  sanitizeWorkflowDateInput,
  WORKFLOW_DATE_MAX_YEAR,
  WORKFLOW_DATE_MIN_YEAR,
} from '../../src/utils/workflow-date.js';

describe('workflow-date helpers', () => {
  test('rejects incomplete or out-of-range years while typing', () => {
    expect(isCompleteWorkflowDate('0002-11-01')).toBe(false);
    expect(isCompleteWorkflowDate('0020-11-01')).toBe(false);
    expect(isCompleteWorkflowDate('0202-11-01')).toBe(false);
    expect(isCompleteWorkflowDate('2026-11-01')).toBe(true);
    expect(isCompleteWorkflowDate('1899-11-01')).toBe(false);
    expect(isCompleteWorkflowDate('2201-11-01')).toBe(false);
    expect(isCompleteWorkflowDate('2026-02-30')).toBe(false);
  });

  test('sanitizeWorkflowDateInput ignores invalid years', () => {
    expect(sanitizeWorkflowDateInput('')).toBe('');
    expect(sanitizeWorkflowDateInput('0002-11-01')).toBe(null);
    expect(sanitizeWorkflowDateInput('20266-11-01')).toBe(null);
    expect(sanitizeWorkflowDateInput('2026-11-01')).toBe('2026-11-01');
  });

  test('formats for locale without timezone shift', () => {
    expect(parseWorkflowDateParts('2026-11-01')).toEqual({
      year: 2026,
      month: 11,
      day: 1,
    });
    expect(formatWorkflowDateForLocale('2026-11-01', 'en-US')).toBe('11/01/2026');
    expect(WORKFLOW_DATE_MIN_YEAR).toBe(1900);
    expect(WORKFLOW_DATE_MAX_YEAR).toBe(2200);
  });
});
