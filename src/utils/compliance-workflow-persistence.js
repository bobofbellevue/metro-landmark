/**
 * Helpers for compliance workflow persistence decisions.
 */

/**
 * Whether a workflow has enough data to justify a DB row.
 * Lease-scoped processes need a selected lease; others need any non-empty
 * workflow_data beyond placeholder keys.
 *
 * @param {Record<string, unknown> | null | undefined} workflowData
 * @param {{ lease_id?: number | string | null, current_step?: number | null } | null} [record]
 * @returns {boolean}
 */
export function hasMeaningfulWorkflowProgress(workflowData = {}, record = null) {
  const leaseId =
    workflowData?.lease_id ??
    record?.lease_id ??
    null;
  if (leaseId != null && String(leaseId).trim() !== '') {
    return true;
  }

  const step = Number(record?.current_step || workflowData?.current_step || 1);
  if (step > 1) {
    return true;
  }

  const data = workflowData && typeof workflowData === 'object' ? workflowData : {};
  const meaningfulKeys = Object.keys(data).filter((key) => {
    if (['jurisdiction'].includes(key)) return false;
    const value = data[key];
    if (value == null || value === '') return false;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      return false;
    }
    return true;
  });

  return meaningfulKeys.length > 0;
}

/**
 * What Close should do: persist an in-progress row, discard an empty one, or
 * just leave if nothing was ever saved.
 *
 * @param {Record<string, unknown> | null | undefined} workflowData
 * @param {{ workflow_id?: number | string | null, lease_id?: number | string | null, current_step?: number | null } | null} [record]
 * @returns {'save' | 'discard' | 'leave'}
 */
export function workflowCloseAction(workflowData = {}, record = null) {
  if (hasMeaningfulWorkflowProgress(workflowData, record)) return 'save';
  const id = record?.workflow_id;
  if (id != null && String(id).trim() !== '') return 'discard';
  return 'leave';
}

/**
 * Workflow types that must not be inserted without a lease_id.
 */
export const LEASE_SCOPED_WORKFLOW_TYPES = new Set([
  'rent_increase',
  'lease_renewal',
  'move_in',
  'move_out',
  'security_deposit',
  'collections',
  'eviction',
  'lease_violation',
  'lease_termination',
  'habitability',
  'entry_notice',
  'rent_control',
]);

/**
 * Status to persist when saving progress for a step.
 * Navigating onto the final review step stays in_progress until Complete.
 * @param {number} stepToSave
 * @param {number} totalSteps
 * @param {boolean} [markCompleted]
 * @returns {'in_progress' | 'completed'}
 */
export function workflowProgressStatus(stepToSave, totalSteps, markCompleted = false) {
  if (markCompleted) return 'completed';
  return 'in_progress';
}

/**
 * Drop undefined values so a remount's empty initialData cannot wipe
 * lease/property fields loaded from the saved row.
 *
 * @param {Record<string, unknown> | null | undefined} value
 * @returns {Record<string, unknown>}
 */
export function definedRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

/**
 * Merge a saved workflow row with caller initialData for resume.
 * Prefer workflow_data, then the lease_id column if the blob omitted it.
 *
 * @param {{ workflow_data?: Record<string, unknown>, lease_id?: number | string | null } | null | undefined} workflow
 * @param {Record<string, unknown> | null | undefined} [initialData]
 * @returns {Record<string, unknown>}
 */
export function hydrateWorkflowData(workflow = {}, initialData = {}) {
  const blob =
    workflow?.workflow_data && typeof workflow.workflow_data === 'object'
      ? workflow.workflow_data
      : {};
  const data = {
    ...blob,
    ...definedRecord(initialData),
  };
  if (
    (data.lease_id == null || data.lease_id === '') &&
    workflow?.lease_id != null &&
    workflow.lease_id !== ''
  ) {
    data.lease_id = workflow.lease_id;
  }
  return data;
}

/**
 * Body for POST/PUT /api/compliance/workflows.
 * Spread row fields first, then set current_step / workflow_data / status so a
 * stale current_step inside workflow_data cannot overwrite the step being saved.
 *
 * @param {{
 *   workflowType: string,
 *   totalSteps: number,
 *   stepToSave: number,
 *   markCompleted?: boolean,
 *   dataToSave?: Record<string, unknown>,
 * }} opts
 * @returns {Record<string, unknown>}
 */
export function buildWorkflowSavePayload({
  workflowType,
  totalSteps,
  stepToSave,
  markCompleted = false,
  dataToSave = {},
} = {}) {
  const total = Math.max(1, Number(totalSteps) || 1);
  const step = Math.min(Math.max(Number(stepToSave) || 1, 1), total);
  const data = dataToSave && typeof dataToSave === 'object' ? dataToSave : {};
  const {
    current_step: _ignoredStep,
    status: _ignoredStatus,
    workflow_data: _ignoredBlob,
    workflow_type: _ignoredType,
    total_steps: _ignoredTotal,
    ...rowFields
  } = data;
  return {
    ...rowFields,
    workflow_type: workflowType,
    total_steps: total,
    current_step: step,
    status: workflowProgressStatus(step, total, markCompleted),
    workflow_data: {
      ...data,
      current_step: step,
    },
  };
}

/**
 * Whether changing the parent workflowId should refetch the row.
 * Skip when the parent just caught up to an id this session already created
 * (otherwise Next remounts/reloads onto Select Lease).
 *
 * @param {number|string|null|undefined} requestedId
 * @param {number|string|null|undefined} loadedId
 * @returns {boolean}
 */
export function shouldReloadWorkflowRecord(requestedId, loadedId) {
  const requested =
    requestedId == null || requestedId === '' ? null : String(requestedId);
  const loaded = loadedId == null || loadedId === '' ? null : String(loadedId);
  if (requested == null) {
    return loaded == null;
  }
  return requested !== loaded;
}

/**
 * Route POST /api/compliance/workflows based on query params.
 * Complete/cancel must win over create (same HTTP method).
 *
 * @param {{ id?: string, action?: string }} query
 * @returns {'complete' | 'cancel' | 'create'}
 */
export function resolveWorkflowPostAction(query = {}) {
  const id = query.id;
  const action = query.action;
  if (id != null && String(id).trim() !== '' && action === 'complete') {
    return 'complete';
  }
  if (id != null && String(id).trim() !== '' && action === 'cancel') {
    return 'cancel';
  }
  return 'create';
}
