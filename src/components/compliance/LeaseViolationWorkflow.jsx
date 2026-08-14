import React from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';

export default function LeaseViolationWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
  const getWorkflowSteps = () => [
    {
      title: 'Select Lease',
      description: 'Choose the lease for the violation notice.',
      fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
      render: ({ workflowData, updateField, errors }) => (
        <LeaseSelectionPicker
          value={workflowData.lease_id || null}
          error={errors?.lease_id}
          statuses={['active']}
          showRent
          emptyMessage="No active leases found."
          onChange={(leaseId) => updateField('lease_id', leaseId)}
        />
      )
    },
    {
      title: 'Violation Details',
      fields: [
        { id: 'violation_type', label: 'Violation Type', type: 'select', required: true, options: [
          { value: 'noise', label: 'Noise Complaint' },
          { value: 'pet', label: 'Pet Policy Violation' },
          { value: 'unauthorized_occupant', label: 'Unauthorized Occupant' },
          { value: 'property_damage', label: 'Property Damage' },
          { value: 'nuisance', label: 'Nuisance' },
          { value: 'other', label: 'Other' }
        ]},
        { id: 'violation_description', label: 'Violation Description', type: 'textarea', required: true },
        { id: 'cure_period_days', label: 'Cure Period (days)', type: 'number', required: true }
      ]
    },
    {
      title: 'Generate Notice',
      fields: [],
      render: () => <p className="text-gray-600">Generate violation notice.</p>
    }
  ];

  return (
    <ComplianceWorkflow
      workflowType="lease_violation"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

