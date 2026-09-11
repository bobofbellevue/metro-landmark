import React, { useMemo } from 'react';
import LeaseSelectionPicker from '../LeaseSelectionPicker';
import {
  GENERATE_THEN_SERVE_WORKFLOW_TYPES,
  leaseAnnotationsFromOpenWorkflows,
  maybeResumeOpenWorkflow,
  noticeLeasePickerGroups,
} from '../../utils/notice-service-workflow.js';

/**
 * Select Lease control for compliance workflows.
 * Generate-then-serve types group in-progress / awaiting-service rows and
 * resume that row instead of stamping a blank session.
 */
export default function NoticeLeasePicker({
  value = null,
  error = '',
  statuses,
  showRent = true,
  showDeposit = false,
  emptyMessage,
  openWorkflows = [],
  workflowId = null,
  onResumeWorkflow,
  workflowType,
  onSelect,
}) {
  const { workflowsByLease, leaseAnnotations } = useMemo(
    () => leaseAnnotationsFromOpenWorkflows(openWorkflows),
    [openWorkflows]
  );
  const grouped = GENERATE_THEN_SERVE_WORKFLOW_TYPES.has(workflowType);

  return (
    <LeaseSelectionPicker
      value={value}
      error={error}
      statuses={statuses}
      showRent={showRent}
      showDeposit={showDeposit}
      emptyMessage={emptyMessage}
      groups={grouped ? noticeLeasePickerGroups(workflowType) : null}
      leaseAnnotations={grouped ? leaseAnnotations : {}}
      onChange={(leaseId, selected) => {
        if (leaseId == null) {
          onSelect?.(null, null);
          return;
        }
        const existing = workflowsByLease.get(String(leaseId));
        if (maybeResumeOpenWorkflow({ existing, workflowId, onResumeWorkflow })) {
          return;
        }
        onSelect?.(leaseId, selected);
      }}
    />
  );
}
