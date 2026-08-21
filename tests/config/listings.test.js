import {
  canEditListings,
  canViewListings,
  filterListingsBySearch,
  isOccupiedLeaseStatus,
  lastRentByUnit,
  listingLabel,
  listingsToCsv,
  listingsToZillowXml,
  mapPropertyType,
  missingListingsTable,
  occupiedUnitIds,
  parseAskingRent,
  validateListingWrite,
  xmlEscape,
} from '../../src/utils/listings.js';

describe('listing helpers', () => {
  test('role gates', () => {
    expect(canViewListings('staff')).toBe(true);
    expect(canEditListings('staff')).toBe(false);
    expect(canEditListings('manager')).toBe(true);
    expect(canEditListings('landlord')).toBe(true);
    expect(canViewListings('tenant')).toBe(false);
  });

  test('occupied leases hide units', () => {
    expect(isOccupiedLeaseStatus('active')).toBe(true);
    expect(isOccupiedLeaseStatus('future')).toBe(true);
    expect(isOccupiedLeaseStatus('ended')).toBe(false);
    const occupied = occupiedUnitIds([
      { unit_id: 1, status: 'active' },
      { unit_id: 2, status: 'ended' },
      { unit_id: 3, status: 'future' },
    ]);
    expect([...occupied].sort()).toEqual([1, 3]);
  });

  test('last rent uses newest start date', () => {
    const rents = lastRentByUnit([
      { unit_id: 4, monthly_rent_amount: 1200, start_date: '2024-01-01' },
      { unit_id: 4, monthly_rent_amount: 1350, start_date: '2025-01-01' },
      { unit_id: 5, monthly_rent_amount: 0, start_date: '2025-01-01' },
    ]);
    expect(rents.get(4)).toBe(1350);
    expect(rents.has(5)).toBe(false);
  });

  test('validateListingWrite', () => {
    expect(validateListingWrite({}).ok).toBe(false);
    expect(validateListingWrite({ unitId: 1, listed: true }).error).toMatch(/Asking rent/);
    expect(
      validateListingWrite({ unitId: 1, listed: true, askingRent: 1800 }).value
    ).toMatchObject({ unitId: 1, listed: true, askingRent: 1800 });
    expect(validateListingWrite({ unitId: 1, listed: false }).ok).toBe(true);
    expect(
      validateListingWrite({ unitId: 1, listed: false, description: 'x'.repeat(2001) }).ok
    ).toBe(false);
  });

  test('parseAskingRent', () => {
    expect(parseAskingRent('1,850.50')).toBe(1850.5);
    expect(parseAskingRent(0)).toBeNull();
    expect(parseAskingRent(-3)).toBeNull();
  });

  test('zillow xml and csv export listed vacancies only', () => {
    const rows = [
      {
        unitId: 9,
        propertyName: 'Cedar',
        unitNumber: '2B',
        addressLine1: '10 Pine St',
        city: 'Seattle',
        state: 'WA',
        postalCode: '98101',
        beds: 2,
        baths: 1,
        squareFootage: 800,
        propertyType: 'Apartment',
        askingRent: 1850,
        lastRent: 1800,
        availableOn: '2026-09-01',
        description: 'Bright <unit> & clean',
        listed: true,
      },
      {
        unitId: 10,
        listed: false,
        askingRent: 900,
      },
    ];
    const xml = listingsToZillowXml(rows);
    expect(xml).toContain('<hotPadsItems>');
    expect(xml).toContain('<id>unit-9</id>');
    expect(xml).toContain('&lt;unit&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('unit-10');
    expect(mapPropertyType('Townhouse')).toBe('TOWNHOUSE');
    expect(listingLabel(rows[0])).toBe('10 Pine St #2B');

    const csv = listingsToCsv(rows);
    expect(csv).toMatch(/^property,unit,street/);
    expect(csv).toContain('Cedar');
    expect(csv).toContain('2B');
    expect(csv).not.toContain('unit-10');
  });

  test('xmlEscape and missing table detector', () => {
    expect(xmlEscape(`a&b<"'>`)).toBe('a&amp;b&lt;&quot;&apos;&gt;');
    expect(missingListingsTable({ message: "Could not find the table 'public.listings'" })).toBe(
      true
    );
    expect(missingListingsTable({ message: 'permission denied' })).toBe(false);
  });

  test('filterListingsBySearch', async () => {
    const { filterListingsBySearch } = await import('../../src/utils/listings.js');
    const rows = [
      { propertyName: 'Cedar Court', unitNumber: '4', city: 'Seattle' },
      { propertyName: 'Oak', unitNumber: '1', city: 'Tacoma' },
    ];
    expect(filterListingsBySearch(rows, 'cedar')).toHaveLength(1);
    expect(filterListingsBySearch(rows, 'TAC')).toHaveLength(1);
  });
});
