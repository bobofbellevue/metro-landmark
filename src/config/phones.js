/**
 * Phone / telephony configuration (Workstream 2).
 *
 * Current model: one shared VAPI.ai number for tenant maintenance (and
 * related voice) during development. Multi-number org/property resources
 * are Phase E (see METRO_LANDMARK_OSS_TRANSITION_PLAN §8).
 *
 * Override via Vercel / .env.local:
 *   VITE_TENANT_MAINTENANCE_PHONE=+12064017109
 *   VITE_VOICE_BOT_PHONE=+12064017109   (alias)
 *
 * Server-side outbound calling still uses VAPI_PHONE_NUMBER_ID (UUID) and
 * optional VAPI_PHONE_NUMBER (E.164) — see api/utils/phones.js.
 */

const env =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env
    : {};

/** Purpose ids for the future multi-number model */
export const PHONE_PURPOSES = Object.freeze({
  TENANT_MAINTENANCE: 'tenant_maintenance',
  VENDOR_DISPATCH: 'vendor_dispatch',
  MARKETING: 'marketing',
  APPOINTMENTS: 'appointments',
});

/**
 * Shared reference/dev VAPI number (Seattle 206).
 * Kept as the product default so the Salish Landmark reference deploy
 * continues to work without new env; Metro installs should override.
 */
export const DEFAULT_TENANT_MAINTENANCE_PHONE_E164 = '+12064017109';

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

/**
 * Normalize to E.164 when possible (US-centric for the reference number).
 * @param {string|null|undefined} raw
 * @returns {string} E.164 or empty string
 */
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

/**
 * Display format for US numbers: (206) 401-7109. Falls back to E.164.
 * @param {string|null|undefined} e164OrRaw
 * @returns {string}
 */
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

/** tel: href target */
export function toTelHref(e164OrRaw) {
  const e164 = toE164(e164OrRaw);
  return e164 ? `tel:${e164}` : '';
}

/**
 * Resolve the configured phone for a purpose.
 * Today only tenant_maintenance (and aliases) are wired; others fall through
 * to the same shared number so call sites can adopt purpose ids early.
 * @param {string} [purpose]
 * @returns {string} E.164 or empty
 */
export function getPhoneForPurpose(purpose = PHONE_PURPOSES.TENANT_MAINTENANCE) {
  const fromEnv = firstNonEmpty(
    env.VITE_TENANT_MAINTENANCE_PHONE,
    env.VITE_VOICE_BOT_PHONE,
    env.VITE_VAPI_PHONE_NUMBER
  );

  // All current purposes share the single VAPI number.
  void purpose;
  return toE164(fromEnv || DEFAULT_TENANT_MAINTENANCE_PHONE_E164);
}

/** Tenant-facing maintenance / voice-bot number (E.164). */
export function getTenantMaintenancePhoneE164() {
  return getPhoneForPurpose(PHONE_PURPOSES.TENANT_MAINTENANCE);
}

export const phones = {
  tenantMaintenanceE164: getTenantMaintenancePhoneE164(),
  tenantMaintenanceDisplay: formatPhoneDisplay(getTenantMaintenancePhoneE164()),
  tenantMaintenanceTelHref: toTelHref(getTenantMaintenancePhoneE164()),
};
