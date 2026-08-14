import {
  buildEnvLocalContents,
  parseEnvFileContents,
  MANAGED_ENV_KEYS,
} from '../../scripts/select-environment.js';

describe('select-environment env.local merge', () => {
  const environment = {
    name: 'dev',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'pub-key',
    supabaseSecretKey: 'secret-key',
  };

  test('parseEnvFileContents reads keys and skips comments', () => {
    const parsed = parseEnvFileContents(`
# comment
VITE_LOGO={"logo":[{"path":"/brand/salish-landmark-totem.svg"},{"alt":"Totem Pole"}]}
VITE_SUPABASE_URL=https://old.example
`);
    expect(parsed.VITE_LOGO).toContain('/brand/salish-landmark-totem.svg');
    expect(parsed.VITE_SUPABASE_URL).toBe('https://old.example');
  });

  test('buildEnvLocalContents rewrites managed keys and preserves brand overrides', () => {
    const existing = [
      'VITE_SUPABASE_URL=https://stale.supabase.co',
      'VITE_SUPABASE_PUBLISHABLE_KEY=stale',
      'VITE_LOGO={"logo":[{"path":"/brand/salish-landmark-totem.svg"},{"alt":"Totem Pole"}]}',
      'VITE_PRODUCT_NAME=Salish Landmark',
      'VITE_BACKGROUND={"background":[{"path":"/brand/salish-landmark-background.jpg"},{"alt":"Longhouse"}]}',
    ].join('\n');

    const out = buildEnvLocalContents(environment, existing);
    const parsed = parseEnvFileContents(out);

    expect(parsed.VITE_SUPABASE_URL).toBe('https://example.supabase.co');
    expect(parsed.VITE_SUPABASE_PUBLISHABLE_KEY).toBe('pub-key');
    expect(parsed.SUPABASE_SECRET_KEY).toBe('secret-key');
    expect(parsed.VITE_LOGO).toContain('/brand/salish-landmark-totem.svg');
    expect(parsed.VITE_PRODUCT_NAME).toBe('Salish Landmark');
    expect(parsed.VITE_BACKGROUND).toContain(
      '/brand/salish-landmark-background.jpg'
    );
    expect(out).toContain('Preserved local overrides');
  });

  test('buildEnvLocalContents works with empty existing file', () => {
    const out = buildEnvLocalContents(environment, '');
    const parsed = parseEnvFileContents(out);
    for (const key of MANAGED_ENV_KEYS) {
      expect(parsed[key]).toBeDefined();
    }
    expect(parsed.VITE_LOGO).toBeUndefined();
    expect(out).not.toContain('Preserved local overrides');
  });
});
