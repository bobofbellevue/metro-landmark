import {
  shouldIgnoreWorkflowCancel,
  shouldIgnoreWorkflowNext,
} from '../../src/utils/workflow-action-guard.js';

describe('workflow-action-guard', () => {
  test('blocks Close while Next holds the action lock (spacebar focus steal)', () => {
    expect(shouldIgnoreWorkflowCancel({ actionLocked: true, busy: false })).toBe(
      true
    );
    expect(shouldIgnoreWorkflowCancel({ actionLocked: false, busy: true })).toBe(
      true
    );
    expect(shouldIgnoreWorkflowCancel({ actionLocked: false, busy: false })).toBe(
      false
    );
  });

  test('blocks duplicate Next while busy', () => {
    expect(shouldIgnoreWorkflowNext({ actionLocked: true })).toBe(true);
    expect(shouldIgnoreWorkflowNext({ busy: true })).toBe(true);
    expect(shouldIgnoreWorkflowNext({})).toBe(false);
  });
});
