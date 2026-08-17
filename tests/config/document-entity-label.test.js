import {
  attachDocumentTenantContacts,
  documentLocationLabel,
  documentPersonLabel,
  formatDocumentEntityLabel,
} from '../../src/utils/document-entity-label.js';

describe('formatDocumentEntityLabel', () => {
  test('uses property and unit from a nested lease join', () => {
    expect(
      formatDocumentEntityLabel({
        lease_id: 72,
        lease: {
          units: {
            unit_number: '4B',
            properties: { property_name: 'Oak Street' },
          },
        },
      })
    ).toBe('Oak Street — Unit 4B');
  });

  test('uses a direct property join when there is no lease', () => {
    expect(
      formatDocumentEntityLabel({
        property_id: 8,
        property: { property_name: 'Pine Court' },
      })
    ).toBe('Pine Court');
  });

  test('uses the tenant contact name when there is no location', () => {
    expect(
      formatDocumentEntityLabel({
        tenant_user_id: 19,
        tenant_contact: { first_name: 'Jane', last_name: 'Smith' },
      })
    ).toBe('Jane Smith');
  });

  test('does not surface internal ids when joins are missing', () => {
    expect(formatDocumentEntityLabel({ lease_id: 72, tenant_user_id: 19 })).toBe(
      ''
    );
    expect(documentLocationLabel({ lease_id: 72 })).toBe('');
    expect(documentPersonLabel({ tenant_user_id: 19 })).toBe('');
  });
});

describe('attachDocumentTenantContacts', () => {
  test('maps contacts onto matching tenant_user_id rows', () => {
    const docs = attachDocumentTenantContacts(
      [{ document_id: 1, tenant_user_id: 19 }],
      [{ contactable_id: 19, first_name: 'Jane', last_name: 'Smith' }]
    );
    expect(formatDocumentEntityLabel(docs[0])).toBe('Jane Smith');
  });
});
