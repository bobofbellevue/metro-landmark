import { signSessionToken } from '../../api/utils/session.js';

export function authHeaders(userId, extra = {}) {
  if (!process.env.SESSION_SECRET && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SESSION_SECRET = 'test-session-secret';
  }
  return {
    authorization: `Bearer ${signSessionToken(userId)}`,
    ...extra,
  };
}
