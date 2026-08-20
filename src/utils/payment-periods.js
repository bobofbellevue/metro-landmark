/**
 * Lease-aligned rent (and other charge) periods.
 *
 * Periods follow the lease start day, not calendar month boundaries.
 * Example: start 2026-08-15 → 08-15 to 09-14, then 09-15 to 10-14.
 */
import {
  addDaysToWorkflowDate,
  formatWorkflowDateMMDDYYYY,
  isCompleteWorkflowDate,
  parseWorkflowDateParts,
  toWorkflowDateString,
  todayWorkflowDate,
} from './workflow-date.js';

const MAX_PERIODS = 48;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isoFromParts(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Add calendar months, clamping the day when the target month is shorter
 * (31 Jan + 1 month → 28/29 Feb).
 * @param {string} isoDate
 * @param {number} months
 * @returns {string}
 */
export function addMonthsClamped(isoDate, months) {
  const iso = toWorkflowDateString(isoDate);
  const parts = parseWorkflowDateParts(iso);
  if (!parts || !isCompleteWorkflowDate(iso)) return '';
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12; // 0-11
  const day = Math.min(parts.day, lastDayOfMonth(year, month + 1));
  return isoFromParts(year, month + 1, day);
}

/**
 * Inclusive period covering start through the day before the next anniversary.
 * @param {string} startIso
 * @returns {{ start: string, end: string }}
 */
export function periodFromStart(startIso) {
  const start = toWorkflowDateString(startIso);
  const nextStart = addMonthsClamped(start, 1);
  const end = addDaysToWorkflowDate(nextStart, -1);
  return { start, end };
}

export function formatPeriodRangeLabel(start, end) {
  const a = formatWorkflowDateMMDDYYYY(start);
  const b = formatWorkflowDateMMDDYYYY(end);
  if (!a && !b) return '';
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

function periodCovers(period, isoDate) {
  if (!period?.start || !period?.end) return false;
  const day = toWorkflowDateString(isoDate);
  return day >= period.start && day <= period.end;
}

function monthsBetween(startIso, endIso) {
  const a = parseWorkflowDateParts(startIso);
  const b = parseWorkflowDateParts(endIso);
  if (!a || !b) return 0;
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/**
 * Build anniversary periods from the lease start through the lease end
 * (or a year past today when the lease has no end).
 *
 * @param {object} lease
 * @param {{ today?: string, maxPeriods?: number }} [options]
 * @returns {Array<{ id: string, start: string, end: string, label: string, current: boolean }>}
 */
export function leaseAlignedPeriods(lease, options = {}) {
  const start = toWorkflowDateString(lease?.start_date || lease?.startDate);
  if (!isCompleteWorkflowDate(start)) return [];
  const today = toWorkflowDateString(options.today) || todayWorkflowDate();
  const leaseEnd = toWorkflowDateString(lease?.end_date || lease?.endDate);
  const maxPeriods = options.maxPeriods || MAX_PERIODS;

  const windowStart = addMonthsClamped(today, -12);
  let startIndex = Math.max(0, monthsBetween(start, windowStart));
  if (start > windowStart) startIndex = 0;

  let lastStart = addMonthsClamped(today, 12);
  if (isCompleteWorkflowDate(leaseEnd) && leaseEnd < lastStart) {
    lastStart = leaseEnd;
  }

  const periods = [];
  for (let i = startIndex; periods.length < maxPeriods; i += 1) {
    const periodStart = addMonthsClamped(start, i);
    if (!periodStart) break;
    if (periodStart > lastStart && periods.length > 0) break;
    const { end } = periodFromStart(periodStart);
    if (!end) break;
    periods.push({
      id: `${periodStart}_${end}`,
      start: periodStart,
      end,
      label: formatPeriodRangeLabel(periodStart, end),
      current: periodCovers({ start: periodStart, end }, today),
    });
    if (isCompleteWorkflowDate(leaseEnd) && end >= leaseEnd) break;
  }
  return periods;
}

/**
 * Period covering today, or the last period that started on or before today.
 * @param {Array<{ start: string, end: string, current?: boolean }>} periods
 * @param {string} [today]
 */
export function currentLeasePeriod(periods, today) {
  const list = Array.isArray(periods) ? periods : [];
  const marked = list.find((p) => p.current);
  if (marked) return marked;
  const day = toWorkflowDateString(today) || todayWorkflowDate();
  const started = [...list].reverse().find((p) => p.start && p.start <= day);
  return started || list[0] || null;
}

export function periodContainsToday(start, end, today) {
  return periodCovers({ start, end }, today || todayWorkflowDate());
}

/**
 * Default due date is the period start (the charge date for that interval).
 * @param {{ start?: string }|null} period
 * @param {string} [today]
 */
export function suggestedDueDate(period, today) {
  if (period?.start && isCompleteWorkflowDate(period.start)) return period.start;
  return toWorkflowDateString(today) || todayWorkflowDate();
}
