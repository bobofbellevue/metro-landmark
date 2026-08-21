import {
  parseBearerToken,
  requireCompanyAdminUser,
  requireSessionUser,
  signSessionToken,
  verifySessionToken,
} from '../../api/utils/session.js';

describe('session tokens', () => {
  const savedSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret';
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret;
  });

  test('round-trips a user id', () => {
    const token = signSessionToken(12);
    expect(verifySessionToken(token)).toMatchObject({ uid: 12 });
  });

  test('rejects a tampered payload', () => {
    const token = signSessionToken(12);
    const [version, body, sig] = token.split('.');
    const tamperedBody = Buffer.from(JSON.stringify({ uid: 1, exp: 9999999999 })).toString(
      'base64url'
    );
    expect(verifySessionToken(`${version}.${tamperedBody}.${sig}`)).toBeNull();
  });

  test('rejects an expired token', () => {
    const token = signSessionToken(12, { now: Date.now() - 60_000, ttlSeconds: 1 });
    expect(verifySessionToken(token)).toBeNull();
  });

  test('parseBearerToken reads Authorization', () => {
    const token = signSessionToken(3);
    expect(parseBearerToken({ Authorization: `Bearer ${token}` })).toBe(token);
    expect(parseBearerToken({})).toBeNull();
    expect(parseBearerToken({ authorization: 'Basic abc' })).toBeNull();
  });

  test('requireSessionUser loads role from the database, not headers', async () => {
    const token = signSessionToken(9);
    const supabase = {
      from: (table) => {
        expect(table).toBe('users');
        return {
          select: () => ({
            eq: (_col, id) => ({
              maybeSingle: async () => ({
                data: { user_id: id, pmc_id: 4, role: 'staff' },
                error: null,
              }),
            }),
          }),
        };
      },
    };
    const result = await requireSessionUser(
      {
        headers: {
          authorization: `Bearer ${token}`,
          'x-user-id': '1',
          'x-user-role': 'global_admin',
        },
      },
      supabase
    );
    expect(result.user).toEqual({ user_id: 9, pmc_id: 4, role: 'staff' });
  });

  test('requireSessionUser rejects a missing token even with x-user-id', async () => {
    const result = await requireSessionUser(
      { headers: { 'x-user-id': '1', 'x-user-role': 'global_admin' } },
      { from: () => ({}) }
    );
    expect(result.user).toBeNull();
    expect(result.error.status).toBe(401);
  });

  test('requireCompanyAdminUser uses the database role', async () => {
    const token = signSessionToken(2);
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { user_id: 2, pmc_id: 9, role: 'manager' },
              error: null,
            }),
          }),
        }),
      }),
    };
    const denied = await requireCompanyAdminUser(
      {
        headers: {
          authorization: `Bearer ${token}`,
          'x-user-role': 'global_admin',
        },
      },
      supabase
    );
    expect(denied.user).toBeNull();
    expect(denied.error.status).toBe(403);
  });
});
