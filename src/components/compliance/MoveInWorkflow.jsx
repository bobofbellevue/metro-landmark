import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import WorkflowDateInput from '../WorkflowDateInput';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID, getRuleCitations } from '../../jurisdictions/index.js';
import { unitNumberText } from '../../utils/unit-display.js';
import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
} from '../../utils/workflow-date.js';
import { readResponseJson } from '../../utils/read-response-json.js';
import {
  CONDITION_OPTIONS,
  conditionLabel,
  defaultMoveInChecklistRows,
  moveInReportFingerprint,
  newChecklistRow,
  normalizeChecklistItems,
  tenantPresentFlag,
} from '../../utils/move-in-condition-report.js';

/**
 * Move-In Process — written condition checklist at commencement of the
 * tenancy (RCW 59.18.260). Generates a PDF into Documents.
 */
export default function MoveInWorkflow({
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
            properties!inner(property_id, property_name, city_of_jurisdiction)
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

  const generateReport = async (data) => {
    const fingerprint = moveInReportFingerprint(data);
    if (data.report_document_id && data.report_fingerprint === fingerprint) {
      return {
        status: 'success',
        document_id: data.report_document_id,
        inspection_id: data.inspection_id,
        reused: true,
      };
    }

    const response = await fetch('/api/documents/generate/condition-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lease_id: data.lease_id,
        inspection_date: data.inspection_date,
        tenant_present: data.tenant_present,
        overall_condition: data.overall_condition,
        condition_notes: data.condition_notes,
        checklist: normalizeChecklistItems(data.checklist),
      }),
    });
    const parsed = await readResponseJson(response);
    const result = parsed.data || {};
    if (!parsed.ok || !result.success) {
      throw new Error(parsed.error || result.error || 'Failed to generate condition report');
    }
    return result;
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property ? detectJurisdiction(property) : DEFAULT_JURISDICTION_PACK_ID;
    const citations = getRuleCitations(jurisdiction, 'moveIn');
    const citationLabel = citations[0]?.id || 'RCW 59.18.260';

    return [
      {
        title: 'Select Lease',
        description: 'Choose the lease for the move-in condition report.',
        fields: [
          {
            id: 'lease_id',
            label: 'Lease',
            type: 'lease',
            required: true,
            statuses: ['active', 'pending'],
            showRent: true,
            emptyMessage: 'No active or pending leases found.',
          },
        ],
        onLeaseSelected: (leaseId, _selected, updateField, workflowData = {}) => {
          if (
            leaseId &&
            (!Array.isArray(workflowData.checklist) ||
              workflowData.checklist.length === 0)
          ) {
            updateField('checklist', defaultMoveInChecklistRows());
          }
          if (leaseId) fetchLeaseDetails(leaseId);
          else setLease(null);
        },
      },
      {
        title: 'Condition Report',
        description:
          'Record the condition and cleanliness of the unit at move-in. Give the tenant a copy.',
        fields: [
          { id: 'inspection_date', label: 'Inspection Date', type: 'date', required: true },
        ],
        validate: (data) => {
          const errors = {};
          if (!isCompleteWorkflowDate(data.inspection_date)) {
            errors.inspection_date = 'Inspection date is required.';
          }
          return errors;
        },
        render: ({ workflowData, updateField, errors }) => (
          <MoveInConditionFields
            workflowData={workflowData}
            updateField={updateField}
            errors={errors}
            citationLabel={citationLabel}
          />
        ),
      },
      {
        title: 'Generate Report',
        description: 'Review the checklist, then click Complete to save the report in Documents.',
        fields: [],
        advanceBusyLabel: 'Generating report…',
        onAdvance: async (data) => {
          if (!data.lease_id || !data.inspection_date) {
            throw new Error('Lease and inspection date are required to generate the report.');
          }
          const payload = {
            ...data,
            checklist:
              Array.isArray(data.checklist) && data.checklist.length
                ? data.checklist
                : defaultMoveInChecklistRows(),
          };
          const result = await generateReport(payload);
          return {
            report_document_id: result.document_id,
            inspection_id: result.inspection_id,
            report_fingerprint: moveInReportFingerprint(payload),
          };
        },
        render: ({ workflowData }) => {
          const items = normalizeChecklistItems(workflowData.checklist);
          const locale =
            typeof navigator !== 'undefined' ? navigator.language : 'en-US';
          const filled = items.filter((row) => row.condition || row.notes).length;
          return (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
                <h4 className="font-semibold text-gray-800 mb-1">Report summary</h4>
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
                  <span className="text-gray-600">Inspection:</span>
                  <span className="font-medium">
                    {workflowData.inspection_date
                      ? formatWorkflowDateForLocale(workflowData.inspection_date, locale)
                      : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Tenant present:</span>
                  <span className="font-medium">
                    {tenantPresentFlag(workflowData.tenant_present) ? 'Yes' : 'No'}
                  </span>
                </div>
                {workflowData.overall_condition ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Overall:</span>
                    <span className="font-medium">
                      {conditionLabel(workflowData.overall_condition)}
                    </span>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Checklist items:</span>
                  <span className="font-medium">
                    {filled} of {items.length} with a condition or notes
                  </span>
                </div>
              </div>
              <p className="text-sm text-blue-800 bg-blue-50 rounded-lg p-3">
                {workflowData.report_document_id &&
                workflowData.report_fingerprint === moveInReportFingerprint(workflowData)
                  ? 'This condition report PDF was already generated. Click Complete to finish.'
                  : 'Click Complete to generate the condition report. It is saved in Documents. Not legal advice.'}
              </p>
            </div>
          );
        },
      },
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="move_in"
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
      onComplete={async (data) => {
        if (!onComplete) return;
        onComplete(data, {
          status: data.report_document_id ? 'success' : 'error',
          title: data.report_document_id
            ? 'Condition report saved'
            : 'Workflow completed without a report',
          message: data.report_document_id
            ? 'The move-in condition report is in Documents. Give the tenant a copy.'
            : 'Lease and inspection date are required to generate the report.',
          documentId: data.report_document_id,
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

function MoveInConditionFields({ workflowData, updateField, errors, citationLabel }) {
  useEffect(() => {
    if (!Array.isArray(workflowData.checklist) || workflowData.checklist.length === 0) {
      updateField('checklist', defaultMoveInChecklistRows());
    }
  }, [workflowData.checklist, updateField]);

  const checklist =
    Array.isArray(workflowData.checklist) && workflowData.checklist.length
      ? workflowData.checklist
      : defaultMoveInChecklistRows();
  const setChecklist = (next) => updateField('checklist', next);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-44">
          <WorkflowDateInput
            label="Inspection Date"
            required
            value={workflowData.inspection_date || ''}
            onChange={(next) => updateField('inspection_date', next)}
            error={errors.inspection_date || ''}
          />
        </div>
        <div className="w-40">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tenant Present
          </label>
          <select
            value={tenantPresentFlag(workflowData.tenant_present) ? 'yes' : 'no'}
            onChange={(e) => updateField('tenant_present', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>
        <div className="w-40">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Overall Condition
          </label>
          <select
            value={workflowData.overall_condition || ''}
            onChange={(e) => updateField('overall_condition', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">Select...</option>
            {CONDITION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-3">
        Written checklist at the start of the tenancy. Not legal advice. See {citationLabel}.
      </p>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Checklist</p>
        <div className="space-y-2">
          {checklist.map((row, index) => (
            <div key={row.key || index} className="flex flex-wrap items-start gap-2">
              <input
                type="text"
                value={row.area || ''}
                onChange={(e) => {
                  const next = checklist.map((item, i) =>
                    i === index ? { ...item, area: e.target.value } : item
                  );
                  setChecklist(next);
                }}
                placeholder="Area"
                className="w-48 max-w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <select
                value={row.condition || ''}
                onChange={(e) => {
                  const next = checklist.map((item, i) =>
                    i === index ? { ...item, condition: e.target.value } : item
                  );
                  setChecklist(next);
                }}
                className="w-36 px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Condition</option>
                {CONDITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={row.notes || ''}
                onChange={(e) => {
                  const next = checklist.map((item, i) =>
                    i === index ? { ...item, notes: e.target.value } : item
                  );
                  setChecklist(next);
                }}
                placeholder="Notes"
                className="w-56 max-w-full flex-1 min-w-[10rem] px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <button
                type="button"
                className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                title="Remove item"
                onClick={() => {
                  const next = checklist.filter((_, i) => i !== index);
                  setChecklist(next.length ? next : [newChecklistRow()]);
                }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1"
          onClick={() => setChecklist([...checklist, newChecklistRow()])}
        >
          <Plus className="w-4 h-4" />
          Add item
        </button>
      </div>

      <div className="max-w-xl">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Additional notes
        </label>
        <textarea
          value={workflowData.condition_notes || ''}
          onChange={(e) => updateField('condition_notes', e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
      </div>
    </div>
  );
}
