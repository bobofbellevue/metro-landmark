import { jest } from '@jest/globals';
import { authHeaders } from './auth-headers.js';

const savedEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
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

const usersById = new Map();

function chain(result) {
  const query = {};
  for (const method of [
    'select',
    'order',
    'range',
    'eq',
    'contains',
    'gte',
    'lte',
    'limit',
    'in',
  ]) {
    query[method] = () => query;
  }
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

await jest.unstable_mockModule('../../api/utils/supabase-client.js', () => ({
  createSupabaseClient: () => ({
    from: (table) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: (_col, id) => ({
              maybeSingle: async () => ({
                data: usersById.get(Number(id)) || null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        return chain({ data: [], error: null, count: 0 });
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const { default: handler } = await import('../../api/audit-logs/list.js');

describe('api/audit-logs/list auth', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    usersById.clear();
    usersById.set(1, { user_id: 1, pmc_id: 9, role: 'company_admin' });
    usersById.set(2, { user_id: 2, pmc_id: 9, role: 'manager' });
  });

  afterEach(() => {
    restoreEnv();
  });

  test('rejects a missing session token', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  test('ignores a spoofed x-user-role header', async () => {
    const res = createRes();
    await handler(
      {
        method: 'GET',
        headers: {
          ...authHeaders(2),
          'x-user-id': '1',
          'x-user-role': 'global_admin',
        },
        query: {},
      },
      res
    );
    expect(res.statusCode).toBe(403);
  });

  test('allows a company admin session', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: authHeaders(1), query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.logs).toEqual([]);
  });
});
