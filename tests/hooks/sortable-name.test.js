import { resolvePersonSortValue } from '../../src/hooks.js';

describe('resolvePersonSortValue', () => {
  test('prefers nested contact last/first name', () => {
    expect(
      resolvePersonSortValue({
        contact: { first_name: 'Ada', last_name: 'Lovelace' },
        email: 'ada@example.com',
      })
    ).toBe('lovelace\u0000ada');
  });

  test('uses top-level first/last when contact is missing', () => {
    expect(
      resolvePersonSortValue({
        first_name: 'Grace',
        last_name: 'Hopper',
      })
    ).toBe('hopper\u0000grace');
  });

  test('falls back to email when no name parts exist', () => {
    expect(resolvePersonSortValue({ email: 'nobody@example.com' })).toBe('nobody@example.com');
  });

  test('sorts last-name-first so displayed Name column order matches indicator', () => {
    const tenants = [
      { contact: { first_name: 'Bob', last_name: 'Jones' }, address_line_1: '100 Main' },
      { contact: { first_name: 'Alice', last_name: 'Smith' }, address_line_1: '10 Oak' },
      { contact: { first_name: 'Carol', last_name: 'Adams' }, address_line_1: '50 Pine' },
    ];

    const sorted = [...tenants].sort((a, b) =>
      resolvePersonSortValue(a).localeCompare(resolvePersonSortValue(b))
    );

    expect(sorted.map((t) => t.contact.last_name)).toEqual(['Adams', 'Jones', 'Smith']);
    // Not address order
    expect(sorted.map((t) => t.address_line_1)).not.toEqual(['10 Oak', '100 Main', '50 Pine']);
  });
});
