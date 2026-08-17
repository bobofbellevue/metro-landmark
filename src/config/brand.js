/**
 * Product brand configuration.
 *
 * Defaults: Metro Landmark. Operator rebrand (e.g. Salish Landmark reference
 * deploy) needs at most three env vars:
 *
 *   VITE_PRODUCT_NAME=Salish Landmark
 *   VITE_LOGO={"logo":[{"path":"/brand/salish-landmark-totem.svg"},{"alt":"Totem Pole"}]}
 *   VITE_BACKGROUND={"background":[{"path":"/brand/salish-landmark-background.jpg"},{"alt":"Longhouse"}]}
 *
 * Heading, stacked sidebar lines, auth storage key, and reference operator
 * label are derived from VITE_PRODUCT_NAME. Logo/background alt come from the
 * JSON when provided; otherwise logo alt falls back to "<product> logo".
 *
 * On Vercel, set those three in the dashboard (Production). The SPA also
 * fetches `/api/brand-config` at boot so request-time env values apply even
 * when they were not inlined into the client bundle at build time.
 *
 * Assets under public/brand/ (same-origin on Vercel):
 *   /brand/metro-landmark-logo.png
 *   /brand/metro-landmark-background.jpg
 *   /brand/salish-landmark-totem.svg
 *   /brand/salish-landmark-background.jpg
 *
 * Restart the Vite dev server after changing local VITE_* values.
 *
 * Per-org chrome (colors / optional sidebar logo) is stored on
 * `pm_companies.theme` and applied after login — see `src/utils/org-theme.js`.
 * That does not change the product name.
 */
import defaultBackground from '../assets/metro-landmark-background.jpg';
import defaultLogo from '../assets/metro-landmark-logo.png';
import {
  LEGACY_AUTH_STORAGE_KEYS,
  firstNonEmpty,
  resolveBrandConfig,
} from './brand-derive.js';

const env =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env
    : {};

export const brand = {
  ...resolveBrandConfig(env, {
    defaultLogoUrl: defaultLogo,
    defaultBackgroundUrl: defaultBackground,
  }),
};

/**
 * Merge sparse runtime overrides into the shared brand object.
 * Providing productName re-derives heading / stacked lines / alt / auth key /
 * reference operator (unless those keys are also present as escape hatches).
 *
 * @param {Record<string, string | null | undefined>} overrides
 */
export function applyBrandOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') return brand;

  const hasProductName = firstNonEmpty(overrides.productName) !== undefined;

  if (hasProductName) {
    const resolved = resolveBrandConfig(
      {
        productName: overrides.productName,
        productHeading: overrides.productHeading,
        productStackedLine1: overrides.productStackedLine1,
        productStackedLine2: overrides.productStackedLine2,
        referenceOperatorName: overrides.referenceOperatorName,
        authStorageKey: overrides.authStorageKey,
        logoAlt: overrides.logoAlt,
        logoUrl: firstNonEmpty(overrides.logoUrl) || brand.logoUrl,
        backgroundUrl:
          firstNonEmpty(overrides.backgroundUrl) || brand.backgroundUrl,
        backgroundAlt:
          firstNonEmpty(overrides.backgroundAlt) || brand.backgroundAlt,
        VITE_LOGO: overrides.VITE_LOGO,
        VITE_BACKGROUND: overrides.VITE_BACKGROUND,
      },
      {
        defaultLogoUrl: brand.logoUrl,
        defaultBackgroundUrl: brand.backgroundUrl,
      }
    );
    Object.assign(brand, resolved);
    return brand;
  }

  // Prefer structured asset JSON when present (from /api/brand-config passthrough).
  if (firstNonEmpty(overrides.VITE_LOGO) || firstNonEmpty(overrides.VITE_BACKGROUND)) {
    const resolved = resolveBrandConfig(
      {
        productName: brand.productName,
        productHeading: brand.productHeading,
        productStackedLine1: brand.productStackedLine1,
        productStackedLine2: brand.productStackedLine2,
        referenceOperatorName: brand.referenceOperatorName,
        authStorageKey: brand.authStorageKey,
        logoAlt: overrides.logoAlt,
        backgroundAlt: overrides.backgroundAlt,
        VITE_LOGO: overrides.VITE_LOGO,
        VITE_BACKGROUND: overrides.VITE_BACKGROUND,
        logoUrl: overrides.logoUrl,
        backgroundUrl: overrides.backgroundUrl,
      },
      {
        defaultLogoUrl: brand.logoUrl,
        defaultBackgroundUrl: brand.backgroundUrl,
      }
    );
    if (firstNonEmpty(overrides.VITE_LOGO)) {
      brand.logoUrl = resolved.logoUrl;
      brand.logoAlt = resolved.logoAlt;
    }
    if (firstNonEmpty(overrides.VITE_BACKGROUND)) {
      brand.backgroundUrl = resolved.backgroundUrl;
      brand.backgroundAlt = resolved.backgroundAlt;
    }
  }

  const patchKeys = [
    'productHeading',
    'productStackedLine1',
    'productStackedLine2',
    'referenceOperatorName',
    'authStorageKey',
    'logoAlt',
    'logoUrl',
    'backgroundUrl',
    'backgroundAlt',
  ];
  for (const key of patchKeys) {
    const next = firstNonEmpty(overrides[key]);
    if (next !== undefined) {
      brand[key] = next;
    }
  }
  return brand;
}

/**
 * Load brand overrides from the serverless config endpoint (Vercel / local API).
 * Failures are ignored so the build-time / default brand still works offline.
 */
export async function loadRuntimeBrandConfig() {
  try {
    const response = await fetch('/api/brand-config', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return brand;
    const data = await response.json();
    return applyBrandOverrides(data);
  } catch {
    return brand;
  }
}

function migrateAuthKeys(value) {
  localStorage.setItem(brand.authStorageKey, value);
  for (const key of LEGACY_AUTH_STORAGE_KEYS) {
    if (key !== brand.authStorageKey) {
      localStorage.removeItem(key);
    }
  }
}

/**
 * Read auth user JSON from localStorage, migrating known legacy keys if needed.
 */
export function readStoredAuthUser() {
  const current = localStorage.getItem(brand.authStorageKey);
  if (current) return current;

  for (const key of LEGACY_AUTH_STORAGE_KEYS) {
    if (key === brand.authStorageKey) continue;
    const legacy = localStorage.getItem(key);
    if (legacy) {
      migrateAuthKeys(legacy);
      return legacy;
    }
  }
  return null;
}

export function writeStoredAuthUser(userJson) {
  migrateAuthKeys(userJson);
}

export function clearStoredAuthUser() {
  localStorage.removeItem(brand.authStorageKey);
  for (const key of LEGACY_AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}
