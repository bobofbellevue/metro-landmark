/**
 * Operator payment ledger helpers (roadmap E4).
 *
 * Records charges and receipts against a lease. Type and method lists ship
 * with product defaults; a company can add more. Online card collection via
 * Stripe is optional.
 */
import { formatPeriodRangeLabel } from './payment-periods.js';
import { isCompleteWorkflowDate, toWorkflowDateString } from './workflow-date.js';

export const PAYMENT_TYPES = Object.freeze([
  { id: 'rent', label: 'Rent' },
  { id: 'prorated_rent', label: 'Prorated rent' },
  { id: 'security_deposit', label: 'Security deposit' },
  { id: 'pet_deposit', label: 'Pet deposit' },
  { id: 'last_month_rent', label: 'Last month rent' },
  { id: 'late_fee', label: 'Late fee' },
  { id: 'nsf_fee', label: 'NSF / returned-payment fee' },
  { id: 'fee', label: 'Fee' },
  { id: 'parking', label: 'Parking' },
  { id: 'storage', label: 'Storage' },
  { id: 'utility', label: 'Utility' },
  { id: 'application_fee', label: 'Application fee' },
  { id: 'hold_deposit', label: 'Hold / reservation deposit' },
  { id: 'other', label: 'Other' },
]);

/** @deprecated use PAYMENT_TYPES */
export const PAYMENT_KINDS = PAYMENT_TYPES;

export const PAYMENT_STATUSES = Object.freeze([
  { id: 'due', label: 'Due' },
  { id: 'paid', label: 'Paid' },
  { id: 'void', label: 'Void' },
]);

export const PAYMENT_METHODS = Object.freeze([
  { id: 'cash', label: 'Cash' },
  { id: 'check', label: 'Check' },
  { id: 'money_order', label: 'Money order' },
  { id: 'cashiers_check', label: "Cashier's check" },
  { id: 'ach', label: 'ACH / bank transfer' },
  { id: 'card', label: 'Card' },
  { id: 'online', label: 'Online' },
  { id: 'wire', label: 'Wire' },
  { id: 'other', label: 'Other' },
]);

export const PAYMENT_TYPE_ALIASES = Object.freeze({
  deposit: 'security_deposit',
});

export const MEMO_MAX_LENGTH = 10000;

const STATUS_IDS = new Set(PAYMENT_STATUSES.map((item) => item.id));
const CATALOG_CODE = /^[a-z][a-z0-9_]{0,63}$/;

const VIEW_ROLES = new Set([
  'global_admin',
  'company_admin',
  'manager',
  'landlord',
]);

const EDIT_ROLES = new Set(['global_admin', 'company_admin', 'manager']);
const CATALOG_EDIT_ROLES = new Set(['global_admin', 'company_admin', 'manager']);

export function canViewPayments(role) {
  return VIEW_ROLES.has(role);
}

export function canEditPayments(role) {
  return EDIT_ROLES.has(role);
}

export function canEditPaymentCatalog(role) {
  return CATALOG_EDIT_ROLES.has(role);
}

export function isPaymentStatus(value) {
  return STATUS_IDS.has(value);
}

export function isCatalogCode(value) {
  return typeof value === 'string' && CATALOG_CODE.test(value);
}

export function catalogCodeFromLabel(label) {
  const slug = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug || !isCatalogCode(slug)) return null;
  return slug.slice(0, 64);
}

export function normalizeTypeCode(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const aliased = PAYMENT_TYPE_ALIASES[raw] || raw;
  return isCatalogCode(aliased) ? aliased : null;
}

export function isPaymentKind(value) {
  return Boolean(normalizeTypeCode(value));
}

export function isPaymentMethod(value) {
  return isCatalogCode(value);
}

function labelFromList(list, id) {
  return (list || []).find((item) => item.id === id)?.label || id || '';
}

export function paymentKindLabel(kind, types = PAYMENT_TYPES) {
  const id = normalizeTypeCode(kind) || kind;
  return labelFromList(types, id) || labelFromList(PAYMENT_TYPES, id);
}

export function paymentStatusLabel(status) {
  return PAYMENT_STATUSES.find((item) => item.id === status)?.label || status || '';
}

export function paymentMethodLabel(method, methods = PAYMENT_METHODS) {
  return labelFromList(methods, method) || labelFromList(PAYMENT_METHODS, method);
}

export function parsePaymentAmount(raw) {
  if (raw == null || raw === '') return null;
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num) || num <= 0 || num > 1e8) return null;
  return Math.round(num * 100) / 100;
}

export function defaultAmountForKind(lease, kind) {
  if (!lease) return null;
  const type = normalizeTypeCode(kind) || kind;
  if (type === 'rent' || type === 'prorated_rent' || type === 'last_month_rent') {
    return parsePaymentAmount(lease.monthly_rent_amount);
  }
  if (type === 'security_deposit' || type === 'deposit' || type === 'hold_deposit') {
    return parsePaymentAmount(lease.security_deposit_amount);
  }
  if (type === 'pet_deposit') {
    return parsePaymentAmount(lease.pet_deposit_amount);
  }
  if (type === 'late_fee' || type === 'nsf_fee' || type === 'fee') {
    return parsePaymentAmount(lease.other_fee_amount);
  }
  return null;
}

export function currentRentPeriodLabel(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function normalizePeriodLabel(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.length > 80) return null;
  if (!/^[0-9A-Za-z][0-9A-Za-z .–—\-/]*$/.test(text)) return null;
  return text;
}

export function normalizeMemo(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  return text.slice(0, MEMO_MAX_LENGTH);
}

export function stripeSecretKey(env = process.env) {
  const key = env?.STRIPE_SECRET_KEY || env?.STRIPE_API_KEY;
  if (!key) return null;
  const text = String(key).trim();
  return text.startsWith('sk_') ? text : null;
}

export function stripeOnlineEnabled(env = process.env) {
  return Boolean(stripeSecretKey(env));
}

/** Columns added after 017; safe to omit on older databases. */
export const OPTIONAL_PAYMENT_WRITE_COLUMNS = Object.freeze([
  'receipt_date',
  'period_start',
  'period_end',
  'document_id',
]);

function errorMessage(error) {
  return String(error?.message || error || '');
}

/**
 * True only when the payments relation itself is missing — not when a
 * later column is absent from the PostgREST schema cache.
 */
export function missingPaymentsTable(error) {
  const message = errorMessage(error);
  return (
    /relation ["']?payments["']? does not exist/i.test(message) ||
    /could not find the table ['"]public\.payments['"] in the schema cache/i.test(message) ||
    /could not find the ['"]payments['"] table in the schema cache/i.test(message)
  );
}

export function missingPaymentsColumn(error) {
  const message = errorMessage(error);
  if (/could not find the ['"][^'"]+['"] column of ['"]payments['"]/i.test(message)) {
    return true;
  }
  return (
    /payments/i.test(message) &&
    /column/i.test(message) &&
    /schema cache|does not exist/i.test(message)
  );
}

export function paymentsCheckConstraintError(error) {
  return /payments_kind_check|payments_method_check/i.test(errorMessage(error));
}

export function paymentColumnFromSchemaError(error) {
  const match = errorMessage(error).match(/could not find the ['"]([^'"]+)['"] column/i);
  return match ? match[1] : null;
}

export function paymentsWriteErrorMessage(error) {
  if (missingPaymentsTable(error)) {
    return 'The payments table is not on this database yet. Run migration 017_payments.sql.';
  }
  if (paymentsCheckConstraintError(error)) {
    return 'This payments table still has the original type and method limits. Run migration 018_payment_ledger_ux.sql, then 019_payment_receipt_and_rls.sql.';
  }
  if (missingPaymentsColumn(error)) {
    const col = paymentColumnFromSchemaError(error) || '';
    const message = errorMessage(error);
    if (/receipt_date/i.test(col) || /receipt_date/i.test(message)) {
      return 'This database is missing the date-of-receipt column. Run migration 019_payment_receipt_and_rls.sql.';
    }
    if (
      /period_start|period_end|document_id/i.test(col) ||
      /period_start|period_end|document_id/i.test(message)
    ) {
      return 'This database is missing later payment ledger columns. Run migration 018_payment_ledger_ux.sql, then 019_payment_receipt_and_rls.sql.';
    }
    const raw = message.trim();
    return raw
      ? `${raw} If a listed column is missing, run migrations 018_payment_ledger_ux.sql and 019_payment_receipt_and_rls.sql.`
      : 'A payment column is missing from this database. Run migrations 018_payment_ledger_ux.sql and 019_payment_receipt_and_rls.sql.';
  }
  return errorMessage(error) || 'Failed to record payment.';
}

export function paymentsSchemaWarning(droppedColumns) {
  const dropped = (droppedColumns || []).filter(Boolean);
  if (dropped.includes('receipt_date')) {
    return 'Date of receipt was not saved because this database is missing that column. Run migration 019_payment_receipt_and_rls.sql.';
  }
  if (dropped.length) {
    return 'Some payment fields were not saved because this database is missing later ledger columns. Run migration 018_payment_ledger_ux.sql, then 019_payment_receipt_and_rls.sql.';
  }
  return null;
}

function parseOptionalDate(raw, fieldLabel) {
  if (raw == null || raw === '') return { ok: true, value: null };
  const iso = toWorkflowDateString(raw);
  if (!isCompleteWorkflowDate(iso)) {
    return { ok: false, error: `${fieldLabel} is not a valid calendar date.` };
  }
  return { ok: true, value: iso };
}

/**
 * Merge product defaults with company catalog rows. Company rows with the same
 * code override the label; extra company codes are appended.
 */
export function mergePaymentCatalog(defaults, rows, category) {
  const base = (defaults || []).map((item) => ({ ...item, source: 'default' }));
  const byId = new Map(base.map((item) => [item.id, item]));
  for (const row of rows || []) {
    if (row.category && row.category !== category) continue;
    if (row.is_active === false) {
      byId.delete(row.code);
      continue;
    }
    const id = row.code || row.id;
    if (!isCatalogCode(id)) continue;
    const existing = byId.get(id);
    byId.set(id, {
      id,
      label: row.label || existing?.label || id,
      source: row.pmc_id == null ? 'default' : 'company',
    });
  }
  const defaultOrder = base.map((item) => item.id);
  const merged = [...byId.values()];
  merged.sort((a, b) => {
    const ai = defaultOrder.indexOf(a.id);
    const bi = defaultOrder.indexOf(b.id);
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return merged;
}

export function validatePaymentWrite(body = {}, options = {}) {
  const requireLease = options.requireLease !== false;
  const requireKind = options.requireKind !== false;
  const leaseId = parseInt(body.leaseId ?? body.lease_id, 10);
  if (requireLease && !(Number.isInteger(leaseId) && leaseId > 0)) {
    return { ok: false, error: 'A lease is required.' };
  }

  const kind = normalizeTypeCode(body.type ?? body.kind);
  if (requireKind && !kind) {
    return { ok: false, error: 'A payment type is required.' };
  }
  if ((body.type ?? body.kind) && !kind) {
    return { ok: false, error: 'Type must be a short code such as rent or late_fee.' };
  }

  let amount;
  if (body.amount !== undefined) {
    amount = parsePaymentAmount(body.amount);
    if (amount == null) {
      return { ok: false, error: 'Amount must be a positive number.' };
    }
  } else if (options.requireAmount) {
    return { ok: false, error: 'Amount must be a positive number.' };
  }

  const statusRaw = body.status != null ? String(body.status) : 'due';
  if (!isPaymentStatus(statusRaw)) {
    return { ok: false, error: 'Status must be due, paid, or void.' };
  }

  let method = null;
  if (body.method != null && String(body.method).trim() !== '') {
    method = String(body.method).trim();
    if (!isPaymentMethod(method)) {
      return { ok: false, error: 'Method must be a short code such as cash, check, or ach.' };
    }
  }
  if (statusRaw === 'paid' && !method && options.requireMethodWhenPaid !== false) {
    return { ok: false, error: 'A payment method is required when marking a charge paid.' };
  }

  const startParsed = parseOptionalDate(
    body.periodStart ?? body.period_start,
    'Period start'
  );
  if (!startParsed.ok) return startParsed;
  const endParsed = parseOptionalDate(body.periodEnd ?? body.period_end, 'Period end');
  if (!endParsed.ok) return endParsed;
  if (startParsed.value && endParsed.value && startParsed.value > endParsed.value) {
    return { ok: false, error: 'Period start must be on or before period end.' };
  }

  const receiptParsed = parseOptionalDate(
    body.receiptDate ?? body.receipt_date,
    'Date of receipt'
  );
  if (!receiptParsed.ok) return receiptParsed;

  let periodLabel = normalizePeriodLabel(body.periodLabel ?? body.period_label);
  if ((body.periodLabel ?? body.period_label) && periodLabel == null) {
    return { ok: false, error: 'Period label is too long or uses characters that are not allowed.' };
  }
  if (!periodLabel && startParsed.value && endParsed.value) {
    periodLabel = formatPeriodRangeLabel(startParsed.value, endParsed.value);
  }

  const memo = normalizeMemo(body.memo);
  const documentIdRaw = parseInt(body.documentId ?? body.document_id, 10);
  const documentId =
    Number.isInteger(documentIdRaw) && documentIdRaw > 0 ? documentIdRaw : null;

  return {
    ok: true,
    value: {
      leaseId: Number.isInteger(leaseId) && leaseId > 0 ? leaseId : null,
      kind,
      amount: amount ?? null,
      status: statusRaw,
      method,
      periodLabel,
      periodStart: startParsed.value,
      periodEnd: endParsed.value,
      receiptDate: receiptParsed.value,
      memo,
      documentId,
      collectOnline: Boolean(body.collectOnline ?? body.collect_online),
    },
  };
}

export function leaseLabelFromParts({ propertyName, unitNumber, tenantNames } = {}) {
  const property = (propertyName || '').trim() || 'Property';
  const unit =
    unitNumber != null && String(unitNumber).trim() !== ''
      ? `Unit ${String(unitNumber).trim()}`
      : null;
  const tenants = (tenantNames || '').trim();
  return [property, unit, tenants].filter(Boolean).join(' · ');
}

export function publicPayment(row, lease = {}, lists = {}) {
  if (!row) return null;
  const propertyName = lease.propertyName ?? lease.property_name ?? null;
  const unitNumber = lease.unitNumber ?? lease.unit_number ?? null;
  const tenantNames = lease.tenantNames ?? lease.tenant_names ?? null;
  const types = lists.types || PAYMENT_TYPES;
  const methods = lists.methods || PAYMENT_METHODS;
  const periodStart = row.period_start || null;
  const periodEnd = row.period_end || null;
  const periodLabel =
    row.period_label ||
    (periodStart && periodEnd ? formatPeriodRangeLabel(periodStart, periodEnd) : null);
  return {
    paymentId: row.payment_id,
    pmcId: row.pmc_id ?? null,
    leaseId: row.lease_id,
    kind: row.kind,
    type: row.kind,
    kindLabel: paymentKindLabel(row.kind, types),
    typeLabel: paymentKindLabel(row.kind, types),
    amount: row.amount != null ? Number(row.amount) : null,
    dueDate: row.due_date || null,
    receiptDate: row.receipt_date || null,
    paidAt: row.paid_at || null,
    method: row.method || null,
    methodLabel: paymentMethodLabel(row.method, methods),
    status: row.status,
    statusLabel: paymentStatusLabel(row.status),
    memo: row.memo || null,
    periodLabel,
    periodStart,
    periodEnd,
    documentId: row.document_id || null,
    documentName: lease.documentName || row.document_name || null,
    stripeCheckoutSessionId: row.stripe_checkout_session_id || null,
    checkoutUrl: row.checkout_url || null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    propertyName,
    unitNumber,
    tenantNames,
    leaseLabel: leaseLabelFromParts({ propertyName, unitNumber, tenantNames }),
  };
}

export function summarizePayments(payments = []) {
  return (payments || []).reduce(
    (acc, row) => {
      const amount = Number(row.amount) || 0;
      if (row.status === 'due') {
        acc.dueCount += 1;
        acc.dueAmount += amount;
      } else if (row.status === 'paid') {
        acc.paidCount += 1;
        acc.paidAmount += amount;
      }
      return acc;
    },
    { dueCount: 0, dueAmount: 0, paidCount: 0, paidAmount: 0 }
  );
}

export function paymentSearchHaystack(payment) {
  return [
    payment.leaseLabel,
    payment.propertyName,
    payment.unitNumber,
    payment.tenantNames,
    payment.kindLabel,
    payment.typeLabel,
    payment.methodLabel,
    payment.statusLabel,
    payment.memo,
    payment.periodLabel,
    payment.documentName,
    payment.dueDate,
    payment.receiptDate,
    payment.amount != null ? String(payment.amount) : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterPaymentsBySearch(payments, searchTerm) {
  const list = Array.isArray(payments) ? payments : [];
  const q = String(searchTerm || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((payment) => paymentSearchHaystack(payment).includes(q));
}
