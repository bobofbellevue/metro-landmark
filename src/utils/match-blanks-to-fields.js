/**
 * Match geometrically detected blanks to template schema fields using
 * the label text around each blank (left and right context).
 */

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeLabel(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'of',
  'to',
  'in',
  'on',
  'a',
  'an',
  'is',
  'or',
  'by',
  'as',
  'at',
  'be',
  'this',
  'that',
  'with',
  'from',
  'his',
  'her',
  'any',
  'all',
  'will',
  'shall',
  'may',
  'not',
  'into',
  'made',
  'which',
  'being',
  'than',
  'one',
  'year',
  'agrees',
  'pay',
  'prior',
  'each',
  'given',
  'have',
  'no',
]);

/**
 * Exclusive cue phrases: if surrounding label text matches, boost listed field keys.
 * `exclusive: true` also penalizes fields that don't match the boost list.
 */
const CUE_RULES = [
  {
    re: /agreement\s+dated|dated$/i,
    boost: ['agreement_date', 'date_of_agreement'],
    exclusive: true,
  },
  {
    re: /entered into between/i,
    boost: ['lessor', 'landlord'],
    exclusive: true,
  },
  {
    re: /lessor.?s?\s*broker|broker.+\band\b|\band$/i,
    boost: ['tenant', 'lessee', 'lessor_broker'],
    exclusive: false,
  },
  {
    re: /broker”?\s*and$|broker"\s*and$/i,
    boost: ['tenant', 'lessee'],
    exclusive: true,
  },
  {
    re: /commonly known as/i,
    boost: ['property_known', 'known_as', 'property_address', 'property'],
    exclusive: true,
  },
  {
    re: /(^|\s)in(\s|$)/i,
    boost: ['county', 'city'],
    exclusive: true,
    leftOnly: true,
    leftRe: /^in$/i,
  },
  {
    re: /receipt from tenant of the sum of|sum of$/i,
    boost: ['security_deposit_amount', 'security_deposit', 'deposit_amount'],
    exclusive: false,
  },
  {
    re: /deposited in a trust account|trust account in/i,
    boost: ['bank', 'depository', 'security_deposit_bank'],
    exclusive: true,
  },
  {
    re: /term of$/i,
    boost: ['term_lease_length', 'lease_length', 'term_length', 'length'],
    exclusive: true,
  },
  {
    re: /commencing on$/i,
    boost: ['start_date', 'commencement', 'term_lease_start', 'begin'],
    exclusive: true,
  },
  {
    re: /end at midnight on|shall end/i,
    boost: ['end_date', 'termination', 'term_lease_end'],
    exclusive: true,
  },
  {
    re: /the rent is$/i,
    boost: ['rent_amount', 'monthly_rent', 'rent'],
    exclusive: true,
  },
  {
    re: /on or before the|day of each month/i,
    boost: ['due_date', 'rent_due', 'rent_day'],
    exclusive: true,
  },
  {
    re: /utilities|except:/i,
    boost: ['utilities', 'excluded'],
    exclusive: true,
  },
  {
    re: /named persons|private residence only|occupancy|subletting/i,
    boost: ['occupancy', 'persons', 'occupants', 'sublet'],
    exclusive: true,
  },
  {
    re: /late charge|delinquent/i,
    boost: ['late_charge', 'late'],
    exclusive: true,
  },
  {
    re: /\bnsf\b|returned check|dishonored|insufficient funds|nsf check/i,
    boost: ['nsf'],
    exclusive: true,
  },
  {
    re: /nonrefundable/i,
    boost: ['nonrefundable', 'fee'],
    exclusive: true,
  },
  {
    re: /lead.?based|paint disclosure/i,
    boost: ['lead', 'paint', 'disclosure'],
    exclusive: true,
  },
];

function pathMatchesBoost(pathKey, boost) {
  if (pathKey === boost) return true;
  if (pathKey.includes(boost)) return true;
  const parts = boost.split('_').filter(Boolean);
  if (parts.length > 1 && parts.every((p) => pathKey.includes(p))) return true;
  return false;
}

/**
 * Prefer real fill-in geometry over end-of-sentence trailing margins.
 * @param {{ kind?: string, rightLabel?: string, widthPdf?: number }} blank
 * @returns {number}
 */
export function blankGeometryBonus(blank) {
  const kind = blank?.kind || '';
  const right = String(blank?.rightLabel || '');
  let bonus = 0;
  if (kind === 'next_line' || right === '[next-line]') bonus += 8;
  if (kind === 'underscore' || right === '[underscore]') bonus += 6;
  if (kind === 'mid_gap') bonus += 4;
  if (right === '[margin]' || kind === 'trailing') bonus -= 5;
  if (Number(blank?.widthPdf) >= 120) bonus += 1;
  if (Number(blank?.widthPdf) >= 200) bonus += 1;
  return bonus;
}

/**
 * @param {{ path: string, description?: string, type?: string }} field
 * @param {{ leftLabel: string, rightLabel?: string, page?: number, kind?: string, widthPdf?: number }} blank
 * @returns {number}
 */
export function scoreFieldBlankMatch(field, blank) {
  const path = String(field.path || '');
  const leaf = path.split('.').pop() || '';
  const desc = String(field.description || '');
  const pathKey = leaf.toLowerCase();
  const fieldTokens = new Set([
    ...tokenizeLabel(leaf.replace(/_/g, ' ')),
    ...tokenizeLabel(desc),
  ]);

  const left = String(blank.leftLabel || '').trim();
  const right = String(blank.rightLabel || '').trim();
  const rightForTokens =
    right === '[margin]' ||
    right === '[line#]' ||
    right === '[next-line]' ||
    right === '[underscore]'
      ? ''
      : right;
  const labelTokens = new Set([
    ...tokenizeLabel(left),
    ...tokenizeLabel(rightForTokens),
  ]);
  // Cues may appear on either side of an inline blank
  // ("a charge ____ of for each NSF check...")
  const labelBlob = `${left} ${rightForTokens}`.toLowerCase();

  let score = 0;

  for (const t of fieldTokens) {
    if (labelTokens.has(t)) score += 1;
  }

  let strongCue = false;
  for (const rule of CUE_RULES) {
    if (rule.leftOnly) {
      if (!rule.leftRe?.test(left)) continue;
    } else if (!rule.re.test(labelBlob) && !rule.re.test(left)) {
      continue;
    }
    let hit = false;
    for (const boost of rule.boost) {
      if (pathMatchesBoost(pathKey, boost)) {
        score += 12;
        hit = true;
        strongCue = true;
      }
    }
    if (rule.exclusive && !hit) {
      score -= 10;
    }
  }

  if (/due|day/.test(pathKey) && !/due|before|day of each/i.test(labelBlob)) {
    score -= 8;
  }
  if (
    /(rent_amount|monthly_rent|^rent$)/.test(pathKey) &&
    /the rent is/i.test(left)
  ) {
    score += 6;
  }
  if (
    /security_deposit_amount|deposit_amount/.test(pathKey) &&
    /sum of/i.test(left) &&
    /tenant/i.test(left)
  ) {
    score += 8;
  }
  if (
    /security_deposit_amount|deposit_amount/.test(pathKey) &&
    /broker the sum of|sales commission/i.test(left)
  ) {
    score -= 15;
  }
  if (/lessor_broker|broker/.test(pathKey) && /entered into between/i.test(left)) {
    score -= 12;
  }
  if (
    (/^lessor$|landlord/.test(pathKey) || pathKey.endsWith('.lessor')) &&
    /entered into between/i.test(left)
  ) {
    score += 6;
  }
  if (/initials/i.test(left) && !/initials/i.test(pathKey)) {
    score -= 12;
  }
  if (/agency disclosure/i.test(left) && !/lead|paint|disclosure/i.test(pathKey)) {
    score -= 12;
  }

  // NSF fee blank sits mid-clause: "charge ____ of for each NSF"
  if (
    /nsf/i.test(pathKey) &&
    /\bnsf\b|returned check|insufficient/i.test(labelBlob)
  ) {
    score += 4;
    if (blank.kind === 'mid_gap') score += 4;
  }

  // Occupancy / named-persons blanks belong on the next underline line
  if (
    /occupancy|persons|occupants|sublet/i.test(pathKey) &&
    /named persons|private residence|subletting/i.test(labelBlob)
  ) {
    score += 4;
    if (blank.kind === 'next_line' || blank.kind === 'underscore') score += 6;
    if (blank.kind === 'trailing' || right === '[margin]') score -= 8;
  }

  if (left.length >= 10) score += 1;
  if (left.length <= 2 && !/^in$/i.test(left)) score -= 6;

  score += blankGeometryBonus(blank);

  if (
    (blank.page === 0 || blank.page === undefined) &&
    /agreement_date|lessor$|tenant$|property_known|county|rent_amount|security_deposit/i.test(
      pathKey
    )
  ) {
    score += 2;
  }
  if (
    (blank.page ?? 0) > 0 &&
    /agreement_date|property_known|property_county/i.test(pathKey)
  ) {
    score -= 4;
  }

  void strongCue;
  return score;
}

/**
 * Greedy 1:1 assignment of blanks to fields.
 *
 * @param {Array<{ path: string, description?: string, type?: string }>} fields
 * @param {Array<{ page: number, xPx: number, yPx: number, leftLabel: string, rightLabel?: string, widthPdf?: number, kind?: string }>} blanks
 * @param {{ minScore?: number }} [opts]
 * @returns {Array<{ path: string, position: { page: number, x: number, y: number }, score: number, leftLabel: string }>}
 */
export function matchBlanksToFields(fields, blanks, opts = {}) {
  const minScore = opts.minScore ?? 10;
  const candidates = [];

  for (const field of fields || []) {
    for (const blank of blanks || []) {
      const score = scoreFieldBlankMatch(field, blank);
      if (score < minScore) continue;
      candidates.push({ field, blank, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedFields = new Set();
  const usedBlanks = new Set();
  const matches = [];

  for (const c of candidates) {
    const blankKey = `${c.blank.page}:${c.blank.xPx}:${c.blank.yPx}:${c.blank.kind || ''}`;
    if (usedFields.has(c.field.path) || usedBlanks.has(blankKey)) continue;
    usedFields.add(c.field.path);
    usedBlanks.add(blankKey);
    matches.push({
      path: c.field.path,
      position: {
        page: c.blank.page,
        x: c.blank.xPx,
        y: c.blank.yPx,
        space: 'image_2x',
      },
      score: c.score,
      leftLabel: c.blank.leftLabel,
      kind: c.blank.kind || null,
    });
  }

  return matches;
}
