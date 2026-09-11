import {
  workflowFieldShellClass,
  workflowFieldWidthClass,
} from '../../src/utils/workflow-field.js';

describe('workflowFieldWidthClass', () => {
  test('maps compact currency and select widths', () => {
    expect(workflowFieldWidthClass('sm')).toContain('w-44');
    expect(workflowFieldWidthClass('md')).toContain('w-64');
    expect(workflowFieldWidthClass('lg')).toContain('w-[32rem]');
    expect(workflowFieldWidthClass('full')).toBe('w-full');
    expect(workflowFieldWidthClass()).toBe('w-full');
  });
});

describe('workflowFieldShellClass', () => {
  test('inline puts the label beside the control', () => {
    expect(workflowFieldShellClass({ layout: 'inline', width: 'lg' })).toContain(
      'flex items-center'
    );
    expect(workflowFieldShellClass({ layout: 'stack', width: 'sm' })).toBe(
      'w-44 max-w-full'
    );
  });
});
