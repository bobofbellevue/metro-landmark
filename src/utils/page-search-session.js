/**
 * Session-only search criteria for finder pages (Properties, Landlords, etc.).
 * Survives in-app navigation; cleared on logout and when the browser session ends.
 */

export const PAGE_SEARCH_KEYS = Object.freeze({
  properties: 'ml-search:properties',
  landlords: 'ml-search:landlords',
  vendors: 'ml-search:vendors',
  applicants: 'ml-search:applicants',
  tenants: 'ml-search:tenants',
  leases: 'ml-search:leases',
  payments: 'ml-search:payments',
  listings: 'listings-search',
});

function resolveSearchStorage(storage) {
  if (storage) return storage;
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

function coerceField(defaultValue, raw) {
  if (typeof defaultValue === 'boolean') return Boolean(raw);
  if (typeof defaultValue === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultValue;
  }
  if (raw == null) return defaultValue;
  return String(raw);
}

export function readPageSearchSession(key, userId, defaults = {}, storage) {
  const fallback = { ...defaults };
  const store = resolveSearchStorage(storage);
  if (!store || userId == null || userId === '') return fallback;
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed?.userId != null && Number(parsed.userId) !== Number(userId)) {
      return fallback;
    }
    const result = { ...fallback };
    for (const field of Object.keys(defaults)) {
      if (parsed[field] === undefined) continue;
      result[field] = coerceField(defaults[field], parsed[field]);
    }
    return result;
  } catch {
    return fallback;
  }
}

export function writePageSearchSession(key, userId, filters, storage) {
  const store = resolveSearchStorage(storage);
  if (!store || userId == null || userId === '') return;
  try {
    store.setItem(
      key,
      JSON.stringify({
        userId,
        ...filters,
      })
    );
  } catch {
    /* ignore quota / private-mode failures */
  }
}

export function clearPageSearchSession(key, storage) {
  const store = resolveSearchStorage(storage);
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearAllPageSearchSessions(storage) {
  for (const key of Object.values(PAGE_SEARCH_KEYS)) {
    clearPageSearchSession(key, storage);
  }
}
