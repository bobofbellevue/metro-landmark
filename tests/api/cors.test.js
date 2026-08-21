import {
  allowedCorsOrigins,
  applyCors,
} from '../../api/utils/cors.js';

function createRes() {
  const res = { headers: {} };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  return res;
}

describe('CORS allowlist', () => {
  const saved = {
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('includes local Vite origins and Vercel hosts', () => {
    const origins = allowedCorsOrigins({
      VERCEL_URL: 'metro-landmark-abc.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'metro-landmark.vercel.app',
      CORS_ORIGIN: 'https://ops.example.com',
    });
    expect(origins.has('http://localhost:5173')).toBe(true);
    expect(origins.has('https://metro-landmark-abc.vercel.app')).toBe(true);
    expect(origins.has('https://metro-landmark.vercel.app')).toBe(true);
    expect(origins.has('https://ops.example.com')).toBe(true);
    expect(origins.has('*')).toBe(false);
  });

  test('reflects an allowed Origin and omits unknown origins', () => {
    delete process.env.CORS_ORIGIN;
    delete process.env.VERCEL_URL;
    const allowed = createRes();
    applyCors(
      { headers: { origin: 'http://localhost:5173' } },
      allowed,
      'POST, OPTIONS'
    );
    expect(allowed.headers['Access-Control-Allow-Origin']).toBe(
      'http://localhost:5173'
    );
    expect(allowed.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(allowed.headers['Access-Control-Allow-Headers']).toBe(
      'Content-Type, Authorization'
    );

    const denied = createRes();
    applyCors({ headers: { origin: 'https://evil.example' } }, denied);
    expect(denied.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  test('CORS_ORIGIN=* is an explicit escape hatch', () => {
    const origins = allowedCorsOrigins({ CORS_ORIGIN: '*' });
    expect(origins.has('*')).toBe(true);
    const res = createRes();
    process.env.CORS_ORIGIN = '*';
    applyCors({ headers: { origin: 'https://evil.example' } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});
