import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import CurrencyInput, { formatCurrencyDisplay } from '../CurrencyInput';
import WorkflowDateInput from '../WorkflowDateInput';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID, getRuleCitations } from '../../jurisdictions/index.js';
import { stampLeaseSelection } from '../../utils/workflow-lease-context.js';
import { unitNumberText } from '../../utils/unit-display.js';
import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
} from '../../utils/workflow-date.js';
import { calculateDepositReturnDeadline } from '../../utils/compliance-calculator.js';
import {
  depositReturnAmount,
  depositReturnFingerprint,
  heldDepositTotal,
  normalizeDepositDeductions,
  sumDepositDeductions,
} from '../../utils/deposit-return-statement.js';
import {
  deductionsFromMoveOutInspection,
  deductionsNeedSeed,
  newDeductionRow,
} from '../../utils/move-out-inspection.js';
import { readResponseJson } from '../../utils/read-response-json.js';

/**
 * Security Deposit Return — itemized statement due 30 days after the tenant
 * vacates (RCW 59.18.280). Generates a PDF into Documents.
 */
export default function SecurityDepositReturnWorkflow({
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

      const { data: inspections } = await supabase
        .from('property_inspections')
        .select('inspection_id, inspection_date, condition_report')
        .eq('lease_id', leaseId)
        .eq('inspection_type', 'move_out')
        .order('inspection_date', { ascending: false })
        .limit(1);
      const moveOut = Array.isArray(inspections) ? inspections[0] : inspections;
      return { lease: data, moveOutInspection: moveOut || null };
    } catch (error) {
      console.error('Error fetching lease details:', error);
      return { lease: null, moveOutInspection: null };
    }
  };

  const generateStatement = async (data) => {
    const fingerprint = depositReturnFingerprint(data);
    if (data.statement_document_id && data.statement_fingerprint === fingerprint) {
      return {
        status: 'success',
        document_id: data.statement_document_id,
        deposit_id: data.deposit_id,
        reused: true,
      };
    }

    const response = await fetch('/api/documents/generate/deposit-statement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lease_id: data.lease_id,
        vacation_date: data.vacation_date,
        security_deposit: data.original_deposit,
        pet_deposit: data.pet_deposit || 0,
        deductions: normalizeDepositDeductions(data.deductions),
      }),
    });
    const parsed = await readResponseJson(response);
    const result = parsed.data || {};
    if (!parsed.ok || !result.success) {
      throw new Error(parsed.error || result.error || 'Failed to generate deposit statement');
    }
    return result;
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property ? detectJurisdiction(property) : DEFAULT_JURISDICTION_PACK_ID;
    const citations = getRuleCitations(jurisdiction, 'deposit');
    const citationLabel = citations[0]?.id || 'RCW 59.18.280';

    return [
      {
        title: 'Select Lease',
        description: 'Choose the lease whose deposit is being returned.',
        fields: [{ id: 'lease_id', label: 'Lease', type: 'select', required: true }],
        render: ({ workflowData, updateField, errors }) => (
          <LeaseSelectionPicker
            value={workflowData.lease_id || null}
            error={errors?.lease_id}
            statuses={['active', 'terminated']}
            showDeposit
            emptyMessage="No active or terminated leases found."
            onChange={async (leaseId, selected) => {
              stampLeaseSelection(updateField, leaseId, selected);
              updateField(
                'original_deposit',
                selected?.security_deposit_amount != null
                  ? Number(selected.security_deposit_amount)
                  : null
              );
              updateField(
                'pet_deposit',
                selected?.pet_deposit_amount != null
                  ? Number(selected.pet_deposit_amount)
                  : 0
              );
              if (leaseId) {
                const ctx = await fetchLeaseDetails(leaseId);
                if (deductionsNeedSeed(workflowData.deductions)) {
                  const fromInspection = deductionsFromMoveOutInspection(
                    ctx.moveOutInspection
                  );
                  updateField(
                    'deductions',
                    fromInspection.length
                      ? fromInspection.map((row) => ({ ...newDeductionRow(), ...row }))
                      : [newDeductionRow()]
                  );
                }
                if (
                  !isCompleteWorkflowDate(workflowData.vacation_date) &&
                  ctx.moveOutInspection?.inspection_date
                ) {
                  updateField('vacation_date', ctx.moveOutInspection.inspection_date);
                }
              } else {
                setLease(null);
                if (deductionsNeedSeed(workflowData.deductions)) {
                  updateField('deductions', [newDeductionRow()]);
                }
              }
            }}
          />
        ),
      },
      {
        title: 'Deductions and Deadline',
        description:
          'Itemize deductions. The statement is due 30 days after the tenant vacates, not before.',
        fields: [
          { id: 'vacation_date', label: 'Termination and vacation date', type: 'date', required: true },
          { id: 'original_deposit', label: 'Security deposit held', type: 'number', required: true },
        ],
        validate: (data) => {
          const errors = {};
          if (!isCompleteWorkflowDate(data.vacation_date)) {
            errors.vacation_date = 'Termination and vacation date is required.';
          }
          if (data.original_deposit == null || data.original_deposit === '') {
            errors.original_deposit = 'Security deposit held is required.';
          }
          return errors;
        },
        render: ({ workflowData, updateField, errors }) => {
          const deductions = Array.isArray(workflowData.deductions) && workflowData.deductions.length
            ? workflowData.deductions
            : [newDeductionRow()];
          const held = heldDepositTotal({
            securityDeposit: workflowData.original_deposit,
            petDeposit: workflowData.pet_deposit,
          });
          const returned = depositReturnAmount(held, deductions);
          const dueBy = isCompleteWorkflowDate(workflowData.vacation_date)
            ? calculateDepositReturnDeadline(workflowData.vacation_date, jurisdiction)
            : '';
          const locale =
            typeof navigator !== 'undefined' ? navigator.language : 'en-US';

          const setDeductions = (next) => updateField('deductions', next);

          return (
            <div className="space-y-4">
              <WorkflowDateInput
                label="Termination and vacation date"
                required
                value={workflowData.vacation_date || ''}
                onChange={(next) => updateField('vacation_date', next)}
                error={errors.vacation_date || ''}
              />

              {dueBy ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                  Statement due by {formatWorkflowDateForLocale(dueBy, locale)} (30 days after
                  vacation). Not legal advice. See {citationLabel}.
                </div>
              ) : null}

              <CurrencyInput
                label="Security deposit held"
                required
                value={workflowData.original_deposit}
                onChange={(value) => updateField('original_deposit', value)}
              />
              <CurrencyInput
                label="Pet deposit held"
                value={workflowData.pet_deposit}
                onChange={(value) => updateField('pet_deposit', value || 0)}
              />

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Itemized deductions</p>
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
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
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
              </div>

              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Total deductions:</span>
                  <span className="font-medium">{formatCurrencyDisplay(sumDepositDeductions(deductions))}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Amount to return:</span>
                  <span className="font-medium">{formatCurrencyDisplay(returned)}</span>
                </div>
              </div>
            </div>
          );
        },
      },
      {
        title: 'Generate Statement',
        description: 'Review the figures, then click Complete to save the statement in Documents.',
        fields: [],
        advanceBusyLabel: 'Generating statement…',
        onAdvance: async (data) => {
          if (!data.lease_id || !data.vacation_date) {
            throw new Error('Lease and vacation date are required to generate the statement.');
          }
          const result = await generateStatement(data);
          return {
            statement_document_id: result.document_id,
            deposit_id: result.deposit_id,
            statement_fingerprint: depositReturnFingerprint(data),
            statement_due_by: result.statement_due_by,
            total_deductions: sumDepositDeductions(data.deductions),
          };
        },
        render: ({ workflowData }) => {
          const deductions = normalizeDepositDeductions(workflowData.deductions);
          const held = heldDepositTotal({
            securityDeposit: workflowData.original_deposit,
            petDeposit: workflowData.pet_deposit,
          });
          const returned = depositReturnAmount(held, deductions);
          const dueBy = isCompleteWorkflowDate(workflowData.vacation_date)
            ? calculateDepositReturnDeadline(workflowData.vacation_date, jurisdiction)
            : '';
          const locale =
            typeof navigator !== 'undefined' ? navigator.language : 'en-US';
          return (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
                <h4 className="font-semibold text-gray-800 mb-1">Statement summary</h4>
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
                  <span className="text-gray-600">Vacated:</span>
                  <span className="font-medium">
                    {workflowData.vacation_date
                      ? formatWorkflowDateForLocale(workflowData.vacation_date, locale)
                      : ''}
                  </span>
                </div>
                {dueBy ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Statement due:</span>
                    <span className="font-medium">{formatWorkflowDateForLocale(dueBy, locale)}</span>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Amount to return:</span>
                  <span className="font-medium">{formatCurrencyDisplay(returned)}</span>
                </div>
              </div>
              <p className="text-sm text-blue-800 bg-blue-50 rounded-lg p-3">
                {workflowData.statement_document_id &&
                workflowData.statement_fingerprint === depositReturnFingerprint(workflowData)
                  ? 'This statement PDF was already generated. Click Complete to finish.'
                  : 'Click Complete to generate the itemized statement. It is saved in Documents. Not legal advice.'}
              </p>
            </div>
          );
        },
      },
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="security_deposit"
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
          status: data.statement_document_id ? 'success' : 'error',
          title: data.statement_document_id
            ? 'Statement saved'
            : 'Workflow completed without a statement',
          message: data.statement_document_id
            ? 'The deposit return statement is in Documents.'
            : 'Lease and vacation date are required to generate the statement.',
          documentId: data.statement_document_id,
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
