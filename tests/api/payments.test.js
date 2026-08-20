import { jest } from '@jest/globals';

const savedEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
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

function primaryKey(table) {
  if (table === 'payments') return 'payment_id';
  if (table === 'leases') return 'lease_id';
  if (table === 'users') return 'user_id';
  if (table === 'units') return 'unit_id';
  if (table === 'properties') return 'property_id';
  if (table === 'contacts') return 'contact_id';
  if (table === 'landlords') return 'landlord_id';
  if (table === 'lease_clients') return 'lease_client_id';
  return 'id';
}

function createQuery(db, table) {
  const state = {
    filters: [],
    insertRow: null,
    patch: null,
  };

  const query = {
    select: () => query,
    eq: (col, val) => {
      state.filters.push((row) => row[col] == val);
      return query;
    },
    in: (col, vals) => {
      state.filters.push((row) => vals.includes(row[col]));
      return query;
    },
    or: () => query,
    is: (col, val) => {
      state.filters.push((row) =>
        val == null ? row[col] == null : row[col] == val
      );
      return query;
    },
    order: () => query,
    insert: (row) => {
      state.insertRow = row;
      return query;
    },
    update: (patch) => {
      state.patch = patch;
      return query;
    },
    maybeSingle: async () => {
      const result = await execute();
      const data = Array.isArray(result.data) ? result.data[0] || null : result.data;
      return { data, error: result.error };
    },
    then: (resolve, reject) => execute().then(resolve, reject),
  };

  async function execute() {
    const rows = db[table] || [];
    if (state.insertRow) {
      const key = primaryKey(table);
      const nextId = rows.reduce((max, row) => Math.max(max, Number(row[key]) || 0), 0) + 1;
      const created = {
        [key]: nextId,
        created_at: '2026-08-19T00:00:00.000Z',
        ...state.insertRow,
      };
      rows.push(created);
      return { data: created, error: null };
    }
    const matched = rows.filter((row) => state.filters.every((fn) => fn(row)));
    if (state.patch) {
      matched.forEach((row) => Object.assign(row, state.patch));
    }
    return { data: matched, error: null };
  }

  return query;
}

const db = {
  users: [],
  landlords: [],
  leases: [],
  units: [],
  properties: [],
  payments: [],
  payment_catalog: [],
  documents: [],
  lease_clients: [],
  contacts: [],
};

await jest.unstable_mockModule('../../api/utils/supabase-client.js', () => ({
  createSupabaseClient: () => ({
    from: (table) => createQuery(db, table),
  }),
}));

const { default: handler } = await import('../../api/payments.js');

describe('api/payments', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    delete process.env.STRIPE_SECRET_KEY;
    db.users.splice(0, db.users.length);
    db.landlords.splice(0, db.landlords.length);
    db.leases.splice(0, db.leases.length);
    db.units.splice(0, db.units.length);
    db.properties.splice(0, db.properties.length);
    db.payments.splice(0, db.payments.length);
    db.payment_catalog.splice(0, db.payment_catalog.length);
    db.documents.splice(0, db.documents.length);
    db.lease_clients.splice(0, db.lease_clients.length);
    db.contacts.splice(0, db.contacts.length);

    db.users.push(
      { user_id: 1, pmc_id: 9, role: 'company_admin' },
      { user_id: 2, pmc_id: 9, role: 'manager' },
      { user_id: 3, pmc_id: 9, role: 'landlord' },
      { user_id: 4, pmc_id: 9, role: 'staff' },
      { user_id: 5, pmc_id: 8, role: 'manager' }
    );
    db.leases.push({
      lease_id: 10,
      pmc_id: 9,
      landlord_id: 1,
      unit_id: 20,
      monthly_rent_amount: 1850,
      security_deposit_amount: 1850,
      other_fee_amount: 25,
      status: 'active',
    });
    db.units.push({ unit_id: 20, unit_number: '2A', property_id: 30 });
    db.properties.push({
      property_id: 30,
      property_name: 'Pine Court',
      pmc_id: 9,
      landlord_id: 1,
    });
    db.lease_clients.push({
      lease_client_id: 1,
      lease_id: 10,
      client_id: 40,
      clients: { client_id: 40, user_id: 50 },
    });
    db.contacts.push({
      contact_id: 1,
      contactable_id: 50,
      contactable_type: 'client',
      first_name: 'Ada',
      last_name: 'Lovelace',
    });
    db.landlords.push({ landlord_id: 1, user_id: 3 });
  });

  afterEach(() => {
    restoreEnv();
  });

  test('rejects unauthenticated GET', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  test('staff cannot view payments', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '4' }, query: {} }, res);
    expect(res.statusCode).toBe(403);
  });

  test('GET returns empty ledger for company admin', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '1' }, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.canEdit).toBe(true);
    expect(res.jsonData.onlinePaymentsEnabled).toBe(false);
    expect(res.jsonData.types.some((t) => t.id === 'rent')).toBe(true);
    expect(res.jsonData.types.some((t) => t.id === 'late_fee')).toBe(true);
    expect(res.jsonData.payments).toEqual([]);
  });

  test('POST records a due rent charge', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-user-id': '1' },
        body: {
          leaseId: 10,
          kind: 'rent',
          amount: 1850,
          dueDate: '2026-09-01',
          periodLabel: '2026-09',
        },
      },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.payment).toMatchObject({
      leaseId: 10,
      kind: 'rent',
      amount: 1850,
      status: 'due',
      propertyName: 'Pine Court',
      tenantNames: 'Ada Lovelace',
    });
    expect(db.payments).toHaveLength(1);
  });

  test('landlord can read but not POST', async () => {
    db.payments.push({
      payment_id: 1,
      pmc_id: 9,
      lease_id: 10,
      kind: 'rent',
      amount: 1850,
      status: 'due',
      due_date: '2026-09-01',
    });
    const getRes = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '3' }, query: {} }, getRes);
    expect(getRes.jsonData.canEdit).toBe(false);
    expect(getRes.jsonData.payments).toHaveLength(1);

    const postRes = createRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-user-id': '3' },
        body: { leaseId: 10, kind: 'rent', amount: 1850 },
      },
      postRes
    );
    expect(postRes.statusCode).toBe(403);
  });

  test('PUT marks a charge paid', async () => {
    db.payments.push({
      payment_id: 7,
      pmc_id: 9,
      lease_id: 10,
      kind: 'rent',
      amount: 1850,
      status: 'due',
      method: null,
    });
    const res = createRes();
    await handler(
      {
        method: 'PUT',
        headers: { 'x-user-id': '2' },
        body: { paymentId: 7, status: 'paid', method: 'check' },
      },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.payment.status).toBe('paid');
    expect(res.jsonData.payment.method).toBe('check');
    expect(db.payments[0].paid_at).toBeTruthy();
  });

  test('manager cannot see another company payment', async () => {
    db.payments.push({
      payment_id: 8,
      pmc_id: 9,
      lease_id: 10,
      kind: 'fee',
      amount: 25,
      status: 'due',
    });
    const res = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '5' }, query: {} }, res);
    expect(res.jsonData.payments).toEqual([]);
  });

  test('collectOnline without Stripe is rejected before insert', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-user-id': '1' },
        body: {
          leaseId: 10,
          kind: 'rent',
          amount: 1850,
          collectOnline: true,
        },
      },
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonData.error).toMatch(/Stripe is not configured/);
    expect(db.payments).toHaveLength(0);
  });
});
