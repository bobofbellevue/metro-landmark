/**
 * Derive brand text fields from a product display name.
 * Shared by client (`src/config/brand.js`) and server (`api/`).
 */

export const DEFAULT_PRODUCT_NAME = 'Metro Landmark';

/** Known historical localStorage keys to migrate from when the product name changes. */
export const LEGACY_AUTH_STORAGE_KEYS = [
  'salish_landmark_user',
  'metro_landmark_user',
];

/**
 * @param {string} productName
 * @returns {string}
 */
export function slugifyProductName(productName) {
  return String(productName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'metro_landmark';
}

/**
 * @param {string} [productName]
 * @returns {{
 *   productName: string,
 *   productHeading: string,
 *   productStackedLine1: string,
 *   productStackedLine2: string,
 *   referenceOperatorName: string,
 *   authStorageKey: string,
 *   logoAlt: string,
 * }}
 */
export function deriveBrandFromProductName(productName) {
  const name = String(productName || '').trim() || DEFAULT_PRODUCT_NAME;
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0] || 'Metro';
  const rest = words.slice(1).join(' ') || 'Landmark';

  return {
    productName: name,
    productHeading: `${first.toUpperCase()} ${rest}`.trim(),
    productStackedLine1: first.toUpperCase(),
    productStackedLine2: rest,
    referenceOperatorName: name,
    authStorageKey: `${slugifyProductName(name)}_user`,
    logoAlt: `${name} logo`,
  };
}

/**
 * Parse a brand asset env value.
 *
 * Expected JSON (alt objects optional):
 *   {"logo":[{"path":"/brand/foo.svg"},{"alt":"Totem Pole"}]}
 *   {"background":[{"path":"/brand/foo.jpg"},{"alt":"Longhouse"}]}
 *
 * Path and alt may be on the same array item or separate items.
 *
 * @param {string | null | undefined} raw
 * @param {'logo' | 'background'} rootKey
 * @returns {{ path?: string, alt?: string }}
 */
export function parseBrandAssetEnv(raw, rootKey) {
  if (raw == null) return {};
  let text = String(raw).trim();
  if (!text) return {};

  // Strip a single layer of wrapping quotes from some env UIs / shells.
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    text = text.slice(1, -1).trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const items = parsed[rootKey];
  if (!Array.isArray(items)) return {};

  let path;
  let alt;
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item.path != null && String(item.path).trim() !== '') {
      path = String(item.path).trim();
    }
    if (item.alt != null && String(item.alt).trim() !== '') {
      alt = String(item.alt).trim();
    }
  }

  const result = {};
  if (path) result.path = path;
  if (alt) result.alt = alt;
  return result;
}

/**
 * Build the full brand identity from env-like values.
 * Primary knobs: VITE_PRODUCT_NAME, VITE_LOGO, VITE_BACKGROUND.
 * Optional escape hatches override derived text fields when non-empty.
 *
 * @param {Record<string, string | undefined | null>} [raw]
 * @param {{ defaultLogoUrl?: string, defaultBackgroundUrl?: string }} [defaults]
 */
export function resolveBrandConfig(raw = {}, defaults = {}) {
  const productName =
    firstNonEmpty(raw.productName, raw.VITE_PRODUCT_NAME, raw.PRODUCT_NAME) ||
    DEFAULT_PRODUCT_NAME;
  const derived = deriveBrandFromProductName(productName);

  const logoAsset = parseBrandAssetEnv(
    firstNonEmpty(raw.VITE_LOGO, raw.logoJson),
    'logo'
  );
  const backgroundAsset = parseBrandAssetEnv(
    firstNonEmpty(raw.VITE_BACKGROUND, raw.backgroundJson),
    'background'
  );

  return {
    ...derived,
    productHeading:
      firstNonEmpty(raw.productHeading, raw.VITE_PRODUCT_HEADING) ||
      derived.productHeading,
    productStackedLine1:
      firstNonEmpty(raw.productStackedLine1, raw.VITE_PRODUCT_STACKED_LINE1) ||
      derived.productStackedLine1,
    productStackedLine2:
      firstNonEmpty(raw.productStackedLine2, raw.VITE_PRODUCT_STACKED_LINE2) ||
      derived.productStackedLine2,
    referenceOperatorName:
      firstNonEmpty(
        raw.referenceOperatorName,
        raw.VITE_REFERENCE_OPERATOR_NAME,
        raw.REFERENCE_OPERATOR_NAME
      ) || derived.referenceOperatorName,
    authStorageKey:
      firstNonEmpty(raw.authStorageKey, raw.VITE_AUTH_STORAGE_KEY) ||
      derived.authStorageKey,
    logoAlt:
      firstNonEmpty(raw.logoAlt, logoAsset.alt, raw.VITE_LOGO_ALT) ||
      derived.logoAlt,
    logoUrl:
      firstNonEmpty(raw.logoUrl, logoAsset.path) || defaults.defaultLogoUrl,
    backgroundUrl:
      firstNonEmpty(raw.backgroundUrl, backgroundAsset.path) ||
      defaults.defaultBackgroundUrl,
    backgroundAlt: firstNonEmpty(raw.backgroundAlt, backgroundAsset.alt) || '',
  };
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return undefined;
}
