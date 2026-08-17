import React from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';

export default function MoveOutWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
  const getWorkflowSteps = () => [
    {
      title: 'Select Lease',
      description: 'Choose the lease for move-out.',
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
      title: 'Move-Out Inspection',
      fields: [
        { id: 'inspection_date', label: 'Move-Out Inspection Date', type: 'date', required: true },
        { id: 'damage_assessment', label: 'Damage Assessment', type: 'textarea' },
        { id: 'deduction_amount', label: 'Total Deduction Amount', type: 'number' }
      ]
    },
    {
      title: 'Complete',
      fields: [],
      render: () => <p className="text-gray-600">Generate move-out inspection report.</p>
    }
  ];

  return (
    <ComplianceWorkflow
      workflowType="move_out"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

