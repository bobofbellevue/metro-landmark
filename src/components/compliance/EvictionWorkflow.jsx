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
  evictionNoticeFingerprint,
  tenantEmailsFromLeaseClients,
  validateNoticeService,
} from '../../utils/notice-service-workflow.js';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';

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
    const fingerprint = evictionNoticeFingerprint(data);
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
        notice_type: data.notice_type,
        notice_data: {
          effective_date: data.effective_date,
          violation_reason: data.violation_reason,
          amount_owed: data.amount_owed,
        }
      })
    });

    const parsed = await readResponseJson(response);
    const result = parsed.data || {};
    if (!parsed.ok || !result.success) {
      throw new Error(parsed.error || result.error || 'Failed to generate eviction notice document');
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
            onChange={(leaseId, selected) => {
              stampLeaseSelection(updateField, leaseId, selected);
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
        title: 'Generate Notice',
        description: 'Review the details, then click Next to generate the eviction notice PDF.',
        fields: [],
        advanceBusyLabel: 'Generating notice…',
        onAdvance: async (data) => {
          if (!data.lease_id || !data.notice_type || !data.effective_date) {
            throw new Error('Lease, notice type, and effective date are required to generate the notice.');
          }
          const result = await generateNotice(data);
          return {
            notice_document_id: result.document_id,
            notice_id: result.notice_id,
            notice_fingerprint: evictionNoticeFingerprint(data),
            service_status: data.service_status || 'unserved',
          };
        },
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
                  {workflowData.notice_document_id &&
                  workflowData.notice_fingerprint ===
                    evictionNoticeFingerprint(workflowData)
                    ? 'This notice PDF was already generated. Click Next to print, email, or record service.'
                    : 'Click Next to generate the eviction notice. You will print, email, or otherwise serve it on the next step.'}
                </p>
              </div>
            </div>
          );
        }
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
            noticeKind="eviction"
            serviceMethods={serviceMethods}
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
      workflowType="eviction"
      initialData={{
        ...initialData,
        property_id: lease?.units?.properties?.property_id,
        unit_id: lease?.units?.unit_id,
        jurisdiction: lease?.units?.properties ? detectJurisdiction(lease.units.properties) : DEFAULT_JURISDICTION_PACK_ID
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
            ? 'Service is recorded. The eviction notice is in Documents.'
            : 'Lease, notice type, and effective date are required to generate the notice.',
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

