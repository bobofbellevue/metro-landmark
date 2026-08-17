/**
 * Space activates <button> on keyup. If Next is disabled mid-press, focus can
 * move to Close and the same Space fires Close. Use aria-disabled + a sync
 * lock instead of the disabled attribute while an action is in flight.
 */

/**
 * @param {{ actionLocked?: boolean, busy?: boolean }} state
 * @returns {boolean}
 */
export function shouldIgnoreWorkflowCancel(state = {}) {
  return Boolean(state.actionLocked || state.busy);
}

/**
 * @param {{ actionLocked?: boolean, busy?: boolean }} state
 * @returns {boolean}
 */
export function shouldIgnoreWorkflowNext(state = {}) {
  return Boolean(state.actionLocked || state.busy);
}
