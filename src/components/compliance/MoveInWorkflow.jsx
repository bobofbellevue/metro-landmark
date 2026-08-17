import React from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';

export default function MoveInWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
  const getWorkflowSteps = () => [
    {
      title: 'Select Lease',
      description: 'Choose the lease for move-in.',
      fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
      render: ({ workflowData, updateField, errors }) => (
        <LeaseSelectionPicker
          value={workflowData.lease_id || null}
          error={errors?.lease_id}
          statuses={['active', 'pending']}
          showRent
          emptyMessage="No active or pending leases found."
          onChange={(leaseId, selected) => stampLeaseSelection(updateField, leaseId, selected)}
        />
      )
    },
    {
      title: 'Inspection Date',
      fields: [
        { id: 'inspection_date', label: 'Move-In Inspection Date', type: 'date', required: true },
        { id: 'tenant_present', label: 'Tenant Present', type: 'select', options: [
          { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
        ]}
      ]
    },
    {
      title: 'Property Condition',
      fields: [
        { id: 'condition_notes', label: 'Condition Notes', type: 'textarea' },
        { id: 'overall_condition', label: 'Overall Condition', type: 'select', options: [
          { value: 'excellent', label: 'Excellent' },
          { value: 'good', label: 'Good' },
          { value: 'fair', label: 'Fair' },
          { value: 'poor', label: 'Poor' }
        ]}
      ]
    },
    {
      title: 'Complete',
      fields: [],
      render: () => <p className="text-gray-600">Generate move-in inspection report.</p>
    }
  ];

  return (
    <ComplianceWorkflow
      workflowType="move_in"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

