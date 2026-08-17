import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import NoticePeriodCalculator from '../NoticePeriodCalculator';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import WorkflowDateInput from '../WorkflowDateInput';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import {
  DEFAULT_JURISDICTION_PACK_ID,
  getJurisdictionDisplayName,
  getNoticeServiceMethods,
} from '../../jurisdictions/index.js';
import { brand } from '../../config/brand.js';
import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
} from '../../utils/workflow-date.js';
import { formatPersonDisplayName } from '../../utils/lease-display.js';
import { resolveNoticeQuestionsContact } from '../../utils/notice-questions-contact.js';
import { copyrightedFormsDisclaimer } from '../../utils/notice-official-resources.js';
import NoticeServiceStep from './NoticeServiceStep.jsx';
import { readResponseJson } from '../../utils/read-response-json.js';
import {
  leaseTerminationNoticeFingerprint,
  tenantEmailsFromLeaseClients,
  validateNoticeService,
} from '../../utils/notice-service-workflow.js';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';
import {
  evaluateLeaseTermination,
  leaseTypeFromLease,
} from '../../utils/compliance-calculator.js';

function hasCauseValue(value) {
  return value === 'yes' || value === true;
}

export default function LeaseTerminationWorkflow({
  initialData = {},
  workflowId = null,
  onComplete,
  onCancel,
  onWorkflowCreated,
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
              landlord_id,
              manager_id,
              pmc_id
            )
          )
        `)
        .eq('lease_id', leaseId)
        .single();
      if (error) throw error;

      let landlordName = '';
      const landlordId = data.landlord_id || data.units?.properties?.landlord_id || null;
      if (landlordId) {
        const { data: contacts } = await supabase
          .from('contacts')
          .select('first_name, middle_name, last_name')
          .eq('contactable_type', 'landlord')
          .eq('contactable_id', landlordId)
          .limit(1);
        landlordName = formatPersonDisplayName(contacts?.[0]) || '';
      }

      const questionsContact = await resolveNoticeQuestionsContact(
        supabase,
        data.units?.properties,
        data.landlord_id
      );

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

      setLease({ ...data, landlordName, questionsContact, tenantEmails });
    } catch (error) {
      console.error('Error fetching lease details:', error);
    }
  };

  const generateNotice = async (data) => {
    const fingerprint = leaseTerminationNoticeFingerprint(data);
    if (data.notice_document_id && data.notice_fingerprint === fingerprint) {
      return {
        status: 'success',
        document_id: data.notice_document_id,
        notice_id: data.notice_id,
        reused: true,
      };
    }

    const response = await fetch('/api/documents/generate/notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lease_id: data.lease_id,
        notice_type: 'lease_termination',
        notice_data: {
          effective_date: data.effective_date,
          initiated_by: data.initiated_by,
          has_cause: data.has_cause,
          termination_reason: data.termination_reason,
          additional_text: data.termination_reason || '',
          locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
          unit_number: lease?.units?.unit_number || null,
          property_name: lease?.units?.properties?.property_name || null,
          landlord_name: lease?.landlordName || null,
        },
      }),
    });

    const parsed = await readResponseJson(response);
    const result = parsed.data || {};
    if (!parsed.ok || !result.success) {
      throw new Error(parsed.error || result.error || 'Failed to generate termination notice');
    }
    return result;
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property
      ? detectJurisdiction(property)
      : DEFAULT_JURISDICTION_PACK_ID;
    const leaseType = leaseTypeFromLease(lease);
    const serviceMethods = getNoticeServiceMethods(jurisdiction);
    const packName = getJurisdictionDisplayName(jurisdiction);

    return [
      {
        title: 'Select Lease',
        description: 'Choose the lease to end.',
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
              if (leaseId) fetchLeaseDetails(leaseId);
              else setLease(null);
            }}
          />
        ),
      },
      {
        title: 'Termination Details',
        description: 'Who is ending the tenancy, whether there is just cause, and the effective date.',
        fields: [
          { id: 'initiated_by', label: 'Initiated by', type: 'select', required: true },
          { id: 'termination_reason', label: 'Reason', type: 'textarea', required: true },
          { id: 'effective_date', label: 'Termination effective date', type: 'date', required: true },
        ],
        validate: (data) => {
          const errors = {};
          if (data.initiated_by === 'landlord' && !data.has_cause) {
            errors.has_cause = 'Say whether this landlord ending is for cause.';
          }
          const evaluation = evaluateLeaseTermination({
            leaseType,
            jurisdiction,
            initiatedBy: data.initiated_by || 'landlord',
            hasCause: hasCauseValue(data.has_cause),
            leaseEndDate: lease?.end_date || null,
          });
          if (evaluation.blocked) {
            errors.has_cause = evaluation.blockReason;
          }
          return errors;
        },
        render: ({ workflowData, updateField, errors }) => {
          const evaluation = evaluateLeaseTermination({
            leaseType,
            jurisdiction,
            initiatedBy: workflowData.initiated_by || 'landlord',
            hasCause: hasCauseValue(workflowData.has_cause),
            leaseEndDate: lease?.end_date || null,
          });
          return (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-800">
                Pack: {packName}. Lease looks{' '}
                {leaseType === 'fixed_term' ? 'fixed-term' : 'month-to-month'}
                {lease?.end_date ? ` (ends ${lease.end_date})` : ''}.
                Pack math is reference math, not legal advice.
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Initiated by <span className="text-red-500">*</span>
                </label>
                <select
                  value={workflowData.initiated_by || ''}
                  onChange={(e) => updateField('initiated_by', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md ${
                    errors.initiated_by ? 'border-red-300' : 'border-gray-300'
                  }`}
                >
                  <option value="">Select...</option>
                  <option value="landlord">Landlord</option>
                  <option value="tenant">Tenant</option>
                  <option value="mutual">Mutual agreement</option>
                </select>
                {errors.initiated_by && (
                  <p className="mt-1 text-sm text-red-600">{errors.initiated_by}</p>
                )}
              </div>

              {workflowData.initiated_by === 'landlord' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Termination for cause <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={workflowData.has_cause || ''}
                    onChange={(e) => updateField('has_cause', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md ${
                      errors.has_cause ? 'border-red-300' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select...</option>
                    <option value="yes">Yes — statutory just cause (operator-confirmed)</option>
                    <option value="no">No — not for cause</option>
                  </select>
                  {errors.has_cause && (
                    <p className="mt-1 text-sm text-red-600">{errors.has_cause}</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={workflowData.termination_reason || ''}
                  onChange={(e) => updateField('termination_reason', e.target.value)}
                  rows={4}
                  className={`w-full px-3 py-2 border rounded-md ${
                    errors.termination_reason ? 'border-red-300' : 'border-gray-300'
                  }`}
                  placeholder="Cite the statutory ground or tenant notice, in your own words."
                />
                {errors.termination_reason && (
                  <p className="mt-1 text-sm text-red-600">{errors.termination_reason}</p>
                )}
              </div>

              <WorkflowDateInput
                label="Termination effective date"
                required
                value={workflowData.effective_date || ''}
                onChange={(next) => updateField('effective_date', next)}
                error={errors.effective_date || ''}
              />

              {evaluation.renewalOfferRequired && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-900">
                  {evaluation.blockReason}{' '}
                  {evaluation.renewalOfferMinDaysBeforeEnd != null &&
                    evaluation.renewalOfferMaxDaysBeforeEnd != null && (
                      <>
                        Renewal offers belong {evaluation.renewalOfferMinDaysBeforeEnd}–
                        {evaluation.renewalOfferMaxDaysBeforeEnd} days before the end date
                        {evaluation.daysUntilLeaseEnd != null
                          ? ` (currently ${evaluation.daysUntilLeaseEnd} days out)`
                          : ''}
                        .
                      </>
                    )}
                </div>
              )}
              {evaluation.justCauseRequiredForPath && !evaluation.renewalOfferRequired && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-900">
                  {evaluation.blockReason}
                </div>
              )}

              {workflowData.lease_id && isCompleteWorkflowDate(workflowData.effective_date) && (
                <NoticePeriodCalculator
                  workflowType="lease_termination"
                  leaseType={leaseType}
                  propertyId={property?.property_id}
                  jurisdiction={jurisdiction}
                  context={{
                    initiatedBy: workflowData.initiated_by || 'landlord',
                    hasCause: hasCauseValue(workflowData.has_cause),
                    effectiveDate: workflowData.effective_date,
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
        description: 'Review the details, then click Next to generate a worksheet PDF.',
        fields: [],
        advanceBusyLabel: 'Generating notice…',
        validate: (data) => {
          const evaluation = evaluateLeaseTermination({
            leaseType,
            jurisdiction,
            initiatedBy: data.initiated_by || 'landlord',
            hasCause: hasCauseValue(data.has_cause),
            leaseEndDate: lease?.end_date || null,
          });
          if (evaluation.blocked) {
            return { general: evaluation.blockReason };
          }
          return {};
        },
        onAdvance: async (data) => {
          const evaluation = evaluateLeaseTermination({
            leaseType,
            jurisdiction,
            initiatedBy: data.initiated_by || 'landlord',
            hasCause: hasCauseValue(data.has_cause),
            leaseEndDate: lease?.end_date || null,
          });
          if (evaluation.blocked) {
            throw new Error(evaluation.blockReason);
          }
          if (!data.lease_id || !data.effective_date) {
            throw new Error('Lease and effective date are required to generate the notice.');
          }
          const result = await generateNotice(data);
          return {
            notice_document_id: result.document_id,
            notice_id: result.notice_id,
            notice_fingerprint: leaseTerminationNoticeFingerprint(data),
            service_status: data.service_status || 'unserved',
          };
        },
        render: ({ workflowData }) => (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-gray-600">Property</span>
                <span className="font-medium">{property?.property_name || '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-600">Unit</span>
                <span className="font-medium">{lease?.units?.unit_number || '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-600">Initiated by</span>
                <span className="font-medium">{workflowData.initiated_by || '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-600">For cause</span>
                <span className="font-medium">
                  {workflowData.initiated_by === 'landlord'
                    ? workflowData.has_cause === 'yes'
                      ? 'Yes'
                      : workflowData.has_cause === 'no'
                        ? 'No'
                        : '—'
                    : 'n/a'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-600">Effective date</span>
                <span className="font-medium">
                  {isCompleteWorkflowDate(workflowData.effective_date)
                    ? formatWorkflowDateForLocale(
                        workflowData.effective_date,
                        typeof navigator !== 'undefined' ? navigator.language : 'en-US'
                      )
                    : workflowData.effective_date || '—'}
                </span>
              </div>
              {noticeCalculation?.noticePeriodDays != null && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Pack notice period</span>
                  <span className="font-medium">{noticeCalculation.noticePeriodDays} days</span>
                </div>
              )}
            </div>
            {workflowData.termination_reason && (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {workflowData.termination_reason}
              </p>
            )}
            <div className="bg-blue-50 p-4 rounded-lg space-y-2 text-sm text-blue-900">
              <p>
                {workflowData.notice_document_id &&
                workflowData.notice_fingerprint ===
                  leaseTerminationNoticeFingerprint(workflowData)
                  ? 'This PDF was already generated. Click Next to print, email, or record service.'
                  : 'Click Next to generate a worksheet. You will print, email, or otherwise serve on the next step.'}
              </p>
              <p>
                This PDF is a worksheet, not a statutory termination form.{' '}
                {copyrightedFormsDisclaimer(brand.productName)} Review RCW 59.18.650
                {jurisdiction === 'seattle' ? ' and SMC 22.206.160' : ''} before serving.
              </p>
            </div>
          </div>
        ),
      },
      {
        title: 'Notice Service',
        description: 'Print or email the notice, then record service or save it for later.',
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
              [property?.property_name, lease?.units?.unit_number && `Unit ${lease.units.unit_number}`]
                .filter(Boolean)
                .join(' — ')
            }
            noticeKind="lease termination"
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
      workflowType="lease_termination"
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
            ? 'Service is recorded. The termination worksheet is in Documents.'
            : 'Lease and effective date are required to generate the notice document.',
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
