import {
  attachDocumentEntityParties,
  attachDocumentTenantContacts,
  documentEntityLines,
  documentLandlordLabel,
  documentLocationLabel,
  documentPersonLabel,
  formatDocumentEntityLabel,
  tenantNamesByLeaseId,
} from '../../src/utils/document-entity-label.js';

const leaseDoc = {
  lease_id: 72,
  lease: {
    landlord_id: 5,
    units: {
      unit_number: '4B',
      properties: { property_name: 'Oak Street', landlord_id: 5 },
    },
  },
};

describe('documentEntityLines', () => {
  test('returns property, tenants, and landlord as separate lines', () => {
    const lines = documentEntityLines({
      ...leaseDoc,
      tenant_names: 'Jane Smith, John Doe',
      landlord_contact: { first_name: 'Pat', last_name: 'Lee' },
    });
    expect(lines).toEqual([
      { role: 'Property', label: 'Oak Street — Unit 4B' },
      { role: 'Tenants', label: 'Jane Smith, John Doe' },
      { role: 'Landlord', label: 'Pat Lee' },
    ]);
    expect(formatDocumentEntityLabel({
      ...leaseDoc,
      tenant_names: 'Jane Smith, John Doe',
      landlord_contact: { first_name: 'Pat', last_name: 'Lee' },
    })).toBe('Oak Street — Unit 4B · Jane Smith, John Doe · Pat Lee');
  });

  test('does not surface internal ids when joins are missing', () => {
    expect(formatDocumentEntityLabel({ lease_id: 72, tenant_user_id: 19 })).toBe(
      ''
    );
    expect(documentLocationLabel({ lease_id: 72 })).toBe('');
    expect(documentPersonLabel({ tenant_user_id: 19 })).toBe('');
    expect(documentLandlordLabel({ landlord_id: 5 })).toBe('');
  });
});

describe('attachDocumentEntityParties', () => {
  test('fills tenant names from the lease and landlord from contacts', () => {
    const [doc] = attachDocumentEntityParties([leaseDoc], {
      tenantsByLeaseId: { 72: ['Jane Smith'] },
      landlordContactsById: {
        5: { first_name: 'Pat', last_name: 'Lee' },
      },
    });
    expect(documentEntityLines(doc)).toEqual([
      { role: 'Property', label: 'Oak Street — Unit 4B' },
      { role: 'Tenant', label: 'Jane Smith' },
      { role: 'Landlord', label: 'Pat Lee' },
    ]);
  });
});

describe('tenantNamesByLeaseId', () => {
  test('groups client contact names by lease', () => {
    expect(
      tenantNamesByLeaseId(
        [
          { lease_id: 72, client_id: 1 },
          { lease_id: 72, client_id: 2 },
        ],
        [
          { contactable_id: 1, first_name: 'Jane', last_name: 'Smith' },
          { contactable_id: 2, first_name: 'John', last_name: 'Doe' },
        ]
      )
    ).toEqual({ 72: ['Jane Smith', 'John Doe'] });
  });

  test('matches contacts keyed by tenant user_id as well as client_id', () => {
    expect(
      tenantNamesByLeaseId(
        [
          {
            lease_id: 72,
            client_id: 1,
            clients: { client_id: 1, user_id: 19 },
          },
        ],
        [{ contactable_id: 19, first_name: 'Jane', last_name: 'Smith' }]
      )
    ).toEqual({ 72: ['Jane Smith'] });
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
