import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import NoticePeriodCalculator from '../NoticePeriodCalculator';
import CurrencyInput from '../CurrencyInput';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import WorkflowDateInput from '../WorkflowDateInput';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import {
  DEFAULT_JURISDICTION_PACK_ID,
  getNoticeServiceMethods,
  getRentIncreaseNoticeResources,
} from '../../jurisdictions/index.js';
import { brand } from '../../config/brand.js';
import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
  toWorkflowDateString,
} from '../../utils/workflow-date.js';
import { copyrightedFormsDisclaimer } from '../../utils/notice-official-resources.js';
import { formatPersonDisplayName } from '../../utils/lease-display.js';
import { resolveNoticeQuestionsContact } from '../../utils/notice-questions-contact.js';
import NoticeServiceStep from './NoticeServiceStep.jsx';
import { readResponseJson } from '../../utils/read-response-json.js';
import {
  NOTICE_PICKER_GROUP_GENERATE,
  NOTICE_PICKER_GROUP_RECORD_SERVICE,
  noticePickerAnnotation,
  openWorkflowsByLeaseId,
  rentIncreaseNoticeFingerprint,
  tenantEmailsFromLeaseClients,
  validateNoticeService,
} from '../../utils/notice-service-workflow.js';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';

/**
 * RentIncreaseWorkflow - Guided workflow for rent increase notices
 */
export default function RentIncreaseWorkflow({ 
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
  const workflowsByLease = openWorkflowsByLeaseId(openWorkflows);
  const leaseAnnotations = {};
  for (const [leaseId, openWorkflow] of workflowsByLease) {
    const annotation = noticePickerAnnotation(openWorkflow);
    if (annotation) leaseAnnotations[leaseId] = annotation;
  }

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
              landlord_id,
              manager_id,
              pmc_id
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
    const fingerprint = rentIncreaseNoticeFingerprint(data);
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
        notice_type: 'rent_increase',
        notice_data: {
          current_rent: data.current_rent,
          new_rent: data.new_rent,
          effective_date: data.effective_date,
          percent_increase:
            data.current_rent > 0
              ? ((data.new_rent - data.current_rent) / data.current_rent) * 100
              : null,
          locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
          unit_number: lease?.units?.unit_number || null,
          property_name: lease?.units?.properties?.property_name || null,
          landlord_id:
            lease?.landlord_id ||
            lease?.units?.properties?.landlord_id ||
            null,
          landlord_name: lease?.landlordName || null,
        }
      })
    });

    const parsed = await readResponseJson(response);
    const result = parsed.data || {};
    if (!parsed.ok || !result.success) {
      throw new Error(parsed.error || result.error || 'Failed to generate notice document');
    }
    return result;
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property ? detectJurisdiction(property) : DEFAULT_JURISDICTION_PACK_ID;
    const leaseType = lease?.end_date ? 'fixed_term' : 'month_to_month';
    const noticeResources = getRentIncreaseNoticeResources(jurisdiction);
    const serviceMethods = getNoticeServiceMethods(jurisdiction);

    return [
      {
        title: 'Select Lease',
        description:
          'Leases with a generated notice still waiting to be served are listed first. Pick one of those to record service, or pick another lease to generate a notice.',
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
            groups={[
              {
                id: NOTICE_PICKER_GROUP_RECORD_SERVICE,
                title: 'Record service',
                description:
                  'These leases already have a rent-increase notice. Open one to print, email, or record how it was served.',
                emptyLabel: 'No notices are waiting for service.',
                beforeSearch: true,
              },
              {
                id: NOTICE_PICKER_GROUP_GENERATE,
                title: 'Generate a notice',
                description:
                  'Choose a lease to calculate the notice period and create a worksheet, or continue an in-progress draft.',
                emptyLabel: 'No other leases are available.',
              },
            ]}
            leaseAnnotations={leaseAnnotations}
            onChange={(leaseId, selected) => {
              if (leaseId == null) {
                stampLeaseSelection(updateField, null, null);
                setLease(null);
                return;
              }
              const existing = workflowsByLease.get(String(leaseId));
              if (
                existing &&
                typeof onResumeWorkflow === 'function' &&
                String(existing.workflow_id) !== String(workflowId || '')
              ) {
                onResumeWorkflow(existing.workflow_id);
                return;
              }
              stampLeaseSelection(updateField, leaseId, selected);
              updateField(
                'current_rent',
                selected?.monthly_rent_amount != null
                  ? Number(selected.monthly_rent_amount)
                  : null
              );
              updateField('new_rent', null);
              fetchLeaseDetails(leaseId, selected);
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
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
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
              </div>

              <div>
                {workflowData.lease_id &&
                currentRent != null &&
                newRent != null &&
                isCompleteWorkflowDate(workflowData.effective_date) ? (
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
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
                    Enter current rent, new rent, and a desired effective date to see the required notice period.
                  </div>
                )}
              </div>
            </div>
          );
        }
      },
      {
        title: 'Generate Notice',
        description: 'Review the details, then click Next to generate the rent increase notice PDF.',
        fields: [],
        advanceBusyLabel: 'Generating notice…',
        onAdvance: async (data) => {
          if (!data.lease_id || !data.new_rent || !data.effective_date) {
            throw new Error('Lease, new rent, and effective date are required to generate the notice.');
          }
          const result = await generateNotice(data);
          const render = result.render || {};
          const renderMode = render.mode || 'unknown';
          const usedTemplatePositions =
            renderMode === 'pdf_overlay' || renderMode === 'image_based';
          if (!result.reused) {
            console.log('[RentIncreaseWorkflow] notice generated', {
              document_id: result.document_id,
              notice_id: result.notice_id,
              render,
            });
          }
          return {
            notice_document_id: result.document_id,
            notice_id: result.notice_id,
            notice_fingerprint: rentIncreaseNoticeFingerprint(data),
            notice_render_mode: renderMode,
            notice_used_template: usedTemplatePositions,
            service_status: data.service_status || 'unserved',
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
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Unit:</span>
                  <span className="font-medium">{lease?.units?.unit_number}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Questions contact:</span>
                  <span className="font-medium">
                    {lease?.questionsContact?.name
                      ? `${lease.questionsContact.name}${
                          lease.questionsContact.role
                            ? ` (${lease.questionsContact.role})`
                            : ''
                        }`
                      : '—'}
                  </span>
                </div>
                {(lease?.questionsContact?.phone ||
                  lease?.questionsContact?.email) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Contact info:</span>
                    <span className="font-medium">
                      {[
                        lease.questionsContact.phone,
                        lease.questionsContact.email,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Current Rent:</span>
                  <span className="font-medium">
                    {workflowData.current_rent != null
                      ? `$${Number(workflowData.current_rent).toFixed(2)}`
                      : '—'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">New Rent:</span>
                  <span className="font-medium">
                    {workflowData.new_rent != null
                      ? `$${Number(workflowData.new_rent).toFixed(2)}`
                      : '—'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
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
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Required Notice Period:</span>
                    <span className="font-medium">{noticeCalculation.noticePeriodDays} days</span>
                  </div>
                )}
                {toWorkflowDateString(noticeCalculation?.requiredNoticeDate) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Required Notice Date:</span>
                    <span className="font-medium">
                      {formatWorkflowDateForLocale(
                        toWorkflowDateString(noticeCalculation.requiredNoticeDate),
                        typeof navigator !== 'undefined' ? navigator.language : 'en-US'
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg space-y-2">
              <p className="text-sm text-blue-800">
                {workflowData.notice_document_id &&
                workflowData.notice_fingerprint ===
                  rentIncreaseNoticeFingerprint(workflowData)
                  ? 'This PDF was already generated. Click Next to print, email, or record service. Changing rent details will create a new PDF.'
                  : 'Click Next to generate a worksheet with the figures for this increase. You will print, email, or otherwise serve on the next step.'}
              </p>
              <p className="text-sm text-blue-900">
                Washington requires a notice substantially the same as the{' '}
                <a
                  href="https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.720"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  RCW 59.18.720 form
                </a>
                . A template-less PDF is a worksheet, not the statutory notice — use the
                official form (Commerce sample or RCW text) before serving.
              </p>
              {noticeResources.officialFormUrls.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-blue-900 space-y-1">
                  {noticeResources.officialFormUrls.map((entry) => (
                    <li key={entry.href}>
                      <a
                        href={entry.href}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {entry.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {noticeResources.preferredLandlordAssociation && (
                <p className="text-sm text-blue-900">
                  For fillable, city-specific templates we recommend{' '}
                  <a
                    href={
                      noticeResources.preferredLandlordAssociation.membershipUrl
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {noticeResources.preferredLandlordAssociation.name}
                  </a>
                  : join and import their current rent-increase forms into
                  Documents.{' '}
                  {copyrightedFormsDisclaimer(brand.productName)}
                  {noticeResources.preferredLandlordAssociation.formsUrl ? (
                    <>
                      {' '}
                      <a
                        href={
                          noticeResources.preferredLandlordAssociation.formsUrl
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        Rent increase notice list
                      </a>
                      .
                    </>
                  ) : null}
                </p>
              )}
            </div>
          </div>
        )
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
        render: ({ workflowData, updateField, errors, workflowId, userId }) => (
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
            noticeKind="rent increase"
            serviceMethods={serviceMethods}
            serviceNotes={noticeResources.serviceNotes || ''}
            preferredMethodIds={noticeResources.preferredMethodIds}
            leaseId={workflowData.lease_id}
            propertyId={property?.property_id}
            unitId={lease?.units?.unit_id}
            workflowId={workflowId}
            userId={userId}
          />
        )
      }
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="rent_increase"
      initialData={{
        ...initialData,
        property_id: lease?.units?.properties?.property_id ?? initialData.property_id,
        unit_id: lease?.units?.unit_id ?? initialData.unit_id,
        jurisdiction: lease?.units?.properties
          ? detectJurisdiction(lease.units.properties)
          : initialData.jurisdiction || DEFAULT_JURISDICTION_PACK_ID
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

        const usedTemplatePositions = data.notice_used_template === true;
        onComplete(data, {
          status: data.notice_document_id ? 'success' : 'error',
          title: data.notice_document_id
            ? 'Service recorded'
            : 'Workflow completed without a notice',
          message: data.notice_document_id
            ? usedTemplatePositions || !data.notice_render_mode
              ? 'Service is recorded. The rent increase notice is in Documents.'
              : 'Service is recorded. The notice was saved using a simple layout (a Notice template with field positions was unavailable).'
            : 'Lease, new rent, and effective date are required to generate the notice document.',
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

