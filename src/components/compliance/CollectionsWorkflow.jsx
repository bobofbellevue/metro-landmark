import React from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';

export default function CollectionsWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
  const getWorkflowSteps = () => [
    {
      title: 'Select Lease',
      description: 'Choose the lease for collections.',
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
      title: 'Collection Details',
      fields: [
        { id: 'amount_owed', label: 'Amount Owed', type: 'number', required: true },
        { id: 'notice_type', label: 'Notice Type', type: 'select', required: true, options: [
          { value: '3_day', label: '3-Day Late Rent Notice' },
          { value: '10_day', label: '10-Day Notice' },
          { value: '14_day', label: '14-Day Notice' }
        ]},
        { id: 'payment_plan', label: 'Payment Plan Offered', type: 'select', options: [
          { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
        ]}
      ]
    },
    {
      title: 'Generate Notice',
      fields: [],
      render: () => <p className="text-gray-600">Generate collection notice.</p>
    }
  ];

  return (
    <ComplianceWorkflow
      workflowType="collections"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

