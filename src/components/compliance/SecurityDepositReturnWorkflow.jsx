import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import NoticePeriodCalculator from '../NoticePeriodCalculator';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID } from '../../jurisdictions/index.js';

export default function SecurityDepositReturnWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
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

    return [
      {
        title: 'Select Lease',
        description: 'Choose the lease for the security deposit return.',
        fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
        render: ({ workflowData, updateField, errors }) => (
          <LeaseSelectionPicker
            value={workflowData.lease_id || null}
            error={errors?.lease_id}
            statuses={['active', 'terminated']}
            showDeposit
            emptyMessage="No active or terminated leases found."
            onChange={(leaseId, selected) => {
              updateField('lease_id', leaseId);
              updateField(
                'original_deposit',
                selected?.security_deposit_amount != null
                  ? Number(selected.security_deposit_amount)
                  : null
              );
              if (leaseId) fetchLeaseDetails(leaseId);
              else setLease(null);
            }}
          />
        )
      },
      {
        title: 'Deposit Calculation',
        fields: [
          { id: 'original_deposit', label: 'Original Deposit Amount', type: 'number', required: true },
          { id: 'total_deductions', label: 'Total Deductions', type: 'number', required: true },
          { id: 'deduction_details', label: 'Itemized Deductions', type: 'textarea', required: true },
          { id: 'return_date', label: 'Return Date (must be within 14 days)', type: 'date', required: true }
        ],
        render: ({ workflowData }) => {
          const returnAmount = (workflowData.original_deposit || 0) - (workflowData.total_deductions || 0);
          return (
            <div className="space-y-4">
              {workflowData.lease_id && workflowData.return_date && (
                <NoticePeriodCalculator
                  workflowType="security_deposit"
                  leaseType="month_to_month"
                  propertyId={property?.property_id}
                  jurisdiction={jurisdiction}
                  context={{ effectiveDate: workflowData.return_date }}
                />
              )}
              {workflowData.original_deposit && (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm font-semibold text-blue-900">
                    Return Amount: ${returnAmount.toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          );
        }
      },
      {
        title: 'Generate Statement',
        fields: [],
        render: () => <p className="text-gray-600">Generate deposit return statement.</p>
      }
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="security_deposit"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

