import {
  buildDocumentTypeFilterOptions,
  formatDocumentTypeLabel,
  DOCUMENT_TYPE_CATALOG,
} from '../../src/config/document-types.js';

describe('document-types catalog', () => {
  test('formats known and unknown types', () => {
    expect(formatDocumentTypeLabel('rent_increase_notice')).toBe(
      'Rent Increase Notice'
    );
    expect(formatDocumentTypeLabel('template_document')).toBe(
      'Template Source File'
    );
    expect(formatDocumentTypeLabel('custom_bid_packet')).toBe('Custom Bid Packet');
  });

  test('filter options keep catalog entries even when none discovered', () => {
    const options = buildDocumentTypeFilterOptions([]);
    expect(options.some((o) => o.value === 'rental_application')).toBe(true);
    expect(options.some((o) => o.value === 'template_document')).toBe(true);
    expect(options.some((o) => o.value === 'rent_increase_notice')).toBe(true);
  });

  test('filter options include discovered unknown types', () => {
    const options = buildDocumentTypeFilterOptions(['vendor_invoice_scan']);
    expect(options.some((o) => o.value === 'vendor_invoice_scan')).toBe(true);
    expect(DOCUMENT_TYPE_CATALOG.work_authorization.category).toBe('maintenance');
  });
});
