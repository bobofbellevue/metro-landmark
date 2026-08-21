/* eslint-env node */
/**
 * Phone number resources and IVR purposes.
 *
 * GET    /api/phone-resources
 * PUT    /api/phone-resources   company_admin / global_admin
 * DELETE /api/phone-resources?purpose=...
 */
import { createSupabaseClient } from './utils/supabase-client.js';
import { applyCors } from './utils/cors.js';
import { requireSessionUser, sendAuthError } from './utils/session.js';
import {
  DEFAULT_TENANT_MAINTENANCE_PHONE_E164,
  envPhoneMap,
  getVapiPhoneNumberId,
  toE164,
} from './utils/phones.js';
import {
  PHONE_PURPOSE_LIST,
  isPhonePurpose,
  normalizeVapiPhoneNumberId,
  publicPhoneResource,
  resolveAllPhoneResources,
} from '../src/utils/phone-resource-resolve.js';

function canEditPhones(role) {
  return role === 'company_admin' || role === 'global_admin';
}

async function pmcIdFromTenant(supabase, userId) {
  const { data: client } = await supabase
    .from('clients')
    .select('client_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!client?.client_id) return null;
  const { data: assignment } = await supabase
    .from('client_units')
    .select('unit_id')
    .eq('client_id', client.client_id)
    .eq('is_archived', false)
    .limit(1)
    .maybeSingle();
  if (!assignment?.unit_id) return null;
  const { data: unit } = await supabase
    .from('units')
    .select('property_id')
    .eq('unit_id', assignment.unit_id)
    .maybeSingle();
  if (!unit?.property_id) return null;
  const { data: property } = await supabase
    .from('properties')
    .select('pmc_id')
    .eq('property_id', unit.property_id)
    .maybeSingle();
  return property?.pmc_id ?? null;
}

async function loadResources(supabase, pmcId) {
  let query = supabase
    .from('phone_resources')
    .select(
      'phone_resource_id, pmc_id, purpose, e164, vapi_phone_number_id, label, is_active'
    )
    .eq('is_active', true);
  if (pmcId != null) {
    query = query.or(`pmc_id.eq.${pmcId},pmc_id.is.null`);
  } else {
    query = query.is('pmc_id', null);
  }
  const { data, error } = await query;
  if (error) {
    if (/phone_resources/i.test(error.message || '')) {
      return [];
    }
    throw error;
  }
  return data || [];
}

function payload(pmcId, resources, canEdit, scope) {
  const resolved = resolveAllPhoneResources({
    pmcId,
    resources,
    envByPurpose: envPhoneMap(process.env),
    defaultE164: DEFAULT_TENANT_MAINTENANCE_PHONE_E164,
    envVapiPhoneNumberId: getVapiPhoneNumberId(),
  });
  return {
    success: true,
    pmcId,
    scope,
    canEdit,
    purposes: PHONE_PURPOSE_LIST,
    resources: resources.map(publicPhoneResource),
    resolved,
  };
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
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

    const canEdit = canEditPhones(user.role);
    const wantSystem =
      (req.query?.scope === 'system' || req.body?.scope === 'system') &&
      user.role === 'global_admin';

    let pmcId = wantSystem ? null : user.pmc_id;
    if (pmcId == null && !wantSystem) {
      pmcId = await pmcIdFromTenant(supabase, user.user_id);
    }

    if (req.method === 'GET') {
      const resources = await loadResources(supabase, pmcId);
      res.status(200).json(payload(pmcId, resources, canEdit, wantSystem ? 'system' : 'company'));
      return;
    }

    if (!canEdit) {
      res.status(403).json({
        success: false,
        error: 'Company admin privileges required to edit phone numbers.',
      });
      return;
    }

    if (wantSystem) {
      pmcId = null;
    } else if (!user.pmc_id) {
      res.status(400).json({
        success: false,
        error: 'No PM company is assigned to this account.',
      });
      return;
    } else {
      pmcId = user.pmc_id;
    }

    const purpose = req.method === 'DELETE' ? req.query?.purpose : req.body?.purpose;
    if (!isPhonePurpose(purpose)) {
      res.status(400).json({
        success: false,
        error: 'A valid purpose is required.',
      });
      return;
    }

    const match = (query) => {
      if (pmcId == null) return query.is('pmc_id', null);
      return query.eq('pmc_id', pmcId);
    };

    if (req.method === 'DELETE' || req.body?.reset) {
      await match(
        supabase
          .from('phone_resources')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('purpose', purpose)
          .eq('is_active', true)
      );
      const resources = await loadResources(supabase, pmcId);
      res.status(200).json(payload(pmcId, resources, true, wantSystem ? 'system' : 'company'));
      return;
    }

    const e164 = toE164(req.body?.e164);
    if (!e164) {
      res.status(400).json({
        success: false,
        error: 'Phone number must be a valid E.164 value such as +12065551212.',
      });
      return;
    }

    const vapiRaw = req.body?.vapiPhoneNumberId ?? req.body?.vapi_phone_number_id;
    let vapiPhoneNumberId = null;
    if (vapiRaw != null && String(vapiRaw).trim() !== '') {
      vapiPhoneNumberId = normalizeVapiPhoneNumberId(vapiRaw);
      if (!vapiPhoneNumberId) {
        res.status(400).json({
          success: false,
          error:
            'Vapi phone number id must be a UUID from the Vapi dashboard, not the DID itself.',
        });
        return;
      }
    }

    const label =
      req.body?.label != null && String(req.body.label).trim() !== ''
        ? String(req.body.label).trim()
        : null;

    const { data: existing } = await match(
      supabase
        .from('phone_resources')
        .select('phone_resource_id')
        .eq('purpose', purpose)
        .eq('is_active', true)
    ).maybeSingle();

    const row = {
      pmc_id: pmcId,
      purpose,
      e164,
      vapi_phone_number_id: vapiPhoneNumberId,
      label,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    if (existing?.phone_resource_id) {
      const { error } = await supabase
        .from('phone_resources')
        .update(row)
        .eq('phone_resource_id', existing.phone_resource_id);
      if (error) {
        res.status(500).json({
          success: false,
          error: error.message || 'Failed to save phone number.',
        });
        return;
      }
    } else {
      const { error } = await supabase.from('phone_resources').insert(row);
      if (error) {
        res.status(500).json({
          success: false,
          error: error.message || 'Failed to save phone number.',
        });
        return;
      }
    }

    const resources = await loadResources(supabase, pmcId);
    res.status(200).json(payload(pmcId, resources, true, wantSystem ? 'system' : 'company'));
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load phone numbers',
    });
  }
}
