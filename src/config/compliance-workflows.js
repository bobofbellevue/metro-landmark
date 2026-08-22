/**
 * Operator-facing names for Compliance Center workflows.
 * Keep in sync with the process cards on the Compliance page.
 */
export const COMPLIANCE_WORKFLOW_TITLES = Object.freeze({
  rent_increase: 'Rent Increase Notice',
  lease_renewal: 'Lease Renewal',
  move_in: 'Move-In Process',
  move_out: 'Move-Out Process',
  security_deposit: 'Security Deposit Return',
  collections: 'Collections Process',
  eviction: 'Eviction Process',
  lease_violation: 'Lease Violation Notices',
  lease_termination: 'Lease Termination Notices',
  habitability: 'Habitability Issues',
  entry_notice: 'Entry Notices',
  tenant_screening: 'Tenant Screening Compliance',
});

export function complianceWorkflowTitle(workflowType) {
  if (!workflowType) return '';
  return COMPLIANCE_WORKFLOW_TITLES[workflowType] || '';
}
