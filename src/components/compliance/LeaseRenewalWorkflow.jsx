import React, { useCallback, useEffect, useState } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import CurrencyInput from '../CurrencyInput';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import WorkflowDateInput from '../WorkflowDateInput';
import { ApplicationFormBuilder } from '../ApplicationFormBuilder';
import { supabase } from '../../lib/supabase';
import {
  addDaysToWorkflowDate,
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
  suggestRenewalEndDate,
  todayWorkflowDate,
  toWorkflowDateString,
} from '../../utils/workflow-date.js';
import {
  fetchLeaseMappingContext,
  mappingValuesFromContext,
} from '../../utils/fetch-lease-mapping-context.js';
import {
  makeAllFieldsOptional,
  stripInternalIdFieldsFromDocumentData,
  stripInternalIdFieldsFromTemplate,
} from '../../utils/template-field-filter.js';
import { parseTemplateData } from '../../utils/template-data.js';
import { mapLeaseLikeDataToTemplate } from '../../../utils/map-template-fields.js';

function formatMoney(amount) {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

function formatDisplayDate(value) {
  if (!value) return '—';
  if (isCompleteWorkflowDate(value)) {
    return formatWorkflowDateForLocale(
      value,
      typeof navigator !== 'undefined' ? navigator.language : 'en-US'
    );
  }
  return value;
}

function SummaryRow({ label, value }) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div>
      <span className="text-gray-600">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * LeaseRenewalWorkflow — renew an existing lease, edit template fields, and
 * create both a renewal PDF and a new lease record.
 */
export default function LeaseRenewalWorkflow({
  initialData = {},
  workflowId = null,
  onComplete,
  onCancel,
  onWorkflowCreated,
}) {
  const [lease, setLease] = useState(null);
  const [selectedLeaseMeta, setSelectedLeaseMeta] = useState(null);
  const [mappingContext, setMappingContext] = useState(null);
  const [templateSchema, setTemplateSchema] = useState(null);
  const [templateId, setTemplateId] = useState(null);
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [loadingMoreFields, setLoadingMoreFields] = useState(false);
  const [moreFieldsError, setMoreFieldsError] = useState('');

  const loadMappingContext = useCallback(async (leaseId) => {
    if (!leaseId) {
      setMappingContext(null);
      setLease(null);
      return;
    }
    try {
      const context = await fetchLeaseMappingContext(leaseId);
      setMappingContext(context);
      setLease(context.lease);
    } catch (error) {
      console.error('[LeaseRenewalWorkflow] Error loading lease context:', error);
    }
  }, []);

  useEffect(() => {
    if (initialData.lease_id) {
      loadMappingContext(initialData.lease_id);
    }
  }, [initialData.lease_id, loadMappingContext]);

  const suggestTermsFromLease = (leaseRow, updateField) => {
    if (!leaseRow) return;
    const currentRent = leaseRow.monthly_rent_amount;
    if (currentRent != null && currentRent !== '') {
      updateField('new_rent', Number(currentRent));
    }

    const originalEnd = toWorkflowDateString(leaseRow.end_date);
    const originalStart = toWorkflowDateString(leaseRow.start_date);

    let start = '';
    if (isCompleteWorkflowDate(originalEnd)) {
      start = addDaysToWorkflowDate(originalEnd, 1);
    } else {
      start = todayWorkflowDate();
    }
    updateField('renewal_start_date', start);

    const end = suggestRenewalEndDate(start, originalStart, originalEnd);
    if (end) {
      updateField('renewal_end_date', end);
    }
  };

  const resolveLeaseTemplateRow = async (leaseRow) => {
    if (leaseRow?.template_id) {
      const { data } = await supabase
        .from('templates')
        .select('*')
        .eq('template_id', leaseRow.template_id)
        .eq('template_type', 'Lease')
        .maybeSingle();
      if (data) return data;
    }

    const { data: defaults } = await supabase
      .from('templates')
      .select('*')
      .eq('template_type', 'Lease')
      .eq('is_default', true)
      .eq('is_archived', false)
      .order('template_level', { ascending: true })
      .limit(1);
    if (defaults?.[0]) return defaults[0];

    const { data: anyLease } = await supabase
      .from('templates')
      .select('*')
      .eq('template_type', 'Lease')
      .eq('is_archived', false)
      .order('template_level', { ascending: true })
      .order('template_id', { ascending: true })
      .limit(1);
    return anyLease?.[0] || null;
  };

  const ensureMoreFieldsLoaded = async (workflowData, updateField) => {
    if (templateSchema && workflowData.document_data) {
      setShowMoreFields(true);
      return;
    }

    const leaseId = workflowData.lease_id;
    if (!leaseId) {
      setMoreFieldsError('Select a lease before editing more fields.');
      return;
    }

    setLoadingMoreFields(true);
    setMoreFieldsError('');
    try {
      let context = mappingContext;
      if (!context || context.lease?.lease_id !== leaseId) {
        context = await fetchLeaseMappingContext(leaseId);
        setMappingContext(context);
        setLease(context.lease);
      }

      const template = await resolveLeaseTemplateRow(context.lease);
      if (!template) {
        setMoreFieldsError('No lease template found to edit fields from.');
        return;
      }

      const parsed = makeAllFieldsOptional(
        stripInternalIdFieldsFromTemplate(parseTemplateData(template))
      );
      setTemplateSchema(parsed);
      setTemplateId(template.template_id);

      const values = mappingValuesFromContext(context, {
        start_date: workflowData.renewal_start_date,
        end_date: workflowData.renewal_end_date || null,
        monthly_rent_amount:
          workflowData.new_rent != null && workflowData.new_rent !== ''
            ? Number(workflowData.new_rent)
            : null,
        date_of_agreement: todayWorkflowDate(),
      });

      let mapped = {};
      try {
        const response = await fetch('/api/leases/map-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mappingData: {
              lease: {
                ...context.lease,
                start_date: values.start_date,
                end_date: values.end_date,
                monthly_rent_amount: values.monthly_rent_amount,
                date_of_agreement: values.date_of_agreement,
              },
              unit: context.unit,
              property: context.property,
              landlord: context.landlord,
              tenants: context.tenants,
            },
            templateData: parsed,
          }),
        });
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.mappedFields) {
            mapped = result.mappedFields;
          }
        }
      } catch (mapError) {
        console.warn(
          '[LeaseRenewalWorkflow] LLM map-fields failed, using deterministic map',
          mapError
        );
      }

      if (!mapped || Object.keys(mapped).length === 0) {
        mapped = mapLeaseLikeDataToTemplate(parsed, values);
      }

      const cleaned = stripInternalIdFieldsFromDocumentData(mapped);
      if (!workflowData.document_data || Object.keys(workflowData.document_data).length === 0) {
        updateField('document_data', cleaned);
      }
      updateField('template_id', template.template_id);
      setShowMoreFields(true);
    } catch (error) {
      console.error('[LeaseRenewalWorkflow] Error loading more fields:', error);
      setMoreFieldsError(
        error.message || 'Could not load additional lease fields.'
      );
    } finally {
      setLoadingMoreFields(false);
    }
  };

  const getWorkflowSteps = () => {
    const summary = mappingContext?.summary || {};
    const unitNumber =
      summary.unit_number ||
      lease?.units?.unit_number ||
      selectedLeaseMeta?.units?.unit_number;
    const propertyName =
      summary.property_name ||
      lease?.units?.properties?.property_name ||
      selectedLeaseMeta?.units?.properties?.property_name;
    const tenantNames =
      summary.tenant_names ||
      selectedLeaseMeta?.tenantNames ||
      selectedLeaseMeta?.tenant_names ||
      '';
    const addressLine =
      summary.address_line || selectedLeaseMeta?.addressLine || '';
    const landlordName =
      summary.landlord_name || selectedLeaseMeta?.landlordName || '';
    const county = summary.county || '';

    return [
      {
        title: 'Select Lease',
        description: 'Choose the existing lease to renew.',
        fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
        render: ({ workflowData, updateField, errors }) => (
          <LeaseSelectionPicker
            value={workflowData.lease_id || null}
            error={errors?.lease_id}
            statuses={['active', 'pending', 'future']}
            showRent
            emptyMessage="No active, pending, or future leases found to renew."
            onChange={(leaseId, selected) => {
              updateField('lease_id', leaseId);
              updateField('document_data', {});
              setSelectedLeaseMeta(selected || null);
              setShowMoreFields(false);
              setTemplateSchema(null);
              setTemplateId(null);
              setMoreFieldsError('');
              if (leaseId) {
                loadMappingContext(leaseId);
                if (selected) {
                  suggestTermsFromLease(selected, updateField);
                }
              } else {
                setLease(null);
                setSelectedLeaseMeta(null);
                setMappingContext(null);
              }
            }}
          />
        ),
      },
      {
        title: 'Renewal Terms',
        description:
          'Confirm the renewed rent and term dates. Optionally edit any other fields that will appear on the new lease document.',
        fields: [
          { id: 'new_rent', label: 'New Monthly Rent', type: 'number', required: true },
          {
            id: 'renewal_start_date',
            label: 'Renewal Start Date',
            type: 'date',
            required: true,
          },
          {
            id: 'renewal_end_date',
            label: 'Renewal End Date',
            type: 'date',
            required: false,
          },
        ],
        validate: (data) => {
          const errs = {};
          if (
            isCompleteWorkflowDate(data.renewal_start_date) &&
            isCompleteWorkflowDate(data.renewal_end_date) &&
            data.renewal_end_date < data.renewal_start_date
          ) {
            errs.renewal_end_date =
              'Renewal end date must be on or after the renewal start date';
          }
          return errs;
        },
        render: ({ workflowData, updateField, errors }) => (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg text-sm space-y-1">
              <h4 className="font-semibold text-gray-800 mb-2">
                Current lease terms
              </h4>
              <SummaryRow label="Property" value={propertyName} />
              <SummaryRow label="Address" value={addressLine} />
              <SummaryRow label="Unit" value={unitNumber} />
              <SummaryRow label="County" value={county} />
              <SummaryRow label="Tenant(s)" value={tenantNames} />
              <SummaryRow label="Lessor" value={landlordName} />
              <SummaryRow
                label="Agreement date"
                value={formatDisplayDate(summary.agreement_date)}
              />
              <SummaryRow
                label="Current term"
                value={
                  summary.start_date || summary.end_date
                    ? `${summary.start_date ? formatDisplayDate(summary.start_date) : '—'} – ${
                        summary.end_date ? formatDisplayDate(summary.end_date) : '—'
                      }`
                    : null
                }
              />
              <SummaryRow label="Lease term" value={summary.lease_term} />
              <SummaryRow
                label="Current rent"
                value={formatMoney(
                  summary.monthly_rent_amount ??
                    lease?.monthly_rent_amount ??
                    selectedLeaseMeta?.monthly_rent_amount
                )}
              />
              <SummaryRow label="Rent due date" value={summary.rent_due_date} />
              <SummaryRow
                label="Security deposit"
                value={formatMoney(summary.security_deposit_amount)}
              />
              <SummaryRow
                label="Pet deposit"
                value={formatMoney(summary.pet_deposit_amount)}
              />
              <SummaryRow
                label="Other fee"
                value={formatMoney(summary.other_fee_amount)}
              />
              <SummaryRow label="Pets" value={summary.pets} />
              <SummaryRow label="Dependents" value={summary.dependent_names} />
            </div>

            <div>
              <CurrencyInput
                label="New Monthly Rent"
                required
                value={
                  workflowData.new_rent === null ||
                  workflowData.new_rent === undefined ||
                  workflowData.new_rent === ''
                    ? null
                    : Number(workflowData.new_rent)
                }
                onChange={(val) => updateField('new_rent', val)}
                className={errors.new_rent ? '[&_input]:border-red-300' : ''}
              />
              {errors.new_rent && (
                <p className="mt-1 text-sm text-red-600">{errors.new_rent}</p>
              )}
            </div>

            <WorkflowDateInput
              label="Renewal Start Date"
              required
              value={workflowData.renewal_start_date || ''}
              onChange={(next) => updateField('renewal_start_date', next)}
              error={errors.renewal_start_date || ''}
            />

            <WorkflowDateInput
              label="Renewal End Date"
              value={workflowData.renewal_end_date || ''}
              onChange={(next) => updateField('renewal_end_date', next)}
              error={errors.renewal_end_date || ''}
            />

            <div className="border-t border-gray-200 pt-4 space-y-3">
              {!showMoreFields ? (
                <button
                  type="button"
                  onClick={() => ensureMoreFieldsLoaded(workflowData, updateField)}
                  disabled={loadingMoreFields}
                  className="text-sm font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
                >
                  {loadingMoreFields ? 'Loading fields…' : 'Edit More…'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowMoreFields(false)}
                  className="text-sm font-medium text-gray-600 hover:text-gray-800"
                >
                  Hide additional fields
                </button>
              )}

              {moreFieldsError && (
                <p className="text-sm text-red-600">{moreFieldsError}</p>
              )}

              {showMoreFields && templateSchema && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">
                    Edit any value that should appear on the new lease document.
                    Party identity, property, and unit stay the same — only the
                    wording on the document changes.
                  </p>
                  <div className="max-h-[28rem] overflow-y-auto border border-gray-200 rounded-lg p-3 bg-white">
                    <ApplicationFormBuilder
                      documentData={workflowData.document_data || {}}
                      onChange={(next) =>
                        updateField(
                          'document_data',
                          stripInternalIdFieldsFromDocumentData(next || {})
                        )
                      }
                      templateData={templateSchema}
                      readOnly={false}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        title: 'Generate Renewal',
        description:
          'Review the renewal details, then generate the document and create the new lease record.',
        fields: [],
        validate: (data) => {
          const errs = {};
          if (!data.lease_id) {
            errs.lease_id = 'Select a lease before generating the renewal';
          }
          if (!isCompleteWorkflowDate(data.renewal_start_date)) {
            errs.renewal_start_date =
              'Renewal start date is required before generating';
          }
          if (
            isCompleteWorkflowDate(data.renewal_start_date) &&
            isCompleteWorkflowDate(data.renewal_end_date) &&
            data.renewal_end_date < data.renewal_start_date
          ) {
            errs.renewal_end_date =
              'Renewal end date must be on or after the renewal start date';
          }
          return errs;
        },
        render: ({ workflowData, errors }) => (
          <div className="space-y-4">
            {(errors.lease_id ||
              errors.renewal_start_date ||
              errors.renewal_end_date) && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 space-y-1">
                {errors.lease_id && <p>{errors.lease_id}</p>}
                {errors.renewal_start_date && <p>{errors.renewal_start_date}</p>}
                {errors.renewal_end_date && <p>{errors.renewal_end_date}</p>}
              </div>
            )}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-semibold text-gray-800 mb-3">Renewal Summary</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Property</span>
                  <span className="font-medium text-right">
                    {propertyName || '—'}
                  </span>
                </div>
                {addressLine ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Address</span>
                    <span className="font-medium text-right">{addressLine}</span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Unit</span>
                  <span className="font-medium text-right">
                    {unitNumber || '—'}
                  </span>
                </div>
                {landlordName ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Lessor</span>
                    <span className="font-medium text-right">{landlordName}</span>
                  </div>
                ) : null}
                {tenantNames ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Tenant(s)</span>
                    <span className="font-medium text-right">{tenantNames}</span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Current rent</span>
                  <span className="font-medium text-right">
                    {formatMoney(
                      summary.monthly_rent_amount ??
                        lease?.monthly_rent_amount ??
                        selectedLeaseMeta?.monthly_rent_amount
                    )}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">New monthly rent</span>
                  <span className="font-medium text-right">
                    {formatMoney(workflowData.new_rent)}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Renewal start</span>
                  <span className="font-medium text-right">
                    {formatDisplayDate(workflowData.renewal_start_date)}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Renewal end</span>
                  <span className="font-medium text-right">
                    {formatDisplayDate(workflowData.renewal_end_date)}
                  </span>
                </div>
                {workflowData.document_data &&
                Object.keys(workflowData.document_data).length > 0 ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Additional fields</span>
                    <span className="font-medium text-right">Edited</span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm text-blue-800">
                Click Complete to generate the lease renewal document, save it to
                Documents, and create a new lease record for the renewed term.
              </p>
            </div>
          </div>
        ),
      },
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="lease_renewal"
      initialData={{
        ...initialData,
        property_id:
          lease?.units?.properties?.property_id ||
          mappingContext?.property?.property_id,
        unit_id: lease?.units?.unit_id || mappingContext?.unit?.unit_id,
        template_id: templateId || initialData.template_id || null,
      }}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onWorkflowCreated={onWorkflowCreated}
      onComplete={async (data) => {
        let generationResult = { status: 'skipped' };

        if (data.lease_id && data.renewal_start_date) {
          try {
            const response = await fetch('/api/documents/generate/renewal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lease_id: data.lease_id,
                new_start_date: data.renewal_start_date,
                new_end_date: data.renewal_end_date || null,
                new_monthly_rent:
                  data.new_rent != null && data.new_rent !== ''
                    ? Number(data.new_rent)
                    : null,
                document_data: stripInternalIdFieldsFromDocumentData(
                  data.document_data || {}
                ),
                template_id: data.template_id || templateId || null,
                create_lease: true,
              }),
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
              throw new Error(
                result.error || 'Failed to generate renewal document'
              );
            }

            const render = result.render || {};
            const renderMode = render.mode || 'unknown';
            const usedTemplatePositions =
              renderMode === 'pdf_overlay' || renderMode === 'image_based';

            console.log('[LeaseRenewalWorkflow] renewal generated', {
              document_id: result.document_id,
              new_lease_id: result.new_lease_id,
              lease_created: result.lease_created,
              lease_create_error: result.lease_create_error,
              render,
            });

            const leaseNote = result.lease_created
              ? ' A new lease record was created on the Leases page.'
              : result.lease_create_error
                ? ` The PDF was saved, but creating the new lease record failed: ${result.lease_create_error}`
                : '';

            generationResult = {
              status: result.lease_created ? 'success' : 'error',
              title: result.lease_created
                ? 'Lease renewal created'
                : 'Renewal document saved, lease record missing',
              message: usedTemplatePositions
                ? `Your lease renewal PDF was saved to Documents.${leaseNote}`
                : `Your lease renewal PDF was saved to Documents using a simple layout (lease template positions were unavailable).${leaseNote}`,
              documentId: result.document_id,
              newLeaseId: result.new_lease_id,
              render,
            };
          } catch (error) {
            console.error('[LeaseRenewalWorkflow] Error generating renewal:', error);
            generationResult = {
              status: 'error',
              title: 'Workflow completed, but renewal was not created',
              message:
                error.message ||
                'Document generation failed. Check Documents or try again from a new workflow.',
            };
          }
        } else {
          generationResult = {
            status: 'error',
            title: 'Workflow completed without a renewal document',
            message:
              'Lease and renewal start date are required to generate the renewal document.',
          };
        }

        if (onComplete) {
          onComplete(data, generationResult);
        }
      }}
      onCancel={onCancel}
    />
  );
}
