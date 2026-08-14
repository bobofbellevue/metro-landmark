import {
  deepMergeObjects,
  findTemplateField,
  mapLeaseLikeDataToTemplate,
} from '../../utils/map-template-fields.js';

describe('map-template-fields', () => {
  const templateData = {
    Parties: {
      Lessor: { type: 'string', description: 'Landlord / owner name' },
      Lessee: { type: 'string', description: 'Tenant name' },
    },
    Terms: {
      start_date: { type: 'date', description: 'Lease start date' },
      end_date: { type: 'date', description: 'Lease end date' },
      monthly_rent: { type: 'currency', description: 'Monthly rent amount' },
    },
    Premises: {
      unit_number: { type: 'string', description: 'Unit number' },
      property_address: { type: 'string', description: 'Property address' },
    },
  };

  test('findTemplateField matches key and description variations', () => {
    expect(findTemplateField(templateData, ['landlord_name', 'Lessor'])?.path).toBe(
      'Parties.Lessor'
    );
    expect(findTemplateField(templateData, ['Tenant Name', 'Lessee'])?.path).toBe(
      'Parties.Lessee'
    );
    expect(findTemplateField(templateData, ['Monthly Rent'])?.path).toBe(
      'Terms.monthly_rent'
    );
  });

  test('mapLeaseLikeDataToTemplate writes nested values for renewal fields', () => {
    const mapped = mapLeaseLikeDataToTemplate(templateData, {
      start_date: '09/01/2026',
      end_date: '08/31/2027',
      monthly_rent_amount: '$1,450.00',
      landlord_name: 'Bob B. Bellevue',
      tenant_names: 'Ada Lovelace',
      unit_number: 'B',
      property_address: '123 Pine St, Seattle, WA 98101',
    });

    expect(mapped.Parties.Lessor).toBe('Bob B. Bellevue');
    expect(mapped.Parties.Lessee).toBe('Ada Lovelace');
    expect(mapped.Terms.start_date).toBe('09/01/2026');
    expect(mapped.Terms.end_date).toBe('08/31/2027');
    expect(mapped.Terms.monthly_rent).toBe('$1,450.00');
    expect(mapped.Premises.unit_number).toBe('B');
    expect(mapped.Premises.property_address).toBe(
      '123 Pine St, Seattle, WA 98101'
    );
  });

  test('maps county and rent due date fields', () => {
    const schema = {
      Premises: {
        County: { type: 'string', description: 'County of Jurisdiction' },
        Rent_Due_Date: { type: 'string', description: 'Rent Due Date' },
      },
    };
    const mapped = mapLeaseLikeDataToTemplate(schema, {
      property_county: 'King',
      rent_due_date: 'first',
    });
    expect(mapped.Premises.County).toBe('King');
    expect(mapped.Premises.Rent_Due_Date).toBe('first');
  });

  test('prefers Security_Deposit_Amount over Security_Deposit_Bank', () => {
    const schema = {
      Lease_Rental_Agreement: {
        Security_Deposit_Amount: {
          type: 'string',
          description: 'Amount of the security deposit',
        },
        Security_Deposit_Bank: {
          type: 'string',
          description: 'Bank where the security deposit is held',
        },
      },
    };
    expect(
      findTemplateField(schema, [
        'Security Deposit Amount',
        'security_deposit_amount',
        'Security Deposit',
        'security_deposit',
      ])?.path
    ).toBe('Lease_Rental_Agreement.Security_Deposit_Amount');

    const mapped = mapLeaseLikeDataToTemplate(schema, {
      security_deposit_amount: '$1,500.00',
    });
    expect(mapped.Lease_Rental_Agreement.Security_Deposit_Amount).toBe('$1,500.00');
    expect(mapped.Lease_Rental_Agreement.Security_Deposit_Bank).toBeUndefined();
  });
});
