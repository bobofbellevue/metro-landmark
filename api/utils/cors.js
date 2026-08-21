/* eslint-env node */

const LOCAL_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
];

function withHttps(host) {
  if (!host) return null;
  const trimmed = String(host).trim().replace(/\/$/, '');
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

export function allowedCorsOrigins(env = process.env) {
  const origins = new Set(LOCAL_DEV_ORIGINS);
  const fromEnv = String(env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of fromEnv) {
    if (value === '*') {
      origins.add('*');
      continue;
    }
    origins.add(withHttps(value) || value);
  }
  for (const host of [
    env.VERCEL_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_BRANCH_URL,
  ]) {
    const origin = withHttps(host);
    if (origin) origins.add(origin);
  }
  return origins;
}

export function applyCors(req, res, methods = 'GET, POST, PUT, DELETE, OPTIONS') {
  const origin = req?.headers?.origin || req?.headers?.Origin;
  const allowed = allowedCorsOrigins();
  if (allowed.has('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
