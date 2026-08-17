import {
  hasMeaningfulWorkflowProgress,
  LEASE_SCOPED_WORKFLOW_TYPES,
  resolveWorkflowPostAction,
  shouldReloadWorkflowRecord,
  workflowProgressStatus,
} from '../../src/utils/compliance-workflow-persistence.js';

describe('hasMeaningfulWorkflowProgress', () => {
  test('empty draft is not meaningful', () => {
    expect(hasMeaningfulWorkflowProgress({}, { current_step: 1 })).toBe(false);
    expect(hasMeaningfulWorkflowProgress({ jurisdiction: 'seattle' })).toBe(false);
  });

  test('lease id is meaningful', () => {
    expect(hasMeaningfulWorkflowProgress({ lease_id: 42 })).toBe(true);
    expect(hasMeaningfulWorkflowProgress({}, { lease_id: 42 })).toBe(true);
  });

  test('step > 1 is meaningful', () => {
    expect(hasMeaningfulWorkflowProgress({}, { current_step: 2 })).toBe(true);
  });

  test('other filled fields are meaningful', () => {
    expect(hasMeaningfulWorkflowProgress({ new_rent: 2000 })).toBe(true);
  });
});

describe('LEASE_SCOPED_WORKFLOW_TYPES', () => {
  test('includes lease renewal and rent increase', () => {
    expect(LEASE_SCOPED_WORKFLOW_TYPES.has('lease_renewal')).toBe(true);
    expect(LEASE_SCOPED_WORKFLOW_TYPES.has('rent_increase')).toBe(true);
  });
});

describe('resolveWorkflowPostAction', () => {
  test('routes complete/cancel before create', () => {
    expect(resolveWorkflowPostAction({ id: '12', action: 'complete' })).toBe(
      'complete'
    );
    expect(resolveWorkflowPostAction({ id: '12', action: 'cancel' })).toBe(
      'cancel'
    );
    expect(resolveWorkflowPostAction({})).toBe('create');
    expect(resolveWorkflowPostAction({ action: 'complete' })).toBe('create');
  });
});

describe('shouldReloadWorkflowRecord', () => {
  test('loads on a fresh mount and when switching ids', () => {
    expect(shouldReloadWorkflowRecord(null, null)).toBe(true);
    expect(shouldReloadWorkflowRecord(12, null)).toBe(true);
    expect(shouldReloadWorkflowRecord(12, 7)).toBe(true);
  });

  test('does not reload when the parent catches up to the created row', () => {
    expect(shouldReloadWorkflowRecord(12, 12)).toBe(false);
    expect(shouldReloadWorkflowRecord('12', 12)).toBe(false);
  });
});

describe('workflowProgressStatus', () => {
  test('stays in_progress when moving onto the final review step', () => {
    expect(workflowProgressStatus(3, 3, false)).toBe('in_progress');
    expect(workflowProgressStatus(2, 3, false)).toBe('in_progress');
  });

  test('completed only when markCompleted is true', () => {
    expect(workflowProgressStatus(3, 3, true)).toBe('completed');
  });
});
