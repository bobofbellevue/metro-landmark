/**
 * Per-org chrome theme (roadmap E2).
 *
 * Deploy-wide product identity stays in env (`VITE_PRODUCT_NAME`, logo, login
 * background). After login, a PM company's stored theme restyles the existing
 * indigo Tailwind tokens and may override the sidebar logo.
 *
 * Stored shape on `pm_companies.theme` (JSONB):
 *   { primary: "#4f46e5", logoUrl: "/brand/acme.svg" | null }
 */

export const DEFAULT_ORG_PRIMARY = '#4f46e5';

export const ORG_INDIGO_STEPS = [
  '50',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '950',
];

/** Mix amounts toward white (50–500) or black (700–950); 600 is the primary. */
const SCALE_MIX = {
  50: { toward: 'white', amount: 0.92 },
  100: { toward: 'white', amount: 0.84 },
  200: { toward: 'white', amount: 0.68 },
  300: { toward: 'white', amount: 0.48 },
  400: { toward: 'white', amount: 0.24 },
  500: { toward: 'white', amount: 0.08 },
  600: { toward: 'white', amount: 0 },
  700: { toward: 'black', amount: 0.18 },
  800: { toward: 'black', amount: 0.36 },
  900: { toward: 'black', amount: 0.52 },
  950: { toward: 'black', amount: 0.68 },
};

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

/**
 * @param {unknown} raw
 * @returns {string | null} lowercase #rrggbb
 */
export function normalizePrimaryHex(raw) {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (!text) return null;
  if (text[0] !== '#') text = `#${text}`;
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    text = `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) return null;
  return text.toLowerCase();
}

/**
 * Same-origin path or http(s) URL. Rejects javascript:, data:, protocol-relative.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeLogoUrl(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  try {
    const parsed = new URL(text);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return text;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {{ primary: string, logoUrl: string | null } | null}
 */
export function parseStoredTheme(raw) {
  let value = raw;
  if (value == null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const primary = normalizePrimaryHex(value.primary);
  const logoUrl = normalizeLogoUrl(value.logoUrl ?? value.logo_url);
  if (!primary && !logoUrl) return null;
  return {
    primary: primary || DEFAULT_ORG_PRIMARY,
    logoUrl,
  };
}

/**
 * Form / API payload: always returns a complete theme object.
 * @param {unknown} raw
 * @returns {{ primary: string, logoUrl: string | null }}
 */
export function normalizeOrgTheme(raw) {
  return (
    parseStoredTheme(raw) || {
      primary: DEFAULT_ORG_PRIMARY,
      logoUrl: null,
    }
  );
}

export function canEditOrgTheme(role) {
  return role === 'company_admin' || role === 'global_admin';
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixRgb(from, toward, amount) {
  return {
    r: from.r + (toward.r - from.r) * amount,
    g: from.g + (toward.g - from.g) * amount,
    b: from.b + (toward.b - from.b) * amount,
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Build an indigo-like 50–950 scale with `primaryHex` as step 600.
 * @param {string} primaryHex
 * @returns {Record<string, string>}
 */
export function themeScaleFromPrimary(primaryHex) {
  const hex = normalizePrimaryHex(primaryHex) || DEFAULT_ORG_PRIMARY;
  const rgb = hexToRgb(hex);
  const scale = {};
  for (const step of ORG_INDIGO_STEPS) {
    const mix = SCALE_MIX[step];
    if (!mix || mix.amount === 0) {
      scale[step] = hex;
      continue;
    }
    const toward = mix.toward === 'black' ? BLACK : WHITE;
    scale[step] = rgbToHex(mixRgb(rgb, toward, mix.amount));
  }
  return scale;
}

function rootElement() {
  if (typeof document === 'undefined') return null;
  return document.documentElement;
}

/**
 * Override Tailwind indigo tokens on `:root` via `--org-indigo-*`.
 * @param {unknown} theme
 */
export function applyOrgTheme(theme) {
  const root = rootElement();
  if (!root) return;
  const parsed = parseStoredTheme(theme);
  if (!parsed) {
    clearOrgTheme();
    return;
  }
  const scale = themeScaleFromPrimary(parsed.primary);
  for (const step of ORG_INDIGO_STEPS) {
    root.style.setProperty(`--org-indigo-${step}`, scale[step]);
  }
  root.dataset.orgTheme = '1';
}

export function clearOrgTheme() {
  const root = rootElement();
  if (!root) return;
  for (const step of ORG_INDIGO_STEPS) {
    root.style.removeProperty(`--org-indigo-${step}`);
  }
  delete root.dataset.orgTheme;
}
