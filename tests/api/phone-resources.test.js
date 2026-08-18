import { jest } from '@jest/globals';

const savedEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  VAPI_PHONE_NUMBER_ID: process.env.VAPI_PHONE_NUMBER_ID,
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
const resources = [];

function thenable(result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    is: () => chain,
    in: () => chain,
    not: () => chain,
    limit: () => chain,
    update: () => chain,
    insert: async () => ({ data: null, error: null }),
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
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
      if (table === 'phone_resources') {
        return thenable({ data: resources.slice(), error: null });
      }
      return thenable({ data: null, error: null });
    },
  }),
}));

const { default: handler } = await import('../../api/phone-resources.js');

describe('api/phone-resources', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    delete process.env.VAPI_PHONE_NUMBER_ID;
    usersById.clear();
    resources.splice(0, resources.length);
    usersById.set(1, { user_id: 1, pmc_id: 9, role: 'company_admin' });
    usersById.set(2, { user_id: 2, pmc_id: 9, role: 'manager' });
  });

  afterEach(() => {
    restoreEnv();
  });

  test('rejects unauthenticated GET', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  test('GET returns resolved purposes with env/default fallback', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '1' }, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.canEdit).toBe(true);
    expect(res.jsonData.resolved.tenant_maintenance.e164).toBe('+12064017109');
    expect(res.jsonData.resolved.marketing.e164).toBe('');
    expect(res.jsonData.purposes.map((p) => p.id)).toContain('vendor_dispatch');
  });

  test('manager can read but not PUT', async () => {
    const getRes = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '2' }, query: {} }, getRes);
    expect(getRes.jsonData.canEdit).toBe(false);

    const putRes = createRes();
    await handler(
      {
        method: 'PUT',
        headers: { 'x-user-id': '2' },
        query: {},
        body: { purpose: 'marketing', e164: '+12065551212' },
      },
      putRes
    );
    expect(putRes.statusCode).toBe(403);
  });

  test('PUT rejects invalid purpose and invalid Vapi id', async () => {
    const badPurpose = createRes();
    await handler(
      {
        method: 'PUT',
        headers: { 'x-user-id': '1' },
        query: {},
        body: { purpose: 'fax', e164: '+12065551212' },
      },
      badPurpose
    );
    expect(badPurpose.statusCode).toBe(400);

    const badVapi = createRes();
    await handler(
      {
        method: 'PUT',
        headers: { 'x-user-id': '1' },
        query: {},
        body: {
          purpose: 'vendor_dispatch',
          e164: '+12065551212',
          vapiPhoneNumberId: '+12065551212',
        },
      },
      badVapi
    );
    expect(badVapi.statusCode).toBe(400);
  });
});
