/**
 * Public brand configuration for the SPA.
 *
 * Primary operator knobs:
 *   VITE_PRODUCT_NAME / PRODUCT_NAME
 *   VITE_LOGO          JSON: {"logo":[{"path":"..."},{"alt":"..."}]}
 *   VITE_BACKGROUND    JSON: {"background":[{"path":"..."},{"alt":"..."}]}
 *
 * This endpoint parses asset JSON and returns flat fields the client merges
 * onto `brand` (plus optional text escape hatches when set).
 */
import {
  firstNonEmpty,
  parseBrandAssetEnv,
} from '../src/config/brand-derive.js';
import { applyCors } from './utils/cors.js';

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function buildPublicBrandConfig(env = process.env) {
  const logo = parseBrandAssetEnv(env.VITE_LOGO, 'logo');
  const background = parseBrandAssetEnv(env.VITE_BACKGROUND, 'background');

  const config = {
    productName: firstNonEmpty(env.VITE_PRODUCT_NAME, env.PRODUCT_NAME),
    logoUrl: logo.path,
    logoAlt: logo.alt,
    backgroundUrl: background.path,
    backgroundAlt: background.alt,
    // Optional escape hatches (omit from docs; still honored if set)
    productHeading: firstNonEmpty(env.VITE_PRODUCT_HEADING),
    productStackedLine1: firstNonEmpty(env.VITE_PRODUCT_STACKED_LINE1),
    productStackedLine2: firstNonEmpty(env.VITE_PRODUCT_STACKED_LINE2),
    referenceOperatorName: firstNonEmpty(
      env.VITE_REFERENCE_OPERATOR_NAME,
      env.REFERENCE_OPERATOR_NAME
    ),
    authStorageKey: firstNonEmpty(env.VITE_AUTH_STORAGE_KEY),
  };

  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value != null && value !== '')
  );
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return;
  }

  res.status(200).json(buildPublicBrandConfig(process.env));
}
