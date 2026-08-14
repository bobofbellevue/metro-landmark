import {
  filterUnitsBySearch,
  formatUnitAddressLine,
  sortUnitsForPicker,
  unitSearchHaystack,
} from '../../src/utils/unit-display.js';

describe('unit-display helpers', () => {
  test('formats address lines', () => {
    expect(
      formatUnitAddressLine({
        address_line_1: '123 Main St',
        address_line_2: 'Suite 2',
        city: 'Seattle',
        state_province_region: 'WA',
        postal_code: '98101',
      })
    ).toBe('123 Main St, Suite 2, Seattle, WA, 98101');
  });

  test('filters and sorts units by property, unit, and address', () => {
    const units = [
      {
        unit_id: 2,
        unit_number: '10',
        properties: { property_name: 'Oak House' },
        property_address: { address_line_1: '9 Oak Ave', city: 'Tacoma' },
      },
      {
        unit_id: 1,
        unit_number: '2A',
        properties: { property_name: 'Pine Court' },
        property_address: {
          address_line_1: '123 Main St',
          city: 'Seattle',
          state_province_region: 'WA',
        },
      },
      {
        unit_id: 3,
        unit_number: '1',
        properties: { property_name: 'Pine Court' },
        property_address: { address_line_1: '123 Main St', city: 'Seattle' },
      },
    ];

    expect(filterUnitsBySearch(units, 'pine')).toHaveLength(2);
    expect(filterUnitsBySearch(units, '2a')).toHaveLength(1);
    expect(filterUnitsBySearch(units, 'tacoma')).toHaveLength(1);
    expect(unitSearchHaystack(units[1])).toContain('pine court');

    const sorted = sortUnitsForPicker(units);
    expect(sorted.map((u) => u.unit_id)).toEqual([2, 3, 1]);
  });
});
