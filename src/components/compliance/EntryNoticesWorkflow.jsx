import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import NoticePeriodCalculator from '../NoticePeriodCalculator';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import WorkflowDateInput from '../WorkflowDateInput';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID, getNoticeServiceMethods } from '../../jurisdictions/index.js';
import { isCompleteWorkflowDate } from '../../utils/workflow-date.js';
import NoticeServiceStep from './NoticeServiceStep.jsx';
import { readResponseJson } from '../../utils/read-response-json.js';
import {
  calculateEntryNoticePeriod,
  entryNoticeCalendarDays,
  entryNoticeOptionsFromReason,
  validateNoticePeriod,
} from '../../utils/compliance-calculator.js';
import {
  entryNoticeFingerprint,
  tenantEmailsFromLeaseClients,
  validateNoticeService,
} from '../../utils/notice-service-workflow.js';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';
import { unitNumberText } from '../../utils/unit-display.js';

const ENTRY_REASON_OPTIONS = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'repair', label: 'Repair/Maintenance' },
  { value: 'showing', label: 'Showing to Prospective Tenant' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'other', label: 'Other' },
];

const ENTRY_REASON_LABELS = Object.fromEntries(
  ENTRY_REASON_OPTIONS.map((option) => [option.value, option.label])
);

/**
 * Entry Notices — pack-driven two-day written notice (one day for showings),
 * with an emergency exception (RCW 59.18.150). Generates a worksheet PDF, then
 * records how the notice was given.
 */
export default function EntryNoticesWorkflow({
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

      let tenantEmails = [];
      try {
        const { data: leaseClients } = await supabase
          .from('lease_clients')
          .select(`
            client_id,
            clients (
              client_id,
              user_id,
              users:users!clients_user_id_fkey ( email )
            )
          `)
          .eq('lease_id', leaseId);
        tenantEmails = tenantEmailsFromLeaseClients(leaseClients);
      } catch (emailError) {
        console.error('Error fetching tenant emails:', emailError);
      }

      setLease({
        ...data,
        tenantEmails,
      });
    } catch (error) {
      console.error('Error fetching lease details:', error);
    }
  };

  const generateNotice = async (data) => {
    const fingerprint = entryNoticeFingerprint(data);
    if (data.notice_document_id && data.notice_fingerprint === fingerprint) {
      return {
        status: 'success',
        document_id: data.notice_document_id,
        notice_id: data.notice_id,
        reused: true,
      };
    }

    const options = entryNoticeOptionsFromReason(data.entry_reason);
    const requiredHours = calculateEntryNoticePeriod(
      detectJurisdiction(lease?.units?.properties) || DEFAULT_JURISDICTION_PACK_ID,
      options
    );

    const response = await fetch('/api/documents/generate/notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lease_id: data.lease_id,
        notice_type: 'entry_notice',
        notice_data: {
          effective_date: data.entry_date,
          entry_date: data.entry_date,
          entry_time: data.entry_time || '',
          entry_reason: data.entry_reason,
          entry_reason_label: ENTRY_REASON_LABELS[data.entry_reason] || data.entry_reason,
          required_notice_hours: requiredHours,
          is_emergency: options.isEmergency,
        },
      }),
    });

    const parsed = await readResponseJson(response);
    const result = parsed.data || {};
    if (!parsed.ok || !result.success) {
      throw new Error(parsed.error || result.error || 'Failed to generate entry notice document');
    }
    return result;
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property ? detectJurisdiction(property) : DEFAULT_JURISDICTION_PACK_ID;
    const leaseType = lease?.end_date ? 'fixed_term' : 'month_to_month';
    const serviceMethods = getNoticeServiceMethods(jurisdiction);

    return [
      {
        title: 'Select Lease',
        description: 'Choose the occupied lease that will receive the entry notice.',
        fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
        render: ({ workflowData, updateField, errors }) => (
          <LeaseSelectionPicker
            value={workflowData.lease_id || null}
            error={errors.lease_id}
            statuses={['active']}
            showRent
            emptyMessage="No active leases found."
            onChange={(leaseId, selected) => {
              stampLeaseSelection(updateField, leaseId, selected);
              if (leaseId) fetchLeaseDetails(leaseId);
              else setLease(null);
            }}
          />
        ),
      },
      {
        title: 'Entry Details',
        description:
          'Two days written notice for inspections and repairs; one day to show the unit. Emergency entry does not require prior written notice.',
        fields: [
          { id: 'entry_reason', label: 'Reason for Entry', type: 'select', required: true },
          { id: 'entry_date', label: 'Planned Entry Date', type: 'date', required: true },
        ],
        validate: (data) => {
          const errors = {};
          if (!data.entry_reason) {
            errors.entry_reason = 'Reason for entry is required.';
          }
          if (!isCompleteWorkflowDate(data.entry_date)) {
            errors.entry_date = 'Planned entry date is required.';
          }
          return errors;
        },
        render: ({ workflowData, updateField, errors }) => {
          const options = entryNoticeOptionsFromReason(workflowData.entry_reason);
          return (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for Entry <span className="text-red-500">*</span>
                </label>
                <select
                  value={workflowData.entry_reason || ''}
                  onChange={(e) => updateField('entry_reason', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md ${
                    errors.entry_reason ? 'border-red-300' : 'border-gray-300'
                  }`}
                >
                  <option value="">Select...</option>
                  {ENTRY_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {errors.entry_reason ? (
                  <p className="mt-1 text-sm text-red-600">{errors.entry_reason}</p>
                ) : null}
              </div>

              <WorkflowDateInput
                label="Planned Entry Date"
                required
                value={workflowData.entry_date || ''}
                onChange={(next) => updateField('entry_date', next)}
                error={errors.entry_date || ''}
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Planned Entry Time
                </label>
                <input
                  type="text"
                  value={workflowData.entry_time || ''}
                  onChange={(e) => updateField('entry_time', e.target.value)}
                  placeholder="e.g., 10:00 AM"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>

              {!options.isEmergency ? null : (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
                  Emergency exception: written notice is not required when you believe an
                  emergency exists. Not legal advice.
                </p>
              )}

              {workflowData.lease_id &&
                workflowData.entry_reason &&
                isCompleteWorkflowDate(workflowData.entry_date) && (
                  <NoticePeriodCalculator
                    workflowType="entry_notice"
                    leaseType={leaseType}
                    propertyId={property?.property_id}
                    jurisdiction={jurisdiction}
                    context={{
                      effectiveDate: workflowData.entry_date,
                      entryPurpose: options.purpose,
                      isEmergency: options.isEmergency,
                    }}
                    onCalculationChange={setNoticeCalculation}
                  />
                )}
            </div>
          );
        },
      },
      {
        title: 'Generate Notice',
        description: 'Review the details, then click Next to generate the entry notice worksheet.',
        fields: [],
        advanceBusyLabel: 'Generating notice…',
        onAdvance: async (data) => {
          if (!data.lease_id || !data.entry_reason || !data.entry_date) {
            throw new Error('Lease, reason, and planned entry date are required to generate the notice.');
          }
          const result = await generateNotice(data);
          const options = entryNoticeOptionsFromReason(data.entry_reason);
          const hours = calculateEntryNoticePeriod(jurisdiction, options);
          return {
            notice_document_id: result.document_id,
            notice_id: result.notice_id,
            notice_fingerprint: entryNoticeFingerprint(data),
            service_status: data.service_status || 'unserved',
            effective_date: data.entry_date,
            required_notice_date: noticeCalculation?.requiredNoticeDate || null,
            notice_period_days: entryNoticeCalendarDays(hours),
          };
        },
        render: ({ workflowData }) => (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-semibold text-gray-800 mb-3">Notice Summary</h4>
              <div className="space-y-2 text-sm">
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
                  <span className="text-gray-600">Reason:</span>
                  <span className="font-medium">
                    {ENTRY_REASON_LABELS[workflowData.entry_reason] || workflowData.entry_reason}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Planned entry:</span>
                  <span className="font-medium">
                    {workflowData.entry_date}
                    {workflowData.entry_time ? ` · ${workflowData.entry_time}` : ''}
                  </span>
                </div>
                {workflowData.entry_reason === 'emergency' ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Notice:</span>
                    <span className="font-medium">Emergency exception</span>
                  </div>
                ) : noticeCalculation ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Written notice:</span>
                    <span className="font-medium">
                      {noticeCalculation.noticePeriodHours ?? noticeCalculation.noticePeriodDays}{' '}
                      {noticeCalculation.noticePeriodHours != null ? 'hours' : 'days'} before entry
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm text-blue-800">
                {workflowData.notice_document_id &&
                workflowData.notice_fingerprint === entryNoticeFingerprint(workflowData)
                  ? 'This worksheet PDF was already generated. Click Next to print, email, or record how notice was given.'
                  : 'Click Next to generate an entry-notice worksheet. This is not a statutory form. You will print, email, or record how notice was given on the next step.'}
              </p>
            </div>
          </div>
        ),
      },
      {
        title: 'Notice Service',
        description: 'Print or email the worksheet, then record how written notice was given — or save it for later.',
        fields: [],
        completeBusyLabel: 'Recording service…',
        validate: (data, ctx) => {
          const errors = validateNoticeService(data, ctx);
          if (ctx?.action !== 'record_service') return errors;
          const options = entryNoticeOptionsFromReason(data.entry_reason);
          if (
            !options.isEmergency &&
            isCompleteWorkflowDate(data.served_date) &&
            isCompleteWorkflowDate(data.entry_date)
          ) {
            const hours = calculateEntryNoticePeriod(jurisdiction, options);
            const days = entryNoticeCalendarDays(hours);
            const check = validateNoticePeriod(data.served_date, data.entry_date, days);
            if (!check.valid) {
              errors.served_date = check.message;
            }
          }
          return errors;
        },
        finishActions: [
          {
            id: 'service_later',
            label: 'Service Later',
            variant: 'outline',
            complete: false,
          },
          {
            id: 'record_service',
            label: 'Record Service',
            variant: 'primary',
            complete: true,
          },
        ],
        render: ({ workflowData, updateField, errors, workflowId: stepWorkflowId, userId }) => (
          <NoticeServiceStep
            workflowData={workflowData}
            updateField={updateField}
            errors={errors}
            documentId={workflowData.notice_document_id}
            tenantEmails={lease?.tenantEmails || []}
            propertyLabel={
              [property?.property_name, unitNumberText(lease?.units) && `Unit ${unitNumberText(lease?.units)}`]
                .filter(Boolean)
                .join(' — ')
            }
            noticeKind="entry"
            serviceMethods={serviceMethods}
            leaseId={workflowData.lease_id}
            propertyId={property?.property_id}
            unitId={lease?.units?.unit_id}
            workflowId={stepWorkflowId}
            userId={userId}
          />
        ),
      },
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="entry_notice"
      initialData={{
        ...initialData,
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
        if (meta.action === 'service_later') {
          onComplete(data, {
            status: 'pending_service',
            title: 'Notice ready — record service when you can',
            message:
              'The PDF is saved in Documents. This workflow stays in Active Workflows until you record how the notice was given.',
            documentId: data.notice_document_id,
            noticeId: data.notice_id,
          });
          return;
        }
        onComplete(data, {
          status: data.notice_document_id ? 'success' : 'error',
          title: data.notice_document_id
            ? 'Service recorded'
            : 'Workflow completed without a notice',
          message: data.notice_document_id
            ? 'Service is recorded.'
            : 'Lease, reason, and planned entry date are required to generate the notice.',
          documentId: data.notice_document_id,
          noticeId: data.notice_id,
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
