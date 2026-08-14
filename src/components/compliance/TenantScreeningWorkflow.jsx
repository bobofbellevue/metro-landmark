import React, { useState } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';

export default function TenantScreeningWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
  const getWorkflowSteps = () => [
    {
      title: 'Application Details',
      fields: [
        { id: 'application_id', label: 'Application ID', type: 'text', required: true },
        { id: 'property_id', label: 'Property ID', type: 'number', required: true }
      ]
    },
    {
      title: 'Screening Criteria',
      fields: [
        { id: 'income_ratio', label: 'Income to Rent Ratio', type: 'number' },
        { id: 'credit_score', label: 'Credit Score', type: 'number' },
        { id: 'rental_history', label: 'Rental History Check', type: 'select', options: [
          { value: 'passed', label: 'Passed' },
          { value: 'failed', label: 'Failed' },
          { value: 'pending', label: 'Pending' }
        ]}
      ]
    },
    {
      title: 'Decision',
      fields: [
        { id: 'decision', label: 'Decision', type: 'select', required: true, options: [
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'conditional', label: 'Conditional Approval' }
        ]},
        { id: 'decision_reason', label: 'Decision Reason', type: 'textarea' }
      ]
    },
    {
      title: 'Complete',
      fields: [],
      render: () => <p className="text-gray-600">Document screening decision per policy.</p>
    }
  ];

  return (
    <ComplianceWorkflow
      workflowType="tenant_screening"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

