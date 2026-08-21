/* eslint-env node */
/**
 * Per-org chrome theme for the signed-in PMC.
 *
 * GET  /api/org-theme  — any authenticated user with a pmc_id
 * PUT  /api/org-theme  — company_admin / global_admin with a pmc_id
 *
 * Login / unauthenticated chrome stays deploy env brand (`/api/brand-config`).
 */
import { createSupabaseClient } from './utils/supabase-client.js';
import { applyCors } from './utils/cors.js';
import { requireSessionUser, sendAuthError } from './utils/session.js';
import {
  DEFAULT_ORG_PRIMARY,
  canEditOrgTheme,
  normalizeLogoUrl,
  normalizePrimaryHex,
  parseStoredTheme,
} from '../src/utils/org-theme.js';

export { canEditOrgTheme };

function publicThemePayload(company) {
  const theme = parseStoredTheme(company?.theme);
  return {
    success: true,
    pmcId: company?.pmc_id ?? null,
    companyName: company?.company_name ?? null,
    theme,
    defaults: { primary: DEFAULT_ORG_PRIMARY },
  };
}

async function loadCompany(supabase, pmcId) {
  const { data, error } = await supabase
    .from('pm_companies')
    .select('pmc_id, company_name, theme')
    .eq('pmc_id', pmcId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

function missingThemeColumn(error) {
  const message = String(error?.message || '');
  return /theme/i.test(message) && /column|schema cache|does not exist/i.test(message);
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET, PUT, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Database configuration error',
    });
    return;
  }

  try {
    const auth = await requireSessionUser(req, supabase);
    if (!auth.user) {
      sendAuthError(res, auth);
      return;
    }
    const user = auth.user;

    const canEdit = canEditOrgTheme(user.role);

    if (!user.pmc_id) {
      if (req.method === 'GET') {
        res.status(200).json({
          success: true,
          pmcId: null,
          companyName: null,
          theme: null,
          defaults: { primary: DEFAULT_ORG_PRIMARY },
          canEdit: false,
        });
        return;
      }
      res.status(400).json({
        success: false,
        error: 'No PM company is assigned to this account.',
      });
      return;
    }

    if (req.method === 'GET') {
      const company = await loadCompany(supabase, user.pmc_id);
      if (!company) {
        res.status(404).json({ success: false, error: 'PM company not found' });
        return;
      }
      res.status(200).json({
        ...publicThemePayload(company),
        canEdit,
      });
      return;
    }

    if (!canEdit) {
      res.status(403).json({
        success: false,
        error: 'Company admin privileges required to edit appearance.',
      });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let nextTheme = null;

    if (!body.reset) {
      const primary = normalizePrimaryHex(body.primary);
      if (body.primary != null && String(body.primary).trim() !== '' && !primary) {
        res.status(400).json({
          success: false,
          error: 'Primary color must be a hex value such as #4f46e5.',
        });
        return;
      }
      const logoRaw = body.logoUrl ?? body.logo_url;
      const logoUrl = normalizeLogoUrl(logoRaw);
      if (logoRaw != null && String(logoRaw).trim() !== '' && !logoUrl) {
        res.status(400).json({
          success: false,
          error:
            'Logo must be an https URL or a same-origin path starting with /.',
        });
        return;
      }
      nextTheme = {
        primary: primary || DEFAULT_ORG_PRIMARY,
        logoUrl,
      };
    }

    const { data, error } = await supabase
      .from('pm_companies')
      .update({ theme: nextTheme })
      .eq('pmc_id', user.pmc_id)
      .select('pmc_id, company_name, theme')
      .maybeSingle();

    if (error) {
      const hint = missingThemeColumn(error)
        ? ' Company theme column is missing. Run database migrations.'
        : '';
      res.status(500).json({
        success: false,
        error: `${error.message || 'Failed to save company theme.'}${hint}`,
      });
      return;
    }

    res.status(200).json({
      ...publicThemePayload(data),
      canEdit: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load company theme',
    });
  }
}
