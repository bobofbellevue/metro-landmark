/**
 * Generate-then-serve helpers for rent-increase (and eviction) notice workflows.
 *
 * The notice PDF is created on Generate → Next. Service may be recorded
 * immediately or deferred ("Service Later") while the workflow stays open.
 */

import { DEFAULT_NOTICE_SERVICE_METHODS } from '../jurisdictions/index.js';

export const GENERATE_THEN_SERVE_WORKFLOW_TYPES = new Set([
  'rent_increase',
  'eviction',
  'lease_termination',
]);

/**
 * Fallback list when a pack has not configured methods.
 * Prefer getNoticeServiceMethods(packId) at call sites.
 */
export const NOTICE_SERVICE_METHODS = DEFAULT_NOTICE_SERVICE_METHODS.map((method) => ({
  value: method.id,
  label: method.label,
  needsPrint: method.needsPrint !== false,
  compound: !!method.compound,
}));

/**
 * @param {Array<{ id?: string, value?: string, label: string, needsPrint?: boolean, compound?: boolean }>|null|undefined} methods
 */
export function normalizeNoticeServiceMethods(methods) {
  const list = Array.isArray(methods) && methods.length ? methods : DEFAULT_NOTICE_SERVICE_METHODS;
  return list.map((method) => ({
    value: method.value || method.id,
    label: method.label,
    needsPrint: method.needsPrint !== false,
    compound: !!method.compound,
  }));
}

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
 * Resume onto the saved step. Skip Select Lease when a lease (or notice PDF)
 * is already on the row — stale current_step=1 is common after Close.
 * Drop back to Generate Notice when the saved step is Service but no PDF exists.
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
  const saved = Math.max(
    Number(currentStep) || 0,
    Number(workflowData?.current_step) || 0
  );
  let next = Math.min(Math.max(saved || 1, 1), total);
  const hasLease =
    workflowData?.lease_id != null && String(workflowData.lease_id).trim() !== '';

  // Stale rows often keep current_step=1 after Select Lease → Next. If a lease
  // (or notice PDF) is already saved, skip the picker instead of restarting.
  if (next <= 1 && total >= 2) {
    if (generateThenServe && workflowData?.notice_document_id) {
      next = total;
    } else if (hasLease) {
      next = 2;
    }
  }

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
 * Whether the wizard can open onto the saved step from already-loaded row data
 * without waiting on GET.
 *
 * @param {number|string|null|undefined} workflowId
 * @param {Record<string, unknown> | null | undefined} initialData
 * @returns {boolean}
 */
export function hasWorkflowResumeSeed(workflowId, initialData = {}) {
  if (workflowId == null || workflowId === '') return false;
  const leaseId = initialData?.lease_id;
  if (leaseId != null && String(leaseId).trim() !== '') return true;
  return Number(initialData?.current_step) > 1;
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
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function leaseTerminationNoticeFingerprint(data = {}) {
  return [
    data.lease_id,
    data.initiated_by,
    data.has_cause,
    data.effective_date,
    data.termination_reason,
  ].join('|');
}

/**
 * @param {{ emails?: string[], propertyLabel?: string, noticeKind?: string }} opts
 * @returns {{ to: string, subject: string, body: string }}
 */
export function buildNoticeEmailParts({
  emails = [],
  propertyLabel = 'the property',
  noticeKind = 'rent increase',
} = {}) {
  return {
    to: emails.filter(Boolean).join(', '),
    subject: `${capitalizeNoticeKind(noticeKind)} notice — ${propertyLabel}`,
    body: `Please find the attached ${noticeKind} notice for ${propertyLabel}.`,
  };
}

/**
 * Plain text for clipboard when the operator uses Gmail (or another webmail)
 * in a browser instead of a mail app.
 * @param {{ emails?: string[], propertyLabel?: string, noticeKind?: string }} opts
 * @returns {string}
 */
export function buildNoticeEmailPlainText(opts = {}) {
  const { to, subject, body } = buildNoticeEmailParts(opts);
  return `To: ${to}\nSubject: ${subject}\n\n${body}`;
}

/**
 * Gmail web compose URL (works without a local mail app).
 * @param {{ emails?: string[], propertyLabel?: string, noticeKind?: string }} opts
 * @returns {string}
 */
export function buildGmailComposeUrl(opts = {}) {
  const { to, subject, body } = buildNoticeEmailParts(opts);
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to,
    su: subject,
    body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * @param {{ emails?: string[], propertyLabel?: string, noticeKind?: string }} opts
 * @returns {string}
 */
export function buildNoticeMailto(opts = {}) {
  const { to, subject, body } = buildNoticeEmailParts(opts);
  const mailtoTo = to.replace(/, /g, ',');
  return `mailto:${mailtoTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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

/**
 * Lease id stored on a compliance workflow row.
 * @param {object|null|undefined} workflow
 * @returns {string|number|null}
 */
export function workflowLeaseId(workflow) {
  if (!workflow) return null;
  return workflow.lease_id ?? workflow.workflow_data?.lease_id ?? null;
}

/**
 * Open workflows keyed by lease id. Prefers an awaiting-service row when two exist.
 * @param {object[]} workflows
 * @returns {Map<string, object>}
 */
export function openWorkflowsByLeaseId(workflows) {
  const map = new Map();
  for (const workflow of workflows || []) {
    const leaseId = workflowLeaseId(workflow);
    if (leaseId == null || leaseId === '') continue;
    const key = String(leaseId);
    const previous = map.get(key);
    if (
      !previous ||
      (isAwaitingNoticeService(workflow) && !isAwaitingNoticeService(previous))
    ) {
      map.set(key, workflow);
    }
  }
  return map;
}

export const NOTICE_PICKER_GROUP_RECORD_SERVICE = 'record_service';
export const NOTICE_PICKER_GROUP_GENERATE = 'generate';

/**
 * Badge/group for Select Lease: record service vs generate/continue a notice.
 * @param {object|null|undefined} workflow
 * @returns {{ group: string, badge: string, badgeClass: string }|null}
 */
export function noticePickerAnnotation(workflow) {
  if (!workflow) return null;
  if (isAwaitingNoticeService(workflow)) {
    return {
      group: NOTICE_PICKER_GROUP_RECORD_SERVICE,
      badge: 'Record service',
      badgeClass: 'bg-amber-100 text-amber-800',
    };
  }
  return {
    group: NOTICE_PICKER_GROUP_GENERATE,
    badge: 'In progress',
    badgeClass: 'bg-blue-100 text-blue-800',
  };
}

function capitalizeNoticeKind(kind) {
  const text = String(kind || '').trim();
  if (!text) return 'Notice';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
