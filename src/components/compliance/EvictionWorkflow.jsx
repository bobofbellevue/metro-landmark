import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import NoticePeriodCalculator from '../NoticePeriodCalculator';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import WorkflowDateInput from '../WorkflowDateInput';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID } from '../../jurisdictions/index.js';
import { isCompleteWorkflowDate } from '../../utils/workflow-date.js';

/**
 * EvictionWorkflow - Multi-step guided workflow for eviction process
 */
export default function EvictionWorkflow({ 
  initialData = {}, 
  workflowId = null,
  onComplete, 
  onCancel,
  onWorkflowCreated,
}) {
  const [lease, setLease] = useState(null);
  const [noticeCalculation, setNoticeCalculation] = useState(null);

  useEffect(() => {
    if (initialData.lease_id) {
      fetchLeaseDetails(initialData.lease_id);
    }
  }, [initialData.lease_id]);

  const fetchLeaseDetails = async (leaseId) => {
    try {
      const { data, error } = await supabase
        .from('leases')
        .select(`
          *,
          units!inner(
            unit_id,
            unit_number,
            properties!inner(
              property_id,
              property_name,
              city_of_jurisdiction,
              landlord_id
            )
          )
        `)
        .eq('lease_id', leaseId)
        .single();

      if (error) throw error;
      setLease(data);
    } catch (error) {
      console.error('Error fetching lease details:', error);
    }
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property ? detectJurisdiction(property) : DEFAULT_JURISDICTION_PACK_ID;
    const leaseType = lease?.end_date ? 'fixed_term' : 'month_to_month';

    return [
      {
        title: 'Select Lease',
        description: 'Choose the lease for the eviction process.',
        fields: [
          {
            id: 'lease_id',
            label: 'Lease',
            type: 'select',
            required: true
          }
        ],
        render: ({ workflowData, updateField, errors }) => (
          <LeaseSelectionPicker
            value={workflowData.lease_id || null}
            error={errors.lease_id}
            statuses={['active', 'pending']}
            showRent
            emptyMessage="No active or pending leases found."
            onChange={(leaseId) => {
              updateField('lease_id', leaseId);
              if (leaseId) fetchLeaseDetails(leaseId);
              else setLease(null);
            }}
          />
        )
      },
      {
        title: 'Notice Type',
        description: 'Select the type of eviction notice to serve.',
        fields: [
          {
            id: 'notice_type',
            label: 'Notice Type',
            type: 'select',
            required: true,
            options: [
              { value: '3_day_pay_or_vacate', label: '3-Day Pay or Vacate (Non-payment of rent)' },
              { value: '10_day_compliance', label: '10-Day Compliance Notice (Lease violation)' },
              { value: '14_day_unconditional', label: '14-Day Unconditional Quit (Serious violation)' },
              { value: '20_day_violation', label: '20-Day Notice (Other lease violations)' }
            ]
          },
          {
            id: 'violation_reason',
            label: 'Reason for Eviction',
            type: 'textarea',
            required: true
          },
          {
            id: 'amount_owed',
            label: 'Amount Owed (if applicable)',
            type: 'number',
            required: false
          }
        ]
      },
      {
        title: 'Notice Period',
        description: 'Review the required notice period based on the notice type and jurisdiction.',
        fields: [
          {
            id: 'effective_date',
            label: 'Desired Effective Date',
            type: 'date',
            required: true
          }
        ],
        render: ({ workflowData, updateField, errors }) => (
          <div className="space-y-4">
            <WorkflowDateInput
              label="Desired Effective Date"
              required
              value={workflowData.effective_date || ''}
              onChange={(next) => updateField('effective_date', next)}
              error={errors.effective_date || ''}
            />

            {workflowData.lease_id &&
              workflowData.notice_type &&
              isCompleteWorkflowDate(workflowData.effective_date) && (
              <NoticePeriodCalculator
                workflowType="eviction"
                leaseType={leaseType}
                propertyId={property?.property_id}
                jurisdiction={jurisdiction}
                context={{
                  noticeType: workflowData.notice_type,
                  effectiveDate: workflowData.effective_date
                }}
                onCalculationChange={setNoticeCalculation}
              />
            )}
          </div>
        )
      },
      {
        title: 'Notice Service',
        description: 'Record how and when the notice was served.',
        fields: [
          {
            id: 'served_date',
            label: 'Date Notice Served',
            type: 'date',
            required: true
          },
          {
            id: 'served_method',
            label: 'Service Method',
            type: 'select',
            required: true,
            options: [
              { value: 'in_person', label: 'In Person' },
              { value: 'certified_mail', label: 'Certified Mail' },
              { value: 'posting', label: 'Posting on Door' },
              { value: 'email', label: 'Email' }
            ]
          },
          {
            id: 'proof_of_service_file',
            label: 'Proof of Service',
            type: 'file',
            documentType: 'proof_of_service',
            description:
              'Upload a photo or PDF — certified mail receipt, posting photo, email confirmation, or similar.',
          },
          {
            id: 'proof_of_service',
            label: 'Notes (optional)',
            type: 'textarea',
            placeholder: 'Tracking number, who accepted service, etc.',
          }
        ]
      },
      {
        title: 'Generate Notice',
        description: 'Review the details and generate the eviction notice document.',
        fields: [],
        render: ({ workflowData }) => {
          const noticeTypeLabels = {
            '3_day_pay_or_vacate': '3-Day Pay or Vacate',
            '10_day_compliance': '10-Day Compliance Notice',
            '14_day_unconditional': '14-Day Unconditional Quit',
            '20_day_violation': '20-Day Notice'
          };

          return (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-semibold text-gray-800 mb-3">Notice Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Property:</span>
                    <span className="font-medium">{property?.property_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Unit:</span>
                    <span className="font-medium">{lease?.units?.unit_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Notice Type:</span>
                    <span className="font-medium">{noticeTypeLabels[workflowData.notice_type] || workflowData.notice_type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Effective Date:</span>
                    <span className="font-medium">{workflowData.effective_date}</span>
                  </div>
                  {workflowData.amount_owed && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Amount Owed:</span>
                      <span className="font-medium">${parseFloat(workflowData.amount_owed).toFixed(2)}</span>
                    </div>
                  )}
                  {noticeCalculation && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Required Notice Period:</span>
                      <span className="font-medium">{noticeCalculation.noticePeriodDays} days</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-blue-800">
                  Click "Complete" to generate the eviction notice document and save the workflow.
                </p>
              </div>
            </div>
          );
        }
      }
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="eviction"
      initialData={{
        ...initialData,
        property_id: lease?.units?.properties?.property_id,
        unit_id: lease?.units?.unit_id,
        jurisdiction: lease?.units?.properties ? detectJurisdiction(lease.units.properties) : DEFAULT_JURISDICTION_PACK_ID
      }}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={async (data) => {
        let generationResult = { status: 'skipped' };

        if (data.lease_id && data.notice_type && data.effective_date) {
          try {
            const response = await fetch('/api/documents/generate/notice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lease_id: data.lease_id,
                notice_type: data.notice_type,
                notice_data: {
                  effective_date: data.effective_date,
                  violation_reason: data.violation_reason,
                  amount_owed: data.amount_owed,
                  served_date: data.served_date,
                  served_method: data.served_method,
                  proof_of_service: data.proof_of_service
                }
              })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
              throw new Error(result.error || 'Failed to generate eviction notice document');
            }
            generationResult = {
              status: 'success',
              title: 'Eviction notice created',
              message: 'The notice PDF was generated and saved to Documents.',
              documentId: result.document_id,
              noticeId: result.notice_id,
            };
          } catch (error) {
            console.error('Error generating notice:', error);
            generationResult = {
              status: 'error',
              title: 'Workflow completed, but notice was not created',
              message: error.message || 'Document generation failed.',
            };
          }
        }

        if (onComplete) {
          onComplete(data, generationResult);
        }
      }}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
    />
  );
}

