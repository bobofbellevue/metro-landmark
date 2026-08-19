/**
 * Operator payment ledger helpers (roadmap E4).
 *
 * Records rent, deposits, and fees against a lease. Online card collection
 * via Stripe is optional — the ledger works without Stripe keys.
 */

export const PAYMENT_KINDS = Object.freeze([
  { id: 'rent', label: 'Rent' },
  { id: 'deposit', label: 'Deposit' },
  { id: 'fee', label: 'Fee' },
  { id: 'other', label: 'Other' },
]);

export const PAYMENT_STATUSES = Object.freeze([
  { id: 'due', label: 'Due' },
  { id: 'paid', label: 'Paid' },
  { id: 'void', label: 'Void' },
]);

export const PAYMENT_METHODS = Object.freeze([
  { id: 'cash', label: 'Cash' },
  { id: 'check', label: 'Check' },
  { id: 'ach', label: 'ACH' },
  { id: 'card', label: 'Card' },
  { id: 'other', label: 'Other' },
]);

const KIND_IDS = new Set(PAYMENT_KINDS.map((item) => item.id));
const STATUS_IDS = new Set(PAYMENT_STATUSES.map((item) => item.id));
const METHOD_IDS = new Set(PAYMENT_METHODS.map((item) => item.id));

const VIEW_ROLES = new Set([
  'global_admin',
  'company_admin',
  'manager',
  'landlord',
]);

const EDIT_ROLES = new Set(['global_admin', 'company_admin', 'manager']);

export function isPaymentKind(value) {
  return KIND_IDS.has(value);
}

export function isPaymentStatus(value) {
  return STATUS_IDS.has(value);
}

export function isPaymentMethod(value) {
  return METHOD_IDS.has(value);
}

export function canViewPayments(role) {
  return VIEW_ROLES.has(role);
}

export function canEditPayments(role) {
  return EDIT_ROLES.has(role);
}

export function paymentKindLabel(kind) {
  return PAYMENT_KINDS.find((item) => item.id === kind)?.label || kind || '';
}

export function paymentStatusLabel(status) {
  return PAYMENT_STATUSES.find((item) => item.id === status)?.label || status || '';
}

export function paymentMethodLabel(method) {
  return PAYMENT_METHODS.find((item) => item.id === method)?.label || method || '';
}

/**
 * Parse a posted amount into a positive number with cents.
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parsePaymentAmount(raw) {
  if (raw == null || raw === '') return null;
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num) || num <= 0 || num > 1e8) return null;
  return Math.round(num * 100) / 100;
}

/**
 * Suggest an amount from the lease when the operator picks a kind.
 * @param {object|null|undefined} lease
 * @param {string} kind
 * @returns {number|null}
 */
export function defaultAmountForKind(lease, kind) {
  if (!lease) return null;
  if (kind === 'rent') return parsePaymentAmount(lease.monthly_rent_amount);
  if (kind === 'deposit') return parsePaymentAmount(lease.security_deposit_amount);
  if (kind === 'fee') return parsePaymentAmount(lease.other_fee_amount);
  return null;
}

/**
 * YYYY-MM period label for rent charges.
 * @param {Date} [now]
 * @returns {string}
 */
export function currentRentPeriodLabel(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function normalizePeriodLabel(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.length > 32) return null;
  if (!/^[0-9A-Za-z][0-9A-Za-z .\-/]*$/.test(text)) return null;
  return text;
}

export function normalizeMemo(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  return text.slice(0, 2000);
}

/**
 * Stripe Checkout is available when a secret key is set (sk_…).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function stripeSecretKey(env = process.env) {
  const key = env?.STRIPE_SECRET_KEY || env?.STRIPE_API_KEY;
  if (!key) return null;
  const text = String(key).trim();
  return text.startsWith('sk_') ? text : null;
}

export function stripeOnlineEnabled(env = process.env) {
  return Boolean(stripeSecretKey(env));
}

/**
 * Validate a create or update payload.
 * @param {object} body
 * @param {{ requireLease?: boolean, requireKind?: boolean }} [options]
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validatePaymentWrite(body = {}, options = {}) {
  const requireLease = options.requireLease !== false;
  const requireKind = options.requireKind !== false;
  const leaseId = parseInt(body.leaseId ?? body.lease_id, 10);
  if (requireLease && !(Number.isInteger(leaseId) && leaseId > 0)) {
    return { ok: false, error: 'A lease is required.' };
  }

  const kind = body.kind != null ? String(body.kind) : null;
  if (requireKind && !isPaymentKind(kind)) {
    return { ok: false, error: 'Kind must be rent, deposit, fee, or other.' };
  }
  if (kind != null && kind !== '' && !isPaymentKind(kind)) {
    return { ok: false, error: 'Kind must be rent, deposit, fee, or other.' };
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
    method = String(body.method);
    if (!isPaymentMethod(method)) {
      return { ok: false, error: 'Method must be cash, check, ACH, card, or other.' };
    }
  }
  if (statusRaw === 'paid' && !method && options.requireMethodWhenPaid !== false) {
    return { ok: false, error: 'A payment method is required when marking a charge paid.' };
  }

  const periodLabel = normalizePeriodLabel(body.periodLabel ?? body.period_label);
  if ((body.periodLabel ?? body.period_label) && periodLabel == null) {
    return { ok: false, error: 'Period label is too long or uses characters that are not allowed.' };
  }

  const memo = normalizeMemo(body.memo);

  return {
    ok: true,
    value: {
      leaseId: Number.isInteger(leaseId) && leaseId > 0 ? leaseId : null,
      kind: isPaymentKind(kind) ? kind : null,
      amount: amount ?? null,
      status: statusRaw,
      method,
      periodLabel,
      memo,
      collectOnline: Boolean(body.collectOnline ?? body.collect_online),
    },
  };
}

export function leaseLabelFromParts({ propertyName, unitNumber, tenantNames } = {}) {
  const property = (propertyName || '').trim() || 'Property';
  const unit = unitNumber != null && String(unitNumber).trim() !== ''
    ? `Unit ${String(unitNumber).trim()}`
    : null;
  const tenants = (tenantNames || '').trim();
  return [property, unit, tenants].filter(Boolean).join(' · ');
}

/**
 * Public JSON for a ledger row.
 * @param {object} row
 * @param {object} [lease]
 */
export function publicPayment(row, lease = {}) {
  if (!row) return null;
  const propertyName = lease.propertyName ?? lease.property_name ?? null;
  const unitNumber = lease.unitNumber ?? lease.unit_number ?? null;
  const tenantNames = lease.tenantNames ?? lease.tenant_names ?? null;
  return {
    paymentId: row.payment_id,
    pmcId: row.pmc_id ?? null,
    leaseId: row.lease_id,
    kind: row.kind,
    kindLabel: paymentKindLabel(row.kind),
    amount: row.amount != null ? Number(row.amount) : null,
    dueDate: row.due_date || null,
    paidAt: row.paid_at || null,
    method: row.method || null,
    methodLabel: paymentMethodLabel(row.method),
    status: row.status,
    statusLabel: paymentStatusLabel(row.status),
    memo: row.memo || null,
    periodLabel: row.period_label || null,
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
    payment.methodLabel,
    payment.statusLabel,
    payment.memo,
    payment.periodLabel,
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
