import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import NoticePeriodCalculator from '../NoticePeriodCalculator';
import WorkflowField from '../WorkflowField';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID, getNoticeServiceMethods } from '../../jurisdictions/index.js';
import { isCompleteWorkflowDate } from '../../utils/workflow-date.js';
import NoticeServiceStep from './NoticeServiceStep.jsx';
import { readResponseJson } from '../../utils/read-response-json.js';
import {
  leaseViolationNoticeFingerprint,
  tenantEmailsFromLeaseClients,
  validateNoticeService,
} from '../../utils/notice-service-workflow.js';
import { unitNumberText } from '../../utils/unit-display.js';
import {
  VIOLATION_TYPE_LABELS,
  VIOLATION_TYPE_OPTIONS,
  violationCureDays,
  violationNoticeKindLabel,
  violationNoticeKindOptions,
} from '../../utils/lease-violation-notice.js';

/**
 * Lease Violation Notices — pack 10-day comply / 20-day notice, generate a
 * worksheet PDF, then record how it was served (RCW 59.12.030).
 */
export default function LeaseViolationWorkflow({
  initialData = {},
  workflowId = null,
  onComplete,
  onCancel,
  onWorkflowCreated,
  onResumeWorkflow,
  openWorkflows = [],
}) {
  const [lease, setLease] = useState(null);
  const [noticeCalculation, setNoticeCalculation] = useState(null);

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

      setLease({ ...data, tenantEmails });
    } catch (error) {
      console.error('Error fetching lease details:', error);
    }
  };

  const generateNotice = async (data, jurisdiction) => {
    const fingerprint = leaseViolationNoticeFingerprint(data);
    if (data.notice_document_id && data.notice_fingerprint === fingerprint) {
      return {
        status: 'success',
        document_id: data.notice_document_id,
        notice_id: data.notice_id,
        reused: true,
      };
    }

    const noticeKind = data.notice_kind || '10_day_compliance';
    const cureDays = violationCureDays(jurisdiction, noticeKind);
    const response = await fetch('/api/documents/generate/notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lease_id: data.lease_id,
        notice_type: 'lease_violation',
        notice_data: {
          effective_date: data.effective_date,
          violation_type: data.violation_type,
          violation_type_label: VIOLATION_TYPE_LABELS[data.violation_type] || data.violation_type,
          notice_kind: noticeKind,
          notice_kind_label: violationNoticeKindLabel(jurisdiction, noticeKind),
          cure_period_days: cureDays,
          additional_text: data.violation_description || '',
        },
      }),
    });
    const parsed = await readResponseJson(response);
    const result = parsed.data || {};
    if (!parsed.ok || !result.success) {
      throw new Error(parsed.error || result.error || 'Failed to generate violation notice');
    }
    return result;
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property ? detectJurisdiction(property) : DEFAULT_JURISDICTION_PACK_ID;
    const leaseType = lease?.end_date ? 'fixed_term' : 'month_to_month';
    const serviceMethods = getNoticeServiceMethods(jurisdiction);
    const kindOptions = violationNoticeKindOptions(jurisdiction);

    return [
      {
        title: 'Select Lease',
        description:
          'Leases with a generated notice still waiting to be served are listed first. Pick one of those to record service, or pick another lease to generate a notice.',
        fields: [
          {
            id: 'lease_id',
            label: 'Lease',
            type: 'lease',
            required: true,
            statuses: ['active'],
            showRent: true,
            emptyMessage: 'No active leases found.',
          },
        ],
        onLeaseSelected: (leaseId) => {
          if (leaseId) fetchLeaseDetails(leaseId);
          else setLease(null);
        },
      },
      {
        title: 'Violation Details',
        description:
          'Record the violation and the comply-or-vacate date. Cure days follow the notice type.',
        fields: [
          { id: 'violation_type', label: 'Violation Type', type: 'select', required: true },
          { id: 'notice_kind', label: 'Notice Type', type: 'select', required: true },
          { id: 'effective_date', label: 'Comply or vacate by', type: 'date', required: true },
          { id: 'violation_description', label: 'Description', type: 'textarea', required: true },
        ],
        validate: (data) => {
          const errors = {};
          if (!data.violation_type) {
            errors.violation_type = 'Violation type is required.';
          }
          if (!data.notice_kind) {
            errors.notice_kind = 'Notice type is required.';
          }
          if (!isCompleteWorkflowDate(data.effective_date)) {
            errors.effective_date = 'Comply or vacate by date is required.';
          }
          if (!String(data.violation_description || '').trim()) {
            errors.violation_description = 'A short description is required.';
          }
          return errors;
        },
        render: ({ workflowData, updateField, errors }) => {
          const noticeKind = workflowData.notice_kind || '10_day_compliance';
          const cureDays = violationCureDays(jurisdiction, noticeKind);
          const fieldProps = { workflowData, updateField };
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start gap-3">
                <WorkflowField
                  field={{
                    id: 'violation_type',
                    label: 'Violation Type',
                    type: 'select',
                    required: true,
                    width: 'md',
                    options: VIOLATION_TYPE_OPTIONS,
                  }}
                  {...fieldProps}
                  error={errors.violation_type || ''}
                />
                <WorkflowField
                  field={{
                    id: 'notice_kind',
                    label: 'Notice Type',
                    type: 'select',
                    required: true,
                    width: 'md',
                    includeEmpty: false,
                    options: kindOptions,
                  }}
                  workflowData={{ ...workflowData, notice_kind: noticeKind }}
                  updateField={updateField}
                  error={errors.notice_kind || ''}
                />
                <WorkflowField
                  field={{
                    id: 'effective_date',
                    label: 'Comply or vacate by',
                    type: 'date',
                    required: true,
                    width: 'sm',
                  }}
                  {...fieldProps}
                  error={errors.effective_date || ''}
                />
              </div>

              <p className="text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-3">
                Cure period is {cureDays} days for this notice type. Not legal advice. See
                RCW 59.12.030.
              </p>

              <WorkflowField
                field={{
                  id: 'violation_description',
                  label: 'Description',
                  type: 'textarea',
                  required: true,
                  rows: 3,
                  width: 'lg',
                }}
                {...fieldProps}
                error={errors.violation_description || ''}
              />

              {workflowData.lease_id && isCompleteWorkflowDate(workflowData.effective_date) ? (
                <NoticePeriodCalculator
                  workflowType="lease_violation"
                  leaseType={leaseType}
                  propertyId={property?.property_id}
                  jurisdiction={jurisdiction}
                  context={{
                    effectiveDate: workflowData.effective_date,
                    noticeType: noticeKind,
                  }}
                  onCalculationChange={setNoticeCalculation}
                />
              ) : null}
            </div>
          );
        },
      },
      {
        title: 'Generate Notice',
        description: 'Review the details, then click Next to generate the violation worksheet.',
        fields: [],
        advanceBusyLabel: 'Generating notice…',
        onAdvance: async (data) => {
          if (!data.lease_id || !data.violation_type || !data.effective_date) {
            throw new Error(
              'Lease, violation type, and comply-or-vacate date are required to generate the notice.'
            );
          }
          const noticeKind = data.notice_kind || '10_day_compliance';
          const result = await generateNotice({ ...data, notice_kind: noticeKind }, jurisdiction);
          return {
            notice_document_id: result.document_id,
            notice_id: result.notice_id,
            notice_fingerprint: leaseViolationNoticeFingerprint({
              ...data,
              notice_kind: noticeKind,
            }),
            notice_kind: noticeKind,
            cure_period_days: violationCureDays(jurisdiction, noticeKind),
            service_status: data.service_status || 'unserved',
          };
        },
        render: ({ workflowData }) => {
          const noticeKind = workflowData.notice_kind || '10_day_compliance';
          return (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
                <h4 className="font-semibold text-gray-800 mb-1">Notice summary</h4>
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
                  <span className="text-gray-600">Violation:</span>
                  <span className="font-medium">
                    {VIOLATION_TYPE_LABELS[workflowData.violation_type] ||
                      workflowData.violation_type}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Notice:</span>
                  <span className="font-medium">
                    {violationNoticeKindLabel(jurisdiction, noticeKind)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Comply or vacate by:</span>
                  <span className="font-medium">{workflowData.effective_date}</span>
                </div>
                {noticeCalculation ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Cure period:</span>
                    <span className="font-medium">{noticeCalculation.noticePeriodDays} days</span>
                  </div>
                ) : null}
              </div>
              <p className="text-sm text-blue-800 bg-blue-50 rounded-lg p-3">
                {workflowData.notice_document_id &&
                workflowData.notice_fingerprint ===
                  leaseViolationNoticeFingerprint(workflowData)
                  ? 'This worksheet PDF was already generated. Click Next to print, email, or record service.'
                  : 'Click Next to generate a violation-notice worksheet. This is not a statutory form. You will print, email, or record service on the next step.'}
              </p>
            </div>
          );
        },
      },
      {
        title: 'Notice Service',
        description: 'Print or email the worksheet, then record service or save it for later.',
        fields: [],
        completeBusyLabel: 'Recording service…',
        validate: (data, ctx) => validateNoticeService(data, ctx),
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
              [
                property?.property_name,
                unitNumberText(lease?.units) && `Unit ${unitNumberText(lease?.units)}`,
              ]
                .filter(Boolean)
                .join(' — ')
            }
            noticeKind="lease violation"
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
      workflowType="lease_violation"
      initialData={{
        ...initialData,
        notice_kind: initialData.notice_kind || '10_day_compliance',
        property_id: lease?.units?.properties?.property_id ?? initialData.property_id,
        unit_id: lease?.units?.unit_id ?? initialData.unit_id,
        jurisdiction: lease?.units?.properties
          ? detectJurisdiction(lease.units.properties)
          : initialData.jurisdiction || DEFAULT_JURISDICTION_PACK_ID,
      }}
      workflowId={workflowId}
      openWorkflows={openWorkflows}
      onResumeWorkflow={onResumeWorkflow}
      getSteps={getWorkflowSteps}
      onComplete={async (data, meta = {}) => {
        if (!onComplete) return;
        if (meta.action === 'service_later') {
          onComplete(data, {
            status: 'pending_service',
            title: 'Notice ready — record service when you can',
            message:
              'The PDF is saved in Documents. This workflow stays in Active Workflows until you record how the notice was served.',
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
            : 'Lease, violation type, and comply-or-vacate date are required to generate the notice.',
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
