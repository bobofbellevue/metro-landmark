/**
 * Server-side phone / telephony configuration.
 * Mirrors src/config/phones.js for Node / Vercel functions, plus Vapi ids.
 */
import {
  PHONE_PURPOSE_LIST,
  PHONE_PURPOSES,
} from '../../src/utils/phone-resource-resolve.js';
import { createSupabaseClient } from './supabase-client.js';

export { PHONE_PURPOSE_LIST, PHONE_PURPOSES };

/** Shared reference/dev VAPI number (Seattle 206). Override via env. */
export const DEFAULT_TENANT_MAINTENANCE_PHONE_E164 = '+12064017109';

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

export function toE164(raw) {
  if (raw == null || String(raw).trim() === '') return '';
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

export function formatPhoneDisplay(e164OrRaw) {
  const e164 = toE164(e164OrRaw);
  if (!e164) return '';
  const digits = e164.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return e164;
}

export function envPhoneForPurpose(purpose, env = process.env) {
  if (purpose === PHONE_PURPOSES.MARKETING) {
    return toE164(firstNonEmpty(env.MARKETING_PHONE, env.VITE_MARKETING_PHONE));
  }
  if (purpose === PHONE_PURPOSES.APPOINTMENTS) {
    return toE164(firstNonEmpty(env.APPOINTMENTS_PHONE, env.VITE_APPOINTMENTS_PHONE));
  }
  if (purpose === PHONE_PURPOSES.VENDOR_DISPATCH) {
    return toE164(
      firstNonEmpty(
        env.VENDOR_DISPATCH_PHONE,
        env.VITE_VENDOR_DISPATCH_PHONE,
        env.VAPI_PHONE_NUMBER,
        env.VITE_VAPI_PHONE_NUMBER
      )
    );
  }
  return toE164(
    firstNonEmpty(
      env.TENANT_MAINTENANCE_PHONE,
      env.VITE_TENANT_MAINTENANCE_PHONE,
      env.VOICE_BOT_PHONE,
      env.VITE_VOICE_BOT_PHONE,
      env.VAPI_PHONE_NUMBER,
      env.VITE_VAPI_PHONE_NUMBER
    )
  );
}

export function envPhoneMap(env = process.env) {
  const map = {};
  for (const item of PHONE_PURPOSE_LIST) {
    map[item.id] = envPhoneForPurpose(item.id, env);
  }
  return map;
}

/**
 * Public/tenant-facing maintenance number (E.164).
 * Prefers explicit tenant/voice env, then VAPI_PHONE_NUMBER, then default.
 */
export function getTenantMaintenancePhoneE164() {
  return (
    envPhoneForPurpose(PHONE_PURPOSES.TENANT_MAINTENANCE) ||
    DEFAULT_TENANT_MAINTENANCE_PHONE_E164
  );
}

/**
 * Vapi outbound caller-id phone number (E.164), if configured.
 * Distinct from VAPI_PHONE_NUMBER_ID (UUID resource id in Vapi dashboard).
 */
export function getVapiPhoneNumberE164() {
  return toE164(
    firstNonEmpty(
      process.env.VAPI_PHONE_NUMBER,
      process.env.VITE_VAPI_PHONE_NUMBER,
      getTenantMaintenancePhoneE164()
    )
  );
}

/** Vapi phone number resource UUID (required for outbound API calls). */
export function getVapiPhoneNumberId() {
  return firstNonEmpty(process.env.VAPI_PHONE_NUMBER_ID) || null;
}

/**
 * Prefer a PMC vendor_dispatch (then tenant_maintenance) Vapi resource id.
 * Falls back to VAPI_PHONE_NUMBER_ID.
 *
 * @param {object} [supabase]
 * @param {number|null|undefined} pmcId
 * @returns {Promise<string|null>}
 */
export async function resolveOutboundVapiPhoneNumberId(supabase, pmcId) {
  const envId = getVapiPhoneNumberId();
  if (pmcId == null) return envId;
  let client = supabase;
  try {
    if (!client) client = createSupabaseClient();
    const { data, error } = await client
      .from('phone_resources')
      .select('purpose, vapi_phone_number_id, pmc_id, is_active')
      .eq('is_active', true)
      .in('purpose', [
        PHONE_PURPOSES.VENDOR_DISPATCH,
        PHONE_PURPOSES.TENANT_MAINTENANCE,
      ])
      .or(`pmc_id.eq.${pmcId},pmc_id.is.null`)
      .not('vapi_phone_number_id', 'is', null);
    if (error || !data?.length) return envId;
    const prefer = (purpose, wantPmc) =>
      data.find(
        (row) =>
          row.purpose === purpose &&
          (wantPmc ? Number(row.pmc_id) === Number(pmcId) : row.pmc_id == null) &&
          row.vapi_phone_number_id
      );
    const row =
      prefer(PHONE_PURPOSES.VENDOR_DISPATCH, true) ||
      prefer(PHONE_PURPOSES.TENANT_MAINTENANCE, true) ||
      prefer(PHONE_PURPOSES.VENDOR_DISPATCH, false) ||
      prefer(PHONE_PURPOSES.TENANT_MAINTENANCE, false);
    return row?.vapi_phone_number_id || envId;
  } catch {
    return envId;
  }
}

export const phones = {
  tenantMaintenanceE164: getTenantMaintenancePhoneE164(),
  vapiPhoneNumberE164: getVapiPhoneNumberE164(),
  vapiPhoneNumberId: getVapiPhoneNumberId(),
};
