import React from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';

export default function HabitabilityWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
  const getWorkflowSteps = () => [
    {
      title: 'Select Lease',
      description: 'Choose the lease for the habitability issue.',
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
      title: 'Habitability Issue',
      fields: [
        { id: 'issue_type', label: 'Issue Type', type: 'select', required: true, options: [
          { value: 'repair', label: 'Repair Needed' },
          { value: 'emergency', label: 'Emergency Repair' },
          { value: 'health_hazard', label: 'Health Hazard' },
          { value: 'safety', label: 'Safety Issue' }
        ]},
        { id: 'issue_description', label: 'Issue Description', type: 'textarea', required: true },
        { id: 'repair_timeline', label: 'Required Repair Timeline (days)', type: 'number' }
      ]
    },
    {
      title: 'Document',
      fields: [],
      render: () => <p className="text-gray-600">Document habitability issue and required repairs.</p>
    }
  ];

  return (
    <ComplianceWorkflow
      workflowType="habitability"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

