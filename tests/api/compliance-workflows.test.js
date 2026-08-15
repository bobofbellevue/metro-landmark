const savedEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  VITE_SUPABASE_SERVICE_KEY: process.env.VITE_SUPABASE_SERVICE_KEY,
};

function clearSupabaseEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.VITE_SUPABASE_SERVICE_KEY;
}

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

describe('api/compliance/workflows', () => {
  afterEach(() => {
    restoreSupabaseEnv();
  });

  test('importing the handler does not throw when env is missing', async () => {
    clearSupabaseEnv();
    const { default: handler } = await import('../../api/compliance/workflows.js');
    expect(typeof handler).toBe('function');
  });

  test('returns JSON 500 instead of crashing when keys are missing', async () => {
    clearSupabaseEnv();
    const { default: handler } = await import('../../api/compliance/workflows.js');
    const res = createRes();
    await handler(
      {
        method: 'POST',
        query: {},
        body: { workflow_type: 'rent_increase', total_steps: 3, lease_id: 1 },
      },
      res
    );
    expect(res.statusCode).toBe(500);
    expect(res.jsonData).toMatchObject({ success: false });
    expect(String(res.jsonData.error || '')).toMatch(/Supabase|configuration/i);
  });
});
