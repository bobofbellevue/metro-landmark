/**
 * Workflow date helpers for compliance date fields (effective dates, etc.).
 * HTML date inputs can emit intermediate years while typing (e.g. 0002, 0020, 0202).
 *
 * Calendar dates must stay on local Y/M/D parts. `new Date('YYYY-MM-DD')` is UTC
 * midnight and displays as the previous day west of UTC (03/01 → 02/28). Prefer
 * these helpers over Date.parse / toISOString().slice(0, 10) for notice math.
 */

export const WORKFLOW_DATE_MIN_YEAR = 1900;
export const WORKFLOW_DATE_MAX_YEAR = 2200;

/**
 * Parse a date string as local Y/M/D parts.
 * Accepts YYYY-MM-DD and MM-DD-YYYY (or MM/DD/YYYY).
 * @param {string} value
 * @returns {{ year: number, month: number, day: number } | null}
 */
export function parseWorkflowDateParts(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
    };
  }

  const us = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (us) {
    return {
      year: Number(us[3]),
      month: Number(us[1]),
      day: Number(us[2]),
    };
  }

  return null;
}

/**
 * True when value is a real calendar date with year in [1900, 2200].
 * @param {string} value
 * @returns {boolean}
 */
export function isCompleteWorkflowDate(value) {
  const parts = parseWorkflowDateParts(value);
  if (!parts) return false;
  const { year, month, day } = parts;
  if (year < WORKFLOW_DATE_MIN_YEAR || year > WORKFLOW_DATE_MAX_YEAR) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * Normalize a date input value for workflow state.
 * Returns '' for empty, the value when complete/valid, or null when incomplete/out of range
 * (caller should ignore null and keep previous / not update).
 * @param {string} value - typically from <input type="date">
 * @returns {string|null}
 */
export function sanitizeWorkflowDateInput(value) {
  if (!value) return '';
  const parts = parseWorkflowDateParts(value);
  if (!parts) return null;
  if (parts.year < WORKFLOW_DATE_MIN_YEAR || parts.year > WORKFLOW_DATE_MAX_YEAR) {
    return null;
  }
  if (!isCompleteWorkflowDate(value)) return null;
  // Prefer ISO for storage when input was ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    const m = String(parts.month).padStart(2, '0');
    const d = String(parts.day).padStart(2, '0');
    return `${parts.year}-${m}-${d}`;
  }
  return value.trim();
}

/**
 * Format a workflow date for display using a locale (defaults to en-US).
 * @param {string} value
 * @param {string} [locale]
 * @returns {string}
 */
export function formatWorkflowDateForLocale(value, locale = 'en-US') {
  const parts = parseWorkflowDateParts(value);
  if (!parts || !isCompleteWorkflowDate(value)) return '';
  const date = new Date(parts.year, parts.month - 1, parts.day);
  try {
    return date.toLocaleDateString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    const m = String(parts.month).padStart(2, '0');
    const d = String(parts.day).padStart(2, '0');
    return `${m}/${d}/${parts.year}`;
  }
}

/**
 * Add calendar days to a YYYY-MM-DD workflow date (timezone-safe).
 * @param {string} isoDate
 * @param {number} days
 * @returns {string}
 */
export function addDaysToWorkflowDate(isoDate, days) {
  if (!isCompleteWorkflowDate(isoDate)) return '';
  const parts = parseWorkflowDateParts(isoDate);
  const d = new Date(parts.year, parts.month - 1, parts.day);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Add calendar months to a YYYY-MM-DD workflow date (timezone-safe).
 * @param {string} isoDate
 * @param {number} months
 * @returns {string}
 */
export function addMonthsToWorkflowDate(isoDate, months) {
  if (!isCompleteWorkflowDate(isoDate)) return '';
  const parts = parseWorkflowDateParts(isoDate);
  const d = new Date(parts.year, parts.month - 1, parts.day);
  d.setMonth(d.getMonth() + months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Today's date as YYYY-MM-DD in the local timezone (not UTC).
 * @param {Date} [now]
 * @returns {string}
 */
export function todayWorkflowDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * First calendar day of the month after `now`.
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD
 */
export function firstOfNextMonth(now = new Date()) {
  const today = todayWorkflowDate(now);
  const parts = parseWorkflowDateParts(today);
  if (!parts) return '';
  const firstOfThisMonth = `${parts.year}-${String(parts.month).padStart(2, '0')}-01`;
  return addMonthsToWorkflowDate(firstOfThisMonth, 1);
}

/**
 * Calendar date as a local midnight Date. Never use `new Date('YYYY-MM-DD')`
 * (UTC midnight, which shifts a day west of UTC).
 * @param {string|Date|null|undefined} value
 * @returns {Date|null}
 */
export function workflowDateToLocalDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const iso = toWorkflowDateString(value);
  const parts = parseWorkflowDateParts(iso);
  if (!parts || !isCompleteWorkflowDate(iso)) return null;
  return new Date(parts.year, parts.month - 1, parts.day);
}

/**
 * Whole calendar days from start to end (YYYY-MM-DD or parseable workflow dates).
 * Positive when end is after start. Uses UTC-from-parts so DST does not skew the count.
 * @param {string|Date} start
 * @param {string|Date} end
 * @returns {number|null}
 */
export function calendarDaysBetween(start, end) {
  const a = parseWorkflowDateParts(toWorkflowDateString(start));
  const b = parseWorkflowDateParts(toWorkflowDateString(end));
  if (!a || !b) return null;
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / 86400000);
}

/**
 * Calendar days from today (local) until isoDate. Negative if the date is past.
 * @param {string|Date} isoDate
 * @param {Date} [now]
 * @returns {number|null}
 */
export function calendarDaysUntil(isoDate, now = new Date()) {
  return calendarDaysBetween(todayWorkflowDate(now), isoDate);
}

/**
 * Normalize a date-like value to YYYY-MM-DD using calendar parts
 * (avoids UTC day-shift from `new Date('YYYY-MM-DD').toISOString()`).
 * @param {string|Date|null|undefined} value
 * @returns {string}
 */
export function toWorkflowDateString(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return todayWorkflowDate(value);
  }
  const parts = parseWorkflowDateParts(String(value));
  if (!parts) return '';
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${parts.year}-${m}-${d}`;
}

/**
 * Format YYYY-MM-DD (or parseable workflow date) as MM-DD-YYYY without UTC shift.
 * @param {string} value
 * @returns {string}
 */
export function formatWorkflowDateMMDDYYYY(value) {
  const iso = toWorkflowDateString(value);
  const parts = parseWorkflowDateParts(iso);
  if (!parts) return '';
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${m}-${d}-${parts.year}`;
}

/**
 * Result of typing in an MM-DD-YYYY date field.
 * '' when cleared, normalized MM-DD-YYYY when complete, null while still editing.
 * @param {string} text
 * @returns {string|null}
 */
export function typedWorkflowDateDraft(text) {
  if (text == null) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return '';
  if (!isCompleteWorkflowDate(trimmed)) return null;
  return formatWorkflowDateMMDDYYYY(trimmed);
}

/**
 * Lease term length in months, counting from start through the day after end.
 * Example: 2025-09-01 → 2026-08-31 is 12 months (not 11).
 * @param {string} startDate
 * @param {string} endDate
 * @returns {number}
 */
export function leaseTermMonths(startDate, endDate) {
  if (!isCompleteWorkflowDate(startDate) || !isCompleteWorkflowDate(endDate)) {
    return 12;
  }
  const dayAfterEnd = addDaysToWorkflowDate(endDate, 1);
  const s = parseWorkflowDateParts(startDate);
  const a = parseWorkflowDateParts(dayAfterEnd);
  let months = (a.year - s.year) * 12 + (a.month - s.month);
  if (a.day < s.day) months -= 1;
  return months >= 1 ? months : 12;
}

/**
 * Suggest renewal end date: renewalStart + termMonths - 1 day.
 * Example: start 2026-09-01, 12-month term → 2027-08-31.
 * @param {string} renewalStartDate
 * @param {string} originalStartDate
 * @param {string} originalEndDate
 * @returns {string}
 */
export function suggestRenewalEndDate(
  renewalStartDate,
  originalStartDate,
  originalEndDate
) {
  if (!isCompleteWorkflowDate(renewalStartDate)) return '';
  const months = leaseTermMonths(originalStartDate, originalEndDate);
  return addDaysToWorkflowDate(
    addMonthsToWorkflowDate(renewalStartDate, months),
    -1
  );
}
