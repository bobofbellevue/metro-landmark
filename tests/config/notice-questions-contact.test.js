import {
  buildQuestionsContactLines,
  formatLandlordFormattedName,
  resolveNoticeQuestionsContact,
} from '../../src/utils/notice-questions-contact.js';

/**
 * Minimal thenable query builder for notice contact resolution tests.
 * @param {Record<string, object[]>} tables
 */
function createMockSupabase(tables) {
  const matchRow = (row, filters) =>
    filters.every(([col, val]) => row[col] === val);

  return {
    from(table) {
      const state = { table, filters: [], limit: null };
      const execute = () => {
        let rows = (tables[state.table] || []).filter((row) =>
          matchRow(row, state.filters)
        );
        if (state.limit != null) rows = rows.slice(0, state.limit);
        return { data: rows, error: null };
      };
      const q = {
        select() {
          return q;
        },
        eq(col, val) {
          state.filters.push([col, val]);
          return q;
        },
        limit(n) {
          state.limit = n;
          return q;
        },
        maybeSingle: async () => {
          const { data } = execute();
          if (data.length > 1) {
            return { data: null, error: { message: 'multiple rows' } };
          }
          return { data: data[0] || null, error: null };
        },
        then(resolve, reject) {
          return Promise.resolve(execute()).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

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

describe('resolveNoticeQuestionsContact', () => {
  test('uses the assigned property manager and their contact info', async () => {
    const supabase = createMockSupabase({
      users: [{ user_id: 10, email: 'grace@example.com', role: 'manager' }],
      contacts: [
        {
          contact_id: 1,
          contactable_type: 'user',
          contactable_id: 10,
          first_name: 'Grace',
          middle_name: '',
          last_name: 'Hopper',
        },
      ],
      contact_methods: [
        { contact_id: 1, method_type: 'phone', value: '206-555-0100' },
        { contact_id: 1, method_type: 'email', value: 'grace@example.com' },
      ],
      pm_companies: [{ pmc_id: 5, company_name: 'Salish Property Group' }],
      landlords: [{ landlord_id: 9, user_id: 99 }],
    });

    const contact = await resolveNoticeQuestionsContact(
      supabase,
      { manager_id: 10, pmc_id: 5, landlord_id: 9 },
      9
    );

    expect(contact.role).toBe('Property Manager');
    expect(contact.name).toBe('Grace Hopper');
    expect(contact.phone).toBe('206-555-0100');
    expect(contact.email).toBe('grace@example.com');
  });

  test('fills missing PM phone from the PMC office', async () => {
    const supabase = createMockSupabase({
      users: [{ user_id: 10, email: 'grace@example.com', role: 'manager' }],
      contacts: [
        {
          contact_id: 1,
          contactable_type: 'user',
          contactable_id: 10,
          first_name: 'Grace',
          last_name: 'Hopper',
        },
        {
          contact_id: 2,
          contactable_type: 'pm_company',
          contactable_id: 5,
        },
      ],
      contact_methods: [
        { contact_id: 2, method_type: 'phone', value: '206-555-0199' },
      ],
      pm_companies: [{ pmc_id: 5, company_name: 'Salish Property Group' }],
    });

    const contact = await resolveNoticeQuestionsContact(supabase, {
      manager_id: 10,
      pmc_id: 5,
      landlord_id: 9,
    });

    expect(contact.role).toBe('Property Manager');
    expect(contact.name).toBe('Grace Hopper');
    expect(contact.phone).toBe('206-555-0199');
  });

  test('uses PMC company name and office contact when no PM is assigned', async () => {
    const supabase = createMockSupabase({
      pm_companies: [{ pmc_id: 5, company_name: 'Salish Property Group' }],
      contacts: [
        { contact_id: 2, contactable_type: 'pm_company', contactable_id: 5 },
        {
          contact_id: 3,
          contactable_type: 'landlord',
          contactable_id: 9,
          first_name: 'Bob',
          last_name: 'Owner',
        },
      ],
      contact_methods: [
        { contact_id: 2, method_type: 'phone', value: '425-555-0100' },
        { contact_id: 2, method_type: 'email', value: 'office@salish.example' },
      ],
      landlords: [{ landlord_id: 9, user_id: 99 }],
    });

    const contact = await resolveNoticeQuestionsContact(supabase, {
      manager_id: null,
      pmc_id: 5,
      landlord_id: 9,
    });

    expect(contact.role).toBe('Property Management Company');
    expect(contact.name).toBe('Salish Property Group');
    expect(contact.phone).toBe('425-555-0100');
    expect(contact.email).toBe('office@salish.example');
  });

  test('uses landlord contact only when the property is self-managed', async () => {
    const supabase = createMockSupabase({
      landlords: [{ landlord_id: 9, user_id: 99 }],
      users: [{ user_id: 99, email: 'bob@example.com' }],
      contacts: [
        {
          contact_id: 3,
          contactable_type: 'landlord',
          contactable_id: 9,
          first_name: 'Bob',
          middle_name: 'B',
          last_name: 'Bellevue',
        },
      ],
      contact_methods: [
        { contact_id: 3, method_type: 'phone', value: '360-555-0142' },
        { contact_id: 3, method_type: 'email', value: 'bob@example.com' },
      ],
      addresses: [
        {
          addressable_type: 'landlord',
          addressable_id: 9,
          address_line_1: '100 Main St',
          city: 'Bellevue',
          state_province_region: 'WA',
          postal_code: '98004',
        },
      ],
    });

    const contact = await resolveNoticeQuestionsContact(
      supabase,
      { manager_id: null, pmc_id: null, landlord_id: 9 },
      9
    );

    expect(contact.role).toBe('Landlord');
    expect(contact.name).toBe('Bob B. Bellevue');
    expect(contact.phone).toBe('360-555-0142');
    expect(contact.email).toBe('bob@example.com');
    expect(contact.address).toBeUndefined();
  });

  test('does not fall back to landlord when a PMC is assigned', async () => {
    const supabase = createMockSupabase({
      pm_companies: [{ pmc_id: 5, company_name: 'Salish Property Group' }],
      landlords: [{ landlord_id: 9, user_id: 99 }],
      contacts: [
        {
          contact_id: 3,
          contactable_type: 'landlord',
          contactable_id: 9,
          first_name: 'Bob',
          last_name: 'Owner',
        },
      ],
    });

    const contact = await resolveNoticeQuestionsContact(supabase, {
      manager_id: null,
      pmc_id: 5,
      landlord_id: 9,
    });

    expect(contact.role).toBe('Property Management Company');
    expect(contact.name).toBe('Salish Property Group');
  });

  test('still finds landlord contact without landlords.manager_id', async () => {
    const supabase = createMockSupabase({
      landlords: [{ landlord_id: 9, user_id: 99 }],
      users: [{ user_id: 99, email: 'bob@example.com' }],
      contacts: [
        {
          contact_id: 3,
          contactable_type: 'landlord',
          contactable_id: 9,
          first_name: 'Ada',
          last_name: 'Owner',
        },
      ],
      contact_methods: [],
    });

    const contact = await resolveNoticeQuestionsContact(supabase, {
      landlord_id: 9,
    });

    expect(contact.name).toBe('Ada Owner');
    expect(contact.email).toBe('bob@example.com');
  });
});

describe('buildQuestionsContactLines', () => {
  test('labels a property manager with phone and email', () => {
    const lines = buildQuestionsContactLines({
      role: 'Property Manager',
      name: 'Grace Hopper',
      phone: '206-555-0100',
      email: 'grace@example.com',
      contact_lines: ['Phone: 206-555-0100', 'Email: grace@example.com'],
    });
    expect(lines).toContain(
      'If you have any questions about this notice, please contact:'
    );
    expect(lines).toContain('Property Manager: Grace Hopper');
    expect(lines).toContain('Phone: 206-555-0100');
    expect(lines).toContain('Email: grace@example.com');
  });

  test('does not print landlord mailing address even when present on the contact', () => {
    const landlordLines = buildQuestionsContactLines({
      role: 'Landlord',
      name: 'Bob B. Bellevue',
      address: '100 Main St, Bellevue, WA 98004',
      contact_lines: ['Phone: 360-555-0142'],
    });
    expect(landlordLines).toContain('Landlord: Bob B. Bellevue');
    expect(landlordLines).not.toContain('100 Main St, Bellevue, WA 98004');
  });
});
