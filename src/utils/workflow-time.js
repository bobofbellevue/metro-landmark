/**
 * Workflow time helpers. Native <input type="time"> uses HH:MM (24-hour).
 * Stored values may still be older free-text like "10:00 AM".
 */

/**
 * @param {string|null|undefined} value
 * @returns {string} HH:MM or ''
 */
export function toWorkflowTimeValue(value) {
  if (value == null) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return '';

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3] ? match[3].toUpperCase() : '';

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';
  if (minute < 0 || minute > 59) return '';

  if (meridiem === 'AM') {
    if (hour === 12) hour = 0;
  } else if (meridiem === 'PM') {
    if (hour !== 12) hour += 12;
  }

  if (hour < 0 || hour > 23) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Locale display for a stored workflow time (HH:MM or legacy "10:00 AM").
 * @param {string|null|undefined} value
 * @param {string} [locale]
 * @returns {string}
 */
export function formatWorkflowTimeForLocale(value, locale = 'en-US') {
  const hhmm = toWorkflowTimeValue(value);
  if (!hhmm) return '';
  const [hour, minute] = hhmm.split(':').map(Number);
  const date = new Date(1970, 0, 1, hour, minute);
  return date.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  });
}
