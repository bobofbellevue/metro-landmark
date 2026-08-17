import {
  buildWorkflowSavePayload,
  definedRecord,
  hasMeaningfulWorkflowProgress,
  hydrateWorkflowData,
  LEASE_SCOPED_WORKFLOW_TYPES,
  resolveWorkflowPostAction,
  shouldReloadWorkflowRecord,
  workflowCloseAction,
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

describe('workflowCloseAction', () => {
  test('saves when a lease is selected so the workflow can be resumed', () => {
    expect(workflowCloseAction({ lease_id: 42 }, null)).toBe('save');
    expect(
      workflowCloseAction({ lease_id: 42 }, { workflow_id: 9, current_step: 2 })
    ).toBe('save');
  });

  test('discards an empty saved row and leaves when nothing was saved', () => {
    expect(workflowCloseAction({}, { workflow_id: 9, current_step: 1 })).toBe(
      'discard'
    );
    expect(workflowCloseAction({ jurisdiction: 'seattle' }, null)).toBe('leave');
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

describe('definedRecord', () => {
  test('drops undefined keys so remount initialData cannot wipe saved fields', () => {
    expect(definedRecord({ property_id: undefined, unit_id: 3, jurisdiction: 'seattle' })).toEqual({
      unit_id: 3,
      jurisdiction: 'seattle',
    });
  });
});

describe('hydrateWorkflowData', () => {
  test('keeps saved lease and fills lease_id from the row column', () => {
    expect(
      hydrateWorkflowData(
        {
          lease_id: 42,
          workflow_data: { lease_id: 42, new_rent: 2100, current_step: 2 },
        },
        { property_id: undefined, jurisdiction: 'seattle' }
      )
    ).toEqual({
      lease_id: 42,
      new_rent: 2100,
      current_step: 2,
      jurisdiction: 'seattle',
    });
    expect(
      hydrateWorkflowData({ lease_id: 7, workflow_data: { new_rent: 1800 } }, {})
    ).toEqual({ lease_id: 7, new_rent: 1800 });
    expect(
      hydrateWorkflowData(
        {
          lease_id: 7,
          unit_id: 3,
          property_id: 8,
          workflow_data: { new_rent: 1800 },
        },
        {}
      )
    ).toEqual({ lease_id: 7, unit_id: 3, property_id: 8, new_rent: 1800 });
  });
});

describe('buildWorkflowSavePayload', () => {
  test('does not let a stale current_step in workflow data overwrite the step being saved', () => {
    const payload = buildWorkflowSavePayload({
      workflowType: 'rent_increase',
      totalSteps: 4,
      stepToSave: 2,
      dataToSave: {
        lease_id: 42,
        current_step: 1,
        new_rent: 2100,
        status: 'draft',
      },
    });
    expect(payload.current_step).toBe(2);
    expect(payload.status).toBe('in_progress');
    expect(payload.workflow_type).toBe('rent_increase');
    expect(payload.lease_id).toBe(42);
    expect(payload.workflow_data).toMatchObject({
      lease_id: 42,
      new_rent: 2100,
      current_step: 2,
    });
  });
});
