import React, { useContext, useEffect, useMemo, useState } from 'react';
import { DollarSign } from 'lucide-react';
import { AuthContext } from '../contexts';
import { api } from '../api';
import { Card } from '../components/ui';
import CurrencyInput, { formatCurrencyDisplay } from '../components/CurrencyInput';
import DateInput from '../components/DateInput';
import LeaseSelectionPicker from '../components/LeaseSelectionPicker';
import WorkflowFileField from '../components/WorkflowFileField';
import { formatDateTime, localeContextFromBrowser } from '../config/locale.js';
import {
  formatWorkflowDateMMDDYYYY,
  todayWorkflowDate,
} from '../utils/workflow-date.js';
import {
  MEMO_MAX_LENGTH,
  PAYMENT_METHODS as DEFAULT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES as DEFAULT_TYPES,
  defaultAmountForKind,
  filterPaymentsBySearch,
  summarizePayments,
} from '../utils/payments.js';
import {
  currentLeasePeriod as currentPeriod,
  leaseAlignedPeriods as leasePeriods,
  suggestedDueDate as dueFromPeriod,
} from '../utils/payment-periods.js';
import { PROOF_OF_SERVICE_ACCEPT } from '../utils/proof-of-service-file.js';

const PROOF_OF_PAYMENT_TYPE = 'proof_of_payment';

const emptyForm = () => ({
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
});

function statusClass(status) {
  if (status === 'paid') return 'bg-green-100 text-green-800';
  if (status === 'void') return 'bg-gray-100 text-gray-600';
  return 'bg-amber-100 text-amber-800';
}

function applyPeriodToForm(form, period) {
  if (!period) {
    return { ...form, periodKey: '', periodStart: '', periodEnd: '' };
  }
  return {
    ...form,
    periodKey: period.id,
    periodStart: formatWorkflowDateMMDDYYYY(period.start),
    periodEnd: formatWorkflowDateMMDDYYYY(period.end),
    dueDate: formatWorkflowDateMMDDYYYY(dueFromPeriod(period)),
  };
}

export default function PaymentsPage() {
  const { user } = useContext(AuthContext);
  const locale = localeContextFromBrowser();
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState(summarizePayments([]));
  const [types, setTypes] = useState(DEFAULT_TYPES);
  const [methods, setMethods] = useState(DEFAULT_METHODS);
  const [canEdit, setCanEdit] = useState(false);
  const [canEditCatalog, setCanEditCatalog] = useState(false);
  const [onlinePaymentsEnabled, setOnlinePaymentsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [addingCategory, setAddingCategory] = useState('');
  const [newCatalogLabel, setNewCatalogLabel] = useState('');

  const periods = useMemo(
    () => (form.lease ? leasePeriods(form.lease) : []),
    [form.lease]
  );

  const load = async () => {
    if (!user?.user_id) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (kindFilter !== 'all') params.set('kind', kindFilter);
      const qs = params.toString();
      const data = await api.get(`/payments${qs ? `?${qs}` : ''}`, user);
      if (!data?.success) {
        setError(data?.error || 'Could not load payments.');
        setPayments([]);
        return;
      }
      setPayments(data.payments || []);
      setSummary(data.summary || summarizePayments(data.payments || []));
      if (data.types?.length) setTypes(data.types);
      if (data.methods?.length) setMethods(data.methods);
      setCanEdit(Boolean(data.canEdit));
      setCanEditCatalog(Boolean(data.canEditCatalog));
      setOnlinePaymentsEnabled(Boolean(data.onlinePaymentsEnabled));
    } catch {
      setError('Could not load payments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id, statusFilter, kindFilter]);

  const visible = useMemo(
    () => filterPaymentsBySearch(payments, searchTerm),
    [payments, searchTerm]
  );

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSuccess('');
    setCheckoutUrl('');
  };

  const handleLeaseChange = (leaseId, lease) => {
    setForm((prev) => {
      const nextKind = prev.kind || 'rent';
      const suggested = defaultAmountForKind(lease, nextKind);
      const keepAmount =
        prev.amount != null &&
        suggested != null &&
        Number(prev.amount) !== Number(defaultAmountForKind(prev.lease, nextKind));
      const next = {
        ...prev,
        leaseId,
        lease,
        amount: keepAmount ? prev.amount : suggested,
      };
      const period = currentPeriod(leasePeriods(lease));
      return applyPeriodToForm(next, period);
    });
    setSuccess('');
  };

  const handleKindChange = (kind) => {
    setForm((prev) => ({
      ...prev,
      kind,
      amount: defaultAmountForKind(prev.lease, kind) ?? prev.amount,
    }));
  };

  const handlePeriodKeyChange = (key) => {
    if (!key) {
      setForm((prev) => ({ ...prev, periodKey: '' }));
      return;
    }
    const period = periods.find((p) => p.id === key);
    setForm((prev) => applyPeriodToForm(prev, period));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError('');
    setSuccess('');
    setCheckoutUrl('');
    const status = form.intent === 'received' ? 'paid' : 'due';
    try {
      const data = await api.post(
        '/payments',
        {
          leaseId: form.leaseId,
          type: form.kind,
          kind: form.kind,
          amount: form.amount,
          dueDate: form.dueDate,
          receiptDate: status === 'paid' ? form.receiptDate : null,
          method:
            status === 'paid' || form.collectOnline
              ? form.method || 'card'
              : form.method,
          status,
          memo: form.memo,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          documentId: form.proof?.document_id || null,
          collectOnline: form.collectOnline && status === 'due',
        },
        user
      );
      if (!data?.success) {
        setError(data?.error || 'Could not save to the ledger.');
        return;
      }
      if (data.checkoutError && !data.checkoutUrl) {
        setError(data.checkoutError);
      } else if (data.warning) {
        setError(data.warning);
      }
      setSuccess(
        data.checkoutUrl
          ? 'Open charge saved. Open the Stripe Checkout link to collect the card payment.'
          : status === 'due'
            ? 'Open charge created. Mark it paid when money arrives.'
            : 'Payment recorded.'
      );
      setCheckoutUrl(data.checkoutUrl || '');
      setForm(emptyForm());
      await load();
    } catch {
      setError('Could not save to the ledger.');
    } finally {
      setSaving(false);
    }
  };

  const updatePayment = async (paymentId, patch) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.put('/payments', { paymentId, ...patch }, user);
      if (!data?.success) {
        setError(data?.error || 'Could not update payment.');
        return;
      }
      if (data.warning) {
        setError(data.warning);
      }
      setSuccess('Payment updated.');
      await load();
    } catch {
      setError('Could not update payment.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCatalog = async (event) => {
    event.preventDefault();
    if (!addingCategory || !newCatalogLabel.trim()) return;
    setSaving(true);
    setError('');
    try {
      const data = await api.post(
        '/payment-catalog',
        { category: addingCategory, label: newCatalogLabel.trim() },
        user
      );
      if (!data?.success) {
        setError(data?.error || 'Could not add that item.');
        return;
      }
      if (data.types) setTypes(data.types);
      if (data.methods) setMethods(data.methods);
      if (addingCategory === 'type' && data.code) {
        setForm((prev) => ({ ...prev, kind: data.code }));
      }
      if (addingCategory === 'method' && data.code) {
        setForm((prev) => ({ ...prev, method: data.code }));
      }
      setAddingCategory('');
      setNewCatalogLabel('');
      setSuccess(`Added ${data.label}.`);
    } catch {
      setError('Could not add that item.');
    } finally {
      setSaving(false);
    }
  };

  const isCharge = form.intent === 'charge';
  const unit = form.lease?.units || form.lease?.unit;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
          <DollarSign className="w-8 h-8 text-indigo-600" />
          Payments
        </h2>
        <p className="mt-2 text-sm text-gray-600 max-w-3xl">
          Open charges are created here as <span className="font-medium">due</span>.
          When money arrives, mark the charge paid — or record a payment that was
          already received in one step. Due date and date of receipt are separate.
          Attach a photo or PDF as proof (photos are compressed before the 10MB
          limit). Type and method lists can be extended for this company.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card title="Open charges">
          <p className="text-2xl font-semibold text-gray-900">
            {formatCurrencyDisplay(summary.dueAmount, locale) || '$0.00'}
          </p>
          <p className="text-sm text-gray-500">{summary.dueCount} due</p>
          <p className="mt-2 text-xs text-gray-500">
            Created with “Open charge” below. They stay due until marked paid or voided.
          </p>
        </Card>
        <Card title="Recorded as paid">
          <p className="text-2xl font-semibold text-gray-900">
            {formatCurrencyDisplay(summary.paidAmount, locale) || '$0.00'}
          </p>
          <p className="text-sm text-gray-500">{summary.paidCount} paid</p>
        </Card>
      </div>

      {canEdit && (
        <Card title="Add to ledger">
          <form onSubmit={handleCreate} className="space-y-4">
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">What to add</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="intent"
                  checked={isCharge}
                  onChange={() => setField('intent', 'charge')}
                />
                Open charge (amount due)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="intent"
                  checked={!isCharge}
                  onChange={() => {
                    setForm((prev) => ({
                      ...prev,
                      intent: 'received',
                      receiptDate:
                        prev.receiptDate ||
                        formatWorkflowDateMMDDYYYY(todayWorkflowDate()),
                    }));
                    setSuccess('');
                    setCheckoutUrl('');
                  }}
                />
                Payment already received
              </label>
            </fieldset>

            <LeaseSelectionPicker
              value={form.leaseId}
              onChange={handleLeaseChange}
              showRent
              showDeposit
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={form.kind}
                  onChange={(e) => handleKindChange(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                >
                  {types.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {canEditCatalog && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-indigo-600 hover:text-indigo-800"
                    onClick={() => {
                      setAddingCategory('type');
                      setNewCatalogLabel('');
                    }}
                  >
                    Add type…
                  </button>
                )}
              </div>
              <CurrencyInput
                label="Amount"
                required
                value={form.amount}
                onChange={(value) => setField('amount', value)}
              />
              <DateInput
                label="Due date"
                value={form.dueDate}
                onChange={(e) => setField('dueDate', e.target.value)}
              />
              {!isCharge && (
                <DateInput
                  label="Date of receipt"
                  value={form.receiptDate}
                  onChange={(e) => setField('receiptDate', e.target.value)}
                />
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Covered period
                </label>
                <select
                  value={form.periodKey}
                  onChange={(e) => handlePeriodKeyChange(e.target.value)}
                  disabled={!form.leaseId}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm disabled:bg-gray-100"
                >
                  <option value="">
                    {form.leaseId ? 'Custom date range' : 'Select a lease first'}
                  </option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.label}
                      {period.current ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Periods follow the lease start day, not calendar months.
                </p>
              </div>
              <DateInput
                label="Period start"
                value={form.periodStart}
                onChange={(e) => {
                  setForm((prev) => ({
                    ...prev,
                    periodStart: e.target.value,
                    periodKey: '',
                  }));
                  setSuccess('');
                }}
              />
              <DateInput
                label="Period end"
                value={form.periodEnd}
                onChange={(e) => {
                  setForm((prev) => ({
                    ...prev,
                    periodEnd: e.target.value,
                    periodKey: '',
                  }));
                  setSuccess('');
                }}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                <select
                  value={form.method}
                  onChange={(e) => setField('method', e.target.value)}
                  required={!isCharge}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                >
                  <option value="">{isCharge ? 'Optional until paid' : 'Select…'}</option>
                  {methods.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {canEditCatalog && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-indigo-600 hover:text-indigo-800"
                    onClick={() => {
                      setAddingCategory('method');
                      setNewCatalogLabel('');
                    }}
                  >
                    Add method…
                  </button>
                )}
              </div>
            </div>

            {addingCategory && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    New {addingCategory} label
                  </label>
                  <input
                    type="text"
                    value={newCatalogLabel}
                    onChange={(e) => setNewCatalogLabel(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                    placeholder={addingCategory === 'type' ? 'e.g. Garage remote' : 'e.g. Venmo'}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddCatalog}
                  disabled={saving || !newCatalogLabel.trim()}
                  className="px-3 py-2 bg-indigo-600 text-white rounded-md text-sm disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingCategory('');
                    setNewCatalogLabel('');
                  }}
                  className="px-3 py-2 text-sm text-gray-600"
                >
                  Cancel
                </button>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Memo</label>
              <textarea
                value={form.memo}
                onChange={(e) => setField('memo', e.target.value)}
                rows={4}
                maxLength={MEMO_MAX_LENGTH}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                placeholder="Check number, who paid, proration notes, concessions…"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Proof of payment
              </label>
              <WorkflowFileField
                value={form.proof}
                onChange={(fileMeta) => setField('proof', fileMeta)}
                leaseId={form.leaseId}
                propertyId={unit?.properties?.property_id || unit?.property_id}
                unitId={unit?.unit_id}
                userId={user?.user_id}
                documentType={PROOF_OF_PAYMENT_TYPE}
                acceptedTypes={PROOF_OF_SERVICE_ACCEPT}
                description="Photo or PDF of a receipt, check image, bank confirmation, or similar. Photos are compressed automatically. Saved to Documents."
              />
            </div>

            {onlinePaymentsEnabled && isCharge && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.collectOnline}
                  onChange={(e) => setField('collectOnline', e.target.checked)}
                />
                Create a Stripe Checkout link for this charge
              </label>
            )}
            <button
              type="submit"
              disabled={saving || !form.leaseId || form.amount == null}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving
                ? 'Saving…'
                : isCharge
                  ? 'Create open charge'
                  : 'Record payment'}
            </button>
          </form>
        </Card>
      )}

      <Card title="Ledger">
        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search property, tenant, memo…"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md shadow-sm"
          >
            <option value="all">All statuses</option>
            {PAYMENT_STATUSES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md shadow-sm"
          >
            <option value="all">All types</option>
            {types.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="mb-3 text-sm text-red-600 whitespace-pre-wrap">{error}</p>
        )}
        {success && <p className="mb-3 text-sm text-green-700">{success}</p>}
        {checkoutUrl && (
          <p className="mb-3 text-sm">
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Open Stripe Checkout
            </a>
          </p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading payments…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-500">No payments match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-4 font-medium">Due</th>
                  <th className="py-2 pr-4 font-medium">Received</th>
                  <th className="py-2 pr-4 font-medium">Lease</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Method</th>
                  {canEdit && <th className="py-2 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.paymentId} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {row.dueDate ? formatWorkflowDateMMDDYYYY(row.dueDate) : '—'}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {row.receiptDate ? formatWorkflowDateMMDDYYYY(row.receiptDate) : '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="font-medium text-gray-900">{row.leaseLabel}</div>
                      {row.periodLabel && (
                        <div className="text-xs text-gray-500">{row.periodLabel}</div>
                      )}
                      {row.memo && (
                        <div className="text-xs text-gray-500 whitespace-pre-wrap mt-1">
                          {row.memo}
                        </div>
                      )}
                      {row.documentName && (
                        <div className="text-xs text-indigo-600 mt-1">
                          Proof: {row.documentName}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4">{row.typeLabel || row.kindLabel}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatCurrencyDisplay(row.amount, locale)}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${statusClass(row.status)}`}>
                        {row.statusLabel}
                      </span>
                      {row.paidAt && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatDateTime(row.paidAt, locale)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4">{row.methodLabel || '—'}</td>
                    {canEdit && (
                      <td className="py-2 space-x-2 whitespace-nowrap">
                        {row.status === 'due' && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              updatePayment(row.paymentId, {
                                status: 'paid',
                                method: row.method || 'other',
                                receiptDate: todayWorkflowDate(),
                              })
                            }
                            className="text-indigo-600 hover:text-indigo-800 font-medium"
                          >
                            Mark paid
                          </button>
                        )}
                        {row.status !== 'void' && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => updatePayment(row.paymentId, { status: 'void' })}
                            className="text-gray-500 hover:text-gray-800"
                          >
                            Void
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
