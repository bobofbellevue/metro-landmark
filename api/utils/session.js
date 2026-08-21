/* eslint-env node */
import crypto from 'node:crypto';

export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ''
  );
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function hmac(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function signSessionToken(userId, options = {}) {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error(
      'Session signing secret missing. Set SESSION_SECRET (or a Supabase service role key).'
    );
  }
  const ttlSeconds = Number(options.ttlSeconds);
  const ttl =
    Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? ttlSeconds
      : Number(process.env.SESSION_TTL_SECONDS) > 0
        ? Number(process.env.SESSION_TTL_SECONDS)
        : DEFAULT_SESSION_TTL_SECONDS;
  const nowSeconds = Math.floor((options.now || Date.now()) / 1000);
  const body = b64urlJson({
    uid: userId,
    exp: nowSeconds + ttl,
  });
  return `v1.${body}.${hmac(body, secret)}`;
}

export function verifySessionToken(token, options = {}) {
  if (!token || typeof token !== 'string') return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, body, sig] = parts;
  if (!body || !sig) return null;
  if (!timingSafeEqualString(sig, hmac(body, secret))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload == null || typeof payload !== 'object' || payload.uid == null) {
    return null;
  }
  const exp = Number(payload.exp);
  const nowSeconds = Math.floor((options.now || Date.now()) / 1000);
  if (!Number.isFinite(exp) || exp <= nowSeconds) return null;
  return payload;
}

export function parseBearerToken(headers = {}) {
  const raw = headers.authorization || headers.Authorization;
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/^Bearer\s+(\S+)/i);
  return match ? match[1] : null;
}

export function sessionUserId(req) {
  const payload = verifySessionToken(parseBearerToken(req?.headers || {}));
  return payload?.uid ?? null;
}

export function requireSessionUserId(req) {
  const userId = sessionUserId(req);
  if (userId == null) {
    return {
      userId: null,
      error: { status: 401, message: 'Authentication required' },
    };
  }
  return { userId };
}

export async function requireSessionUser(
  req,
  supabase,
  { select = 'user_id, pmc_id, role' } = {}
) {
  const userId = sessionUserId(req);
  if (userId == null) {
    return {
      user: null,
      error: { status: 401, message: 'Authentication required' },
    };
  }
  const { data, error } = await supabase
    .from('users')
    .select(select)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    return {
      user: null,
      error: { status: 401, message: 'Authentication required' },
    };
  }
  return { user: data };
}

export async function requireCompanyAdminUser(req, supabase) {
  const auth = await requireSessionUser(req, supabase);
  if (!auth.user) return auth;
  if (auth.user.role !== 'global_admin' && auth.user.role !== 'company_admin') {
    return {
      user: null,
      error: {
        status: 403,
        message:
          'Access denied. Global Admin or Company Admin privileges required.',
      },
    };
  }
  return auth;
}

export function sendAuthError(res, auth) {
  const status = auth?.error?.status || 401;
  const message = auth?.error?.message || 'Authentication required';
  res.status(status).json({ success: false, error: message });
}
