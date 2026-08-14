/**
 * Locale / presentation resolution (Workstream 2).
 *
 * Layers (highest priority first for a given field):
 *   1. Explicit property override
 *   2. Organization (PMC) default
 *   3. follow_user_locale → browser/device locale (when enabled for that field)
 *   4. Product default (US / en-US for the reference deployment)
 *
 * Jurisdiction / legal packs are NOT resolved here — those stay on the
 * jurisdiction-pack seam. This module is for presentation only
 * (dates, numbers, phone display, first day of week, etc.).
 */

/** Product-level defaults shipped with Metro Landmark */
export const PRODUCT_LOCALE_DEFAULTS = {
  locale: 'en-US',
  timeZone: 'America/Los_Angeles',
  country: 'US',
  defaultState: 'WA',
  currency: 'USD',
  phoneCountryCode: '1',
  defaultAreaCode: '206',
  firstDayOfWeek: 0, // Sunday
  /**
   * When an org/property sets a field to this sentinel, presentation follows
   * the end-user device locale instead of org/product defaults.
   */
  followUserLocaleSentinel: 'follow_user_locale',
};

/**
 * @typedef {Object} LocaleContext
 * @property {Record<string, unknown>} [property] - Property/location settings
 * @property {Record<string, unknown>} [organization] - PMC / org settings
 * @property {string} [userLocale] - Device/browser locale (e.g. navigator.language)
 * @property {string} [userTimeZone] - Device timezone (e.g. Intl resolved)
 */

/**
 * Resolve a single presentation field through the standard layer stack.
 *
 * @param {string} field - e.g. 'locale', 'timeZone', 'currency', 'defaultAreaCode'
 * @param {LocaleContext} [ctx]
 * @param {unknown} [productDefault] - override product default for this call
 * @returns {unknown}
 */
export function resolveLocaleField(field, ctx = {}, productDefault) {
  const productValue =
    productDefault !== undefined
      ? productDefault
      : PRODUCT_LOCALE_DEFAULTS[field];

  const propertyValue = ctx.property?.[field];
  if (isSet(propertyValue)) {
    return resolveFollowUser(propertyValue, field, ctx, productValue);
  }

  const orgValue = ctx.organization?.[field];
  if (isSet(orgValue)) {
    return resolveFollowUser(orgValue, field, ctx, productValue);
  }

  return productValue;
}

/**
 * Resolve the BCP-47 locale used for Intl date/number formatting.
 * @param {LocaleContext} [ctx]
 * @returns {string}
 */
export function resolveFormattingLocale(ctx = {}) {
  return String(resolveLocaleField('locale', ctx, PRODUCT_LOCALE_DEFAULTS.locale));
}

/**
 * Resolve IANA timezone for displaying timestamps.
 * @param {LocaleContext} [ctx]
 * @returns {string}
 */
export function resolveTimeZone(ctx = {}) {
  return String(resolveLocaleField('timeZone', ctx, PRODUCT_LOCALE_DEFAULTS.timeZone));
}

/**
 * Format a date with the resolved locale (and optional timezone).
 * @param {Date|string|number} value
 * @param {LocaleContext} [ctx]
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatDate(value, ctx = {}, options = {}) {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const locale = resolveFormattingLocale(ctx);
  const timeZone = options.timeZone || resolveTimeZone(ctx);
  return date.toLocaleDateString(locale, { timeZone, ...options });
}

/**
 * Format a date-time with the resolved locale/timezone.
 * @param {Date|string|number} value
 * @param {LocaleContext} [ctx]
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatDateTime(value, ctx = {}, options = {}) {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const locale = resolveFormattingLocale(ctx);
  const timeZone = options.timeZone || resolveTimeZone(ctx);
  const hasDetailedOptions =
    options.weekday != null ||
    options.year != null ||
    options.month != null ||
    options.day != null ||
    options.hour != null;

  return date.toLocaleString(locale, {
    timeZone,
    ...(hasDetailedOptions
      ? options
      : { dateStyle: 'short', timeStyle: 'short', ...options }),
  });
}

/**
 * Format currency with the resolved locale + currency code.
 * @param {number} amount
 * @param {LocaleContext} [ctx]
 * @param {Intl.NumberFormatOptions} [options]
 * @returns {string}
 */
export function formatCurrency(amount, ctx = {}, options = {}) {
  if (amount == null || Number.isNaN(Number(amount))) return '';
  const locale = resolveFormattingLocale(ctx);
  const currency = String(
    resolveLocaleField('currency', ctx, PRODUCT_LOCALE_DEFAULTS.currency)
  );
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    ...options,
  }).format(Number(amount));
}

function isSet(value) {
  return value != null && value !== '';
}

function resolveFollowUser(value, field, ctx, productValue) {
  if (value !== PRODUCT_LOCALE_DEFAULTS.followUserLocaleSentinel) {
    return value;
  }

  if (field === 'locale') {
    return ctx.userLocale || productValue;
  }
  if (field === 'timeZone') {
    return ctx.userTimeZone || productValue;
  }
  // Other fields: fall back to product default when follow_user_locale has no mapping
  return productValue;
}

/**
 * Build a LocaleContext from browser APIs (safe for SSR / missing window).
 * @param {Partial<LocaleContext>} [base]
 * @returns {LocaleContext}
 */
export function localeContextFromBrowser(base = {}) {
  let userLocale;
  let userTimeZone;
  try {
    if (typeof navigator !== 'undefined') {
      userLocale = navigator.language;
    }
    userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // ignore
  }
  return {
    ...base,
    userLocale: base.userLocale || userLocale,
    userTimeZone: base.userTimeZone || userTimeZone,
  };
}
