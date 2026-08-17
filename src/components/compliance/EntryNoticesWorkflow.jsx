import React from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';

export default function EntryNoticesWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
  const getWorkflowSteps = () => [
    {
      title: 'Select Lease',
      description: 'Choose the lease for the entry notice.',
      fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
      render: ({ workflowData, updateField, errors }) => (
        <LeaseSelectionPicker
          value={workflowData.lease_id || null}
          error={errors?.lease_id}
          statuses={['active']}
          showRent
          emptyMessage="No active leases found."
          onChange={(leaseId, selected) => stampLeaseSelection(updateField, leaseId, selected)}
        />
      )
    },
    {
      title: 'Entry Details',
      fields: [
        { id: 'entry_date', label: 'Planned Entry Date', type: 'date', required: true },
        { id: 'entry_time', label: 'Planned Entry Time', type: 'text', placeholder: 'e.g., 10:00 AM' },
        { id: 'entry_reason', label: 'Reason for Entry', type: 'select', required: true, options: [
          { value: 'inspection', label: 'Inspection' },
          { value: 'repair', label: 'Repair/Maintenance' },
          { value: 'showing', label: 'Showing to Prospective Tenant' },
          { value: 'emergency', label: 'Emergency' },
          { value: 'other', label: 'Other' }
        ]},
        { id: 'notice_given_date', label: 'Date Written Notice Given (2 days; 1 day for showings)', type: 'date', required: true },
        { id: 'tenant_consent', label: 'Tenant Consent', type: 'select', options: [
          { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'pending', label: 'Pending' }
        ]}
      ]
    },
    {
      title: 'Complete',
      fields: [],
      render: () => <p className="text-gray-600">Document entry notice compliance.</p>
    }
  ];

  return (
    <ComplianceWorkflow
      workflowType="entry_notice"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

