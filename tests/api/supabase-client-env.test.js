import { jest } from '@jest/globals';

const savedEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  VITE_SUPABASE_SERVICE_KEY: process.env.VITE_SUPABASE_SERVICE_KEY,
};

function restoreSupabaseEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('createSupabaseClient env fallback', () => {
  afterEach(() => {
    restoreSupabaseEnv();
    jest.resetModules();
  });

  test('uses SUPABASE_SERVICE_ROLE_KEY when SUPABASE_SECRET_KEY is unset', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.VITE_SUPABASE_SERVICE_KEY;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-service-role';

    let usedKey = null;
    await jest.unstable_mockModule('@supabase/supabase-js', () => ({
      createClient: (url, key) => {
        usedKey = key;
        return { url, key };
      },
    }));

    const { createSupabaseClient } = await import('../../api/utils/supabase-client.js');
    const client = createSupabaseClient();
    expect(usedKey).toBe('legacy-service-role');
    expect(client.key).toBe('legacy-service-role');
  });
});
