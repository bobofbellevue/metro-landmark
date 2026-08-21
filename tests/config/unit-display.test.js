import {
  filterUnitsBySearch,
  formatPlaceWithUnit,
  formatUnitAddressLine,
  formatUnitAtProperty,
  formatUnitLocationLine,
  formatUnitPickerLabel,
  formatUnitQualifier,
  normalizeStoredUnitNumber,
  sortUnitsForPicker,
  unitSearchHaystack,
  validatePropertyUnitNumbers,
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

  test('compact unit picker label is property plus unit name', () => {
    expect(
      formatUnitPickerLabel({
        unit_number: '2A',
        properties: { property_name: 'Pine Court' },
      })
    ).toBe('Pine Court · 2A');
    expect(
      formatUnitPickerLabel({
        unit_number: '',
        properties: { property_name: 'Oak House' },
      })
    ).toBe('Oak House');
  });

  test('unit qualifier is omitted when the dwelling has no number', () => {
    expect(formatUnitQualifier({ unit_number: '2B' })).toBe('Unit 2B');
    expect(formatUnitQualifier({ unit_number: null })).toBe('');
    expect(formatUnitQualifier('')).toBe('');
    expect(normalizeStoredUnitNumber('  3A  ')).toBe('3A');
    expect(normalizeStoredUnitNumber('')).toBeNull();
  });

  test('location line skips Unit when unlabeled', () => {
    expect(
      formatUnitLocationLine({
        unit_number: '2B',
        property_address: { address_line_1: '123 Main St', city: 'Seattle', state_province_region: 'WA' },
      })
    ).toBe('Unit 2B - 123 Main St, Seattle, WA');
    expect(
      formatUnitLocationLine({
        unit_number: null,
        properties: { property_name: 'Oak House' },
        property_address: { address_line_1: '9 Oak Ave', city: 'Tacoma' },
      })
    ).toBe('9 Oak Ave, Tacoma');
    expect(formatPlaceWithUnit('9 Oak Ave', { unit_number: null })).toBe('9 Oak Ave');
    expect(formatPlaceWithUnit('9 Oak Ave', { unit_number: 'A' })).toBe('9 Oak Ave - Unit A');
    expect(formatUnitAtProperty({ unit_number: '2B' }, 'Pine Court')).toBe('Unit 2B at Pine Court');
    expect(formatUnitAtProperty({ unit_number: null }, 'Oak House')).toBe('Oak House');
  });

  test('two or more units on a property must have distinct numbers', () => {
    expect(validatePropertyUnitNumbers([{ unit_number: null }])).toEqual({ ok: true });
    expect(validatePropertyUnitNumbers([])).toEqual({ ok: true });
    expect(validatePropertyUnitNumbers([{ unit_number: 'A' }, { unit_number: 'B' }]).ok).toBe(true);
    expect(validatePropertyUnitNumbers([{ unit_number: null }, { unit_number: '2' }]).ok).toBe(false);
    expect(validatePropertyUnitNumbers([{ unit_number: '2B' }, { unit_number: '2b' }]).ok).toBe(false);
  });
});
