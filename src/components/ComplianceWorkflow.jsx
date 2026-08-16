import React, { useState, useEffect, useContext, useRef } from 'react';
import { CheckCircle, Circle, ArrowRight, ArrowLeft, AlertCircle, Shield, Save } from 'lucide-react';
import { Card } from './ui';
import DateInput from './DateInput';
import WorkflowFileField from './WorkflowFileField';
import { AuthContext } from '../contexts';
import { hasMeaningfulWorkflowProgress, workflowProgressStatus } from '../utils/compliance-workflow-persistence.js';
import {
  shouldIgnoreWorkflowCancel,
  shouldIgnoreWorkflowNext,
} from '../utils/workflow-action-guard.js';
import { readResponseJson } from '../utils/read-response-json.js';
import {
  GENERATE_THEN_SERVE_WORKFLOW_TYPES,
  resumeStepIndex,
} from '../utils/notice-service-workflow.js';

/**
 * ComplianceWorkflow - Guided workflow component for compliance processes
 *
 * Space activates a <button> on keyup. If Next uses disabled={busy}, focus can
 * jump to Cancel before keyup and the same Space fires Cancel. Buttons use
 * aria-disabled + a sync action lock instead.
 *
 * @param {string} workflowType - Type of workflow (rent_increase, eviction, etc.)
 * @param {Object} initialData - Initial workflow data
 * @param {number} workflowId - Existing workflow ID (if resuming)
 * @param {Function} getSteps - Optional function to get custom workflow steps
 * @param {Function} onComplete - Callback when workflow is completed (or Service Later)
 * @param {Function} onCancel - Callback when workflow is cancelled
 * @param {Function} onWorkflowCreated - Callback when a new workflow row is created
 * @param {Function} onWorkflowLoaded - Callback after an existing workflow row is loaded
 */
export default function ComplianceWorkflow({
  workflowType,
  initialData = {},
  workflowId = null,
  getSteps = null,
  onComplete,
  onCancel,
  onWorkflowCreated,
  onWorkflowLoaded,
}) {
  const { user } = useContext(AuthContext);
  const [currentStep, setCurrentStep] = useState(1);
  const [workflowData, setWorkflowData] = useState(initialData);
  const [steps, setSteps] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [workflowRecord, setWorkflowRecord] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  // Sync lock so Space keyup cannot cancel after Next has already started.
  const actionLockRef = useRef(false);

  useEffect(() => {
    loadWorkflowData();
  }, [workflowType, workflowId]);

  const loadWorkflowData = async () => {
    setIsLoading(true);
    try {
      if (workflowId) {
        const response = await fetch(`/api/compliance/workflows?id=${workflowId}`);
        const parsed = await readResponseJson(response);
        const result = parsed.data;
        if (parsed.ok && result?.success && result.workflow) {
          const loadedData = {
            ...result.workflow.workflow_data,
            ...initialData
          };
          const loadedSteps = getSteps ? (getSteps() || []) : getWorkflowSteps(workflowType) || [];
          const totalSteps = loadedSteps.length || result.workflow.total_steps || 1;
          setWorkflowRecord(result.workflow);
          setCurrentStep(
            resumeStepIndex({
              currentStep: result.workflow.current_step || 1,
              totalSteps,
              workflowData: loadedData,
              generateThenServe: GENERATE_THEN_SERVE_WORKFLOW_TYPES.has(workflowType),
            })
          );
          setWorkflowData(loadedData);
          if (typeof onWorkflowLoaded === 'function') {
            onWorkflowLoaded(result.workflow);
          }
        }
      }

      if (!getSteps) {
        setSteps(getWorkflowSteps(workflowType) || []);
      }

      await loadPolicy();
    } catch (error) {
      console.error('Error loading workflow data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadPolicy = async () => {
    try {
      const propertyId = workflowData.property_id ||
                         workflowRecord?.property_id ||
                         initialData.property_id;

      if (!propertyId) return;

      const response = await fetch(
        `/api/compliance/policies?type=${workflowType}&property_id=${propertyId}`
      );
      const parsed = await readResponseJson(response);
      const result = parsed.data;
      if (parsed.ok && result?.success && result.policy) {
        setPolicy(result.policy);
      }
    } catch (error) {
      console.error('Error loading policy:', error);
    }
  };

  const handleNext = async () => {
    if (
      shouldIgnoreWorkflowNext({
        actionLocked: actionLockRef.current,
        busy: isSaving || isCancelling || isCompleting || isAdvancing,
      })
    ) {
      return;
    }
    const activeSteps = getSteps ? (getSteps() || []) : steps;
    const stepDef = activeSteps[currentStep - 1];
    if (Array.isArray(stepDef?.finishActions) && stepDef.finishActions.length > 0) {
      return;
    }
    if (!validateStep(currentStep, { action: 'next' })) return;

    actionLockRef.current = true;
    const nextStep = currentStep + 1;
    const totalSteps = activeSteps.length || steps.length;
    const isFinalStep = nextStep > totalSteps;

    if (isFinalStep) {
      setIsCompleting(true);
    }

    try {
      let extra = {};
      if (typeof stepDef?.onAdvance === 'function') {
        setIsAdvancing(true);
        try {
          extra = (await stepDef.onAdvance(workflowData)) || {};
        } catch (error) {
          setErrors({ general: error.message || 'Failed to continue' });
          return;
        } finally {
          setIsAdvancing(false);
        }
      }

      const merged = { ...workflowData, ...extra };
      if (Object.keys(extra).length > 0) {
        setWorkflowData(merged);
      }

      // Only mark completed on actual Complete — navigating TO the last
      // (review) step must stay in_progress or the session looks finished.
      const saved = await saveProgress(isFinalStep ? totalSteps : nextStep, {
        markCompleted: isFinalStep,
        workflowData: merged,
      });
      if (!saved && !isFinalStep) {
        return;
      }

      if (!isFinalStep) {
        setCurrentStep(nextStep);
      } else {
        await handleComplete(merged, { action: 'complete' });
      }
    } finally {
      if (isFinalStep) {
        setIsCompleting(false);
      }
      actionLockRef.current = false;
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const saveProgress = async (step = null, options = {}) => {
    setIsSaving(true);
    try {
      const dataToSave = options.workflowData || workflowData;
      const stepToSave = step || currentStep;
      const totalSteps = (getSteps ? getSteps() : steps)?.length || steps.length;
      const markCompleted = options.markCompleted === true;
      const existingId = workflowId || workflowRecord?.workflow_id;
      const meaningful = hasMeaningfulWorkflowProgress(dataToSave, {
        ...(workflowRecord || {}),
        current_step: stepToSave,
        lease_id: dataToSave.lease_id ?? workflowRecord?.lease_id,
      });

      // Do not create empty drafts (e.g. Save Progress on step 1 with no lease).
      if (!existingId && !meaningful) {
        setErrors({
          general:
            'Select a lease (or complete the first step) before saving. Nothing was saved yet.',
        });
        return false;
      }

      const payload = {
        workflow_type: workflowType,
        total_steps: totalSteps,
        current_step: Math.min(stepToSave, totalSteps),
        status: workflowProgressStatus(
          Math.min(stepToSave, totalSteps),
          totalSteps,
          markCompleted
        ),
        workflow_data: dataToSave,
        ...dataToSave
      };

      let response;
      if (existingId) {
        response = await fetch(`/api/compliance/workflows?id=${existingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        payload.created_by_user_id = user?.user_id;
        response = await fetch('/api/compliance/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const parsed = await readResponseJson(response);
      if (!parsed.ok) {
        throw new Error(parsed.error || 'Failed to save workflow');
      }
      const result = parsed.data || {};
      if (!result.success) {
        throw new Error(result.error || 'Failed to save workflow');
      }

      if (result.workflow) {
        setWorkflowRecord(result.workflow);
        if (!existingId && typeof onWorkflowCreated === 'function') {
          onWorkflowCreated(result.workflow);
        }
      }
      setErrors((prev) => {
        const next = { ...prev };
        delete next.general;
        return next;
      });
      return true;
    } catch (error) {
      console.error('Error saving workflow progress:', error);
      setErrors({ general: error.message });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = async () => {
    // Space on Next can disable Next and move focus here before keyup —
    // ignore Cancel while Next/Complete/Save already holds the lock.
    if (
      shouldIgnoreWorkflowCancel({
        actionLocked: actionLockRef.current,
        busy: isSaving || isCompleting || isCancelling || isAdvancing,
      })
    ) {
      return;
    }
    actionLockRef.current = true;
    setIsCancelling(true);
    try {
      const id = workflowId || workflowRecord?.workflow_id;
      if (id) {
        const meaningful = hasMeaningfulWorkflowProgress(workflowData, workflowRecord);
        if (!meaningful) {
          await fetch(`/api/compliance/workflows?id=${id}`, { method: 'DELETE' });
        } else {
          await fetch(`/api/compliance/workflows?id=${id}&action=cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    } catch (error) {
      console.error('Error cancelling workflow:', error);
    } finally {
      setIsCancelling(false);
      actionLockRef.current = false;
      if (onCancel) onCancel();
    }
  };

  const handleComplete = async (dataOverride = null, meta = {}) => {
    // isCompleting is set by handleNext for the final step; keep it true if already set
    setIsCompleting(true);
    try {
      const data = dataOverride || workflowData;
      const id = workflowId || workflowRecord?.workflow_id;
      const totalSteps = (getSteps ? getSteps() : steps)?.length || steps.length;

      if (id) {
        const response = await fetch(`/api/compliance/workflows?id=${id}&action=complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflow_data: data,
            completed_at: new Date().toISOString()
          })
        });

        const parsed = await readResponseJson(response);
        if (!parsed.ok) {
          throw new Error(parsed.error || 'Failed to complete workflow');
        }
        const result = parsed.data || {};
        if (!result.success) {
          throw new Error(result.error || 'Failed to complete workflow');
        }
      } else {
        await saveProgress(totalSteps, { markCompleted: true, workflowData: data });
      }

      if (onComplete) {
        // Await so async generators (notice/renewal) finish before the parent unmounts
        await onComplete(data, meta);
      }
    } catch (error) {
      console.error('Error completing workflow:', error);
      setErrors({ general: error.message });
    } finally {
      setIsCompleting(false);
    }
  };

  const handleFinishAction = async (finishAction) => {
    if (
      shouldIgnoreWorkflowNext({
        actionLocked: actionLockRef.current,
        busy: isSaving || isCancelling || isCompleting || isAdvancing,
      })
    ) {
      return;
    }
    const actionId = finishAction?.id;
    if (!actionId) return;
    if (!validateStep(currentStep, { action: actionId })) return;

    actionLockRef.current = true;
    const markCompleted = finishAction.complete !== false;
    if (markCompleted) {
      setIsCompleting(true);
    }

    try {
      const activeSteps = getSteps ? (getSteps() || []) : steps;
      const stepDef = activeSteps[currentStep - 1];
      let extra = {};
      if (typeof stepDef?.onFinish === 'function') {
        extra = (await stepDef.onFinish(workflowData, { action: actionId })) || {};
      }
      if (actionId === 'service_later') {
        extra = { ...extra, service_status: 'pending' };
      }
      if (actionId === 'record_service') {
        extra = { ...extra, service_status: 'served' };
      }
      const merged = { ...workflowData, ...extra };
      setWorkflowData(merged);

      const saved = await saveProgress(currentStep, {
        markCompleted,
        workflowData: merged,
      });
      if (!saved) return;

      if (markCompleted) {
        await handleComplete(merged, { action: actionId });
      } else if (onComplete) {
        await onComplete(merged, { action: actionId });
      }
    } catch (error) {
      console.error('Error finishing workflow step:', error);
      setErrors({ general: error.message });
    } finally {
      setIsCompleting(false);
      actionLockRef.current = false;
    }
  };

  const validateStep = (stepNumber, ctx = {}) => {
    const activeSteps = getSteps ? (getSteps() || []) : steps;
    const step = activeSteps[stepNumber - 1];
    if (!step) return true;

    const stepErrors = {};
    let isValid = true;

    if (step.fields) {
      step.fields.forEach(field => {
        const value = workflowData[field.id];
        const isEmpty =
          value === null ||
          value === undefined ||
          value === '' ||
          (typeof value === 'number' && Number.isNaN(value)) ||
          (field.type === 'file' && !value?.document_id);

        if (field.required && isEmpty) {
          stepErrors[field.id] = `${field.label} is required`;
          isValid = false;
        } else if (
          field.type === 'number' &&
          !isEmpty &&
          typeof value === 'number' &&
          value <= 0
        ) {
          stepErrors[field.id] = `${field.label} must be greater than 0`;
          isValid = false;
        }
      });
    }

    if (typeof step.validate === 'function') {
      const customErrors = step.validate(workflowData, ctx) || {};
      Object.entries(customErrors).forEach(([fieldId, message]) => {
        if (message) {
          stepErrors[fieldId] = message;
          isValid = false;
        }
      });
    }

    if (!isValid) {
      setErrors(prev => ({ ...prev, [stepNumber]: stepErrors }));
    } else {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[stepNumber];
        return newErrors;
      });
    }

    return isValid;
  };

  const updateField = (fieldId, value) => {
    setWorkflowData(prev => ({
      ...prev,
      [fieldId]: value
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  const resolvedSteps = getSteps ? (getSteps() || []) : steps;

  if (resolvedSteps.length === 0) {
    return (
      <Card title="Workflow Not Found">
        <p className="text-gray-600">No workflow steps defined for {workflowType}.</p>
      </Card>
    );
  }

  const currentStepData = resolvedSteps[currentStep - 1];
  const stepErrors = errors[currentStep] || {};
  const busy = isSaving || isCancelling || isCompleting || isAdvancing;
  const finishActions = currentStepData?.finishActions;
  const hasFinishActions = Array.isArray(finishActions) && finishActions.length > 0;
  const overlayLabel = isAdvancing
    ? (currentStepData?.advanceBusyLabel || 'Generating document…')
    : (currentStepData?.completeBusyLabel || 'Generating document…');

  return (
    <form
      className={`space-y-6 ${isCompleting || isAdvancing ? 'cursor-wait' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || hasFinishActions) return;
        handleNext();
      }}
    >
      {(isCompleting || isAdvancing) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 cursor-wait"
          role="alertdialog"
          aria-busy="true"
          aria-live="assertive"
          aria-label={overlayLabel}
        >
          <div className="bg-white rounded-lg shadow-xl px-8 py-6 max-w-sm mx-4 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-b-2 border-indigo-600" />
            <p className="text-base font-semibold text-gray-900">
              {overlayLabel}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Please wait. This may take a moment — do not click again.
            </p>
          </div>
        </div>
      )}
      {policy && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-blue-900 mb-1">
              Applicable Policy: {policy.policy_name}
            </h4>
            <p className="text-xs text-blue-700">
              Policy Level: {policy.effective_level || policy.policy_level}
              {policy.description && ` • ${policy.description}`}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        {resolvedSteps.map((step, index) => (
          <React.Fragment key={index}>
            <div className="flex flex-col items-center flex-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                  index + 1 < currentStep
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : index + 1 === currentStep
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-gray-300 text-gray-400'
                }`}
              >
                {index + 1 < currentStep ? (
                  <CheckCircle className="w-6 h-6" />
                ) : (
                  <Circle className="w-6 h-6" />
                )}
              </div>
              <span className={`mt-2 text-xs text-center ${
                index + 1 <= currentStep ? 'text-indigo-600 font-semibold' : 'text-gray-400'
              }`}>
                {step.title}
              </span>
            </div>
            {index < resolvedSteps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 ${
                index + 1 < currentStep ? 'bg-indigo-600' : 'bg-gray-300'
              }`} />
            )}
          </React.Fragment>
        ))}
      </div>

      <Card title={currentStepData.title}>
        {currentStepData.description && (
          <p className="text-gray-600 mb-6">{currentStepData.description}</p>
        )}

        {errors.general && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{errors.general}</p>
          </div>
        )}

        {currentStepData.render ? (
          currentStepData.render({
            workflowData,
            updateField,
            errors: stepErrors,
            workflowId: workflowId || workflowRecord?.workflow_id,
            userId: user?.user_id,
          })
        ) : (
          <div className="space-y-4">
            {currentStepData.fields?.map(field => (
              <div key={field.id}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {field.type === 'text' && (
                  <input
                    type="text"
                    value={workflowData[field.id] || ''}
                    onChange={(e) => updateField(field.id, e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md ${
                      stepErrors[field.id] ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder={field.placeholder}
                  />
                )}
                {field.type === 'number' && (
                  <input
                    type="number"
                    value={workflowData[field.id] || ''}
                    onChange={(e) => updateField(field.id, parseFloat(e.target.value))}
                    className={`w-full px-3 py-2 border rounded-md ${
                      stepErrors[field.id] ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder={field.placeholder}
                  />
                )}
                {field.type === 'date' && (
                  <DateInput
                    label=""
                    value={workflowData[field.id] || ''}
                    onChange={(e) => updateField(field.id, e.target.value || null)}
                    className={stepErrors[field.id] ? 'border-red-300' : ''}
                  />
                )}
                {field.type === 'select' && (
                  <select
                    value={workflowData[field.id] || ''}
                    onChange={(e) => updateField(field.id, e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md ${
                      stepErrors[field.id] ? 'border-red-300' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select...</option>
                    {field.options?.map(option => (
                      <option key={option.value || option} value={option.value || option}>
                        {option.label || option}
                      </option>
                    ))}
                  </select>
                )}
                {field.type === 'textarea' && (
                  <textarea
                    value={workflowData[field.id] || ''}
                    onChange={(e) => updateField(field.id, e.target.value)}
                    rows={4}
                    className={`w-full px-3 py-2 border rounded-md ${
                      stepErrors[field.id] ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder={field.placeholder}
                  />
                )}
                {field.type === 'file' && (
                  <WorkflowFileField
                    value={workflowData[field.id] || null}
                    onChange={(fileMeta) => updateField(field.id, fileMeta)}
                    error={stepErrors[field.id]}
                    leaseId={workflowData.lease_id}
                    propertyId={workflowData.property_id}
                    unitId={workflowData.unit_id}
                    workflowId={workflowId || workflowRecord?.workflow_id}
                    userId={user?.user_id}
                    documentType={field.documentType}
                    acceptedTypes={field.acceptedTypes}
                    description={field.description}
                  />
                )}
                {stepErrors[field.id] && field.type !== 'file' && (
                  <p className="mt-1 text-sm text-red-600">{stepErrors[field.id]}</p>
                )}
                {field.description && field.type !== 'file' && (
                  <p className="mt-1 text-xs text-gray-500">{field.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              aria-disabled={busy ? 'true' : undefined}
              onClick={(e) => {
                if (busy || actionLockRef.current) {
                  e.preventDefault();
                  return;
                }
                handleCancel();
              }}
              onKeyDown={(e) => {
                if (
                  (busy || actionLockRef.current) &&
                  (e.key === ' ' || e.key === 'Enter')
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              className={`px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 ${
                busy ? 'opacity-50 cursor-wait' : ''
              }`}
            >
              {isCancelling ? 'Cancelling...' : 'Cancel'}
            </button>
          )}
          <button
            type="button"
            aria-disabled={busy ? 'true' : undefined}
            onClick={(e) => {
              if (busy || actionLockRef.current) {
                e.preventDefault();
                return;
              }
              saveProgress();
            }}
            onKeyDown={(e) => {
              if (
                (busy || actionLockRef.current) &&
                (e.key === ' ' || e.key === 'Enter')
              ) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            className={`px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2 ${
              busy ? 'opacity-50 cursor-wait' : ''
            }`}
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Progress'}
          </button>
        </div>
        <div className="flex gap-2">
          {currentStep > 1 && (
            <button
              type="button"
              aria-disabled={busy ? 'true' : undefined}
              onClick={(e) => {
                if (busy || actionLockRef.current) {
                  e.preventDefault();
                  return;
                }
                handlePrevious();
              }}
              onKeyDown={(e) => {
                if (
                  (busy || actionLockRef.current) &&
                  (e.key === ' ' || e.key === 'Enter')
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              className={`px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2 ${
                busy ? 'opacity-50 cursor-wait' : ''
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              Previous
            </button>
          )}
          {hasFinishActions ? (
            finishActions.map((action) => {
              const isPrimary = action.variant !== 'outline';
              return (
                <button
                  key={action.id}
                  type="button"
                  aria-disabled={busy ? 'true' : undefined}
                  onClick={(e) => {
                    if (busy || actionLockRef.current) {
                      e.preventDefault();
                      return;
                    }
                    handleFinishAction(action);
                  }}
                  onKeyDown={(e) => {
                    if (
                      (busy || actionLockRef.current) &&
                      (e.key === ' ' || e.key === 'Enter')
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  className={`px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 ${
                    isPrimary
                      ? 'text-white bg-indigo-600 hover:bg-indigo-700'
                      : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                  } ${busy ? 'opacity-50 cursor-wait' : ''}`}
                >
                  {action.label}
                </button>
              );
            })
          ) : (
            <button
              type="button"
              aria-disabled={busy ? 'true' : undefined}
              onClick={(e) => {
                if (busy || actionLockRef.current) {
                  e.preventDefault();
                  return;
                }
                handleNext();
              }}
              onKeyDown={(e) => {
                if (
                  (busy || actionLockRef.current) &&
                  (e.key === ' ' || e.key === 'Enter')
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              className={`px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 flex items-center gap-2 ${
                busy ? 'opacity-50 cursor-wait' : ''
              } ${isCompleting || isAdvancing ? 'cursor-wait' : ''}`}
            >
              {isAdvancing
                ? (currentStepData?.advanceBusyLabel || 'Generating…')
                : isCompleting
                  ? 'Generating…'
                  : currentStep === resolvedSteps.length
                    ? 'Complete'
                    : 'Next'}
              {currentStep < resolvedSteps.length && !isCompleting && !isAdvancing && (
                <ArrowRight className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function getWorkflowSteps(workflowType) {
  const workflows = {
    rent_increase: [
      {
        title: 'Select Lease',
        description: 'Choose the lease for which you want to increase rent.',
        fields: [
          {
            id: 'lease_id',
            label: 'Lease',
            type: 'select',
            required: true,
            description: 'Select the lease for rent increase'
          }
        ]
      },
      {
        title: 'Rent Details',
        description: 'Enter current and new rent amounts.',
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
        ]
      },
      {
        title: 'Review & Generate',
        description: 'Review the notice details and generate the compliant document.',
        fields: []
      }
    ]
  };

  return workflows[workflowType] || [];
}
