import {
  canEditListings,
  canViewListings,
  filterListings,
  filterListingsBySearch,
  formatListingLandlordName,
  formatListingManagerName,
  isOccupiedLeaseStatus,
  lastRentByUnit,
  listingAsPickerUnit,
  listingLabel,
  listingsToCsv,
  listingsToZillowXml,
  mapPropertyType,
  missingListingsTable,
  occupiedUnitIds,
  parseAskingRent,
  uniqueListingFilters,
  unitsAssignedWithoutLease,
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

  test('tenant assignments without a lease occupy the unit', () => {
    const today = '2026-08-21';
    expect(
      [...unitsAssignedWithoutLease([
        { unit_id: 8, lease_id: null, is_archived: false },
        { unit_id: 9, lease_id: 10, is_archived: false },
        { unit_id: 11, lease_id: null, end_date: '2026-08-01', is_archived: false },
        { unit_id: 12, lease_id: null, vacated_at: '2026-08-01', is_archived: false },
        { unit_id: 13, lease_id: null, is_archived: true },
      ], today)].sort()
    ).toEqual([8]);
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

  test('zillow xml and csv export all vacancies', () => {
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
        propertyName: 'Oak',
        unitNumber: '1',
        listed: false,
        askingRent: 900,
      },
    ];
    const xml = listingsToZillowXml(rows);
    expect(xml).toContain('<hotPadsItems>');
    expect(xml).toContain('<id>unit-9</id>');
    expect(xml).toContain('<id>unit-10</id>');
    expect(xml).toContain('<listed>true</listed>');
    expect(xml).toContain('<listed>false</listed>');
    expect(xml).toContain('&lt;unit&gt;');
    expect(xml).toContain('&amp;');
    expect(mapPropertyType('Townhouse')).toBe('TOWNHOUSE');
    expect(listingLabel(rows[0])).toBe('10 Pine St #2B');

    const csv = listingsToCsv(rows);
    expect(csv).toMatch(/^property,unit,street/);
    expect(csv).toContain('Cedar');
    expect(csv).toContain('2B');
    expect(csv).toContain('Oak');
    expect(csv).toMatch(/listed/);
    expect(csv).toContain('true');
    expect(csv).toContain('false');
  });

  test('xmlEscape and missing table detector', () => {
    expect(xmlEscape(`a&b<"'>`)).toBe('a&amp;b&lt;&quot;&apos;&gt;');
    expect(missingListingsTable({ message: "Could not find the table 'public.listings'" })).toBe(
      true
    );
    expect(missingListingsTable({ message: 'permission denied' })).toBe(false);
  });

  test('filterListingsBySearch', () => {
    const rows = [
      { propertyName: 'Cedar Court', unitNumber: '4', city: 'Seattle' },
      { propertyName: 'Oak', unitNumber: '1', city: 'Tacoma' },
    ];
    expect(filterListingsBySearch(rows, 'cedar')).toHaveLength(1);
    expect(filterListingsBySearch(rows, 'TAC')).toHaveLength(1);
  });

  test('filterListings by listed, owner, PM, and PMC', () => {
    const rows = [
      {
        propertyName: 'Cedar',
        city: 'Seattle',
        listed: false,
        landlordId: 1,
        landlordName: 'Kelly, Bob',
        managerId: 8,
        managerName: 'Pat Manager',
        pmcId: 9,
        pmcName: 'Metro PMC',
      },
      {
        propertyName: 'Oak',
        city: 'Tacoma',
        listed: true,
        landlordId: 2,
        landlordName: 'Lee, Ann',
        managerId: 8,
        managerName: 'Pat Manager',
        pmcId: 9,
        pmcName: 'Metro PMC',
      },
      {
        propertyName: 'Pine',
        city: 'Seattle',
        listed: false,
        landlordId: 1,
        landlordName: 'Kelly, Bob',
        managerId: 12,
        managerName: 'Sam Staff',
        pmcId: 4,
        pmcName: 'Other PMC',
      },
    ];
    expect(filterListings(rows, { searchTerm: 'seattle', listed: 'unlisted' })).toHaveLength(2);
    expect(
      filterListings(rows, { searchTerm: 'seattle', listed: 'unlisted', landlordId: 1, managerId: 8 })
    ).toEqual([rows[0]]);
    expect(filterListings(rows, { pmcId: 4 })).toEqual([rows[2]]);
    expect(filterListings(rows, { listed: 'listed' })).toEqual([rows[1]]);
  });

  test('uniqueListingFilters and name formatters', () => {
    expect(formatListingLandlordName({ first_name: 'Bob', last_name: 'Kelly', middle_name: 'T' })).toBe(
      'Kelly, Bob T.'
    );
    expect(formatListingManagerName({ first_name: 'Pat', last_name: 'Manager', middle_name: 'Ann' })).toBe(
      'Pat A. Manager'
    );
    expect(formatListingLandlordName(null)).toBe('');
    const filters = uniqueListingFilters([
      { landlordId: 2, landlordName: 'Lee, Ann', pmcId: 9, pmcName: 'Metro PMC', managerId: 8, managerName: 'Pat Manager' },
      { landlordId: 1, landlordName: 'Kelly, Bob', pmcId: 9, pmcName: 'Metro PMC', managerId: 12, managerName: 'Sam Staff' },
      { landlordId: 1, landlordName: 'Kelly, Bob' },
    ]);
    expect(filters.landlords.map((item) => item.name)).toEqual(['Kelly, Bob', 'Lee, Ann']);
    expect(filters.pmcs).toEqual([{ id: 9, name: 'Metro PMC' }]);
    expect(filters.managers.map((item) => item.name)).toEqual(['Pat Manager', 'Sam Staff']);
    expect(listingAsPickerUnit({ unitId: 21, unitNumber: '3B', propertyName: 'Pine Court' })).toMatchObject({
      unit_id: 21,
      unit_number: '3B',
      properties: { property_name: 'Pine Court' },
    });
  });
});
