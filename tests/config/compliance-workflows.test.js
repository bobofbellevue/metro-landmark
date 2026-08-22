import { complianceWorkflowTitle } from '../../src/config/compliance-workflows.js';

describe('compliance workflow titles', () => {
  test('names rent increase and other processes', () => {
    expect(complianceWorkflowTitle('rent_increase')).toBe('Rent Increase Notice');
    expect(complianceWorkflowTitle('lease_renewal')).toBe('Lease Renewal');
    expect(complianceWorkflowTitle('unknown')).toBe('');
    expect(complianceWorkflowTitle('')).toBe('');
  });
});
