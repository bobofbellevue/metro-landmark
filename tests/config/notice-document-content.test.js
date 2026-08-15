import {
  buildSimpleNoticeContentLines,
  formatLandlordFormattedName,
} from '../../utils/document-generator.js';

describe('formatLandlordFormattedName', () => {
  test('uses contact first+last when landlord_name is null', () => {
    expect(
      formatLandlordFormattedName(
        { landlord_name: null },
        { first_name: 'Bob', middle_name: 'Q', last_name: 'Owner' }
      )
    ).toBe('Bob Q. Owner');
  });

  test('falls back to landlord_name when contact names are missing', () => {
    expect(
      formatLandlordFormattedName(
        { landlord_name: 'Acme Holdings' },
        { first_name: '', last_name: '' }
      )
    ).toBe('Acme Holdings');
  });
});

describe('buildSimpleNoticeContentLines', () => {
  test('includes current and new rent for rent increase notices', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      property_name: 'Pine Court',
      unit_number: 'B',
      current_rent: '$1,200.00',
      new_rent: '$1,300.00',
      percent_increase: 8.333,
      effective_date: '11/01/2026',
    });

    expect(lines).toContain('To: Ada Lovelace');
    expect(lines).toContain('Current Monthly Rent: $1,200.00');
    expect(lines).toContain('New Monthly Rent: $1,300.00');
    expect(lines).toContain('Increase: 8.3%');
    expect(lines).toContain('Effective Date: 11/01/2026');
    expect(lines.some((l) => l.startsWith('Landlord:'))).toBe(false);
  });

  test('omits rent lines for other notice types', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'eviction',
      tenant_names: 'Ada Lovelace',
      property_name: 'Pine Court',
      unit_number: 'B',
      current_rent: '$1,200.00',
      effective_date: '11/01/2026',
    });

    expect(lines.some((l) => l.startsWith('Current Monthly Rent:'))).toBe(false);
    expect(lines).toContain('Effective Date: 11/01/2026');
  });

  test('includes named contact with phone and email lines', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      pmc_name: 'Salish Property Group',
      property_name: 'Pine Court',
      unit_number: 'B',
      current_rent: '$1,200.00',
      new_rent: '$1,300.00',
      effective_date: '11/01/2026',
      questions_contact: {
        role: 'Property Manager',
        name: 'Grace Hopper',
        phone: '206-555-0100',
        email: 'grace@example.com',
        contact_lines: ['Phone: 206-555-0100', 'Email: grace@example.com'],
      },
    });

    expect(lines).toContain('Property Management Company: Salish Property Group');
    expect(lines).toContain(
      'If you have any questions about this notice, please contact Grace Hopper.'
    );
    expect(lines).toContain('Phone: 206-555-0100');
    expect(lines).toContain('Email: grace@example.com');
    expect(lines).toContain('Signature: ________________________________');
    expect(lines).toContain('Printed Name: _____________________________');
    expect(lines).toContain('Date: ____________________________________');
  });

  test('falls back to phone/email fields when contact_lines is absent', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      property_name: 'Pine Court',
      unit_number: 'B',
      effective_date: '11/01/2026',
      questions_contact: {
        role: 'Landlord',
        name: 'Ada Owner',
        phone: '425-555-0199',
        email: 'owner@example.com',
      },
    });

    expect(lines).toContain(
      'If you have any questions about this notice, please contact Ada Owner.'
    );
    expect(lines).toContain('Phone: 425-555-0199');
    expect(lines).toContain('Email: owner@example.com');
  });

  test('falls back to PMC name for questions contact when no person is set', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      pmc_name: 'Salish Property Group',
      property_name: 'Pine Court',
      unit_number: 'B',
      effective_date: '11/01/2026',
    });

    expect(lines).toContain(
      'If you have any questions about this notice, please contact Salish Property Group.'
    );
    expect(
      lines.some((l) =>
        l.includes('your property manager, property management company, or landlord')
      )
    ).toBe(false);
    expect(lines).toContain('Signature: ________________________________');
  });

  test('includes landlord name and contact info when no PM/PMC', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      property_name: 'Pine Court',
      unit_number: 'B',
      effective_date: '11/01/2026',
      questions_contact: {
        role: 'Landlord',
        name: 'Bob B. Bellevue',
        phone: '360-555-0142',
        email: 'bob@example.com',
        contact_lines: ['Phone: 360-555-0142', 'Email: bob@example.com'],
      },
    });

    expect(lines).toContain('Unit: B');
    expect(lines).toContain(
      'If you have any questions about this notice, please contact Bob B. Bellevue.'
    );
    expect(lines).toContain('Phone: 360-555-0142');
    expect(lines).toContain('Email: bob@example.com');
  });

  test('always includes landlord name and mailing address as party info', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      landlord_name: 'Bob B. Bellevue',
      landlord_address: '100 Main St, Bellevue, WA 98004',
      pmc_name: 'Salish Property Group',
      property_name: 'Pine Court',
      unit_number: 'B',
      current_rent: '$1,200.00',
      new_rent: '$1,300.00',
      effective_date: '11/01/2026',
      questions_contact: {
        role: 'Property Manager',
        name: 'Grace Hopper',
        phone: '206-555-0100',
        email: 'grace@example.com',
        contact_lines: ['Phone: 206-555-0100', 'Email: grace@example.com'],
      },
    });

    expect(lines).toContain('Landlord: Bob B. Bellevue');
    expect(lines).toContain('100 Main St, Bellevue, WA 98004');
    expect(lines.indexOf('Landlord: Bob B. Bellevue')).toBeLessThan(
      lines.indexOf('Property Management Company: Salish Property Group')
    );
    expect(lines).toContain(
      'If you have any questions about this notice, please contact Grace Hopper.'
    );
  });

  test('uses lessor aliases when landlord_name is absent', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      lessor_name: 'Acme Holdings LLC',
      lessor_address: '200 Owner Ave, Seattle, WA 98101',
      property_name: 'Pine Court',
      unit_number: 'B',
      effective_date: '11/01/2026',
    });

    expect(lines).toContain('Landlord: Acme Holdings LLC');
    expect(lines).toContain('200 Owner Ave, Seattle, WA 98101');
  });

  test('shows N/A only when unit_number is missing', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      property_name: 'Pine Court',
      effective_date: '11/01/2026',
    });
    expect(lines).toContain('Unit: N/A');
  });
});
