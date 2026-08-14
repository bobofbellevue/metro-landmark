/**
 * Server-side phone / telephony configuration (Workstream 2).
 * Mirrors src/config/phones.js for Node / Vercel functions.
 */

export const PHONE_PURPOSES = Object.freeze({
  TENANT_MAINTENANCE: 'tenant_maintenance',
  VENDOR_DISPATCH: 'vendor_dispatch',
  MARKETING: 'marketing',
  APPOINTMENTS: 'appointments',
});

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

/**
 * Public/tenant-facing maintenance number (E.164).
 * Prefers explicit tenant/voice env, then VAPI_PHONE_NUMBER, then default.
 */
export function getTenantMaintenancePhoneE164() {
  return toE164(
    firstNonEmpty(
      process.env.TENANT_MAINTENANCE_PHONE,
      process.env.VITE_TENANT_MAINTENANCE_PHONE,
      process.env.VOICE_BOT_PHONE,
      process.env.VITE_VOICE_BOT_PHONE,
      process.env.VAPI_PHONE_NUMBER,
      process.env.VITE_VAPI_PHONE_NUMBER,
      DEFAULT_TENANT_MAINTENANCE_PHONE_E164
    )
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

export const phones = {
  tenantMaintenanceE164: getTenantMaintenancePhoneE164(),
  vapiPhoneNumberE164: getVapiPhoneNumberE164(),
  vapiPhoneNumberId: getVapiPhoneNumberId(),
};
