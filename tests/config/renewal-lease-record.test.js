import {
  buildRenewalLeaseInsert,
  collectOriginalLeaseClientIds,
} from '../../src/utils/renewal-lease-record.js';

describe('renewal-lease-record', () => {
  test('builds insert payload copying identity FKs and deposits', () => {
    const payload = buildRenewalLeaseInsert(
      {
        unit_id: 12,
        landlord_id: 4,
        pmc_id: 2,
        monthly_rent_amount: 1200,
        security_deposit_amount: 1200,
        pet_deposit_amount: 200,
        other_fee_amount: 25,
        dependent_names: 'Sam',
        pets: 'Cat',
        comment: 'Quiet',
        template_id: 7,
      },
      {
        start_date: '2026-09-01',
        end_date: '2027-08-31',
        monthly_rent_amount: 1300,
        date_of_agreement: '2026-08-13',
        document_data: { Parties: { Lessor: 'Owner LLC' } },
      }
    );

    expect(payload).toMatchObject({
      unit_id: 12,
      landlord_id: 4,
      pmc_id: 2,
      start_date: '2026-09-01',
      end_date: '2027-08-31',
      monthly_rent_amount: 1300,
      status: 'active',
      security_deposit_amount: 1200,
      pet_deposit_amount: 200,
      template_id: 7,
    });
    expect(payload.document_data.Parties.Lessor).toBe('Owner LLC');
  });

  test('requires unit_id and start_date', () => {
    expect(() =>
      buildRenewalLeaseInsert({ monthly_rent_amount: 1 }, { start_date: '2026-01-01', monthly_rent_amount: 1 })
    ).toThrow(/unit_id/);
    expect(() =>
      buildRenewalLeaseInsert({ unit_id: 1 }, { monthly_rent_amount: 1 })
    ).toThrow(/start_date/);
  });

  test('collects unique client ids from lease_clients', () => {
    const ids = collectOriginalLeaseClientIds({
      lease_clients: [
        { client_id: 1 },
        { clients: { client_id: 2 } },
        { client: { client_id: 1 } },
      ],
    });
    expect(ids.sort()).toEqual([1, 2]);
  });
});
