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
