import { jest } from '@jest/globals';
import { authHeaders } from './auth-headers.js';

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

function createRes() {
  const res = {
    headers: {},
    statusCode: 200,
    jsonData: null,
  };
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

const usersById = new Map();
const companiesById = new Map();
let lastThemeUpdate = null;

function userQuery(userId) {
  return {
    select: () => ({
      eq: (_col, id) => ({
        maybeSingle: async () => ({
          data: usersById.get(Number(id) || Number(userId)) || null,
          error: null,
        }),
      }),
    }),
  };
}

function companyQuery() {
  return {
    select: () => ({
      eq: (_col, pmcId) => ({
        maybeSingle: async () => ({
          data: companiesById.get(Number(pmcId)) || null,
          error: null,
        }),
      }),
    }),
    update: (payload) => ({
      eq: (_col, pmcId) => ({
        select: () => ({
          maybeSingle: async () => {
            const existing = companiesById.get(Number(pmcId));
            if (!existing) return { data: null, error: { message: 'not found' } };
            lastThemeUpdate = payload.theme;
            const next = { ...existing, theme: payload.theme };
            companiesById.set(Number(pmcId), next);
            return { data: next, error: null };
          },
        }),
      }),
    }),
  };
}

await jest.unstable_mockModule('../../api/utils/supabase-client.js', () => ({
  createSupabaseClient: () => ({
    from: (table) => {
      if (table === 'users') return userQuery();
      if (table === 'pm_companies') return companyQuery();
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const { default: handler, canEditOrgTheme } = await import(
  '../../api/org-theme.js'
);

describe('api/org-theme helpers', () => {
  test('re-exports canEditOrgTheme', () => {
    expect(canEditOrgTheme('company_admin')).toBe(true);
  });
});

describe('api/org-theme', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    usersById.clear();
    companiesById.clear();
    lastThemeUpdate = null;
    usersById.set(1, { user_id: 1, pmc_id: 9, role: 'company_admin' });
    usersById.set(2, { user_id: 2, pmc_id: 9, role: 'manager' });
    usersById.set(3, { user_id: 3, pmc_id: null, role: 'global_admin' });
    companiesById.set(9, {
      pmc_id: 9,
      company_name: 'Acme Property',
      theme: { primary: '#0a7c42', logoUrl: '/brand/acme.svg' },
    });
  });

  afterEach(() => {
    restoreSupabaseEnv();
  });

  test('OPTIONS returns 200', async () => {
    const res = createRes();
    await handler({ method: 'OPTIONS', headers: {} }, res);
    expect(res.statusCode).toBe(200);
  });

  test('rejects unauthenticated GET', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  test('GET returns stored theme for a company user', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: authHeaders(1) }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({
      success: true,
      pmcId: 9,
      companyName: 'Acme Property',
      canEdit: true,
      theme: { primary: '#0a7c42', logoUrl: '/brand/acme.svg' },
    });
  });

  test('GET is read-only for managers', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: authHeaders(2) }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.canEdit).toBe(false);
    expect(res.jsonData.theme.primary).toBe('#0a7c42');
  });

  test('GET without pmc_id returns empty theme', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: authHeaders(3) }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({
      success: true,
      theme: null,
      canEdit: false,
    });
  });

  test('PUT is forbidden for managers', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PUT',
        headers: authHeaders(2),
        body: { primary: '#111111' },
      },
      res
    );
    expect(res.statusCode).toBe(403);
    expect(lastThemeUpdate).toBeNull();
  });

  test('PUT saves a normalized theme for company admin', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PUT',
        headers: authHeaders(1),
        body: { primary: '#0AF', logoUrl: 'https://cdn.example.com/a.png' },
      },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.theme).toEqual({
      primary: '#00aaff',
      logoUrl: 'https://cdn.example.com/a.png',
    });
    expect(lastThemeUpdate).toEqual({
      primary: '#00aaff',
      logoUrl: 'https://cdn.example.com/a.png',
    });
  });

  test('PUT rejects invalid hex and unsafe logo URLs', async () => {
    const badColor = createRes();
    await handler(
      {
        method: 'PUT',
        headers: authHeaders(1),
        body: { primary: 'blue' },
      },
      badColor
    );
    expect(badColor.statusCode).toBe(400);

    const badLogo = createRes();
    await handler(
      {
        method: 'PUT',
        headers: authHeaders(1),
        body: { primary: '#4f46e5', logoUrl: 'javascript:alert(1)' },
      },
      badLogo
    );
    expect(badLogo.statusCode).toBe(400);
    expect(lastThemeUpdate).toBeNull();
  });

  test('PUT reset clears stored theme', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PUT',
        headers: authHeaders(1),
        body: { reset: true },
      },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.theme).toBeNull();
    expect(lastThemeUpdate).toBeNull();
  });
});
