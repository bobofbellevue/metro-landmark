/**
 * Official rent-increase form referrals for template-less notices.
 * The statutory form lives in RCW 59.18.720; Commerce hosts sample PDFs.
 * This worksheet must not be served as the notice.
 */

/**
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function wrapNoticeText(text, maxChars = 88) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (raw.length <= maxChars) return [raw];
  const words = raw.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (word.length > maxChars) {
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      current = '';
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * @param {{ officialFormUrls?: Array<{label?: string, href?: string}>, requiredNoticeLanguage?: string[], packDisplayName?: string }} resources
 * @returns {string[]}
 */
export function buildOfficialFormReferralLines(resources = {}) {
  const lines = [
    'This worksheet is not the statutory Washington rent-increase notice.',
    'RCW 59.18.720 requires a notice substantially the same as the state form.',
    'Do not serve this PDF as the notice. Fill the official form using the figures above.',
    '',
  ];
  const urls = Array.isArray(resources.officialFormUrls)
    ? resources.officialFormUrls
    : [];
  if (urls.length) {
    lines.push('Official forms and guidance:');
    for (const entry of urls) {
      if (entry.label) lines.push(...wrapNoticeText(entry.label));
      if (entry.href) lines.push(...wrapNoticeText(entry.href));
    }
    lines.push('');
  }
  const required = Array.isArray(resources.requiredNoticeLanguage)
    ? resources.requiredNoticeLanguage
    : [];
  if (required.length) {
    const where = resources.packDisplayName
      ? `${resources.packDisplayName} required language (include on the official form):`
      : 'Required local language (include on the official form):';
    lines.push(...wrapNoticeText(where));
    for (const paragraph of required) {
      lines.push(...wrapNoticeText(paragraph));
    }
  }
  return lines;
}
