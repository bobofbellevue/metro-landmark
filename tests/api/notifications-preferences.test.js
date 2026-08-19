import { jest } from '@jest/globals';

const savedEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  VITE_SUPABASE_SERVICE_KEY: process.env.VITE_SUPABASE_SERVICE_KEY,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function createRes() {
  const res = { headers: {}, statusCode: 200, jsonData: null };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.jsonData = obj;
    return res;
  };
  res.end = () => res;
  return res;
}

let prefsRow = null;
let lastInsert = null;

function prefsTable() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: prefsRow, error: null }),
      }),
    }),
    insert: (row) => {
      lastInsert = row;
      prefsRow = { preference_id: 1, ...row };
      return {
        select: () => ({
          maybeSingle: async () => ({ data: prefsRow, error: null }),
        }),
      };
    },
    update: (row) => ({
      eq: () => {
        prefsRow = { ...prefsRow, ...row };
        return {
          select: () => ({
            maybeSingle: async () => ({ data: prefsRow, error: null }),
          }),
        };
      },
    }),
  };
}

await jest.unstable_mockModule('../../api/utils/supabase-client.js', () => ({
  createSupabaseClient: () => ({
    from: (table) => {
      if (table !== 'user_notification_preferences') {
        throw new Error(`unexpected table ${table}`);
      }
      return prefsTable();
    },
  }),
}));

const { default: handler, defaultNotificationPreferences, parseUserIdHeader } =
  await import('../../api/notifications/preferences.js');

describe('api/notifications/preferences', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    prefsRow = null;
    lastInsert = null;
  });

  afterEach(() => {
    restoreEnv();
  });

  test('parseUserIdHeader', () => {
    expect(parseUserIdHeader({})).toBeNull();
    expect(parseUserIdHeader({ 'x-user-id': '12' })).toBe(12);
  });

  test('GET creates defaults when none exist', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '7' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.preferences).toMatchObject(
      defaultNotificationPreferences(7)
    );
    expect(lastInsert.user_id).toBe(7);
  });

  test('GET returns stored preferences', async () => {
    prefsRow = { preference_id: 3, user_id: 7, email_enabled: false };
    const res = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '7' } }, res);
    expect(res.jsonData.preferences.email_enabled).toBe(false);
    expect(lastInsert).toBeNull();
  });

  test('rejects missing user', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });
});
