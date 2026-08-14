import {
  applyBrandOverrides,
  brand,
} from '../../src/config/brand.js';
import { buildPublicBrandConfig } from '../../api/brand-config.js';
import {
  DEFAULT_PRODUCT_NAME,
  deriveBrandFromProductName,
  parseBrandAssetEnv,
  resolveBrandConfig,
  slugifyProductName,
} from '../../src/config/brand-derive.js';

const SALISH_LOGO_JSON = JSON.stringify({
  logo: [
    { path: '/brand/salish-landmark-totem.svg' },
    { alt: 'Totem Pole' },
  ],
});

const SALISH_BACKGROUND_JSON = JSON.stringify({
  background: [
    { path: '/brand/salish-landmark-background.jpg' },
    { alt: 'Longhouse' },
  ],
});

describe('deriveBrandFromProductName', () => {
  test('derives Salish Landmark fields', () => {
    expect(deriveBrandFromProductName('Salish Landmark')).toEqual({
      productName: 'Salish Landmark',
      productHeading: 'SALISH Landmark',
      productStackedLine1: 'SALISH',
      productStackedLine2: 'Landmark',
      referenceOperatorName: 'Salish Landmark',
      authStorageKey: 'salish_landmark_user',
      logoAlt: 'Salish Landmark logo',
    });
  });

  test('defaults to Metro Landmark', () => {
    expect(deriveBrandFromProductName('')).toMatchObject({
      productName: DEFAULT_PRODUCT_NAME,
      productHeading: 'METRO Landmark',
      productStackedLine1: 'METRO',
      productStackedLine2: 'Landmark',
      authStorageKey: 'metro_landmark_user',
    });
  });

  test('slugifyProductName normalizes punctuation', () => {
    expect(slugifyProductName('Foo & Bar PMS')).toBe('foo_bar_pms');
  });
});

describe('parseBrandAssetEnv', () => {
  test('parses path and alt from separate array items', () => {
    expect(parseBrandAssetEnv(SALISH_LOGO_JSON, 'logo')).toEqual({
      path: '/brand/salish-landmark-totem.svg',
      alt: 'Totem Pole',
    });
  });

  test('parses path and alt on the same item', () => {
    expect(
      parseBrandAssetEnv(
        JSON.stringify({
          background: [{ path: '/brand/bg.jpg', alt: 'Longhouse' }],
        }),
        'background'
      )
    ).toEqual({ path: '/brand/bg.jpg', alt: 'Longhouse' });
  });

  test('allows omitting alt', () => {
    expect(
      parseBrandAssetEnv(
        JSON.stringify({ logo: [{ path: '/brand/only.svg' }] }),
        'logo'
      )
    ).toEqual({ path: '/brand/only.svg' });
  });

  test('strips wrapping quotes and rejects invalid JSON', () => {
    expect(
      parseBrandAssetEnv(`'${SALISH_LOGO_JSON}'`, 'logo').path
    ).toBe('/brand/salish-landmark-totem.svg');
    expect(parseBrandAssetEnv('not-json', 'logo')).toEqual({});
  });
});

describe('resolveBrandConfig', () => {
  test('uses three primary knobs including asset JSON', () => {
    const resolved = resolveBrandConfig(
      {
        VITE_PRODUCT_NAME: 'Salish Landmark',
        VITE_LOGO: SALISH_LOGO_JSON,
        VITE_BACKGROUND: SALISH_BACKGROUND_JSON,
      },
      {
        defaultLogoUrl: '/default-logo.png',
        defaultBackgroundUrl: '/default-bg.jpg',
      }
    );
    expect(resolved.productHeading).toBe('SALISH Landmark');
    expect(resolved.logoUrl).toBe('/brand/salish-landmark-totem.svg');
    expect(resolved.logoAlt).toBe('Totem Pole');
    expect(resolved.backgroundUrl).toBe('/brand/salish-landmark-background.jpg');
    expect(resolved.backgroundAlt).toBe('Longhouse');
  });

  test('falls back to derived logo alt when JSON omits alt', () => {
    const resolved = resolveBrandConfig({
      VITE_PRODUCT_NAME: 'Salish Landmark',
      VITE_LOGO: JSON.stringify({
        logo: [{ path: '/brand/salish-landmark-totem.svg' }],
      }),
    });
    expect(resolved.logoAlt).toBe('Salish Landmark logo');
  });
});

describe('runtime brand config', () => {
  const snapshot = { ...brand };

  afterEach(() => {
    Object.assign(brand, snapshot);
  });

  test('buildPublicBrandConfig parses asset JSON into flat fields', () => {
    expect(
      buildPublicBrandConfig({
        VITE_PRODUCT_NAME: 'Salish Landmark',
        VITE_LOGO: SALISH_LOGO_JSON,
        VITE_BACKGROUND: SALISH_BACKGROUND_JSON,
      })
    ).toEqual({
      productName: 'Salish Landmark',
      logoUrl: '/brand/salish-landmark-totem.svg',
      logoAlt: 'Totem Pole',
      backgroundUrl: '/brand/salish-landmark-background.jpg',
      backgroundAlt: 'Longhouse',
    });
  });

  test('applyBrandOverrides with productName re-derives text fields', () => {
    applyBrandOverrides({
      productName: 'Salish Landmark',
      logoUrl: '/brand/salish-landmark-totem.svg',
      logoAlt: 'Totem Pole',
    });
    expect(brand.productName).toBe('Salish Landmark');
    expect(brand.productHeading).toBe('SALISH Landmark');
    expect(brand.productStackedLine1).toBe('SALISH');
    expect(brand.productStackedLine2).toBe('Landmark');
    expect(brand.logoAlt).toBe('Totem Pole');
    expect(brand.authStorageKey).toBe('salish_landmark_user');
    expect(brand.logoUrl).toBe('/brand/salish-landmark-totem.svg');
  });

  test('applyBrandOverrides logo-only does not reset product name', () => {
    const beforeName = brand.productName;
    applyBrandOverrides({
      logoUrl: '/brand/salish-landmark-totem.svg',
      logoAlt: 'Totem Pole',
    });
    expect(brand.logoUrl).toBe('/brand/salish-landmark-totem.svg');
    expect(brand.logoAlt).toBe('Totem Pole');
    expect(brand.productName).toBe(beforeName);
  });

  test('applyBrandOverrides ignores empty strings', () => {
    const before = brand.logoUrl;
    applyBrandOverrides({ logoUrl: '   ' });
    expect(brand.logoUrl).toBe(before);
  });
});
