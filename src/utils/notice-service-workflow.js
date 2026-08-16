/**
 * Generate-then-serve helpers for rent-increase (and eviction) notice workflows.
 *
 * The notice PDF is created on Generate → Next. Service may be recorded
 * immediately or deferred ("Service Later") while the workflow stays open.
 */

export const GENERATE_THEN_SERVE_WORKFLOW_TYPES = new Set([
  'rent_increase',
  'eviction',
]);

export const NOTICE_SERVICE_METHODS = [
  { value: 'in_person', label: 'In Person', needsPrint: true },
  { value: 'certified_mail', label: 'Certified Mail', needsPrint: true },
  { value: 'posting', label: 'Posting on Door', needsPrint: true },
  { value: 'email', label: 'Email', needsPrint: false },
];

/**
 * @param {object|null|undefined} workflow
 * @returns {boolean}
 */
export function isAwaitingNoticeService(workflow) {
  if (!workflow) return false;
  if (!['draft', 'in_progress'].includes(workflow.status)) return false;
  if (!GENERATE_THEN_SERVE_WORKFLOW_TYPES.has(workflow.workflow_type)) {
    return false;
  }
  const data = workflow.workflow_data || {};
  if (!data.notice_document_id) return false;
  if (data.service_status === 'served') return false;
  if (data.service_status === 'pending') return true;
  if (data.served_date) return false;
  return true;
}

/**
 * Service fields are required only when the user records service now.
 *
 * @param {Record<string, unknown>} data
 * @param {{ action?: string }} [ctx]
 * @returns {Record<string, string>}
 */
export function validateNoticeService(data = {}, ctx = {}) {
  const errors = {};
  if (ctx.action !== 'record_service') return errors;
  if (!data.served_date) {
    errors.served_date = 'Date notice served is required to record service.';
  }
  if (!data.served_method) {
    errors.served_method = 'Service method is required to record service.';
  }
  return errors;
}

/**
 * Resume onto Generate Notice when the saved step is Service but no PDF exists
 * (legacy in-progress workflows that stored Generate as the last step).
 *
 * Steps are 1-indexed.
 *
 * @param {{ currentStep?: number, totalSteps?: number, workflowData?: object, generateThenServe?: boolean }} opts
 * @returns {number}
 */
export function resumeStepIndex({
  currentStep,
  totalSteps,
  workflowData,
  generateThenServe = false,
} = {}) {
  const total = Math.max(1, Number(totalSteps) || 1);
  const step = Number(currentStep) || 1;
  let next = Math.min(Math.max(step, 1), total);
  if (
    generateThenServe &&
    !workflowData?.notice_document_id &&
    next >= total &&
    total >= 2
  ) {
    next = total - 1;
  }
  return next;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function rentIncreaseNoticeFingerprint(data = {}) {
  return [data.lease_id, data.new_rent, data.effective_date].join('|');
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function evictionNoticeFingerprint(data = {}) {
  return [data.lease_id, data.notice_type, data.effective_date].join('|');
}

/**
 * @param {{ emails?: string[], propertyLabel?: string, noticeKind?: string }} opts
 * @returns {string}
 */
export function buildNoticeMailto({
  emails = [],
  propertyLabel = 'the property',
  noticeKind = 'rent increase',
} = {}) {
  const to = emails.filter(Boolean).join(',');
  const subject = encodeURIComponent(
    `${capitalizeNoticeKind(noticeKind)} notice — ${propertyLabel}`
  );
  const body = encodeURIComponent(
    `Please find the attached ${noticeKind} notice for ${propertyLabel}.\n\nAttach the downloaded PDF before sending.`
  );
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

/**
 * Unique, non-empty emails from a lease_clients query result.
 *
 * @param {Array<{ clients?: object, client?: object }>|null|undefined} rows
 * @returns {string[]}
 */
export function tenantEmailsFromLeaseClients(rows) {
  const emails = [];
  for (const row of rows || []) {
    const client = row.clients || row.client || row;
    const nested = client?.users || client?.user || null;
    const email = nested?.email || client?.email || '';
    if (email && emails.indexOf(email) === -1) emails.push(email);
  }
  return emails;
}

function capitalizeNoticeKind(kind) {
  const text = String(kind || '').trim();
  if (!text) return 'Notice';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
