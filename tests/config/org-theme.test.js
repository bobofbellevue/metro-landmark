import {
  DEFAULT_ORG_PRIMARY,
  ORG_INDIGO_STEPS,
  applyOrgTheme,
  canEditOrgTheme,
  clearOrgTheme,
  normalizeLogoUrl,
  normalizeOrgTheme,
  normalizePrimaryHex,
  parseStoredTheme,
  themeScaleFromPrimary,
} from '../../src/utils/org-theme.js';

describe('normalizePrimaryHex', () => {
  test('accepts #rrggbb and lowercases', () => {
    expect(normalizePrimaryHex('#4F46E5')).toBe('#4f46e5');
  });

  test('expands #rgb', () => {
    expect(normalizePrimaryHex('#0af')).toBe('#00aaff');
  });

  test('allows missing hash', () => {
    expect(normalizePrimaryHex('4f46e5')).toBe('#4f46e5');
  });

  test('rejects invalid values', () => {
    expect(normalizePrimaryHex('')).toBeNull();
    expect(normalizePrimaryHex('blue')).toBeNull();
    expect(normalizePrimaryHex('#ffff')).toBeNull();
    expect(normalizePrimaryHex(null)).toBeNull();
  });
});

describe('normalizeLogoUrl', () => {
  test('accepts same-origin paths and http(s)', () => {
    expect(normalizeLogoUrl('/brand/acme.svg')).toBe('/brand/acme.svg');
    expect(normalizeLogoUrl('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png'
    );
    expect(normalizeLogoUrl('http://localhost:5173/logo.png')).toBe(
      'http://localhost:5173/logo.png'
    );
  });

  test('rejects unsafe or empty values', () => {
    expect(normalizeLogoUrl('')).toBeNull();
    expect(normalizeLogoUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLogoUrl('data:image/png;base64,abc')).toBeNull();
    expect(normalizeLogoUrl('//evil.example/logo.png')).toBeNull();
    expect(normalizeLogoUrl('not a url')).toBeNull();
  });
});

describe('parseStoredTheme / normalizeOrgTheme', () => {
  test('returns null for empty storage', () => {
    expect(parseStoredTheme(null)).toBeNull();
    expect(parseStoredTheme({})).toBeNull();
    expect(parseStoredTheme('')).toBeNull();
  });

  test('parses JSON strings and snake_case logo', () => {
    expect(
      parseStoredTheme(
        JSON.stringify({ primary: '#0a7c42', logo_url: '/brand/acme.svg' })
      )
    ).toEqual({ primary: '#0a7c42', logoUrl: '/brand/acme.svg' });
  });

  test('logo-only storage still fills default primary', () => {
    expect(parseStoredTheme({ logoUrl: '/brand/acme.svg' })).toEqual({
      primary: DEFAULT_ORG_PRIMARY,
      logoUrl: '/brand/acme.svg',
    });
  });

  test('normalizeOrgTheme always returns a complete object', () => {
    expect(normalizeOrgTheme(null)).toEqual({
      primary: DEFAULT_ORG_PRIMARY,
      logoUrl: null,
    });
    expect(normalizeOrgTheme({ primary: '#abc' })).toEqual({
      primary: '#aabbcc',
      logoUrl: null,
    });
  });
});

describe('themeScaleFromPrimary', () => {
  test('step 600 is the primary; other steps stay hex', () => {
    const scale = themeScaleFromPrimary('#0a7c42');
    expect(scale['600']).toBe('#0a7c42');
    for (const step of ORG_INDIGO_STEPS) {
      expect(scale[step]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test('lights 50/100 are closer to white than 500', () => {
    const scale = themeScaleFromPrimary('#0a7c42');
    const luminance = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return r + g + b;
    };
    expect(luminance(scale['50'])).toBeGreaterThan(luminance(scale['500']));
    expect(luminance(scale['900'])).toBeLessThan(luminance(scale['600']));
  });

  test('invalid primary falls back to default indigo', () => {
    expect(themeScaleFromPrimary('nope')['600']).toBe(DEFAULT_ORG_PRIMARY);
  });
});

describe('canEditOrgTheme', () => {
  test('company and global admins can edit', () => {
    expect(canEditOrgTheme('company_admin')).toBe(true);
    expect(canEditOrgTheme('global_admin')).toBe(true);
    expect(canEditOrgTheme('manager')).toBe(false);
    expect(canEditOrgTheme('staff')).toBe(false);
  });
});

describe('applyOrgTheme / clearOrgTheme', () => {
  const originalDocument = global.document;

  afterEach(() => {
    global.document = originalDocument;
  });

  test('sets and clears --org-indigo tokens on documentElement', () => {
    const props = new Map();
    const dataset = {};
    global.document = {
      documentElement: {
        style: {
          setProperty: (key, value) => props.set(key, value),
          removeProperty: (key) => props.delete(key),
        },
        dataset,
      },
    };

    applyOrgTheme({ primary: '#0a7c42' });
    expect(props.get('--org-indigo-600')).toBe('#0a7c42');
    expect(dataset.orgTheme).toBe('1');

    clearOrgTheme();
    expect(props.has('--org-indigo-600')).toBe(false);
    expect(dataset.orgTheme).toBeUndefined();
  });

  test('applyOrgTheme with empty theme clears tokens', () => {
    const props = new Map();
    global.document = {
      documentElement: {
        style: {
          setProperty: (key, value) => props.set(key, value),
          removeProperty: (key) => props.delete(key),
        },
        dataset: { orgTheme: '1' },
      },
    };
    applyOrgTheme(null);
    expect(props.size).toBe(0);
  });
});
