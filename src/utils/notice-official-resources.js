/**
 * Official rent-increase form referrals for template-less notices.
 * The statutory form lives in RCW 59.18.720; Commerce hosts sample PDFs.
 * This worksheet must not be served as the notice.
 */

import { DEFAULT_PRODUCT_NAME } from '../config/brand-derive.js';

/**
 * @param {string} [productName]
 * @returns {string}
 */
export function copyrightedFormsDisclaimer(productName) {
  const name = String(productName || '').trim() || DEFAULT_PRODUCT_NAME;
  return `${name} does not provide those copyrighted forms.`;
}

/**
 * One-line tenant-page disclaimer for the rent-increase worksheet.
 * @returns {string}
 */
export function simpleNoticeWorksheetDisclaimerLine() {
  return 'This worksheet is not the statutory notice. Official form required — see page 2.';
}

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
 * @param {{ requiredNoticeLanguage?: string[], packDisplayName?: string }} resources
 * @returns {string[]}
 */
export function buildRequiredNoticeLanguageLines(resources = {}) {
  const required = Array.isArray(resources.requiredNoticeLanguage)
    ? resources.requiredNoticeLanguage
    : [];
  if (!required.length) return [];
  const includeHeading = resources.includeHeading !== false;
  const where = resources.packDisplayName
    ? `${resources.packDisplayName} required language (include on the official form):`
    : 'Required local language (include on the official form):';
  const lines = includeHeading ? [...wrapNoticeText(where)] : [];
  for (const paragraph of required) {
    lines.push(...wrapNoticeText(paragraph));
  }
  return lines;
}

/**
 * @param {{
 *   officialFormUrls?: Array<{label?: string, href?: string}>,
 *   requiredNoticeLanguage?: string[],
 *   packDisplayName?: string,
 *   preferredLandlordAssociation?: object,
 *   productName?: string,
 *   includeRequiredLanguage?: boolean
 * }} resources
 * @returns {string[]}
 */
export function buildOfficialFormReferralLines(resources = {}) {
  const productName = resources.productName || DEFAULT_PRODUCT_NAME;
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
  const association = resources.preferredLandlordAssociation;
  if (association?.name) {
    lines.push(
      ...wrapNoticeText(
        association.recommendation ||
          `Recommended fillable templates: join ${association.name} and import their current forms.`
      )
    );
    lines.push(...wrapNoticeText(copyrightedFormsDisclaimer(productName)));
    if (association.membershipUrl) {
      lines.push(...wrapNoticeText(association.membershipUrl));
    }
    if (association.formsUrl && association.formsUrl !== association.membershipUrl) {
      lines.push(...wrapNoticeText(association.formsUrl));
    }
    lines.push('');
  }
  if (resources.includeRequiredLanguage !== false) {
    const requiredLines = buildRequiredNoticeLanguageLines(resources);
    if (requiredLines.length) {
      lines.push(...requiredLines);
    }
  }
  return lines;
}
