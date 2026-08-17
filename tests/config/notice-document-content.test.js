import { buildSimpleNoticeContentLines } from '../../utils/document-generator.js';

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
    expect(lines.some((l) => l.includes('not the statutory'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Landlord:'))).toBe(false);
  });

  test('puts tenant figures and Seattle language before the full disclaimer', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      property_name: 'Pine Court',
      unit_number: 'B',
      current_rent: '$1,200.00',
      new_rent: '$1,300.00',
      effective_date: '03/01/2027',
      pack_display_name: 'City of Seattle',
      required_notice_language: [
        'If you need help understanding this notice, call the Renting in Seattle Helpline at (206) 684-5700.',
      ],
      product_name: 'Salish Landmark',
      preferred_landlord_association: {
        name: 'Rental Housing Association of Washington (RHAWA)',
        recommendation:
          'Join RHAWA and import their current city-specific rent-increase templates into Documents.',
      },
    });

    const toIndex = lines.indexOf('To: Ada Lovelace');
    const rentIndex = lines.indexOf('Current Monthly Rent: $1,200.00');
    const effectiveIndex = lines.indexOf('Effective Date: 03/01/2027');
    const signatureIndex = lines.indexOf('Signature: ________________________________');
    const fullDisclaimerIndex = lines.findIndex((l) =>
      l.includes('statutory Washington rent-increase notice')
    );
    const helplineIndexes = lines
      .map((l, i) => (l.includes('Renting in Seattle Helpline') ? i : -1))
      .filter((i) => i >= 0);

    expect(toIndex).toBeGreaterThanOrEqual(0);
    expect(rentIndex).toBeGreaterThan(toIndex);
    expect(effectiveIndex).toBeGreaterThan(rentIndex);
    expect(helplineIndexes.length).toBeGreaterThanOrEqual(2);
    expect(helplineIndexes[0]).toBeLessThan(signatureIndex);
    expect(fullDisclaimerIndex).toBeGreaterThan(signatureIndex);
    expect(
      lines.some(
        (l, i) =>
          i < signatureIndex &&
          l.includes('required language (include on the official form)')
      )
    ).toBe(false);
    expect(
      lines.some(
        (l, i) =>
          i > signatureIndex && l.includes('City of Seattle required language')
      )
    ).toBe(true);
    expect(lines.some((l) => l.includes('Salish Landmark does not provide'))).toBe(
      true
    );
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

  test('includes initiator and cause on lease termination worksheets', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'lease_termination',
      tenant_names: 'Ada Lovelace',
      property_name: 'Pine Court',
      unit_number: 'B',
      effective_date: '11/01/2026',
      initiated_by: 'landlord',
      has_cause: 'yes',
      additional_text: 'Nonpayment after notice.',
    });
    expect(lines).toContain('Initiated by: landlord');
    expect(lines).toContain('Just cause: yes (operator-confirmed)');
    expect(lines).toContain('Nonpayment after notice.');
    expect(lines.some((l) => l.includes('not the statutory'))).toBe(true);
  });

  test('shows the assigned property manager, not the landlord or PMC header', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      pmc_name: 'Salish Property Group',
      landlord_name: 'Bob B. Bellevue',
      landlord_address: '100 Main St, Bellevue, WA 98004',
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

    expect(lines).toContain('Property Manager: Grace Hopper');
    expect(lines).toContain('Phone: 206-555-0100');
    expect(lines).toContain('Email: grace@example.com');
    expect(lines.some((l) => l.startsWith('Landlord:'))).toBe(false);
    expect(lines).not.toContain('100 Main St, Bellevue, WA 98004');
    expect(lines).not.toContain(
      'Property Management Company: Salish Property Group'
    );
    expect(lines).toContain('Signature: ________________________________');
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

    expect(lines).toContain('Landlord: Ada Owner');
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
      'If you have any questions about this notice, please contact:'
    );
    expect(lines).toContain('Salish Property Group');
    expect(
      lines.some((l) =>
        l.includes('your property manager, property management company, or landlord')
      )
    ).toBe(false);
    expect(lines).toContain('Signature: ________________________________');
  });

  test('includes landlord name and contact info when self-managing', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      property_name: 'Pine Court',
      unit_number: 'B',
      effective_date: '11/01/2026',
      questions_contact: {
        role: 'Landlord',
        name: 'Bob B. Bellevue',
        address: '100 Main St, Bellevue, WA 98004',
        phone: '360-555-0142',
        email: 'bob@example.com',
        contact_lines: ['Phone: 360-555-0142', 'Email: bob@example.com'],
      },
    });

    expect(lines).toContain('Unit: B');
    expect(lines).toContain('Landlord: Bob B. Bellevue');
    expect(lines).not.toContain('100 Main St, Bellevue, WA 98004');
    expect(lines).toContain('Phone: 360-555-0142');
    expect(lines).toContain('Email: bob@example.com');
  });

  test('shows PMC office as the questions contact without a landlord line', () => {
    const lines = buildSimpleNoticeContentLines({
      notice_type_key: 'rent_increase',
      tenant_names: 'Ada Lovelace',
      property_name: 'Pine Court',
      unit_number: 'B',
      effective_date: '11/01/2026',
      questions_contact: {
        role: 'Property Management Company',
        name: 'Salish Property Group',
        phone: '425-555-0100',
        email: 'office@salish.example',
        contact_lines: [
          'Phone: 425-555-0100',
          'Email: office@salish.example',
        ],
      },
    });

    expect(lines).toContain(
      'Property Management Company: Salish Property Group'
    );
    expect(lines).toContain('Phone: 425-555-0100');
    expect(lines.some((l) => l.startsWith('Landlord:'))).toBe(false);
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
