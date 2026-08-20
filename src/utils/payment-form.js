import { formatWorkflowDateMMDDYYYY, todayWorkflowDate } from './workflow-date.js';
import { suggestedDueDate as dueFromPeriod, periodFromStart } from './payment-periods.js';

export const PAYMENT_FORM_FIELD_CLASS =
  'block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm';

export function emptyPaymentForm() {
  return {
    intent: 'charge',
    leaseId: null,
    lease: null,
    kind: 'rent',
    amount: null,
    dueDate: formatWorkflowDateMMDDYYYY(todayWorkflowDate()),
    receiptDate: formatWorkflowDateMMDDYYYY(todayWorkflowDate()),
    method: '',
    memo: '',
    periodKey: '',
    periodStart: '',
    periodEnd: '',
    collectOnline: false,
    proof: null,
  };
}

export function paymentFormFromRow(row) {
  return {
    intent: row.status === 'paid' ? 'received' : 'charge',
    leaseId: row.leaseId,
    lease: null,
    kind: row.kind || row.type || 'rent',
    amount: row.amount,
    dueDate: row.dueDate ? formatWorkflowDateMMDDYYYY(row.dueDate) : '',
    receiptDate: row.receiptDate
      ? formatWorkflowDateMMDDYYYY(row.receiptDate)
      : formatWorkflowDateMMDDYYYY(todayWorkflowDate()),
    method: row.method || '',
    memo: row.memo || '',
    periodKey: '',
    periodStart: row.periodStart ? formatWorkflowDateMMDDYYYY(row.periodStart) : '',
    periodEnd: row.periodEnd
      ? formatWorkflowDateMMDDYYYY(row.periodEnd)
      : row.periodStart
        ? formatWorkflowDateMMDDYYYY(periodFromStart(row.periodStart).end)
        : '',
    collectOnline: false,
    proof: row.documentId
      ? { document_id: row.documentId, file_name: row.documentName }
      : null,
  };
}

export function applyPeriodToPaymentForm(form, period) {
  if (!period) {
    return { ...form, periodKey: '', periodStart: '', periodEnd: '' };
  }
  const startIso = period.start;
  const endIso = period.end || (startIso ? periodFromStart(startIso).end : '');
  return {
    ...form,
    periodKey: period.id,
    periodStart: formatWorkflowDateMMDDYYYY(startIso),
    periodEnd: formatWorkflowDateMMDDYYYY(endIso),
    dueDate: formatWorkflowDateMMDDYYYY(dueFromPeriod(period)),
  };
}

export function paymentWritePayload(form, { includeLease = true, includeCollectOnline = false } = {}) {
  const status = form.intent === 'received' ? 'paid' : 'due';
  const payload = {
    type: form.kind,
    kind: form.kind,
    amount: form.amount,
    dueDate: form.dueDate,
    receiptDate: status === 'paid' ? form.receiptDate : null,
    method:
      status === 'paid' || form.collectOnline ? form.method || 'card' : form.method,
    status,
    memo: form.memo,
    periodStart: form.periodStart,
    periodEnd:
      form.periodEnd ||
      (form.periodStart
        ? formatWorkflowDateMMDDYYYY(periodFromStart(form.periodStart).end)
        : ''),
    documentId: form.proof?.document_id || null,
  };
  if (includeLease) payload.leaseId = form.leaseId;
  if (includeCollectOnline) {
    payload.collectOnline = form.collectOnline && status === 'due';
  }
  return payload;
}
