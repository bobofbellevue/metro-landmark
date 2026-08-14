import {
  isInternalTemplateFieldKey,
  makeAllFieldsOptional,
  stripInternalIdFieldsFromDocumentData,
  stripInternalIdFieldsFromTemplate,
} from '../../src/utils/template-field-filter.js';

describe('template-field-filter', () => {
  test('detects internal identity keys', () => {
    expect(isInternalTemplateFieldKey('landlord_id')).toBe(true);
    expect(isInternalTemplateFieldKey('unit_id')).toBe(true);
    expect(isInternalTemplateFieldKey('property_id')).toBe(true);
    expect(isInternalTemplateFieldKey('client_id')).toBe(true);
    expect(isInternalTemplateFieldKey('Lessor')).toBe(false);
    expect(isInternalTemplateFieldKey('monthly_rent_amount')).toBe(false);
  });

  test('strips internal keys from template schema', () => {
    const template = {
      Parties: {
        Lessor: { type: 'string', description: 'Lessor name' },
        landlord_id: { type: 'number', description: 'Internal' },
        unit_id: { type: 'number' },
      },
      Terms: {
        Monthly_Rent: { type: 'string' },
      },
    };

    const stripped = stripInternalIdFieldsFromTemplate(template);
    expect(stripped.Parties.Lessor).toBeTruthy();
    expect(stripped.Parties.landlord_id).toBeUndefined();
    expect(stripped.Parties.unit_id).toBeUndefined();
    expect(stripped.Terms.Monthly_Rent).toBeTruthy();
  });

  test('strips internal keys from document_data', () => {
    const data = {
      Parties: {
        Lessor: 'Ada Owner LLC',
        landlord_id: 9,
      },
      property_id: 3,
    };
    const cleaned = stripInternalIdFieldsFromDocumentData(data);
    expect(cleaned.Parties.Lessor).toBe('Ada Owner LLC');
    expect(cleaned.Parties.landlord_id).toBeUndefined();
    expect(cleaned.property_id).toBeUndefined();
  });

  test('makeAllFieldsOptional marks field definitions optional', () => {
    const template = {
      Parties: {
        Lessor: { type: 'string', required: true },
      },
    };
    const optional = makeAllFieldsOptional(template);
    expect(optional.Parties.Lessor.required).toBe(false);
  });
});

