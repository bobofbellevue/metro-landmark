import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import NoticePeriodCalculator from '../NoticePeriodCalculator';
import CurrencyInput from '../CurrencyInput';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import WorkflowDateInput from '../WorkflowDateInput';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID } from '../../jurisdictions/index.js';
import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
} from '../../utils/workflow-date.js';
import { formatPersonDisplayName } from '../../utils/lease-display.js';

/**
 * RentIncreaseWorkflow - Guided workflow for rent increase notices
 */
export default function RentIncreaseWorkflow({ 
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

  const fetchLeaseDetails = async (leaseId, selected = null) => {
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

      let landlordName = selected?.landlordName || '';
      const landlordId =
        data.landlord_id || data.units?.properties?.landlord_id || null;
      if (!landlordName && landlordId) {
        const { data: contacts } = await supabase
          .from('contacts')
          .select('first_name, middle_name, last_name')
          .eq('contactable_type', 'landlord')
          .eq('contactable_id', landlordId)
          .limit(1);
        landlordName = formatPersonDisplayName(contacts?.[0]) || '';
      }

      setLease({ ...data, landlordName });
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
        description: 'Choose the lease for which you want to increase rent.',
        fields: [
          {
            id: 'lease_id',
            label: 'Lease',
            type: 'select',
            required: true,
          }
        ],
        render: ({ workflowData, updateField, errors }) => (
          <LeaseSelectionPicker
            value={workflowData.lease_id || null}
            error={errors.lease_id}
            statuses={['active', 'pending', 'future']}
            showRent
            emptyMessage="No active, pending, or future leases found."
            onChange={(leaseId, selected) => {
              updateField('lease_id', leaseId);
              updateField(
                'current_rent',
                selected?.monthly_rent_amount != null
                  ? Number(selected.monthly_rent_amount)
                  : null
              );
              updateField('new_rent', null);
              if (leaseId) {
                fetchLeaseDetails(leaseId, selected);
              } else {
                setLease(null);
              }
            }}
          />
        )
      },
      {
        title: 'Rent Details',
        description: 'Enter current and new rent amounts. The system will calculate the required notice period.',
        fields: [
          {
            id: 'current_rent',
            label: 'Current Monthly Rent',
            type: 'number',
            required: true
          },
          {
            id: 'new_rent',
            label: 'New Monthly Rent',
            type: 'number',
            required: true
          },
          {
            id: 'effective_date',
            label: 'Desired Effective Date',
            type: 'date',
            required: true
          }
        ],
        render: ({ workflowData, updateField, errors }) => {
          const currentRent =
            workflowData.current_rent === null || workflowData.current_rent === undefined || workflowData.current_rent === ''
              ? null
              : Number(workflowData.current_rent);
          const newRent =
            workflowData.new_rent === null || workflowData.new_rent === undefined || workflowData.new_rent === ''
              ? null
              : Number(workflowData.new_rent);
          const percentIncrease =
            currentRent > 0 && newRent != null
              ? ((newRent - currentRent) / currentRent) * 100
              : null;

          return (
            <div className="space-y-4">
              <div>
                <CurrencyInput
                  label="Current Monthly Rent"
                  required
                  value={currentRent}
                  onChange={(val) => updateField('current_rent', val)}
                  className={errors.current_rent ? '[&_input]:border-red-300' : ''}
                />
                {errors.current_rent && (
                  <p className="mt-1 text-sm text-red-600">{errors.current_rent}</p>
                )}
              </div>

              <div>
                <CurrencyInput
                  label="New Monthly Rent"
                  required
                  value={newRent}
                  onChange={(val) => updateField('new_rent', val)}
                  className={errors.new_rent ? '[&_input]:border-red-300' : ''}
                />
                {errors.new_rent && (
                  <p className="mt-1 text-sm text-red-600">{errors.new_rent}</p>
                )}
                {currentRent != null && newRent != null && newRent > currentRent && (
                  <p className="mt-1 text-sm text-gray-600">
                    Increase: ${(newRent - currentRent).toFixed(2)}/month ({percentIncrease.toFixed(1)}%)
                  </p>
                )}
              </div>

              <WorkflowDateInput
                label="Desired Effective Date"
                required
                value={workflowData.effective_date || ''}
                onChange={(next) => updateField('effective_date', next)}
                error={errors.effective_date || ''}
              />

              {workflowData.lease_id &&
                currentRent != null &&
                newRent != null &&
                isCompleteWorkflowDate(workflowData.effective_date) && (
                <NoticePeriodCalculator
                  workflowType="rent_increase"
                  leaseType={leaseType}
                  propertyId={property?.property_id}
                  jurisdiction={jurisdiction}
                  context={{
                    currentRent,
                    newRent,
                    effectiveDate: workflowData.effective_date,
                    percent_increase: percentIncrease,
                    tenancyStartDate: lease?.start_date || lease?.lease_start_date || null,
                    // E11: no lease/unit subsidy fields yet; pack 30-day path stays unused.
                    subsidized: false,
                  }}
                  onCalculationChange={setNoticeCalculation}
                />
              )}
            </div>
          );
        }
      },
      {
        title: 'Notice Service',
        description: 'Record how and when the notice was served to the tenant.',
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
            id: 'proof_of_service',
            label: 'Proof of Service (Notes)',
            type: 'textarea'
          }
        ]
      },
      {
        title: 'Generate Notice',
        description: 'Review the details and generate the compliant rent increase notice document.',
        fields: [],
        render: ({ workflowData }) => (
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
                  <span className="text-gray-600">Landlord:</span>
                  <span className="font-medium">{lease?.landlordName || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Current Rent:</span>
                  <span className="font-medium">
                    {workflowData.current_rent != null
                      ? `$${Number(workflowData.current_rent).toFixed(2)}`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">New Rent:</span>
                  <span className="font-medium">
                    {workflowData.new_rent != null
                      ? `$${Number(workflowData.new_rent).toFixed(2)}`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Effective Date:</span>
                  <span className="font-medium">
                    {isCompleteWorkflowDate(workflowData.effective_date)
                      ? formatWorkflowDateForLocale(
                          workflowData.effective_date,
                          typeof navigator !== 'undefined' ? navigator.language : 'en-US'
                        )
                      : workflowData.effective_date || '—'}
                  </span>
                </div>
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
                Click "Complete" to generate the rent increase notice document and save the workflow.
              </p>
            </div>
          </div>
        )
      }
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="rent_increase"
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

        // Generate notice document
        if (data.lease_id && data.new_rent && data.effective_date) {
          try {
            const response = await fetch('/api/documents/generate/notice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lease_id: data.lease_id,
                notice_type: 'rent_increase',
                notice_data: {
                  current_rent: data.current_rent,
                  new_rent: data.new_rent,
                  effective_date: data.effective_date,
                  percent_increase: ((data.new_rent - data.current_rent) / data.current_rent) * 100,
                  served_date: data.served_date,
                  served_method: data.served_method,
                  proof_of_service: data.proof_of_service,
                  locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
                  unit_number: lease?.units?.unit_number || null,
                  property_name: lease?.units?.properties?.property_name || null,
                  // landlord_name column is often null; server resolves from contacts
                  landlord_id:
                    lease?.landlord_id ||
                    lease?.units?.properties?.landlord_id ||
                    null,
                  landlord_name: lease?.landlordName || null,
                }
              })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
              throw new Error(result.error || 'Failed to generate notice document');
            }
            const render = result.render || {};
            const renderMode = render.mode || 'unknown';
            const usedTemplatePositions =
              renderMode === 'pdf_overlay' || renderMode === 'image_based';
            console.log('[RentIncreaseWorkflow] notice generated', {
              document_id: result.document_id,
              notice_id: result.notice_id,
              render,
            });
            generationResult = {
              status: 'success',
              title: 'Rent increase notice created',
              message: usedTemplatePositions
                ? 'Your rent increase notice was saved to Documents.'
                : 'Your rent increase notice was saved to Documents using a simple layout (a Notice template with field positions was unavailable).',
              documentId: result.document_id,
              noticeId: result.notice_id,
              render,
            };
          } catch (error) {
            console.error('Error generating notice:', error);
            generationResult = {
              status: 'error',
              title: 'Workflow completed, but notice was not created',
              message: error.message || 'Document generation failed. Check Documents or try again from a new workflow.',
            };
          }
        } else {
          generationResult = {
            status: 'error',
            title: 'Workflow completed without a notice',
            message: 'Lease, new rent, and effective date are required to generate the notice document.',
          };
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

