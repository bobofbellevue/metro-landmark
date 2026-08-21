/* eslint-env node */
/**
 * Company-configurable payment types and methods.
 *
 * GET  /api/payment-catalog
 * POST /api/payment-catalog   { category: 'type'|'method', label, code? }
 */
import { createSupabaseClient } from './utils/supabase-client.js';
import { applyCors } from './utils/cors.js';
import { requireSessionUser, sendAuthError } from './utils/session.js';
import {
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  canEditPaymentCatalog,
  canViewPayments,
  catalogCodeFromLabel,
  isCatalogCode,
  mergePaymentCatalog,
} from '../src/utils/payments.js';

async function loadRows(supabase, pmcId) {
  let query = supabase
    .from('payment_catalog')
    .select(
      'payment_catalog_id, pmc_id, category, code, label, sort_order, is_active'
    )
    .eq('is_active', true);
  if (pmcId != null) {
    query = query.or(`pmc_id.eq.${pmcId},pmc_id.is.null`);
  } else {
    query = query.is('pmc_id', null);
  }
  const { data, error } = await query;
  if (error) {
    if (/payment_catalog/i.test(error.message || '')) return [];
    throw error;
  }
  return data || [];
}

function lists(rows) {
  return {
    types: mergePaymentCatalog(PAYMENT_TYPES, rows, 'type'),
    methods: mergePaymentCatalog(PAYMENT_METHODS, rows, 'method'),
  };
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!['GET', 'POST'].includes(req.method)) {
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
    if (!canViewPayments(user.role)) {
      res.status(403).json({ success: false, error: 'Payments are not available for this role.' });
      return;
    }

    const wantSystem =
      (req.query?.scope === 'system' || req.body?.scope === 'system') &&
      user.role === 'global_admin';
    const pmcId = wantSystem ? null : user.pmc_id;

    if (req.method === 'GET') {
      const rows = await loadRows(supabase, pmcId);
      res.status(200).json({
        success: true,
        canEdit: canEditPaymentCatalog(user.role),
        ...lists(rows),
      });
      return;
    }

    if (!canEditPaymentCatalog(user.role)) {
      res.status(403).json({
        success: false,
        error: 'Manager or company admin privileges are required to add types and methods.',
      });
      return;
    }
    if (!wantSystem && !user.pmc_id) {
      res.status(400).json({
        success: false,
        error: 'No PM company is assigned to this account.',
      });
      return;
    }

    const category = String(req.body?.category || '').trim();
    if (category !== 'type' && category !== 'method') {
      res.status(400).json({
        success: false,
        error: 'Category must be type or method.',
      });
      return;
    }
    const label = String(req.body?.label || '').trim();
    if (!label || label.length > 100) {
      res.status(400).json({
        success: false,
        error: 'A label is required (up to 100 characters).',
      });
      return;
    }
    const code =
      (req.body?.code && isCatalogCode(String(req.body.code).trim())
        ? String(req.body.code).trim()
        : catalogCodeFromLabel(label));
    if (!code) {
      res.status(400).json({
        success: false,
        error: 'Could not make a short code from that label.',
      });
      return;
    }

    const match = (query) => {
      if (pmcId == null) return query.is('pmc_id', null);
      return query.eq('pmc_id', pmcId);
    };
    const { data: existing } = await match(
      supabase
        .from('payment_catalog')
        .select('payment_catalog_id')
        .eq('category', category)
        .eq('code', code)
        .eq('is_active', true)
    ).maybeSingle();

    const row = {
      pmc_id: pmcId,
      category,
      code,
      label,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    if (existing?.payment_catalog_id) {
      const { error } = await supabase
        .from('payment_catalog')
        .update(row)
        .eq('payment_catalog_id', existing.payment_catalog_id);
      if (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to save.' });
        return;
      }
    } else {
      const { error } = await supabase.from('payment_catalog').insert(row);
      if (error) {
        res.status(500).json({
          success: false,
          error: /payment_catalog/i.test(error.message || '')
            ? 'The payment catalog table is not on this database yet. Run migration 018_payment_ledger_ux.sql.'
            : error.message || 'Failed to save.',
        });
        return;
      }
    }

    const rows = await loadRows(supabase, pmcId);
    res.status(200).json({
      success: true,
      code,
      label,
      category,
      canEdit: true,
      ...lists(rows),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load payment catalog',
    });
  }
}
