/**
 * Convert a date to an ordinal word for rent-due-day fields
 * (e.g. "2026-01-01" → "first", "2026-01-15" → "fifteenth").
 *
 * @param {string} dateString
 * @returns {string}
 */
export function convertDateToOrdinalWord(dateString) {
  if (!dateString) return '';

  let date;
  const raw = String(dateString);
  if (raw.includes('-')) {
    const parts = raw.split('-');
    if (parts.length >= 3) {
      // Support YYYY-MM-DD and MM-DD-YYYY
      if (parts[0].length === 4) {
        date = new Date(
          parseInt(parts[0], 10),
          parseInt(parts[1], 10) - 1,
          parseInt(parts[2], 10)
        );
      } else {
        date = new Date(
          parseInt(parts[2], 10),
          parseInt(parts[0], 10) - 1,
          parseInt(parts[1], 10)
        );
      }
    } else {
      date = new Date(raw);
    }
  } else {
    date = new Date(raw);
  }

  if (Number.isNaN(date.getTime())) return raw;

  const day = date.getDate();
  const month = date.getMonth();
  const year = date.getFullYear();
  const lastDay = new Date(year, month + 1, 0).getDate();

  if (day === 1) return 'first';
  if (day === lastDay) return 'last';

  const ordinals = {
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth',
    11: 'eleventh',
    12: 'twelfth',
    13: 'thirteenth',
    14: 'fourteenth',
    15: 'fifteenth',
    16: 'sixteenth',
    17: 'seventeenth',
    18: 'eighteenth',
    19: 'nineteenth',
    20: 'twentieth',
    21: 'twenty-first',
    22: 'twenty-second',
    23: 'twenty-third',
    24: 'twenty-fourth',
    25: 'twenty-fifth',
    26: 'twenty-sixth',
    27: 'twenty-seventh',
    28: 'twenty-eighth',
    29: 'twenty-ninth',
    30: 'thirtieth',
    31: 'thirty-first',
  };

  return (
    ordinals[day] ||
    `${day}${
      day === 1 || day === 21 || day === 31
        ? 'st'
        : day === 2 || day === 22
          ? 'nd'
          : day === 3 || day === 23
            ? 'rd'
            : 'th'
    }`
  );
}

/**
 * Human-readable lease term from start/end dates.
 * @param {string} startDate
 * @param {string|null|undefined} endDate
 * @returns {string}
 */
export function describeLeaseTerm(startDate, endDate) {
  if (!startDate) return '';
  if (!endDate) return 'Month-to-Month';

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';

  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (years > 0 && remainingMonths > 0) {
    return `${years} year${years > 1 ? 's' : ''} and ${remainingMonths} month${
      remainingMonths > 1 ? 's' : ''
    }`;
  }
  if (years > 0) {
    return `${years} year${years > 1 ? 's' : ''}`;
  }
  return `${months} month${months !== 1 ? 's' : ''}`;
}
