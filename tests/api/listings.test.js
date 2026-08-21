import { jest } from '@jest/globals';

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
  const res = { headers: {}, statusCode: 200, jsonData: null, body: null };
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
  res.send = (body) => {
    res.body = body;
    return res;
  };
  res.end = () => res;
  return res;
}

function primaryKey(table) {
  if (table === 'listings') return 'listing_id';
  if (table === 'leases') return 'lease_id';
  if (table === 'users') return 'user_id';
  if (table === 'units') return 'unit_id';
  if (table === 'properties') return 'property_id';
  if (table === 'landlords') return 'landlord_id';
  if (table === 'addresses') return 'address_id';
  if (table === 'client_units') return 'client_unit_id';
  if (table === 'pm_companies') return 'pmc_id';
  if (table === 'contacts') return 'contact_id';
  return 'id';
}

function createQuery(db, table) {
  const state = {
    filters: [],
    insertRow: null,
    patch: null,
    deleting: false,
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
    insert: (row) => {
      state.insertRow = row;
      return query;
    },
    delete: () => {
      state.deleting = true;
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
    if (state.deleting) {
      const remaining = rows.filter((row) => !state.filters.every((fn) => fn(row)));
      db[table].splice(0, db[table].length, ...remaining);
      return { data: remaining, error: db.tableErrors?.[table] || null };
    }
    const matched = rows.filter((row) => state.filters.every((fn) => fn(row)));
    if (state.patch) {
      matched.forEach((row) => Object.assign(row, state.patch));
    }
    return { data: matched, error: db.tableErrors?.[table] || null };
  }

  return query;
}

const db = {
  users: [],
  landlords: [],
  leases: [],
  units: [],
  properties: [],
  listings: [],
  addresses: [],
  client_units: [],
  contacts: [],
  pm_companies: [],
  tableErrors: {},
};

await jest.unstable_mockModule('../../api/utils/supabase-client.js', () => ({
  createSupabaseClient: () => ({
    from: (table) => createQuery(db, table),
  }),
}));

const { default: handler } = await import('../../api/listings.js');

function seedBase() {
  db.users.splice(0, db.users.length);
  db.landlords.splice(0, db.landlords.length);
  db.leases.splice(0, db.leases.length);
  db.units.splice(0, db.units.length);
  db.properties.splice(0, db.properties.length);
  db.listings.splice(0, db.listings.length);
  db.addresses.splice(0, db.addresses.length);
  db.client_units.splice(0, db.client_units.length);
  db.contacts.splice(0, db.contacts.length);
  db.pm_companies.splice(0, db.pm_companies.length);
  db.tableErrors = {};

  db.users.push(
    { user_id: 1, pmc_id: 9, role: 'company_admin' },
    { user_id: 2, pmc_id: 9, role: 'manager' },
    { user_id: 3, pmc_id: 9, role: 'landlord' },
    { user_id: 4, pmc_id: 9, role: 'staff' },
    { user_id: 5, pmc_id: 8, role: 'manager' },
    { user_id: 6, pmc_id: 9, role: 'tenant' }
  );
  db.landlords.push({ landlord_id: 1, user_id: 3 });
  db.properties.push(
    {
      property_id: 30,
      property_name: 'Pine Court',
      property_type: 'Apartment',
      pmc_id: 9,
      landlord_id: 1,
      manager_id: 2,
      is_archived: false,
    },
    {
      property_id: 31,
      property_name: 'Other PMC',
      property_type: 'House',
      pmc_id: 8,
      landlord_id: 2,
      manager_id: 5,
      is_archived: false,
    }
  );
  db.units.push(
    {
      unit_id: 20,
      unit_number: '2A',
      property_id: 30,
      beds: 2,
      baths: 1,
      square_footage: 800,
      is_archived: false,
    },
    {
      unit_id: 21,
      unit_number: '3B',
      property_id: 30,
      beds: 1,
      baths: 1,
      square_footage: 600,
      is_archived: false,
    },
    {
      unit_id: 22,
      unit_number: '1C',
      property_id: 30,
      beds: 3,
      baths: 2,
      square_footage: 1100,
      is_archived: false,
    },
    {
      unit_id: 23,
      unit_number: '4D',
      property_id: 30,
      beds: 1,
      baths: 1,
      square_footage: 550,
      is_archived: false,
    },
    {
      unit_id: 40,
      unit_number: 'A',
      property_id: 31,
      beds: 2,
      baths: 1,
      square_footage: 900,
      is_archived: false,
    }
  );
  db.leases.push(
    {
      lease_id: 10,
      unit_id: 20,
      status: 'active',
      monthly_rent_amount: 1850,
      start_date: '2025-01-01',
      is_archived: false,
    },
    {
      lease_id: 11,
      unit_id: 21,
      status: 'ended',
      monthly_rent_amount: 1600,
      start_date: '2024-01-01',
      is_archived: false,
    },
    {
      lease_id: 12,
      unit_id: 22,
      status: 'future',
      monthly_rent_amount: 2000,
      start_date: '2026-10-01',
      is_archived: false,
    }
  );
  db.client_units.push({
    client_unit_id: 1,
    client_id: 99,
    unit_id: 23,
    lease_id: null,
    is_archived: false,
    end_date: null,
    vacated_at: null,
  });
  db.addresses.push({
    address_id: 1,
    addressable_type: 'property',
    addressable_id: 30,
    address_line_1: '10 Pine St',
    address_line_2: null,
    city: 'Seattle',
    state_province_region: 'WA',
    postal_code: '98101',
  });
  db.contacts.push(
    {
      contact_id: 1,
      contactable_type: 'landlord',
      contactable_id: 1,
      first_name: 'Bob',
      last_name: 'Kelly',
    },
    {
      contact_id: 2,
      contactable_type: 'user',
      contactable_id: 2,
      first_name: 'Pat',
      last_name: 'Manager',
    }
  );
  db.pm_companies.push({ pmc_id: 9, company_name: 'Metro PMC' }, { pmc_id: 8, company_name: 'Other PMC' });
}

describe('api/listings', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    seedBase();
  });

  afterEach(() => {
    restoreEnv();
  });

  test('rejects unauthenticated GET', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  test('tenant cannot view listings', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '6' }, query: {} }, res);
    expect(res.statusCode).toBe(403);
  });

  test('GET returns vacant units only and hides occupied/future leases', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '1' }, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.canEdit).toBe(true);
    const unitIds = res.jsonData.listings.map((row) => row.unitId).sort();
    expect(unitIds).toEqual([21]);
    expect(res.jsonData.listings[0]).toMatchObject({
      propertyName: 'Pine Court',
      unitNumber: '3B',
      city: 'Seattle',
      lastRent: 1600,
      listed: false,
      landlordName: 'Kelly, Bob',
      managerName: 'Pat Manager',
      pmcName: 'Metro PMC',
    });
  });

  test('staff can view but not edit', async () => {
    const getRes = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '4' }, query: {} }, getRes);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.jsonData.canEdit).toBe(false);

    const putRes = createRes();
    await handler(
      {
        method: 'PUT',
        headers: { 'x-user-id': '4' },
        body: { unitId: 21, listed: true, askingRent: 1700 },
      },
      putRes
    );
    expect(putRes.statusCode).toBe(403);
  });

  test('PUT lists a vacancy and fills asking rent from last lease', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PUT',
        headers: { 'x-user-id': '1' },
        body: { unitId: 21, listed: true, availableOn: '09-01-2026', description: 'Bright unit' },
      },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    const row = res.jsonData.listings.find((item) => item.unitId === 21);
    expect(row).toMatchObject({
      listed: true,
      askingRent: 1600,
      availableOn: '2026-09-01',
      description: 'Bright unit',
    });
    expect(db.listings).toHaveLength(1);
    expect(db.listings[0].updated_by).toBe(1);
  });

  test('PUT rejects occupied units', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PUT',
        headers: { 'x-user-id': '1' },
        body: { unitId: 20, listed: true, askingRent: 1900 },
      },
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonData.error).toMatch(/not a vacancy/);
  });

  test('skips units with a tenant assignment and no lease', async () => {
    const getRes = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '1' }, query: {} }, getRes);
    expect(getRes.jsonData.listings.map((row) => row.unitId)).not.toContain(23);

    const putRes = createRes();
    await handler(
      {
        method: 'PUT',
        headers: { 'x-user-id': '1' },
        body: { unitId: 23, listed: true, askingRent: 1500 },
      },
      putRes
    );
    expect(putRes.statusCode).toBe(400);
    expect(putRes.jsonData.error).toMatch(/not a vacancy/);
  });

  test('XML and CSV export vacancies whether or not Listed is checked', async () => {
    const xmlRes = createRes();
    await handler(
      { method: 'GET', headers: { 'x-user-id': '1' }, query: { format: 'xml' } },
      xmlRes
    );
    expect(xmlRes.statusCode).toBe(200);
    expect(xmlRes.headers['Content-Type']).toMatch(/xml/);
    expect(xmlRes.body).toContain('<hotPadsItems>');
    expect(xmlRes.body).toContain('<id>unit21</id>');
    expect(xmlRes.body).toContain('<listed>false</listed>');
    expect(xmlRes.body).not.toContain('<id>unit20</id>');
    expect(xmlRes.body).not.toContain('<id>unit23</id>');

    db.listings.push({
      listing_id: 1,
      unit_id: 21,
      listed: true,
      asking_rent: 1725,
      available_on: '2026-09-01',
      description: 'Corner <unit>',
    });

    const listedXml = createRes();
    await handler(
      { method: 'GET', headers: { 'x-user-id': '1' }, query: { format: 'xml' } },
      listedXml
    );
    expect(listedXml.body).toContain('<id>unit21</id>');
    expect(listedXml.body).toContain('&lt;unit&gt;');
    expect(listedXml.body).toContain('<listed>true</listed>');

    const csvRes = createRes();
    await handler(
      { method: 'GET', headers: { 'x-user-id': '1' }, query: { format: 'csv' } },
      csvRes
    );
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.headers['Content-Type']).toMatch(/csv/);
    expect(csvRes.body).toContain('Pine Court');
    expect(csvRes.body).toContain('3B');
    expect(csvRes.body).toContain('true');
    expect(csvRes.body).not.toContain('2A');
  });

  test('landlord is scoped to owned properties; other PMC is hidden', async () => {
    const landlordRes = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '3' }, query: {} }, landlordRes);
    expect(landlordRes.jsonData.listings.map((row) => row.unitId)).toEqual([21]);

    const otherPmc = createRes();
    await handler({ method: 'GET', headers: { 'x-user-id': '5' }, query: {} }, otherPmc);
    expect(otherPmc.jsonData.listings.map((row) => row.unitId)).toEqual([40]);
  });

  test('DELETE removes a listing row and leaves the vacancy unlisted', async () => {
    db.listings.push({
      listing_id: 7,
      unit_id: 21,
      listed: true,
      asking_rent: 1725,
      available_on: '2026-09-01',
      description: 'Corner unit',
    });

    const res = createRes();
    await handler(
      { method: 'DELETE', headers: { 'x-user-id': '1' }, query: { unitId: 21 } },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(db.listings).toHaveLength(0);
    expect(res.jsonData.listings.find((row) => row.unitId === 21)).toMatchObject({
      listed: false,
      hasListing: false,
    });
  });

  test('staff cannot delete listings', async () => {
    db.listings.push({
      listing_id: 7,
      unit_id: 21,
      listed: true,
      asking_rent: 1725,
    });
    const res = createRes();
    await handler(
      { method: 'DELETE', headers: { 'x-user-id': '4' }, query: { unitId: 21 } },
      res
    );
    expect(res.statusCode).toBe(403);
    expect(db.listings).toHaveLength(1);
  });
});
