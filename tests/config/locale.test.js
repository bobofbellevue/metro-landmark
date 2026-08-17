import {
  PRODUCT_LOCALE_DEFAULTS,
  resolveLocaleField,
  resolveFormattingLocale,
  formatCurrency,
  formatCurrencyNumber,
} from '../../src/config/locale.js';

describe('locale resolution', () => {
  test('uses product defaults when no org/property overrides', () => {
    expect(resolveFormattingLocale({})).toBe('en-US');
    expect(resolveLocaleField('currency', {})).toBe('USD');
    expect(resolveLocaleField('defaultAreaCode', {})).toBe('206');
  });

  test('property override wins over organization', () => {
    const ctx = {
      organization: { locale: 'en-GB', currency: 'GBP' },
      property: { locale: 'fr-CA' },
    };
    expect(resolveFormattingLocale(ctx)).toBe('fr-CA');
    expect(resolveLocaleField('currency', ctx)).toBe('GBP');
  });

  test('follow_user_locale uses device locale when enabled', () => {
    const ctx = {
      organization: { locale: PRODUCT_LOCALE_DEFAULTS.followUserLocaleSentinel },
      userLocale: 'de-DE',
    };
    expect(resolveFormattingLocale(ctx)).toBe('de-DE');
  });

  test('formatCurrency respects resolved currency', () => {
    const formatted = formatCurrency(12.5, {
      organization: { locale: 'en-US', currency: 'USD' },
    });
    expect(formatted).toContain('12.50');
    expect(formatted).toMatch(/\$/);
  });

  test('formatCurrencyNumber omits the currency symbol for prefixed inputs', () => {
    const formatted = formatCurrencyNumber(2100, {
      organization: { locale: 'en-US', currency: 'USD' },
    });
    expect(formatted).toBe('2,100.00');
    expect(formatted).not.toMatch(/\$/);
  });
});
