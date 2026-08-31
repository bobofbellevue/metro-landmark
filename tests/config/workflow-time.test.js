import {
  formatWorkflowTimeForLocale,
  toWorkflowTimeValue,
} from '../../src/utils/workflow-time.js';

describe('workflow time helpers', () => {
  test('normalizes HTML time and legacy AM/PM strings', () => {
    expect(toWorkflowTimeValue('')).toBe('');
    expect(toWorkflowTimeValue('10:00')).toBe('10:00');
    expect(toWorkflowTimeValue('10:00:00')).toBe('10:00');
    expect(toWorkflowTimeValue('10:00 AM')).toBe('10:00');
    expect(toWorkflowTimeValue('10:00 PM')).toBe('22:00');
    expect(toWorkflowTimeValue('12:00 AM')).toBe('00:00');
    expect(toWorkflowTimeValue('12:00 PM')).toBe('12:00');
    expect(toWorkflowTimeValue('9:30 am')).toBe('09:30');
    expect(toWorkflowTimeValue('not a time')).toBe('');
  });

  test('formats for en-US display', () => {
    expect(formatWorkflowTimeForLocale('22:00', 'en-US')).toMatch(/10:00\s*PM/i);
    expect(formatWorkflowTimeForLocale('10:00 AM', 'en-US')).toMatch(/10:00\s*AM/i);
    expect(formatWorkflowTimeForLocale('', 'en-US')).toBe('');
  });
});
