import {
  buildSimpleRenewalContentLines,
} from '../../utils/document-generator.js';

describe('buildSimpleRenewalContentLines', () => {
  test('includes renewal term, rent, unit, and signature lines', () => {
    const lines = buildSimpleRenewalContentLines({
      primary_tenant_name: 'Ada Lovelace',
      property_name: 'Pine Court',
      unit_number: 'B',
      original_lease_start_date: '01/01/2025',
      original_lease_end_date: '12/31/2025',
      renewal_start_date: '01/01/2026',
      renewal_end_date: '12/31/2026',
      original_monthly_rent: '$1,200.00',
      monthly_rent: '$1,300.00',
      security_deposit: '$1,200.00',
    });

    expect(lines).toContain('To: Ada Lovelace');
    expect(lines).toContain('Unit: B');
    expect(lines).toContain('Renewal Start Date: 01/01/2026');
    expect(lines).toContain('Renewal End Date: 12/31/2026');
    expect(lines).toContain('Previous Monthly Rent: $1,200.00');
    expect(lines).toContain('New Monthly Rent: $1,300.00');
    expect(lines).toContain('Signature: ________________________________');
  });
});
