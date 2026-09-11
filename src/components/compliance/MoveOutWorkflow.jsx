import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import CurrencyInput, { formatCurrencyDisplay } from '../CurrencyInput';
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
  tenantPresentFlag,
} from '../../utils/move-in-condition-report.js';
import {
  checklistFromMoveInReport,
  moveOutReportFingerprint,
  newChecklistRow,
  newDeductionRow,
  normalizeMoveOutChecklistItems,
} from '../../utils/move-out-inspection.js';
import {
  normalizeDepositDeductions,
  sumDepositDeductions,
} from '../../utils/deposit-return-statement.js';

/**
 * Move-Out Process — inspection compared to move-in, with proposed deductions
 * that can feed Security Deposit Return (RCW 59.18.280).
 */
export default function MoveOutWorkflow({
  initialData = {},
  workflowId = null,
  onComplete,
  onCancel,
  onWorkflowCreated,
}) {
  const [lease, setLease] = useState(null);
  const [moveInInspection, setMoveInInspection] = useState(null);

  useEffect(() => {
    if (initialData.lease_id) fetchLeaseContext(initialData.lease_id);
  }, [initialData.lease_id]);

  const fetchLeaseContext = async (leaseId) => {
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

      const { data: inspections } = await supabase
        .from('property_inspections')
        .select('inspection_id, inspection_date, overall_condition, condition_report, notes')
        .eq('lease_id', leaseId)
        .eq('inspection_type', 'move_in')
        .order('inspection_date', { ascending: false })
        .limit(1);
      const inspection = Array.isArray(inspections) ? inspections[0] : inspections;
      setMoveInInspection(inspection || null);
      return { lease: data, moveInInspection: inspection || null };
    } catch (error) {
      console.error('Error fetching lease details:', error);
      return { lease: null, moveInInspection: null };
    }
  };

  const generateReport = async (data) => {
    const fingerprint = moveOutReportFingerprint(data);
    if (data.report_document_id && data.report_fingerprint === fingerprint) {
      return {
        status: 'success',
        document_id: data.report_document_id,
        inspection_id: data.inspection_id,
        reused: true,
      };
    }

    const response = await fetch('/api/documents/generate/move-out-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lease_id: data.lease_id,
        inspection_date: data.inspection_date,
        tenant_present: data.tenant_present,
        overall_condition: data.overall_condition,
        condition_notes: data.condition_notes,
        checklist: normalizeMoveOutChecklistItems(data.checklist),
        deductions: normalizeDepositDeductions(data.deductions),
        move_in_inspection_date: data.move_in_inspection_date,
      }),
    });
    const parsed = await readResponseJson(response);
    const result = parsed.data || {};
    if (!parsed.ok || !result.success) {
      throw new Error(parsed.error || result.error || 'Failed to generate move-out report');
    }
    return result;
  };

  const buildGenerateExtra = async (data) => {
    if (!data.lease_id || !data.inspection_date) {
      throw new Error('Lease and inspection date are required to generate the report.');
    }
    const payload = {
      ...data,
      checklist:
        Array.isArray(data.checklist) && data.checklist.length
          ? data.checklist
          : checklistFromMoveInReport(moveInInspection?.condition_report),
      move_in_inspection_date:
        data.move_in_inspection_date || moveInInspection?.inspection_date || '',
    };
    const result = await generateReport(payload);
    return {
      report_document_id: result.document_id,
      inspection_id: result.inspection_id,
      report_fingerprint: moveOutReportFingerprint(payload),
      move_in_inspection_date: payload.move_in_inspection_date,
    };
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property ? detectJurisdiction(property) : DEFAULT_JURISDICTION_PACK_ID;
    const citations = getRuleCitations(jurisdiction, 'deposit');
    const citationLabel = citations[0]?.id || 'RCW 59.18.280';

    return [
      {
        title: 'Select Lease',
        description: 'Choose the lease for the move-out inspection.',
        fields: [
          {
            id: 'lease_id',
            label: 'Lease',
            type: 'lease',
            required: true,
            statuses: ['active', 'terminated'],
            showDeposit: true,
            showRent: true,
            emptyMessage: 'No active or terminated leases found.',
          },
        ],
        onLeaseSelected: async (leaseId, _selected, updateField, workflowData = {}) => {
          if (leaseId) {
            const ctx = await fetchLeaseContext(leaseId);
            if (
              !Array.isArray(workflowData.checklist) ||
              workflowData.checklist.length === 0
            ) {
              updateField(
                'checklist',
                checklistFromMoveInReport(ctx.moveInInspection?.condition_report)
              );
            }
            if (ctx.moveInInspection?.inspection_date) {
              updateField(
                'move_in_inspection_date',
                ctx.moveInInspection.inspection_date
              );
            }
            if (
              !Array.isArray(workflowData.deductions) ||
              workflowData.deductions.length === 0
            ) {
              updateField('deductions', [newDeductionRow()]);
            }
          } else {
            setLease(null);
            setMoveInInspection(null);
          }
        },
      },
      {
        title: 'Inspection and Deductions',
        description:
          'Compare the unit to the move-in checklist and list proposed deposit deductions.',
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
          <MoveOutInspectionFields
            workflowData={workflowData}
            updateField={updateField}
            errors={errors}
            citationLabel={citationLabel}
            moveInInspection={moveInInspection}
          />
        ),
      },
      {
        title: 'Generate Report',
        description: 'Review the inspection, then save the report in Documents.',
        fields: [],
        advanceBusyLabel: 'Generating report…',
        onAdvance: buildGenerateExtra,
        onFinish: (data) => buildGenerateExtra(data),
        finishActions: [
          {
            id: 'complete',
            label: 'Complete',
            variant: 'outline',
            complete: true,
          },
          {
            id: 'continue_deposit',
            label: 'Continue to Deposit Return',
            variant: 'primary',
            complete: true,
          },
        ],
        render: ({ workflowData }) => {
          const items = normalizeMoveOutChecklistItems(workflowData.checklist);
          const deductions = normalizeDepositDeductions(workflowData.deductions);
          const locale =
            typeof navigator !== 'undefined' ? navigator.language : 'en-US';
          const filled = items.filter((row) => row.condition || row.notes).length;
          return (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
                <h4 className="font-semibold text-gray-800 mb-1">Inspection summary</h4>
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
                {moveInInspection?.inspection_date ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Move-in:</span>
                    <span className="font-medium">
                      {formatWorkflowDateForLocale(moveInInspection.inspection_date, locale)}
                    </span>
                  </div>
                ) : (
                  <p className="text-gray-500">No move-in report on file for this lease.</p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Checklist items:</span>
                  <span className="font-medium">
                    {filled} of {items.length} with a condition or notes
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Proposed deductions:</span>
                  <span className="font-medium">
                    {formatCurrencyDisplay(sumDepositDeductions(deductions))}
                  </span>
                </div>
              </div>
              <p className="text-sm text-blue-800 bg-blue-50 rounded-lg p-3">
                {workflowData.report_document_id &&
                workflowData.report_fingerprint === moveOutReportFingerprint(workflowData)
                  ? 'This inspection PDF was already generated. Complete, or continue to the deposit return statement.'
                  : 'Complete saves the inspection in Documents. Continue to Deposit Return carries proposed deductions into that statement. Not legal advice.'}
              </p>
            </div>
          );
        },
      },
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="move_out"
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
        const deductions = normalizeDepositDeductions(data.deductions).map((row) => ({
          ...newDeductionRow(),
          ...row,
        }));
        if (meta.action === 'continue_deposit' && data.report_document_id) {
          onComplete(data, {
            status: 'handoff',
            nextProcess: 'security_deposit',
            nextInitialData: {
              lease_id: data.lease_id,
              unit_id: data.unit_id || lease?.units?.unit_id,
              property_id: data.property_id || lease?.units?.properties?.property_id,
              vacation_date: data.inspection_date,
              original_deposit:
                lease?.security_deposit_amount != null
                  ? Number(lease.security_deposit_amount)
                  : null,
              pet_deposit:
                lease?.pet_deposit_amount != null ? Number(lease.pet_deposit_amount) : 0,
              deductions: deductions.length ? deductions : [newDeductionRow()],
            },
          });
          return;
        }
        onComplete(data, {
          status: data.report_document_id ? 'success' : 'error',
          title: data.report_document_id
            ? 'Inspection report saved'
            : 'Workflow completed without a report',
          message: data.report_document_id
            ? deductions.length
              ? 'The move-out inspection is in Documents. Proposed deductions are available when you start Security Deposit Return for this lease.'
              : 'The move-out inspection is in Documents. Give the tenant a copy.'
            : 'Lease and inspection date are required to generate the report.',
          documentId: data.report_document_id,
        });
      }}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
      onWorkflowLoaded={(workflow) => {
        const leaseId = workflow?.workflow_data?.lease_id || workflow?.lease_id;
        if (leaseId) fetchLeaseContext(leaseId);
      }}
    />
  );
}

function MoveOutInspectionFields({
  workflowData,
  updateField,
  errors,
  citationLabel,
  moveInInspection,
}) {
  useEffect(() => {
    if (!Array.isArray(workflowData.checklist) || workflowData.checklist.length === 0) {
      updateField(
        'checklist',
        checklistFromMoveInReport(moveInInspection?.condition_report)
      );
    }
  }, [workflowData.checklist, moveInInspection, updateField]);

  useEffect(() => {
    if (!Array.isArray(workflowData.deductions) || workflowData.deductions.length === 0) {
      updateField('deductions', [newDeductionRow()]);
    }
  }, [workflowData.deductions, updateField]);

  const checklist =
    Array.isArray(workflowData.checklist) && workflowData.checklist.length
      ? workflowData.checklist
      : checklistFromMoveInReport(moveInInspection?.condition_report);
  const deductions =
    Array.isArray(workflowData.deductions) && workflowData.deductions.length
      ? workflowData.deductions
      : [newDeductionRow()];
  const setChecklist = (next) => updateField('checklist', next);
  const setDeductions = (next) => updateField('deductions', next);
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US';

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
        {moveInInspection?.inspection_date
          ? `Compared to the move-in report from ${formatWorkflowDateForLocale(
              moveInInspection.inspection_date,
              locale
            )}. Proposed deductions can feed the deposit return statement. Not legal advice. See ${citationLabel}.`
          : `No move-in report on file. Record condition now; proposed deductions can feed the deposit return statement. Not legal advice. See ${citationLabel}.`}
      </p>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Checklist</p>
        <div className="space-y-2">
          {checklist.map((row, index) => (
            <div key={row.key || index} className="space-y-1">
              <div className="flex flex-wrap items-start gap-2">
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
              {row.moveInCondition || row.moveInNotes ? (
                <p className="text-xs text-gray-500 pl-0.5">
                  At move-in: {conditionLabel(row.moveInCondition) || '—'}
                  {row.moveInNotes ? ` — ${row.moveInNotes}` : ''}
                </p>
              ) : null}
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

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Proposed deductions</p>
        <div className="space-y-2">
          {deductions.map((row, index) => (
            <div key={row.key || index} className="flex items-start gap-2">
              <input
                type="text"
                value={row.reason || ''}
                onChange={(e) => {
                  const next = deductions.map((item, i) =>
                    i === index ? { ...item, reason: e.target.value } : item
                  );
                  setDeductions(next);
                }}
                placeholder="Reason"
                className="w-64 max-w-full flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <div className="w-36">
                <CurrencyInput
                  label=""
                  value={row.amount}
                  onChange={(value) => {
                    const next = deductions.map((item, i) =>
                      i === index ? { ...item, amount: value } : item
                    );
                    setDeductions(next);
                  }}
                />
              </div>
              <button
                type="button"
                className="p-2 text-red-600 hover:bg-red-50 rounded-md mt-1"
                title="Remove deduction"
                onClick={() => {
                  const next = deductions.filter((_, i) => i !== index);
                  setDeductions(next.length ? next : [newDeductionRow()]);
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
          onClick={() => setDeductions([...deductions, newDeductionRow()])}
        >
          <Plus className="w-4 h-4" />
          Add deduction
        </button>
        <div className="mt-2 text-sm text-gray-700">
          Total:{' '}
          <span className="font-medium">
            {formatCurrencyDisplay(sumDepositDeductions(deductions))}
          </span>
        </div>
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
