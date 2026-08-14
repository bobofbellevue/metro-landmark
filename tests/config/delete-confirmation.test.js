import {
  DELETE_CONFIRM_PREFIX_LENGTH,
  clampDeleteConfirmationInput,
  getDeleteConfirmationMaxLength,
  getDeleteConfirmationTarget,
  matchesDeleteConfirmation,
} from '../../src/utils/delete-confirmation.js';

describe('delete-confirmation helpers', () => {
  test('uses first 10 characters, or full name when shorter', () => {
    expect(getDeleteConfirmationTarget('lease_notice_2026_final.pdf')).toBe(
      'lease_noti'
    );
    expect(getDeleteConfirmationTarget('short.pdf')).toBe('short.pdf');
    expect(DELETE_CONFIRM_PREFIX_LENGTH).toBe(10);
  });

  test('extends past trailing spaces so the required prefix is at least 10 meaningful chars', () => {
    // First 10 of "Lease for XYZ" are "Lease for " (ends with space).
    // Require through the next non-space character instead.
    expect(getDeleteConfirmationTarget('Lease for XYZ')).toBe('Lease for X');
    expect(getDeleteConfirmationTarget('Lease for XYZ').endsWith(' ')).toBe(
      false
    );
    expect(getDeleteConfirmationTarget('Lease for XYZ').length).toBeGreaterThanOrEqual(
      10
    );
  });

  test('max length is the full name so users can type the whole string', () => {
    const name = 'lease_notice_2026_final.pdf';
    expect(getDeleteConfirmationMaxLength(name)).toBe(name.length);
    expect(getDeleteConfirmationMaxLength('short.pdf')).toBe('short.pdf'.length);
    expect(clampDeleteConfirmationInput('lease_notice_2026_final.pdfEXTRA', name)).toBe(
      name
    );
    expect(clampDeleteConfirmationInput('lease_notic', name)).toBe('lease_notic');
  });

  test('accepts first 10 characters or a longer matching prefix up to full name', () => {
    const name = 'lease_notice_2026_final.pdf';
    expect(matchesDeleteConfirmation('lease_noti', name)).toBe(true);
    expect(matchesDeleteConfirmation('lease_noti ', name)).toBe(true);
    expect(matchesDeleteConfirmation('lease_notice', name)).toBe(true);
    expect(matchesDeleteConfirmation('lease_notice_2', name)).toBe(true);
    expect(matchesDeleteConfirmation(name, name)).toBe(true);
    expect(matchesDeleteConfirmation(`${name}x`, name)).toBe(false);
    expect(matchesDeleteConfirmation('LEASE_NOTI', name)).toBe(false);
    expect(matchesDeleteConfirmation('lease_no', name)).toBe(false);
    expect(matchesDeleteConfirmation('lease_wrong', name)).toBe(false);
  });

  test('Lease for XYZ: 9 chars is not enough; 10+ matching chars work', () => {
    const name = 'Lease for XYZ';
    const target = getDeleteConfirmationTarget(name);
    expect(target).toBe('Lease for X');

    // Truncating the space made "Lease for" (9) look valid before — it must not.
    expect(matchesDeleteConfirmation('Lease for', name)).toBe(false);

    // Required prefix and longer matching prefixes work.
    expect(matchesDeleteConfirmation('Lease for X', name)).toBe(true);
    expect(matchesDeleteConfirmation('Lease for XY', name)).toBe(true);
    expect(matchesDeleteConfirmation('Lease for XYZ', name)).toBe(true);

    // Wrong continuation does not.
    expect(matchesDeleteConfirmation('Lease for Z', name)).toBe(false);
    expect(matchesDeleteConfirmation('Lease for XZZ', name)).toBe(false);
  });
});
