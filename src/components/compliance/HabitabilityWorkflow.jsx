import React, { useState, useEffect } from 'react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import WorkflowDateInput from '../WorkflowDateInput';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import { DEFAULT_JURISDICTION_PACK_ID } from '../../jurisdictions/index.js';
import { unitNumberText } from '../../utils/unit-display.js';
import {
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
  toWorkflowDateString,
} from '../../utils/workflow-date.js';
import { readResponseJson } from '../../utils/read-response-json.js';
import {
  HABITABILITY_ISSUE_OPTIONS,
  habitabilityIssueTypeLabel,
  habitabilityRecordFingerprint,
  habitabilityReferenceDeadline,
  habitabilityRepairWindow,
  maintenanceRequestOptionLabel,
  normalizeHabitabilityIssueType,
} from '../../utils/habitability-issue.js';

/**
 * Habitability Issues — record a defective condition, show the commence-repair
 * window (RCW 59.18.070), optionally link a work order, and save a worksheet.
 * Not a statutory form. Do not copy RHAWA forms.
 */
export default function HabitabilityWorkflow({
  initialData = {},
  workflowId = null,
  onComplete,
  onCancel,
  onWorkflowCreated,
}) {
  const [lease, setLease] = useState(null);
  const [maintenanceRequests, setMaintenanceRequests] = useState([]);

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
      const unitId = data?.units?.unit_id;
      if (unitId) fetchMaintenanceRequests(unitId);
      else setMaintenanceRequests([]);
    } catch (error) {
      console.error('Error fetching lease details:', error);
    }
  };

  const fetchMaintenanceRequests = async (unitId) => {
    try {
      const { data, error } = await supabase
        .from('maintenance_requests')
        .select('request_id, description, status, created_at, is_archived')
        .eq('unit_id', unitId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setMaintenanceRequests(data || []);
    } catch (error) {
      console.error('Error fetching maintenance requests:', error);
      setMaintenanceRequests([]);
    }
  };

  const generateRecord = async (data, jurisdiction) => {
    const fingerprint = habitabilityRecordFingerprint(data);
    if (data.report_document_id && data.report_fingerprint === fingerprint) {
      return {
        status: 'success',
        document_id: data.report_document_id,
        reused: true,
      };
    }

    const issueType = normalizeHabitabilityIssueType(data.issue_type);
    const window = habitabilityRepairWindow(jurisdiction, issueType);
    const linked = maintenanceRequests.find(
      (row) => String(row.request_id) === String(data.maintenance_request_id)
    );
    const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
    const linkedLabel = linked
      ? maintenanceRequestOptionLabel(
          linked,
          linked.created_at
            ? formatWorkflowDateForLocale(toWorkflowDateString(linked.created_at), locale)
            : ''
        )
      : '';

    const response = await fetch('/api/documents/generate/habitability-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lease_id: data.lease_id,
        reported_date: data.reported_date,
        issue_type: issueType,
        issue_type_label: habitabilityIssueTypeLabel(issueType),
        issue_description: data.issue_description,
        repair_window_hours: window.hours,
        repair_window_label: window.label,
        repair_deadline: habitabilityReferenceDeadline(data.reported_date, window.hours),
        outcome_notes: data.outcome_notes,
        maintenance_request_id: data.maintenance_request_id || null,
        maintenance_request_label: linkedLabel,
      }),
    });
    const parsed = await readResponseJson(response);
    const result = parsed.data || {};
    if (!parsed.ok || !result.success) {
      throw new Error(parsed.error || result.error || 'Failed to generate habitability record');
    }
    return result;
  };

  const getWorkflowSteps = () => {
    const property = lease?.units?.properties;
    const jurisdiction = property ? detectJurisdiction(property) : DEFAULT_JURISDICTION_PACK_ID;
    const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US';

    return [
      {
        title: 'Select Lease',
        description: 'Choose the occupied lease for the habitability issue.',
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
        onLeaseSelected: (leaseId, _selected, updateField) => {
          updateField?.('maintenance_request_id', null);
          if (leaseId) fetchLeaseDetails(leaseId);
          else {
            setLease(null);
            setMaintenanceRequests([]);
          }
        },
      },
      {
        title: 'Issue Details',
        description: 'Record the defective condition and when written notice was received.',
        fields: [
          { id: 'issue_type', label: 'Issue Type', type: 'select', required: true },
          { id: 'reported_date', label: 'Written notice received', type: 'date', required: true },
          { id: 'issue_description', label: 'Description', type: 'textarea', required: true },
        ],
        validate: (data) => {
          const errors = {};
          if (!normalizeHabitabilityIssueType(data.issue_type)) {
            errors.issue_type = 'Issue type is required.';
          }
          if (!isCompleteWorkflowDate(data.reported_date)) {
            errors.reported_date = 'Date written notice was received is required.';
          }
          if (!String(data.issue_description || '').trim()) {
            errors.issue_description = 'A short description is required.';
          }
          return errors;
        },
        render: ({ workflowData, updateField, errors }) => {
          const issueType = normalizeHabitabilityIssueType(workflowData.issue_type);
          const window = habitabilityRepairWindow(jurisdiction, issueType || 'other');
          const deadline = habitabilityReferenceDeadline(workflowData.reported_date, window.hours);
          const citationText = window.citations.map((cite) => cite.id).filter(Boolean).join(', ');
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="w-72 max-w-full">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Issue Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={issueType}
                    onChange={(e) => updateField('issue_type', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md ${
                      errors.issue_type ? 'border-red-300' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select...</option>
                    {HABITABILITY_ISSUE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {errors.issue_type ? (
                    <p className="mt-1 text-sm text-red-600">{errors.issue_type}</p>
                  ) : null}
                </div>
                <div className="w-52">
                  <WorkflowDateInput
                    label="Written notice received"
                    required
                    value={workflowData.reported_date || ''}
                    onChange={(next) => updateField('reported_date', next)}
                    error={errors.reported_date || ''}
                  />
                </div>
              </div>

              <p className="text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-3">
                Commence remedial action within {window.label} of written notice
                {deadline
                  ? ` (reference date ${formatWorkflowDateForLocale(deadline, locale)} if counted as calendar days)`
                  : ''}
                . The statute counts hours from receipt. Not legal advice
                {citationText ? `. See ${citationText}` : ''}.
              </p>

              <div className="max-w-xl">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={workflowData.issue_description || ''}
                  onChange={(e) => updateField('issue_description', e.target.value)}
                  rows={3}
                  className={`w-full px-3 py-2 border rounded-md text-sm ${
                    errors.issue_description ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                {errors.issue_description ? (
                  <p className="mt-1 text-sm text-red-600">{errors.issue_description}</p>
                ) : null}
              </div>

              <div className="max-w-xl">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Linked work order
                </label>
                <select
                  value={workflowData.maintenance_request_id || ''}
                  onChange={(e) =>
                    updateField('maintenance_request_id', e.target.value || null)
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">None</option>
                  {maintenanceRequests.map((request) => (
                    <option key={request.request_id} value={request.request_id}>
                      {maintenanceRequestOptionLabel(
                        request,
                        request.created_at
                          ? formatWorkflowDateForLocale(
                              toWorkflowDateString(request.created_at),
                              locale
                            )
                          : ''
                      )}
                    </option>
                  ))}
                </select>
                {maintenanceRequests.length === 0 ? (
                  <p className="mt-1 text-sm text-gray-500">
                    No maintenance requests on file for this unit.
                  </p>
                ) : null}
              </div>

              <div className="max-w-xl">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Outcome
                </label>
                <textarea
                  value={workflowData.outcome_notes || ''}
                  onChange={(e) => updateField('outcome_notes', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
          );
        },
      },
      {
        title: 'Generate Record',
        description: 'Review the issue, then click Complete to save the worksheet in Documents.',
        fields: [],
        advanceBusyLabel: 'Generating record…',
        onAdvance: async (data) => {
          if (
            !data.lease_id ||
            !normalizeHabitabilityIssueType(data.issue_type) ||
            !isCompleteWorkflowDate(data.reported_date)
          ) {
            throw new Error(
              'Lease, issue type, and written-notice date are required to generate the record.'
            );
          }
          const result = await generateRecord(data, jurisdiction);
          return {
            report_document_id: result.document_id,
            report_fingerprint: habitabilityRecordFingerprint(data),
            issue_type: normalizeHabitabilityIssueType(data.issue_type),
          };
        },
        render: ({ workflowData }) => {
          const issueType = normalizeHabitabilityIssueType(workflowData.issue_type);
          const window = habitabilityRepairWindow(jurisdiction, issueType);
          const linked = maintenanceRequests.find(
            (row) => String(row.request_id) === String(workflowData.maintenance_request_id)
          );
          return (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
                <h4 className="font-semibold text-gray-800 mb-1">Issue summary</h4>
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
                  <span className="text-gray-600">Issue:</span>
                  <span className="font-medium">{habitabilityIssueTypeLabel(issueType)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Written notice received:</span>
                  <span className="font-medium">
                    {workflowData.reported_date
                      ? formatWorkflowDateForLocale(workflowData.reported_date, locale)
                      : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-gray-600">Commence within:</span>
                  <span className="font-medium">{window.label}</span>
                </div>
                {linked ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-gray-600">Work order:</span>
                    <span className="font-medium">
                      {maintenanceRequestOptionLabel(
                        linked,
                        linked.created_at
                          ? formatWorkflowDateForLocale(
                              toWorkflowDateString(linked.created_at),
                              locale
                            )
                          : ''
                      )}
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="text-sm text-blue-800 bg-blue-50 rounded-lg p-3">
                {workflowData.report_document_id &&
                workflowData.report_fingerprint === habitabilityRecordFingerprint(workflowData)
                  ? 'This worksheet PDF was already generated. Click Complete to finish.'
                  : 'Click Complete to save a habitability worksheet in Documents. This is not a statutory form. Not legal advice.'}
              </p>
            </div>
          );
        },
      },
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="habitability"
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
            ? 'Habitability record saved'
            : 'Workflow completed without a record',
          message: data.report_document_id
            ? 'The worksheet is in Documents. This is not a legal opinion.'
            : 'Lease, issue type, and written-notice date are required to generate the record.',
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
