import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import {
  getJurisdictionDisplayName,
  isRentControlEnabled,
} from '../../jurisdictions/index.js';

export default function RentControlWorkflow({ initialData = {}, workflowId = null, onComplete, onCancel, onWorkflowCreated }) {
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
    const packId = property ? detectJurisdiction(property) : null;
    const rentControlApplies = packId ? isRentControlEnabled(packId) : false;
    const jurisdictionName = packId ? getJurisdictionDisplayName(packId) : null;

    return [
      {
        title: 'Select Lease',
        description: 'Choose the lease to check rent control compliance.',
        fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
        render: ({ workflowData, updateField, errors }) => (
          <LeaseSelectionPicker
            value={workflowData.lease_id || null}
            error={errors?.lease_id}
            statuses={['active']}
            showRent
            emptyMessage="No active leases found."
            onChange={(leaseId, selected) => {
              updateField('lease_id', leaseId);
              updateField(
                'current_rent',
                selected?.monthly_rent_amount != null
                  ? Number(selected.monthly_rent_amount)
                  : null
              );
              if (leaseId) fetchLeaseDetails(leaseId);
              else setLease(null);
            }}
          />
        )
      },
      {
        title: 'Rent Control Compliance',
        fields: [
          { id: 'current_rent', label: 'Current Rent', type: 'number', required: true },
          { id: 'proposed_rent', label: 'Proposed Rent', type: 'number', required: true },
          { id: 'cpi_adjustment', label: 'CPI Adjustment (%)', type: 'number' }
        ],
        render: ({ workflowData }) => {
          const currentRent = workflowData.current_rent || 0;
          const proposedRent = workflowData.proposed_rent || 0;
          const increase = currentRent > 0 ? ((proposedRent - currentRent) / currentRent) * 100 : 0;
          const maxIncrease = 7 + (workflowData.cpi_adjustment || 0);
          const isCompliant = increase <= maxIncrease;

          return (
            <div className="space-y-4">
              {rentControlApplies ? (
                <div className={`p-4 rounded-lg ${isCompliant ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <p className={`text-sm font-semibold ${isCompliant ? 'text-green-900' : 'text-red-900'}`}>
                    {isCompliant
                      ? `✓ Compliant with ${jurisdictionName} rent control`
                      : '⚠ Exceeds Rent Control Limits'}
                  </p>
                  <p className="text-xs mt-1 text-gray-600">
                    Proposed increase: {increase.toFixed(1)}% | Max allowed: {maxIncrease.toFixed(1)}%
                  </p>
                </div>
              ) : (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-blue-800">
                    Rent control does not apply under the{' '}
                    {jurisdictionName || 'current'} jurisdiction pack.
                  </p>
                </div>
              )}
            </div>
          );
        }
      },
      {
        title: 'Complete',
        fields: [],
        render: () => <p className="text-gray-600">Document rent control compliance.</p>
      }
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="rent_control"
      initialData={initialData}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={onComplete}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

