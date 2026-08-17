import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import ComplianceWorkflow from '../ComplianceWorkflow';
import { AuthContext } from '../../contexts';
import { supabase } from '../../lib/supabase';
import { detectJurisdiction } from '../../utils/jurisdiction-detector';
import {
  DEFAULT_JURISDICTION_PACK_ID,
  getJurisdictionDisplayName,
} from '../../jurisdictions/index.js';
import { formatPersonDisplayName } from '../../utils/lease-display.js';
import {
  evaluateFirstQualifiedScreening,
  pendingApplicationsInOrder,
} from '../../utils/first-qualified-screening.js';
import { formatWorkflowDateForLocale } from '../../utils/workflow-date.js';

function applicationStatusLabel(status) {
  const value = String(status || 'pending').toLowerCase();
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  if (value === 'conditional') return 'Conditional';
  if (value === 'submitted') return 'Submitted';
  return 'Pending';
}

export default function TenantScreeningWorkflow({
  initialData = {},
  workflowId = null,
  onComplete,
  onCancel,
  onWorkflowCreated,
}) {
  const { user } = useContext(AuthContext);
  const [properties, setProperties] = useState([]);
  const [propertySearch, setPropertySearch] = useState('');
  const [property, setProperty] = useState(null);
  const [applications, setApplications] = useState([]);
  const [loadingApps, setLoadingApps] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('property_id, property_name, city_of_jurisdiction')
        .eq('is_archived', false)
        .order('property_name');
      if (cancelled) return;
      if (error) {
        console.error('Error loading properties:', error);
        setProperties([]);
        return;
      }
      setProperties(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const propertyId = initialData.property_id;
    if (!propertyId || property?.property_id === propertyId) return;
    const match = properties.find(
      (row) => String(row.property_id) === String(propertyId)
    );
    if (match) setProperty(match);
  }, [initialData.property_id, properties, property?.property_id]);

  const loadApplications = async (propertyId) => {
    if (!propertyId) {
      setApplications([]);
      return;
    }
    setLoadingApps(true);
    try {
      const { data: units, error: unitsError } = await supabase
        .from('units')
        .select('unit_id, unit_number')
        .eq('property_id', propertyId)
        .eq('is_archived', false);
      if (unitsError) throw unitsError;
      const unitIds = (units || []).map((unit) => unit.unit_id);
      if (unitIds.length === 0) {
        setApplications([]);
        return;
      }

      const { data: rows, error: appsError } = await supabase
        .from('client_applications')
        .select(
          'application_id, client_id, unit_id, status, applied_at, notes, units(unit_id, unit_number)'
        )
        .in('unit_id', unitIds)
        .eq('is_archived', false)
        .order('applied_at', { ascending: true });
      if (appsError) throw appsError;

      const clientIds = [
        ...new Set((rows || []).map((row) => row.client_id).filter(Boolean)),
      ];
      let clients = [];
      if (clientIds.length > 0) {
        const { data: clientRows } = await supabase
          .from('clients')
          .select('client_id, user_id')
          .in('client_id', clientIds);
        clients = clientRows || [];
      }
      const userIds = [
        ...new Set(clients.map((client) => client.user_id).filter(Boolean)),
      ];
      let contacts = [];
      if (userIds.length > 0) {
        const { data: contactRows } = await supabase
          .from('contacts')
          .select('contactable_id, first_name, middle_name, last_name')
          .eq('contactable_type', 'client')
          .in('contactable_id', userIds);
        contacts = contactRows || [];
      }
      const contactByUserId = new Map(
        contacts.map((contact) => [String(contact.contactable_id), contact])
      );
      const userIdByClientId = new Map(
        clients.map((client) => [String(client.client_id), client.user_id])
      );
      const unitNumberById = new Map(
        (units || []).map((unit) => [String(unit.unit_id), unit.unit_number])
      );

      setApplications(
        (rows || []).map((row) => {
          const userId = userIdByClientId.get(String(row.client_id));
          const contact = userId != null ? contactByUserId.get(String(userId)) : null;
          const unit = Array.isArray(row.units) ? row.units[0] : row.units;
          return {
            ...row,
            applicant_name: formatPersonDisplayName(contact) || `Applicant ${row.client_id}`,
            unit_number:
              unit?.unit_number || unitNumberById.get(String(row.unit_id)) || '',
          };
        })
      );
    } catch (error) {
      console.error('Error loading applications:', error);
      setApplications([]);
    } finally {
      setLoadingApps(false);
    }
  };

  useEffect(() => {
    if (property?.property_id) loadApplications(property.property_id);
  }, [property?.property_id]);

  const filteredProperties = useMemo(() => {
    const term = propertySearch.trim().toLowerCase();
    if (!term) return properties;
    return properties.filter((row) => {
      const haystack = `${row.property_name || ''} ${row.city_of_jurisdiction || ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [properties, propertySearch]);

  const persistDecision = async (data) => {
    if (!data.application_id || !data.decision) return;
    const status =
      data.decision === 'approved'
        ? 'approved'
        : data.decision === 'rejected'
          ? 'rejected'
          : data.decision;
    await supabase
      .from('client_applications')
      .update({
        status,
        decided_at: new Date().toISOString(),
        decision_by_user_id: user?.user_id || null,
        decision_notes: data.decision_reason || null,
      })
      .eq('application_id', data.application_id);
  };

  const getWorkflowSteps = () => {
    const jurisdiction = property
      ? detectJurisdiction(property)
      : DEFAULT_JURISDICTION_PACK_ID;
    const packName = getJurisdictionDisplayName(jurisdiction);
    const pending = pendingApplicationsInOrder(applications);

    return [
      {
        title: 'Select Property',
        description: 'Choose the property whose applicant queue you are screening.',
        fields: [{ id: 'property_id', label: 'Property', type: 'select', required: true }],
        render: ({ workflowData, updateField, errors }) => (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="search"
                value={propertySearch}
                onChange={(e) => setPropertySearch(e.target.value)}
                placeholder="Search properties"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            {errors.property_id && (
              <p className="text-sm text-red-600">{errors.property_id}</p>
            )}
            <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-md divide-y">
              {filteredProperties.length === 0 && (
                <p className="p-3 text-sm text-gray-500">No matching properties.</p>
              )}
              {filteredProperties.map((row) => {
                const selected =
                  String(workflowData.property_id) === String(row.property_id);
                return (
                  <button
                    key={row.property_id}
                    type="button"
                    onClick={() => {
                      updateField('property_id', row.property_id);
                      updateField('application_id', null);
                      updateField('unit_id', null);
                      setProperty(row);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm ${
                      selected ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="font-medium text-gray-900">
                      {row.property_name || `Property ${row.property_id}`}
                    </span>
                    {row.city_of_jurisdiction && (
                      <span className="block text-xs text-gray-500">
                        {row.city_of_jurisdiction}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ),
      },
      {
        title: 'Applicant Queue',
        description: 'Pending applications in the order they were received.',
        fields: [
          { id: 'application_id', label: 'Applicant', type: 'select', required: true },
        ],
        render: ({ workflowData, updateField, errors }) => (
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-800">
              Pack: {packName}. Pack math is reference math, not legal advice.
            </div>
            {loadingApps && <p className="text-sm text-gray-500">Loading applications…</p>}
            {!loadingApps && applications.length === 0 && (
              <p className="text-sm text-gray-600">
                No applications found for this property.
              </p>
            )}
            {errors.application_id && (
              <p className="text-sm text-red-600">{errors.application_id}</p>
            )}
            <div className="space-y-2">
              {applications.map((row) => {
                const selected =
                  String(workflowData.application_id) === String(row.application_id);
                const open = pending.some(
                  (item) => String(item.application_id) === String(row.application_id)
                );
                return (
                  <button
                    key={row.application_id}
                    type="button"
                    onClick={() => {
                      updateField('application_id', row.application_id);
                      updateField('unit_id', row.unit_id);
                      updateField('applicant_name', row.applicant_name);
                    }}
                    className={`w-full text-left p-3 rounded-lg border ${
                      selected
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex justify-between gap-3">
                      <span className="font-medium text-gray-900">{row.applicant_name}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          open
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {applicationStatusLabel(row.status)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      {row.unit_number ? `Unit ${row.unit_number}` : 'Unit —'}
                      {row.applied_at
                        ? ` · Applied ${formatWorkflowDateForLocale(
                            String(row.applied_at).slice(0, 10),
                            typeof navigator !== 'undefined'
                              ? navigator.language
                              : 'en-US'
                          )}`
                        : ''}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ),
      },
      {
        title: 'Decision',
        description: 'Record whether this applicant meets written criteria and the outcome.',
        fields: [
          {
            id: 'meets_written_criteria',
            label: 'Meets written screening criteria',
            type: 'select',
            required: true,
          },
          { id: 'decision', label: 'Decision', type: 'select', required: true },
          { id: 'decision_reason', label: 'Decision reason', type: 'textarea', required: true },
        ],
        validate: (data) => {
          const errors = {};
          const evaluation = evaluateFirstQualifiedScreening({
            jurisdiction,
            queue: applications,
            selectedApplicationId: data.application_id,
            decision: data.decision,
          });
          if (evaluation.writtenCriteriaRequired && !data.written_criteria_notes) {
            errors.written_criteria_notes =
              'This pack requires written screening criteria. Note the criteria used.';
          }
          if (evaluation.blocked) {
            errors.decision = evaluation.blockReason;
          }
          return errors;
        },
        render: ({ workflowData, updateField, errors }) => {
          const evaluation = evaluateFirstQualifiedScreening({
            jurisdiction,
            queue: applications,
            selectedApplicationId: workflowData.application_id,
            decision: workflowData.decision,
          });
          const selected = applications.find(
            (row) =>
              String(row.application_id) === String(workflowData.application_id)
          );
          return (
            <div className="space-y-4">
              <div className="bg-gray-50 p-3 rounded-lg text-sm">
                <p className="font-medium text-gray-900">
                  {selected?.applicant_name || workflowData.applicant_name || 'Applicant'}
                </p>
                <p className="text-gray-600">
                  {selected?.unit_number ? `Unit ${selected.unit_number}` : ''}
                </p>
              </div>

              {evaluation.firstQualifiedApplicant && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
                  First-qualified: offer to the first pending applicant who meets the
                  published written criteria (SMC 14.09). {evaluation.pendingCount} pending
                  in this queue.
                </div>
              )}
              {evaluation.blocked && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-900">
                  {evaluation.blockReason}
                </div>
              )}

              {evaluation.writtenCriteriaRequired && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Written criteria used <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={workflowData.written_criteria_notes || ''}
                    onChange={(e) =>
                      updateField('written_criteria_notes', e.target.value)
                    }
                    rows={3}
                    className={`w-full px-3 py-2 border rounded-md ${
                      errors.written_criteria_notes ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder="Income, credit, history, and other published criteria applied to this file."
                  />
                  {errors.written_criteria_notes && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.written_criteria_notes}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Meets written screening criteria <span className="text-red-500">*</span>
                </label>
                <select
                  value={workflowData.meets_written_criteria || ''}
                  onChange={(e) => updateField('meets_written_criteria', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md ${
                    errors.meets_written_criteria ? 'border-red-300' : 'border-gray-300'
                  }`}
                >
                  <option value="">Select...</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
                {errors.meets_written_criteria && (
                  <p className="mt-1 text-sm text-red-600">{errors.meets_written_criteria}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Decision <span className="text-red-500">*</span>
                </label>
                <select
                  value={workflowData.decision || ''}
                  onChange={(e) => updateField('decision', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md ${
                    errors.decision ? 'border-red-300' : 'border-gray-300'
                  }`}
                >
                  <option value="">Select...</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="conditional">Conditional</option>
                </select>
                {errors.decision && (
                  <p className="mt-1 text-sm text-red-600">{errors.decision}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Decision reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={workflowData.decision_reason || ''}
                  onChange={(e) => updateField('decision_reason', e.target.value)}
                  rows={4}
                  className={`w-full px-3 py-2 border rounded-md ${
                    errors.decision_reason ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                {errors.decision_reason && (
                  <p className="mt-1 text-sm text-red-600">{errors.decision_reason}</p>
                )}
              </div>
            </div>
          );
        },
      },
      {
        title: 'Complete',
        fields: [],
        render: ({ workflowData }) => (
          <div className="space-y-3 text-sm text-gray-700">
            <p>
              Completing this workflow records the screening decision on the application
              ({workflowData.applicant_name || 'selected applicant'}:{' '}
              {workflowData.decision || '—'}).
            </p>
            <p className="text-gray-500">
              Pack numbers and first-qualified order are reference math, not a substitute
              for legal counsel.
            </p>
          </div>
        ),
      },
    ];
  };

  return (
    <ComplianceWorkflow
      workflowType="tenant_screening"
      initialData={{
        ...initialData,
        property_id: property?.property_id ?? initialData.property_id,
        jurisdiction: property
          ? detectJurisdiction(property)
          : initialData.jurisdiction || DEFAULT_JURISDICTION_PACK_ID,
      }}
      workflowId={workflowId}
      getSteps={getWorkflowSteps}
      onComplete={async (data) => {
        try {
          await persistDecision(data);
        } catch (error) {
          console.error('Error saving application decision:', error);
        }
        if (onComplete) {
          onComplete(data, {
            status: 'success',
            title: 'Screening decision recorded',
            message: data.applicant_name
              ? `${data.applicant_name}: ${data.decision || 'decision saved'}.`
              : 'The screening decision is saved on the application.',
          });
        }
      }}
      onCancel={onCancel}
      onWorkflowCreated={onWorkflowCreated}
      onWorkflowLoaded={(workflow) => {
        const propertyId =
          workflow?.workflow_data?.property_id || workflow?.property_id;
        if (!propertyId) return;
        const match = properties.find(
          (row) => String(row.property_id) === String(propertyId)
        );
        if (match) setProperty(match);
        else loadApplications(propertyId);
      }}
    />
  );
}
