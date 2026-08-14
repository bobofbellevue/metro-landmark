import {
  filterLeasesBySearch,
  formatPersonDisplayName,
  formatPropertyAddressLine,
  formatTenantNamesList,
  leaseSearchHaystack,
} from '../../src/utils/lease-display.js';

describe('lease-display helpers', () => {
  test('formats person and tenant lists', () => {
    expect(
      formatPersonDisplayName({ first_name: 'Ada', middle_name: 'P', last_name: 'Lovelace' })
    ).toBe('Ada P. Lovelace');
    expect(
      formatTenantNamesList([
        { first_name: 'Ada', last_name: 'Lovelace' },
        { email: 'bob@example.com' },
      ])
    ).toBe('Ada Lovelace, bob@example.com');
  });

  test('formats address lines', () => {
    expect(
      formatPropertyAddressLine({
        address_line_1: '123 Main St',
        city: 'Seattle',
        state_province_region: 'WA',
        postal_code: '98101',
      })
    ).toBe('123 Main St, Seattle, WA, 98101');
  });

  test('filters leases by property, tenant, landlord, and rent', () => {
    const leases = [
      {
        lease_id: 1,
        monthly_rent_amount: 2000,
        status: 'active',
        units: { unit_number: '2A', properties: { property_name: 'Pine Court' } },
        tenantNames: 'Ada Lovelace',
        landlordName: 'Salish Holdings',
        addressLine: '123 Main St, Seattle, WA',
        tenants: [{ first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' }],
      },
      {
        lease_id: 2,
        monthly_rent_amount: 1500,
        status: 'pending',
        units: { unit_number: '1', properties: { property_name: 'Oak House' } },
        tenantNames: 'Grace Hopper',
        landlordName: 'Metro LLC',
        addressLine: '9 Oak Ave',
        tenants: [{ first_name: 'Grace', last_name: 'Hopper' }],
      },
    ];

    expect(filterLeasesBySearch(leases, 'pine')).toHaveLength(1);
    expect(filterLeasesBySearch(leases, 'hopper')).toHaveLength(1);
    expect(filterLeasesBySearch(leases, 'metro')).toHaveLength(1);
    expect(filterLeasesBySearch(leases, '2000')).toHaveLength(1);
    expect(leaseSearchHaystack(leases[0])).toContain('pine court');
  });
});
