/**
 * Phone / telephony configuration.
 *
 * Deploy env still supplies a shared VAPI DID for tenant maintenance and
 * vendor dispatch. Per-org numbers and IVR purposes (roadmap E3) live in
 * `phone_resources` and are resolved at runtime via `/api/phone-resources`.
 *
 * Override via Vercel / .env.local:
 *   VITE_TENANT_MAINTENANCE_PHONE=+12064017109
 *   VITE_VOICE_BOT_PHONE=+12064017109   (alias)
 *   VITE_VENDOR_DISPATCH_PHONE=+1...     (optional; else shared voice DID)
 *   VITE_MARKETING_PHONE=+1...
 *   VITE_APPOINTMENTS_PHONE=+1...
 *
 * Server-side outbound calling still uses VAPI_PHONE_NUMBER_ID (UUID) unless
 * a phone_resources row stores a per-purpose Vapi resource id.
 */
import {
  PHONE_PURPOSE_LIST,
  PHONE_PURPOSES,
} from '../utils/phone-resource-resolve.js';

const env =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env
    : {};

export { PHONE_PURPOSE_LIST, PHONE_PURPOSES };

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

export function envPhoneForPurpose(purpose, source = env) {
  if (purpose === PHONE_PURPOSES.MARKETING) {
    return toE164(firstNonEmpty(source.VITE_MARKETING_PHONE, source.MARKETING_PHONE));
  }
  if (purpose === PHONE_PURPOSES.APPOINTMENTS) {
    return toE164(
      firstNonEmpty(source.VITE_APPOINTMENTS_PHONE, source.APPOINTMENTS_PHONE)
    );
  }
  if (purpose === PHONE_PURPOSES.VENDOR_DISPATCH) {
    return toE164(
      firstNonEmpty(
        source.VITE_VENDOR_DISPATCH_PHONE,
        source.VENDOR_DISPATCH_PHONE,
        source.VITE_VAPI_PHONE_NUMBER,
        source.VAPI_PHONE_NUMBER
      )
    );
  }
  return toE164(
    firstNonEmpty(
      source.VITE_TENANT_MAINTENANCE_PHONE,
      source.TENANT_MAINTENANCE_PHONE,
      source.VITE_VOICE_BOT_PHONE,
      source.VOICE_BOT_PHONE,
      source.VITE_VAPI_PHONE_NUMBER,
      source.VAPI_PHONE_NUMBER
    )
  );
}

/**
 * Env-only resolve (no PMC table). Used before `/api/phone-resources` loads
 * and as the deploy fallback.
 * @param {string} [purpose]
 * @returns {string} E.164 or empty
 */
export function getPhoneForPurpose(purpose = PHONE_PURPOSES.TENANT_MAINTENANCE) {
  const fromEnv = envPhoneForPurpose(purpose);
  if (fromEnv) return fromEnv;
  if (
    purpose === PHONE_PURPOSES.TENANT_MAINTENANCE ||
    purpose === PHONE_PURPOSES.VENDOR_DISPATCH
  ) {
    return DEFAULT_TENANT_MAINTENANCE_PHONE_E164;
  }
  return '';
}

/** Tenant-facing maintenance / voice-bot number (E.164). */
export function getTenantMaintenancePhoneE164() {
  return getPhoneForPurpose(PHONE_PURPOSES.TENANT_MAINTENANCE);
}

export function phoneView(e164OrRaw) {
  const e164 = toE164(e164OrRaw);
  return {
    e164,
    display: formatPhoneDisplay(e164),
    telHref: toTelHref(e164),
  };
}

export const phones = {
  tenantMaintenanceE164: getTenantMaintenancePhoneE164(),
  tenantMaintenanceDisplay: formatPhoneDisplay(getTenantMaintenancePhoneE164()),
  tenantMaintenanceTelHref: toTelHref(getTenantMaintenancePhoneE164()),
};
