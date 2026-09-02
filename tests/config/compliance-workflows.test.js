import {
  COMPLIANCE_LIFECYCLE_STAGES,
  COMPLIANCE_WORKFLOW_CATALOG,
  complianceWorkflowCardId,
  complianceWorkflowTitle,
  formatComplianceWorkflowNumber,
  labeledComplianceWorkflow,
  pickComplianceWorkflowForJump,
  searchComplianceWorkflows,
} from '../../src/config/compliance-workflows.js';

describe('compliance workflow titles', () => {
  test('names rent increase and other processes', () => {
    expect(complianceWorkflowTitle('rent_increase')).toBe('Rent Increase Notice');
    expect(complianceWorkflowTitle('lease_renewal')).toBe('Lease Renewal');
    expect(complianceWorkflowTitle('unknown')).toBe('');
    expect(complianceWorkflowTitle('')).toBe('');
  });
});

describe('compliance workflow lifecycle catalog', () => {
  test('orders workflows along the tenancy lifecycle with two-digit numbers', () => {
    expect(COMPLIANCE_WORKFLOW_CATALOG.map((item) => item.id)).toEqual([
      'tenant_screening',
      'move_in',
      'entry_notice',
      'rent_increase',
      'lease_renewal',
      'habitability',
      'lease_violation',
      'collections',
      'lease_termination',
      'eviction',
      'move_out',
      'security_deposit',
    ]);
    expect(COMPLIANCE_WORKFLOW_CATALOG.map((item) => item.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(formatComplianceWorkflowNumber(4)).toBe('04');
    expect(formatComplianceWorkflowNumber(12)).toBe('12');
    expect(COMPLIANCE_LIFECYCLE_STAGES.map((stage) => stage.id)).toEqual([
      'start',
      'occupancy',
      'end',
    ]);
  });

  test('labels workflows with the lifecycle number', () => {
    expect(labeledComplianceWorkflow('rent_increase')).toBe('04 Rent Increase Notice');
    expect(labeledComplianceWorkflow('tenant_screening')).toBe(
      '01 Tenant Screening Compliance'
    );
    expect(labeledComplianceWorkflow('rent_control')).toBe('Rent Control (removed)');
    expect(complianceWorkflowCardId('move_in')).toBe('compliance-workflow-02');
  });

  test('searches by number, name, or description', () => {
    expect(searchComplianceWorkflows('04').map((item) => item.id)).toEqual([
      'rent_increase',
    ]);
    expect(searchComplianceWorkflows('4').map((item) => item.id)).toEqual([
      'rent_increase',
    ]);
    expect(searchComplianceWorkflows('1').map((item) => item.id)).toEqual([
      'tenant_screening',
      'eviction',
      'move_out',
      'security_deposit',
    ]);
    expect(searchComplianceWorkflows('deposit').map((item) => item.id)).toEqual([
      'move_out',
      'security_deposit',
    ]);
    expect(searchComplianceWorkflows('first-qualified').map((item) => item.id)).toEqual(
      ['tenant_screening']
    );
    expect(searchComplianceWorkflows('pay-or-vacate').map((item) => item.id)).toEqual([
      'collections',
    ]);
    expect(searchComplianceWorkflows('20-day').map((item) => item.id)).toEqual([
      'lease_violation',
    ]);
  });

  test('jumps to an exact number or a unique name match', () => {
    expect(pickComplianceWorkflowForJump('04')?.id).toBe('rent_increase');
    expect(pickComplianceWorkflowForJump('12')?.id).toBe('security_deposit');
    expect(pickComplianceWorkflowForJump('1')?.id).toBe('tenant_screening');
    expect(pickComplianceWorkflowForJump('2')?.id).toBe('move_in');
    expect(pickComplianceWorkflowForJump('screening')?.id).toBe('tenant_screening');
    expect(pickComplianceWorkflowForJump('deposit')).toBeNull();
    expect(pickComplianceWorkflowForJump('')).toBeNull();
  });
});
