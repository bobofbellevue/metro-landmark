import {
  fetchFirstTenantUserId,
  fetchLeaseClientTenantRefs,
  firstTenantUserId,
  flattenLeaseClientRows,
  leaseTenantContactableIds,
} from '../../src/utils/lease-tenants.js';

describe('flattenLeaseClientRows', () => {
  test('reads nested clients object or array and top-level ids', () => {
    expect(
      flattenLeaseClientRows([
        { lease_id: 72, client_id: 1, clients: { client_id: 1, user_id: 19 } },
        { lease_id: 72, client_id: 2, clients: [{ client_id: 2, user_id: 20 }] },
        { lease_id: 73, client_id: 3, user_id: 21 },
      ])
    ).toEqual([
      { lease_id: 72, client_id: 1, user_id: 19 },
      { lease_id: 72, client_id: 2, user_id: 20 },
      { lease_id: 73, client_id: 3, user_id: 21 },
    ]);
  });
});

describe('firstTenantUserId', () => {
  test('returns the first nested clients.user_id', () => {
    expect(
      firstTenantUserId([
        { client_id: 1, clients: { client_id: 1, user_id: 19 } },
        { client_id: 2, clients: { client_id: 2, user_id: 20 } },
      ])
    ).toBe(19);
  });

  test('returns null when no tenant user is linked', () => {
    expect(firstTenantUserId([{ client_id: 1 }])).toBeNull();
    expect(firstTenantUserId([])).toBeNull();
  });
});

describe('leaseTenantContactableIds', () => {
  test('includes both client_id and user_id', () => {
    expect(
      leaseTenantContactableIds([
        { client_id: 1, user_id: 19 },
        { client_id: 1, user_id: 19 },
        { client_id: 2 },
      ]).sort((a, b) => a - b)
    ).toEqual([1, 2, 19]);
  });
});

function supabaseFromMap(handlers) {
  return {
    from(table) {
      return {
        select(columns) {
          return {
            in(_column, ids) {
              return handlers[table]({ columns, ids });
            },
          };
        },
      };
    },
  };
}

describe('fetchLeaseClientTenantRefs', () => {
  test('uses nested clients.user_id when the join succeeds', async () => {
    const supabase = supabaseFromMap({
      lease_clients: async () => ({
        data: [
          {
            lease_id: 72,
            client_id: 1,
            clients: { client_id: 1, user_id: 19 },
          },
        ],
        error: null,
      }),
    });
    await expect(fetchLeaseClientTenantRefs(supabase, [72])).resolves.toEqual([
      { lease_id: 72, client_id: 1, user_id: 19 },
    ]);
  });

  test('falls back to clients.user_id when the nested select fails', async () => {
    const supabase = supabaseFromMap({
      lease_clients: async ({ columns }) => {
        if (String(columns).includes('clients')) {
          return { data: null, error: { message: 'embed failed' } };
        }
        return {
          data: [{ lease_id: 72, client_id: 1 }],
          error: null,
        };
      },
      clients: async () => ({
        data: [{ client_id: 1, user_id: 19 }],
        error: null,
      }),
    });
    await expect(fetchLeaseClientTenantRefs(supabase, [72])).resolves.toEqual([
      { lease_id: 72, client_id: 1, user_id: 19 },
    ]);
  });
});

describe('fetchFirstTenantUserId', () => {
  test('returns the first tenant user_id for a lease', async () => {
    const supabase = supabaseFromMap({
      lease_clients: async () => ({
        data: [
          {
            lease_id: 72,
            client_id: 1,
            clients: { client_id: 1, user_id: 19 },
          },
        ],
        error: null,
      }),
    });
    await expect(fetchFirstTenantUserId(supabase, 72)).resolves.toBe(19);
    await expect(fetchFirstTenantUserId(supabase, null)).resolves.toBeNull();
  });
});
