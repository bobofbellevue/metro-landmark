/**
 * Resolve a phone number resource for an IVR / telephony purpose (roadmap E3).
 *
 * Precedence:
 *   1. Active PMC row for the purpose
 *   2. Active deploy-wide (pmc_id null) row for the purpose
 *   3. Purpose-specific env
 *   4. Shared voice default for tenant_maintenance and vendor_dispatch only
 *
 * Marketing and appointments do not inherit the maintenance DID.
 */

export const PHONE_PURPOSES = Object.freeze({
  TENANT_MAINTENANCE: 'tenant_maintenance',
  VENDOR_DISPATCH: 'vendor_dispatch',
  MARKETING: 'marketing',
  APPOINTMENTS: 'appointments',
});

export const PHONE_PURPOSE_LIST = Object.freeze([
  {
    id: PHONE_PURPOSES.TENANT_MAINTENANCE,
    label: 'Tenant maintenance / voice bot',
    description:
      'Number tenants call for maintenance. Inbound Vapi assistant uses this DID.',
  },
  {
    id: PHONE_PURPOSES.VENDOR_DISPATCH,
    label: 'Vendor dispatch',
    description:
      'Outbound caller ID and Vapi phone-number resource when calling vendors.',
  },
  {
    id: PHONE_PURPOSES.MARKETING,
    label: 'Marketing',
    description: 'Listings and ads. Not used for maintenance voice.',
  },
  {
    id: PHONE_PURPOSES.APPOINTMENTS,
    label: 'Appointments',
    description: 'Showing and appointment callbacks.',
  },
]);

export const VOICE_FALLBACK_PURPOSES = new Set([
  PHONE_PURPOSES.TENANT_MAINTENANCE,
  PHONE_PURPOSES.VENDOR_DISPATCH,
]);

const VAPI_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPhonePurpose(value) {
  return PHONE_PURPOSE_LIST.some((item) => item.id === value);
}

export function normalizeVapiPhoneNumberId(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  return VAPI_UUID.test(text) ? text.toLowerCase() : null;
}

export function publicPhoneResource(row) {
  if (!row) return null;
  return {
    phoneResourceId: row.phone_resource_id,
    pmcId: row.pmc_id ?? null,
    purpose: row.purpose,
    e164: row.e164,
    vapiPhoneNumberId: row.vapi_phone_number_id || null,
    label: row.label || null,
    isActive: row.is_active !== false,
  };
}

/**
 * @param {object} args
 * @param {string} args.purpose
 * @param {number|null|undefined} args.pmcId
 * @param {Array<object>} args.resources
 * @param {Record<string, string>} [args.envByPurpose]
 * @param {string} [args.defaultE164]
 * @param {string|null} [args.envVapiPhoneNumberId]
 * @returns {{
 *   e164: string,
 *   vapiPhoneNumberId: string|null,
 *   label: string|null,
 *   source: 'pmc'|'system'|'env'|'default'|null,
 *   phoneResourceId: number|null,
 * }}
 */
export function resolvePhoneResource({
  purpose,
  pmcId,
  resources = [],
  envByPurpose = {},
  defaultE164 = '',
  envVapiPhoneNumberId = null,
}) {
  const empty = {
    e164: '',
    vapiPhoneNumberId: null,
    label: null,
    source: null,
    phoneResourceId: null,
  };
  if (!isPhonePurpose(purpose)) return empty;

  const active = (resources || []).filter(
    (row) => row && row.is_active !== false && row.purpose === purpose && row.e164
  );
  const pmcRow =
    pmcId != null
      ? active.find((row) => Number(row.pmc_id) === Number(pmcId))
      : null;
  if (pmcRow) {
    return {
      e164: pmcRow.e164,
      vapiPhoneNumberId: pmcRow.vapi_phone_number_id || envVapiPhoneNumberId,
      label: pmcRow.label || null,
      source: 'pmc',
      phoneResourceId: pmcRow.phone_resource_id ?? null,
    };
  }

  const systemRow = active.find(
    (row) => row.pmc_id == null || row.pmc_id === undefined
  );
  if (systemRow) {
    return {
      e164: systemRow.e164,
      vapiPhoneNumberId: systemRow.vapi_phone_number_id || envVapiPhoneNumberId,
      label: systemRow.label || null,
      source: 'system',
      phoneResourceId: systemRow.phone_resource_id ?? null,
    };
  }

  const fromEnv = envByPurpose[purpose] || '';
  if (fromEnv) {
    return {
      e164: fromEnv,
      vapiPhoneNumberId: envVapiPhoneNumberId,
      label: null,
      source: 'env',
      phoneResourceId: null,
    };
  }

  if (VOICE_FALLBACK_PURPOSES.has(purpose) && defaultE164) {
    return {
      e164: defaultE164,
      vapiPhoneNumberId: envVapiPhoneNumberId,
      label: null,
      source: 'default',
      phoneResourceId: null,
    };
  }

  return empty;
}

export function resolveAllPhoneResources(args) {
  const resolved = {};
  for (const item of PHONE_PURPOSE_LIST) {
    resolved[item.id] = resolvePhoneResource({ ...args, purpose: item.id });
  }
  return resolved;
}
