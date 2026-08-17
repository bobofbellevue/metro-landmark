/**
 * Lease ↔ tenant (client) helpers.
 *
 * Tenant display names live on contacts. TenantsPage stores those as
 * contactable_type = 'client' with contactable_id = user_id (not client_id).
 * Older rows may use client_id. Always try both.
 */

function nestedClients(row) {
  const value = row?.clients;
  if (Array.isArray(value)) return value.filter(Boolean);
  return value && typeof value === 'object' ? [value] : [];
}

function uniqueIds(values) {
  return [
    ...new Set(
      (values || []).filter((id) => id != null && id !== '').map((id) => id)
    ),
  ];
}

/**
 * Flatten lease_clients rows (with optional nested clients) into
 * { lease_id, client_id, user_id } refs.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<{ lease_id: unknown, client_id: unknown, user_id: unknown }>}
 */
export function flattenLeaseClientRows(rows = []) {
  return (rows || []).flatMap((row) => {
    if (row?.lease_id == null && row?.client_id == null && !row?.clients) {
      return [];
    }
    const clients = nestedClients(row);
    if (clients.length === 0) {
      return [
        {
          lease_id: row.lease_id ?? null,
          client_id: row.client_id ?? row.client?.client_id ?? null,
          user_id: row.user_id ?? row.client?.user_id ?? null,
        },
      ];
    }
    return clients.map((client) => ({
      lease_id: row.lease_id ?? null,
      client_id: client.client_id ?? row.client_id ?? null,
      user_id: client.user_id ?? row.user_id ?? null,
    }));
  });
}

/**
 * First tenant users.user_id on a lease (documents.tenant_user_id is singular).
 *
 * @param {Array<Record<string, unknown>>} rows
 * @returns {number|string|null}
 */
export function firstTenantUserId(rows = []) {
  const found = flattenLeaseClientRows(rows).find((ref) => ref.user_id != null);
  return found?.user_id ?? null;
}

/**
 * contactable_id values that may hold a tenant contact (client_id or user_id).
 *
 * @param {Array<{ client_id?: unknown, user_id?: unknown }>} refs
 * @returns {Array<number|string>}
 */
export function leaseTenantContactableIds(refs = []) {
  return uniqueIds([
    ...(refs || []).map((ref) => ref.client_id),
    ...(refs || []).map((ref) => ref.user_id),
  ]);
}

/**
 * Load lease_clients for the given leases, including clients.user_id when
 * the nested select is allowed. Falls back to a clients table lookup.
 *
 * @param {{ from: Function }} supabase
 * @param {Array<number|string>} leaseIds
 * @returns {Promise<Array<{ lease_id: unknown, client_id: unknown, user_id: unknown }>>}
 */
export async function fetchLeaseClientTenantRefs(supabase, leaseIds = []) {
  const ids = uniqueIds(leaseIds);
  if (ids.length === 0) return [];

  let { data, error } = await supabase
    .from('lease_clients')
    .select('lease_id, client_id, clients(client_id, user_id)')
    .in('lease_id', ids);

  if (error) {
    console.warn(
      '[lease-tenants] nested lease_clients select failed:',
      error.message || error
    );
    ({ data, error } = await supabase
      .from('lease_clients')
      .select('lease_id, client_id')
      .in('lease_id', ids));
    if (error) {
      console.warn(
        '[lease-tenants] lease_clients select failed:',
        error.message || error
      );
      return [];
    }
  }

  let rows = data || [];
  const missingUserIds = flattenLeaseClientRows(rows).some(
    (ref) => ref.client_id != null && ref.user_id == null
  );
  if (missingUserIds) {
    const clientIds = uniqueIds(rows.map((row) => row.client_id));
    if (clientIds.length > 0) {
      const { data: clients, error: clientsError } = await supabase
        .from('clients')
        .select('client_id, user_id')
        .in('client_id', clientIds);
      if (clientsError) {
        console.warn(
          '[lease-tenants] clients select failed:',
          clientsError.message || clientsError
        );
      } else {
        const userByClient = new Map(
          (clients || []).map((client) => [
            String(client.client_id),
            client.user_id,
          ])
        );
        rows = rows.map((row) => ({
          ...row,
          user_id:
            row.user_id ??
            nestedClients(row)[0]?.user_id ??
            userByClient.get(String(row.client_id)) ??
            null,
        }));
      }
    }
  }

  return flattenLeaseClientRows(rows);
}

/**
 * Look up the first tenant user_id for a lease (for documents.tenant_user_id).
 *
 * @param {{ from: Function }} supabase
 * @param {number|string|null} leaseId
 * @returns {Promise<number|string|null>}
 */
export async function fetchFirstTenantUserId(supabase, leaseId) {
  if (leaseId == null || leaseId === '') return null;
  const refs = await fetchLeaseClientTenantRefs(supabase, [leaseId]);
  return firstTenantUserId(refs);
}

export { uniqueIds as uniqueLeaseTenantIds };
