/* eslint-env node */
/**
 * Operator payment ledger.
 *
 * GET  /api/payments
 * POST /api/payments   create (optional Stripe Checkout when collectOnline)
 * PUT  /api/payments   mark paid / void / update memo
 */
import { createSupabaseClient } from './utils/supabase-client.js';
import { createCheckoutSession, appOriginFromRequest } from './utils/stripe-checkout.js';
import {
  toWorkflowDateString,
  isCompleteWorkflowDate,
  todayWorkflowDate,
} from '../src/utils/workflow-date.js';
import { brand } from './utils/brand.js';
import {
  OPTIONAL_PAYMENT_WRITE_COLUMNS,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  canEditPaymentCatalog,
  canEditPayments,
  canViewPayments,
  mergePaymentCatalog,
  missingPaymentsColumn,
  missingPaymentsTable,
  paymentColumnFromSchemaError,
  paymentsSchemaWarning,
  paymentsWriteErrorMessage,
  publicPayment,
  stripeOnlineEnabled,
  stripeSecretKey,
  summarizePayments,
  validatePaymentWrite,
} from '../src/utils/payments.js';

export function parseUserIdHeader(headers = {}) {
  const n = parseInt(headers['x-user-id'], 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function writePaymentRow(supabase, action, row, matchId = null) {
  const attempt = { ...row };
  const dropped = [];
  for (let i = 0; i <= OPTIONAL_PAYMENT_WRITE_COLUMNS.length; i += 1) {
    let query =
      action === 'insert'
        ? supabase.from('payments').insert(attempt)
        : supabase.from('payments').update(attempt).eq('payment_id', matchId);
    const { data, error } = await query.select('*').maybeSingle();
    if (!error) return { data, error: null, dropped };
    if (missingPaymentsTable(error) || !missingPaymentsColumn(error)) {
      return { data: null, error, dropped };
    }
    const col =
      paymentColumnFromSchemaError(error) ||
      OPTIONAL_PAYMENT_WRITE_COLUMNS.find((name) =>
        new RegExp(`\\b${name}\\b`, 'i').test(String(error?.message || ''))
      );
    if (!col || !Object.prototype.hasOwnProperty.call(attempt, col)) {
      return { data: null, error, dropped };
    }
    delete attempt[col];
    dropped.push(col);
  }
  return {
    data: null,
    error: { message: 'Could not save this payment after omitting missing columns.' },
    dropped,
  };
}

async function loadUser(supabase, userId) {
  const { data, error } = await supabase
    .from('users')
    .select('user_id, pmc_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function landlordIdForUser(supabase, userId) {
  const { data } = await supabase
    .from('landlords')
    .select('landlord_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.landlord_id ?? null;
}

async function loadLease(supabase, leaseId) {
  const { data, error } = await supabase
    .from('leases')
    .select(
      'lease_id, pmc_id, landlord_id, unit_id, monthly_rent_amount, security_deposit_amount, pet_deposit_amount, other_fee_amount, start_date, end_date, status'
    )
    .eq('lease_id', leaseId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function pmcIdForUnit(supabase, unitId) {
  if (!unitId) return null;
  const { data: unit } = await supabase
    .from('units')
    .select('property_id')
    .eq('unit_id', unitId)
    .maybeSingle();
  if (!unit?.property_id) return null;
  const { data: property } = await supabase
    .from('properties')
    .select('pmc_id, landlord_id, property_name')
    .eq('property_id', unit.property_id)
    .maybeSingle();
  return property || null;
}

function leaseAccessible(user, lease, property, landlordId) {
  if (user.role === 'global_admin') return true;
  if (user.role === 'landlord') {
    const leaseLandlord = lease?.landlord_id ?? property?.landlord_id ?? null;
    return landlordId != null && leaseLandlord === landlordId;
  }
  const pmcId = lease?.pmc_id ?? property?.pmc_id ?? null;
  if (user.pmc_id && pmcId && Number(pmcId) !== Number(user.pmc_id)) return false;
  if (user.pmc_id && !pmcId) return false;
  return Boolean(user.pmc_id);
}

async function loadCatalogLists(supabase, pmcId) {
  try {
    let query = supabase
      .from('payment_catalog')
      .select('payment_catalog_id, pmc_id, category, code, label, sort_order, is_active')
      .eq('is_active', true);
    if (pmcId != null) {
      query = query.or(`pmc_id.eq.${pmcId},pmc_id.is.null`);
    } else {
      query = query.is('pmc_id', null);
    }
    const { data, error } = await query;
    if (error) return { types: PAYMENT_TYPES, methods: PAYMENT_METHODS };
    return {
      types: mergePaymentCatalog(PAYMENT_TYPES, data, 'type'),
      methods: mergePaymentCatalog(PAYMENT_METHODS, data, 'method'),
    };
  } catch {
    return { types: PAYMENT_TYPES, methods: PAYMENT_METHODS };
  }
}

async function enrichPayments(supabase, rows, lists = {}) {
  const payments = rows || [];
  if (payments.length === 0) return [];

  const leaseIds = [...new Set(payments.map((row) => row.lease_id).filter(Boolean))];
  const { data: leases } = await supabase
    .from('leases')
    .select('lease_id, unit_id, pmc_id, landlord_id')
    .in('lease_id', leaseIds);

  const leaseList = leases || [];
  const unitIds = [...new Set(leaseList.map((row) => row.unit_id).filter(Boolean))];
  const { data: units } = unitIds.length
    ? await supabase
        .from('units')
        .select('unit_id, unit_number, property_id')
        .in('unit_id', unitIds)
    : { data: [] };

  const unitList = units || [];
  const propertyIds = [...new Set(unitList.map((row) => row.property_id).filter(Boolean))];
  const { data: properties } = propertyIds.length
    ? await supabase
        .from('properties')
        .select('property_id, property_name, pmc_id, landlord_id')
        .in('property_id', propertyIds)
    : { data: [] };

  let { data: leaseClients, error: leaseClientError } = await supabase
    .from('lease_clients')
    .select('lease_id, client_id, clients(client_id, user_id)')
    .in('lease_id', leaseIds);
  if (leaseClientError) {
    ({ data: leaseClients } = await supabase
      .from('lease_clients')
      .select('lease_id, client_id')
      .in('lease_id', leaseIds));
  }

  const refs = (leaseClients || []).flatMap((row) => {
    const client = row.clients;
    const list = Array.isArray(client) ? client : client ? [client] : [];
    if (list.length === 0) {
      return [{ lease_id: row.lease_id, client_id: row.client_id, user_id: null }];
    }
    return list.map((c) => ({
      lease_id: row.lease_id,
      client_id: c.client_id ?? row.client_id,
      user_id: c.user_id ?? null,
    }));
  });
  const contactableIds = [
    ...new Set(
      refs.flatMap((ref) => [ref.client_id, ref.user_id]).filter((id) => id != null)
    ),
  ];
  const { data: contacts } = contactableIds.length
    ? await supabase
        .from('contacts')
        .select('contactable_id, first_name, last_name')
        .eq('contactable_type', 'client')
        .in('contactable_id', contactableIds)
    : { data: [] };

  const contactById = new Map(
    (contacts || []).map((c) => [Number(c.contactable_id), c])
  );
  const tenantsByLease = new Map();
  for (const ref of refs) {
    const contact =
      contactById.get(Number(ref.user_id)) || contactById.get(Number(ref.client_id));
    const name = contact
      ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim()
      : '';
    if (!name) continue;
    const existing = tenantsByLease.get(ref.lease_id) || [];
    if (!existing.includes(name)) existing.push(name);
    tenantsByLease.set(ref.lease_id, existing);
  }

  const unitById = new Map(unitList.map((u) => [u.unit_id, u]));
  const propertyById = new Map((properties || []).map((p) => [p.property_id, p]));
  const leaseById = new Map(leaseList.map((l) => [l.lease_id, l]));

  const documentIds = [
    ...new Set(payments.map((row) => row.document_id).filter(Boolean)),
  ];
  const { data: documents } = documentIds.length
    ? await supabase
        .from('documents')
        .select('document_id, document_name, file_name')
        .in('document_id', documentIds)
    : { data: [] };
  const documentById = new Map((documents || []).map((d) => [d.document_id, d]));

  return payments.map((row) => {
    const lease = leaseById.get(row.lease_id);
    const unit = lease ? unitById.get(lease.unit_id) : null;
    const property = unit ? propertyById.get(unit.property_id) : null;
    const document = documentById.get(row.document_id);
    return publicPayment(
      row,
      {
        propertyName: property?.property_name || null,
        unitNumber: unit?.unit_number ?? null,
        tenantNames: (tenantsByLease.get(row.lease_id) || []).join(', ') || null,
        documentName: document?.file_name || document?.document_name || null,
      },
      lists
    );
  });
}

async function listScopedPayments(supabase, user, query = {}) {
  let q = supabase
    .from('payments')
    .select('*')
    .order('due_date', { ascending: false });

  if (query.status && query.status !== 'all') {
    q = q.eq('status', query.status);
  }
  if (query.kind && query.kind !== 'all') {
    q = q.eq('kind', query.kind);
  }
  if (query.lease_id || query.leaseId) {
    q = q.eq('lease_id', Number(query.lease_id || query.leaseId));
  }

  if (user.role === 'landlord') {
    const landlordId = await landlordIdForUser(supabase, user.user_id);
    if (!landlordId) return [];
    const { data: leases } = await supabase
      .from('leases')
      .select('lease_id, landlord_id, unit_id')
      .eq('landlord_id', landlordId);
    let leaseIds = (leases || []).map((l) => l.lease_id);
    if (leaseIds.length === 0) {
      const { data: properties } = await supabase
        .from('properties')
        .select('property_id')
        .eq('landlord_id', landlordId);
      const propertyIds = (properties || []).map((p) => p.property_id);
      if (propertyIds.length === 0) return [];
      const { data: units } = await supabase
        .from('units')
        .select('unit_id')
        .in('property_id', propertyIds);
      const unitIds = (units || []).map((u) => u.unit_id);
      if (unitIds.length === 0) return [];
      const { data: unitLeases } = await supabase
        .from('leases')
        .select('lease_id')
        .in('unit_id', unitIds);
      leaseIds = (unitLeases || []).map((l) => l.lease_id);
    }
    if (leaseIds.length === 0) return [];
    q = q.in('lease_id', leaseIds);
  } else if (user.role !== 'global_admin') {
    if (!user.pmc_id) return [];
    q = q.eq('pmc_id', user.pmc_id);
  }

  const { data, error } = await q;
  if (error) {
    if (missingPaymentsTable(error)) return [];
    throw new Error(paymentsWriteErrorMessage(error));
  }
  return enrichPayments(supabase, data || [], await loadCatalogLists(supabase, user.pmc_id));
}

async function maybeCheckout(req, paymentRow, publicRow) {
  if (!paymentRow) return { payment: publicRow };
  const origin = appOriginFromRequest(req);
  const productName = `${brand.productName} ${publicRow.kindLabel || 'payment'}`;
  const result = await createCheckoutSession({
    secretKey: stripeSecretKey(),
    payment: {
      ...publicRow,
      amount: publicRow.amount,
      productName,
    },
    successUrl: `${origin}/?payments=success`,
    cancelUrl: `${origin}/?payments=cancel`,
  });
  if (!result.ok) {
    return { payment: publicRow, checkoutError: result.error };
  }
  return {
    payment: { ...publicRow, stripeCheckoutSessionId: result.sessionId, checkoutUrl: result.checkoutUrl },
    checkoutUrl: result.checkoutUrl,
    stripeCheckoutSessionId: result.sessionId,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-user-id, x-user-role'
  );
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!['GET', 'POST', 'PUT'].includes(req.method)) {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Database configuration error',
    });
    return;
  }

  try {
    const userId = parseUserIdHeader(req.headers);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const user = await loadUser(supabase, userId);
    if (!user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    if (!canViewPayments(user.role)) {
      res.status(403).json({ success: false, error: 'Payments are not available for this role.' });
      return;
    }

    const canEdit = canEditPayments(user.role);
    const catalog = await loadCatalogLists(supabase, user.pmc_id);

    if (req.method === 'GET') {
      const payments = await listScopedPayments(supabase, user, req.query || {});
      res.status(200).json({
        success: true,
        payments,
        summary: summarizePayments(payments),
        types: catalog.types,
        methods: catalog.methods,
        onlinePaymentsEnabled: stripeOnlineEnabled(),
        canEdit,
        canEditCatalog: canEditPaymentCatalog(user.role),
      });
      return;
    }

    if (!canEdit) {
      res.status(403).json({
        success: false,
        error: 'Manager or company admin privileges are required to record payments.',
      });
      return;
    }

    if (req.method === 'POST') {
      const parsed = validatePaymentWrite(req.body || {}, {
        requireLease: true,
        requireKind: true,
        requireAmount: true,
      });
      if (!parsed.ok) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }

      const dueRaw = req.body?.dueDate ?? req.body?.due_date;
      let dueDate = null;
      if (dueRaw) {
        const iso = toWorkflowDateString(dueRaw);
        if (!isCompleteWorkflowDate(iso)) {
          res.status(400).json({ success: false, error: 'Due date is not a valid calendar date.' });
          return;
        }
        dueDate = iso;
      }

      const lease = await loadLease(supabase, parsed.value.leaseId);
      if (!lease) {
        res.status(404).json({ success: false, error: 'Lease not found.' });
        return;
      }
      const property = await pmcIdForUnit(supabase, lease.unit_id);
      const landlordId =
        user.role === 'landlord' ? await landlordIdForUser(supabase, user.user_id) : null;
      if (!leaseAccessible(user, lease, property, landlordId)) {
        res.status(403).json({ success: false, error: 'That lease is not in this company.' });
        return;
      }

      const pmcId = lease.pmc_id || property?.pmc_id || user.pmc_id || null;
      const paidAt =
        parsed.value.status === 'paid'
          ? new Date().toISOString()
          : null;

      if (parsed.value.collectOnline && !stripeOnlineEnabled()) {
        res.status(400).json({
          success: false,
          error:
            'Stripe is not configured on this deploy. Record cash, check, ACH, or card instead.',
          onlinePaymentsEnabled: false,
        });
        return;
      }

      const row = {
        pmc_id: pmcId,
        lease_id: parsed.value.leaseId,
        kind: parsed.value.kind,
        amount: parsed.value.amount,
        due_date: dueDate,
        paid_at: paidAt,
        receipt_date:
          parsed.value.status === 'paid'
            ? parsed.value.receiptDate || todayWorkflowDate()
            : null,
        method: parsed.value.method,
        status: parsed.value.status,
        memo: parsed.value.memo,
        period_label: parsed.value.periodLabel,
        period_start: parsed.value.periodStart,
        period_end: parsed.value.periodEnd,
        document_id: parsed.value.documentId,
        created_by: user.user_id,
        updated_at: new Date().toISOString(),
      };

      const { data: created, error, dropped } = await writePaymentRow(
        supabase,
        'insert',
        row
      );

      if (error) {
        res.status(500).json({
          success: false,
          error: paymentsWriteErrorMessage(error),
        });
        return;
      }
      const schemaWarning = paymentsSchemaWarning(dropped);

      const [enriched] = await enrichPayments(
        supabase,
        created ? [created] : [],
        catalog
      );
      const publicRow = enriched || publicPayment(created, {}, catalog);

      if (parsed.value.collectOnline) {
        const checkout = await maybeCheckout(req, created, publicRow);
        if (checkout.stripeCheckoutSessionId) {
          await supabase
            .from('payments')
            .update({
              stripe_checkout_session_id: checkout.stripeCheckoutSessionId,
              updated_at: new Date().toISOString(),
            })
            .eq('payment_id', created.payment_id);
        }
        res.status(200).json({
          success: true,
          payment: checkout.payment,
          checkoutUrl: checkout.checkoutUrl || null,
          checkoutError: checkout.checkoutError || null,
          warning: schemaWarning,
          onlinePaymentsEnabled: true,
          canEdit: true,
        });
        return;
      }

      res.status(200).json({
        success: true,
        payment: publicRow,
        warning: schemaWarning,
        onlinePaymentsEnabled: stripeOnlineEnabled(),
        canEdit: true,
      });
      return;
    }

    const paymentId = parseInt(req.body?.paymentId ?? req.body?.payment_id, 10);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      res.status(400).json({ success: false, error: 'A payment id is required.' });
      return;
    }

    const { data: existing, error: loadError } = await supabase
      .from('payments')
      .select('*')
      .eq('payment_id', paymentId)
      .maybeSingle();

    if (loadError) {
      res.status(500).json({
        success: false,
        error: paymentsWriteErrorMessage(loadError),
      });
      return;
    }
    if (!existing) {
      res.status(404).json({ success: false, error: 'Payment not found.' });
      return;
    }

    if (user.role !== 'global_admin' && user.pmc_id && existing.pmc_id !== user.pmc_id) {
      res.status(403).json({ success: false, error: 'That payment is not in this company.' });
      return;
    }

    const nextStatus = req.body?.status != null ? String(req.body.status) : existing.status;
    const parsed = validatePaymentWrite(
      {
        leaseId: existing.lease_id,
        kind: req.body?.type ?? req.body?.kind ?? existing.kind,
        amount: req.body?.amount ?? existing.amount,
        status: nextStatus,
        method: req.body?.method ?? existing.method,
        memo: req.body?.memo ?? existing.memo,
        periodLabel: req.body?.periodLabel ?? req.body?.period_label ?? existing.period_label,
        periodStart: req.body?.periodStart ?? req.body?.period_start ?? existing.period_start,
        periodEnd: req.body?.periodEnd ?? req.body?.period_end ?? existing.period_end,
        documentId: req.body?.documentId ?? req.body?.document_id ?? existing.document_id,
        receiptDate: req.body?.receiptDate ?? req.body?.receipt_date ?? existing.receipt_date,
      },
      { requireLease: true, requireKind: true, requireAmount: true }
    );
    if (!parsed.ok) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }

    const patch = {
      kind: parsed.value.kind,
      amount: parsed.value.amount,
      status: parsed.value.status,
      method: parsed.value.method,
      memo: parsed.value.memo,
      period_label: parsed.value.periodLabel,
      period_start: parsed.value.periodStart,
      period_end: parsed.value.periodEnd,
      document_id: parsed.value.documentId,
      updated_at: new Date().toISOString(),
    };

    if (parsed.value.status === 'paid') {
      if (!existing.paid_at) {
        patch.paid_at = new Date().toISOString();
      }
      patch.receipt_date =
        parsed.value.receiptDate || existing.receipt_date || todayWorkflowDate();
    }
    if (parsed.value.status === 'due') {
      patch.paid_at = null;
      patch.receipt_date = null;
    }
    if (parsed.value.status === 'void') {
      patch.paid_at = existing.paid_at;
    }

    const dueRaw = req.body?.dueDate ?? req.body?.due_date;
    if (dueRaw !== undefined) {
      if (!dueRaw) {
        patch.due_date = null;
      } else {
        const iso = toWorkflowDateString(dueRaw);
        if (!isCompleteWorkflowDate(iso)) {
          res.status(400).json({ success: false, error: 'Due date is not a valid calendar date.' });
          return;
        }
        patch.due_date = iso;
      }
    }

    const { data: updated, error: updateError, dropped } = await writePaymentRow(
      supabase,
      'update',
      patch,
      paymentId
    );

    if (updateError) {
      res.status(500).json({
        success: false,
        error: paymentsWriteErrorMessage(updateError),
      });
      return;
    }

    const [enriched] = await enrichPayments(
      supabase,
      updated ? [updated] : [],
      catalog
    );
    res.status(200).json({
      success: true,
      payment: enriched || publicPayment(updated, {}, catalog),
      warning: paymentsSchemaWarning(dropped),
      onlinePaymentsEnabled: stripeOnlineEnabled(),
      canEdit: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load payments',
    });
  }
}
