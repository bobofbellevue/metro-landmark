import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import NoticePeriodCalculator from '../NoticePeriodCalculator';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import CurrencyInput, { formatCurrencyDisplay } from '../CurrencyInput';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID } from '../../jurisdictions/index.js';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';
import { unitNumberText } from '../../utils/unit-display.js';
import {
  COLLECTION_FDCPA_NOTICE,
  COLLECTION_PAY_OR_VACATE,
  collectionNoticeDays,
  collectionNoticeKindLabel,
  collectionNoticeKindOptions,
  evictionHandoffFromCollections,
  isPositiveAmountOwed,
  normalizeCollectionNoticeType,
} from '../../utils/collections-notice.js';

const PAYMENT_PLAN_OPTIONS = Object.freeze([
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]);

/**
 * Collections Process — record amount owed and a 3-day pay-or-vacate path,
 * then hand off to Eviction generate-then-serve (RCW 59.12.030). Not a
 * statutory form. Do not copy RHAWA forms.
 */
export default function CollectionsWorkflow({
  initialData = {},
  workflowId = null,
  onComplete,
  onCancel,
  onWorkflowCreated,
}) {
  const [lease, setLease] = useState(null);

  useEffect(() => {
    if (initialData.lease_id) fetchLeaseDetails(initialData.lease_id);
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
    const kindOptions = collectionNoticeKindOptions(jurisdiction);

    return [
      {
        title: 'Select Lease',
        description: 'Choose the lease with unpaid rent.',
        fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
        render: ({ workflowData, updateField, errors }) => (
          <LeaseSelectionPicker
            value={workflowData.lease_id || null}
            error={errors?.lease_id}
            statuses={['active']}
            showRent
            emptyMessage="No active leases found."
            onChange={(leaseId, selected) => {
              stampLeaseSelection(updateField, leaseId, selected);
              if (!workflowData.notice_type) {
                updateField('notice_type', COLLECTION_PAY_OR_VACATE);
              }
              if (leaseId) fetchLeaseDetails(leaseId);
              else setLease(null);
            }}
          />
        ),
      },
      {
        title: 'Collection Details',
        description: 'Record the amount owed and the pay-or-vacate notice type.',
        fields: [
          { id: 'amount_owed', label: 'Amount Owed', type: 'number', required: true },
          { id: 'notice_type', label: 'Notice Type', type: 'select', required: true },
        ],
        validate: (data) => {
          const errors = {};
          if (!isPositiveAmountOwed(data.amount_owed)) {
            errors.amount_owed = 'Amount owed must be greater than zero.';
          }
          return errors;
        },
        render: ({ workflowData, updateField, errors }) => {
          const noticeType = normalizeCollectionNoticeType(workflowData.notice_type);
          const cureDays = collectionNoticeDays(jurisdiction, noticeType);
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="w-44">
                  <CurrencyInput
                    label="Amount Owed"
                    required
                    value={workflowData.amount_owed}
                    onChange={(next) => updateField('amount_owed', next)}
                    className={errors.amount_owed ? '[&_input]:border-red-300' : ''}
                  />
                  {errors.amount_owed ? (
                    <p className="mt-1 text-sm text-red-600">{errors.amount_owed}</p>
                  ) : null}
                </div>
                <div className="w-64 max-w-full">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notice Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={noticeType}
                    onChange={(e) => updateField('notice_type', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md ${
                      errors.notice_type ? 'border-red-300' : 'border-gray-300'
                    }`}
                  >
                    {kindOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {errors.notice_type ? (
                    <p className="mt-1 text-sm text-red-600">{errors.notice_type}</p>
                  ) : null}
                </div>
                <div className="w-44 max-w-full">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment plan offered
                  </label>
                  <select
                    value={workflowData.payment_plan || ''}
                    onChange={(e) => updateField('payment_plan', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">Select...</option>
                    {PAYMENT_PLAN_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-3">
                Pay-or-vacate period is {cureDays} days for this notice type. {COLLECTION_FDCPA_NOTICE}{' '}
                See RCW 59.12.030.
              </p>

              <div className="max-w-xl">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={workflowData.collection_notes || ''}
                  onChange={(e) => updateField('collection_notes', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>

              {workflowData.lease_id ? (
                <NoticePeriodCalculator
                  workflowType="collections"
                  leaseType={leaseType}
                  propertyId={property?.property_id}
                  jurisdiction={jurisdiction}
                  context={{ noticeType }}
                />
              ) : null}
            </div>
          );
        },
      },
      {
        title: 'Record Collection',
        description:
          'Save this outcome, or continue to Eviction to generate and serve the pay-or-vacate notice.',
        fields: [],
        completeBusyLabel: 'Saving…',
        validate: (data) => {
          const errors = {};
          if (!isPositiveAmountOwed(data.amount_owed)) {
            errors.amount_owed = 'Amount owed must be greater than zero.';
          }
          return errors;
        },
        finishActions: [
          {
            id: 'complete',
            label: 'Complete',
            variant: 'outline',
            complete: true,
          },
          {
            id: 'continue_eviction',
            label: 'Continue to Eviction',
            variant: 'primary',
            complete: true,
          },
        ],
        render: ({ workflowData, errors }) => {
          const noticeType = normalizeCollectionNoticeType(workflowData.notice_type);
          const paymentPlan =
            PAYMENT_PLAN_OPTIONS.find((option) => option.value === workflowData.payment_plan)
              ?.label || '';
          return (
            <div className="space-y-4">
              {errors?.amount_owed ? (
                <p className="text-sm text-red-600">{errors.amount_owed}</p>
              ) : null}
              <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
                <h4 className="font-semibold text-gray-800 mb-1">Collection summary</h4>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Property:</span>
                  <span className="font-medium">{property?.property_name}</span>
                </div>
                {unitNumberText(lease?.units) ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Unit:</span>
                    <span className="font-medium">{unitNumberText(lease?.units)}</span>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Amount owed:</span>
                  <span className="font-medium">
                    {formatCurrencyDisplay(workflowData.amount_owed)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Notice:</span>
                  <span className="font-medium">
                    {collectionNoticeKindLabel(jurisdiction, noticeType)}
                  </span>
                </div>
                {paymentPlan ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Payment plan offered:</span>
                    <span className="font-medium">{paymentPlan}</span>
                  </div>
                ) : null}
              </div>
              <p className="text-sm text-blue-800 bg-blue-50 rounded-lg p-3">
                Complete saves this collections record. Continue to Eviction opens pay-or-vacate
                generate-then-serve with the lease and amount already filled. That worksheet is not a
                statutory form. Not legal advice.
              </p>
            </div>
          );
        },
      },
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="collections"
      initialData={{
        ...initialData,
        notice_type: normalizeCollectionNoticeType(initialData.notice_type),
        property_id: lease?.units?.properties?.property_id ?? initialData.property_id,
        unit_id: lease?.units?.unit_id ?? initialData.unit_id,
        jurisdiction: lease?.units?.properties
          ? detectJurisdiction(lease.units.properties)
          : initialData.jurisdiction || DEFAULT_JURISDICTION_PACK_ID,
      }}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={async (data, meta = {}) => {
        if (!onComplete) return;
        const normalized = {
          ...data,
          notice_type: normalizeCollectionNoticeType(data.notice_type),
        };
        if (meta.action === 'continue_eviction' && isPositiveAmountOwed(normalized.amount_owed)) {
          onComplete(normalized, {
            status: 'handoff',
            nextProcess: 'eviction',
            nextInitialData: evictionHandoffFromCollections(normalized, lease),
          });
          return;
        }
        onComplete(normalized, {
          status: 'success',
          title: 'Collection recorded',
          message: isPositiveAmountOwed(normalized.amount_owed)
            ? 'The amount owed is saved on this workflow. Start Eviction when you are ready to generate the pay-or-vacate notice.'
            : 'Lease and amount owed are required.',
        });
      }}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
      onWorkflowLoaded={(workflow) => {
        const leaseId = workflow?.workflow_data?.lease_id || workflow?.lease_id;
        if (leaseId) fetchLeaseDetails(leaseId);
      }}
    />
  );
}
