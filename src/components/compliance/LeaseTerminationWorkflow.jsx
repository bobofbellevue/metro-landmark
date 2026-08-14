import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import NoticePeriodCalculator from '../NoticePeriodCalculator';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID } from '../../jurisdictions/index.js';

export default function LeaseTerminationWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
  const [lease, setLease] = useState(null);

  useEffect(() => {
    if (initialData.lease_id) fetchLeaseDetails(initialData.lease_id);
  }, [initialData.lease_id]);

  const fetchLeaseDetails = async (leaseId) => {
    const { data } = await supabase.from('leases').select(`
      *, units!inner(unit_id, unit_number, properties!inner(property_id, property_name, city_of_jurisdiction))
    `).eq('lease_id', leaseId).single();
    setLease(data);
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property ? detectJurisdiction(property) : DEFAULT_JURISDICTION_PACK_ID;
    const leaseType = lease?.end_date ? 'fixed_term' : 'month_to_month';

    return [
      {
        title: 'Select Lease',
        description: 'Choose the lease to terminate.',
        fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
        render: ({ workflowData, updateField, errors }) => (
          <LeaseSelectionPicker
            value={workflowData.lease_id || null}
            error={errors?.lease_id}
            statuses={['active']}
            showRent
            emptyMessage="No active leases found."
            onChange={(leaseId) => {
              updateField('lease_id', leaseId);
              if (leaseId) fetchLeaseDetails(leaseId);
              else setLease(null);
            }}
          />
        )
      },
      {
        title: 'Termination Details',
        fields: [
          { id: 'initiated_by', label: 'Initiated By', type: 'select', required: true, options: [
            { value: 'landlord', label: 'Landlord' },
            { value: 'tenant', label: 'Tenant' },
            { value: 'mutual', label: 'Mutual Agreement' }
          ]},
          { id: 'termination_reason', label: 'Termination Reason', type: 'textarea', required: true },
          { id: 'has_cause', label: 'Termination for Cause', type: 'select', options: [
            { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
          ]},
          { id: 'effective_date', label: 'Termination Effective Date', type: 'date', required: true }
        ],
        render: ({ workflowData }) => (
          workflowData.lease_id && workflowData.effective_date && (
            <NoticePeriodCalculator
              workflowType="lease_termination"
              leaseType={leaseType}
              propertyId={property?.property_id}
              jurisdiction={jurisdiction}
              context={{
                initiatedBy: workflowData.initiated_by || 'landlord',
                hasCause: workflowData.has_cause === 'yes',
                effectiveDate: workflowData.effective_date
              }}
            />
          )
        )
      },
      {
        title: 'Generate Notice',
        fields: [],
        render: () => <p className="text-gray-600">Generate termination notice.</p>
      }
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="lease_termination"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

