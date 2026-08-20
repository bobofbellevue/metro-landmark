import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { AuthContext } from '../contexts';
import { api } from '../api';
import { Card } from '../components/ui';
import CurrencyInput, { formatCurrencyDisplay } from '../components/CurrencyInput';
import DateInput from '../components/DateInput';
import LeaseSelectionPicker from '../components/LeaseSelectionPicker';
import WorkflowFileField from '../components/WorkflowFileField';
import PaymentVoidModal from '../components/PaymentVoidModal';
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
  restoreStatusForVoided,
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

const fieldClass = 'block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm';

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
  const [formError, setFormError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [addingCategory, setAddingCategory] = useState('');
  const [newCatalogLabel, setNewCatalogLabel] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

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
    setFormError('');
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
    setFormError('');
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
    setFormError('');
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
        setFormError(data?.error || 'Could not save to the ledger.');
        return;
      }
      if (data.checkoutError && !data.checkoutUrl) {
        setFormError(data.checkoutError);
      } else if (data.warning) {
        setFormError(data.warning);
      }
      setCheckoutUrl(data.checkoutUrl || '');
      setForm(emptyForm());
      setAddingCategory('');
      setNewCatalogLabel('');
      await load();
    } catch {
      setFormError('Could not save to the ledger.');
    } finally {
      setSaving(false);
    }
  };

  const updatePayment = async (paymentId, patch) => {
    setSaving(true);
    setError('');
    try {
      const data = await api.put('/payments', { paymentId, ...patch }, user);
      if (!data?.success) {
        setError(data?.error || 'Could not update payment.');
        return false;
      }
      if (data.warning) setError(data.warning);
      await load();
      return true;
    } catch {
      setError('Could not update payment.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deletePayment = async (paymentId) => {
    const data = await api.delete(`/payments?paymentId=${paymentId}`, user);
    if (!data?.success) {
      throw new Error(data?.error || 'Could not delete payment.');
    }
    await load();
  };

  const handleAddCatalog = async (event) => {
    event.preventDefault();
    if (!addingCategory || !newCatalogLabel.trim()) return;
    setSaving(true);
    setFormError('');
    try {
      const data = await api.post(
        '/payment-catalog',
        { category: addingCategory, label: newCatalogLabel.trim() },
        user
      );
      if (!data?.success) {
        setFormError(data?.error || 'Could not add that item.');
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
    } catch {
      setFormError('Could not add that item.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setForm(emptyForm());
    setFormError('');
    setCheckoutUrl('');
    setAddingCategory('');
    setNewCatalogLabel('');
  };

  const isCharge = form.intent === 'charge';
  const unit = form.lease?.units || form.lease?.unit;

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-gray-800">Payments</h2>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {canEdit && (
          <Card hideTitle className="lg:col-span-1 max-h-[calc(100vh-160px)]" contentClassName="h-full">
            <form onSubmit={handleCreate} className="flex flex-col h-full">
              <div className="flex items-start justify-between pb-4 mb-4 border-b">
                <h2 className="text-2xl font-bold text-gray-800">Add Payment</h2>
              </div>
              <div className="flex-1 overflow-y-auto pr-1 space-y-4">
                <fieldset className="flex flex-wrap gap-4 text-sm">
                  <legend className="sr-only">What to add</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="intent"
                      checked={isCharge}
                      onChange={() => setField('intent', 'charge')}
                    />
                    Open charge
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
                      }}
                    />
                    Already received
                  </label>
                </fieldset>

                <LeaseSelectionPicker
                  value={form.leaseId}
                  onChange={handleLeaseChange}
                  showRent
                  showDeposit
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700">Type</label>
                  <select
                    value={form.kind}
                    onChange={(e) => handleKindChange(e.target.value)}
                    className={fieldClass}
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

                <div>
                  <label className="block text-sm font-medium text-gray-700">Covered period</label>
                  <select
                    value={form.periodKey}
                    onChange={(e) => handlePeriodKeyChange(e.target.value)}
                    disabled={!form.leaseId}
                    className={`${fieldClass} disabled:bg-gray-100`}
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
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <DateInput
                    label="Period start"
                    value={form.periodStart}
                    onChange={(e) => {
                      setForm((prev) => ({
                        ...prev,
                        periodStart: e.target.value,
                        periodKey: '',
                      }));
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
                    }}
                  />
                </div>

                {!isCharge && (
                  <DateInput
                    label="Date of receipt"
                    value={form.receiptDate}
                    onChange={(e) => setField('receiptDate', e.target.value)}
                  />
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700">Method</label>
                  <select
                    value={form.method}
                    onChange={(e) => setField('method', e.target.value)}
                    required={!isCharge}
                    className={fieldClass}
                  >
                    <option value="">{isCharge ? '' : 'Select…'}</option>
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

                {addingCategory && (
                  <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                    <label className="block text-sm font-medium text-gray-700">
                      New {addingCategory} label
                    </label>
                    <input
                      type="text"
                      value={newCatalogLabel}
                      onChange={(e) => setNewCatalogLabel(e.target.value)}
                      className={fieldClass}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddCatalog}
                        disabled={saving || !newCatalogLabel.trim()}
                        className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingCategory('');
                          setNewCatalogLabel('');
                        }}
                        className="px-3 py-1.5 text-sm text-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700">Memo</label>
                  <textarea
                    value={form.memo}
                    onChange={(e) => setField('memo', e.target.value)}
                    rows={3}
                    maxLength={MEMO_MAX_LENGTH}
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Proof of payment</label>
                  <div className="mt-1">
                    <WorkflowFileField
                      value={form.proof}
                      onChange={(fileMeta) => setField('proof', fileMeta)}
                      leaseId={form.leaseId}
                      propertyId={unit?.properties?.property_id || unit?.property_id}
                      unitId={unit?.unit_id}
                      userId={user?.user_id}
                      documentType={PROOF_OF_PAYMENT_TYPE}
                      acceptedTypes={PROOF_OF_SERVICE_ACCEPT}
                    />
                  </div>
                </div>

                {onlinePaymentsEnabled && isCharge && (
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.collectOnline}
                      onChange={(e) => setField('collectOnline', e.target.checked)}
                    />
                    Stripe Checkout link
                  </label>
                )}
              </div>
              <div className="pt-4 mt-4 border-t flex flex-col gap-3 flex-shrink-0">
                {formError && (
                  <p className="text-sm text-red-600 whitespace-pre-wrap">{formError}</p>
                )}
                <div className="flex justify-end gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={handleClear}
                    className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                  >
                    Clear
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !form.leaseId || form.amount == null}
                    className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {saving
                      ? 'Saving…'
                      : isCharge
                        ? 'Create open charge'
                        : 'Record payment'}
                  </button>
                </div>
              </div>
            </form>
          </Card>
        )}

        <Card
          title="Payment Search"
          className={`${canEdit ? 'lg:col-span-2' : 'lg:col-span-3'} max-h-[calc(100vh-160px)]`}
          contentClassName="flex flex-col h-full"
        >
          <div className="flex flex-col h-full">
            <div className="mb-4 flex-shrink-0">
              <div className="flex items-center gap-4 mb-2 flex-wrap">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search property, tenant, memo…"
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      title="Clear search"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
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
                  className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                >
                  <option value="all">All types</option>
                  {types.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 text-sm text-gray-600">
                {searchTerm ? (
                  visible.length === 0 ? (
                    <span className="text-red-600">No payments found matching "{searchTerm}"</span>
                  ) : (
                    <span>
                      Showing {visible.length} of {payments.length} payments
                    </span>
                  )
                ) : (
                  <span>
                    Showing {payments.length} of {payments.length} payments
                    {' · '}
                    Open {formatCurrencyDisplay(summary.dueAmount, locale) || '$0.00'}
                    {' · '}
                    Paid {formatCurrencyDisplay(summary.paidAmount, locale) || '$0.00'}
                  </span>
                )}
              </div>
            </div>

            {error && (
              <p className="mb-3 text-sm text-red-600 whitespace-pre-wrap flex-shrink-0">{error}</p>
            )}
            {checkoutUrl && (
              <p className="mb-3 text-sm flex-shrink-0">
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
              <div className="flex-1 overflow-hidden rounded-lg border border-gray-200">
                <div className="overflow-auto h-full max-w-full">
                  <table className="w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        {canEdit && (
                          <th className="px-4 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                            Actions
                          </th>
                        )}
                        <th className="px-4 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                          Due
                        </th>
                        <th className="px-4 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                          Received
                        </th>
                        <th className="px-4 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                          Lease
                        </th>
                        <th className="px-4 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                          Type
                        </th>
                        <th className="px-4 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                          Status
                        </th>
                        <th className="px-4 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                          Method
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {visible.map((row) => (
                        <tr key={row.paymentId} className="align-top">
                          {canEdit && (
                            <td className="px-4 py-3 space-x-2 whitespace-nowrap">
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
                              {row.status === 'void' && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() =>
                                    updatePayment(row.paymentId, {
                                      status: restoreStatusForVoided(row),
                                      method: row.method || 'other',
                                    })
                                  }
                                  className="text-indigo-600 hover:text-indigo-800 font-medium"
                                >
                                  Restore
                                </button>
                              )}
                              {row.status !== 'void' && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => setVoidTarget(row)}
                                  className="text-gray-500 hover:text-gray-800"
                                >
                                  Void
                                </button>
                              )}
                              {row.status === 'void' && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => setDeleteTarget(row)}
                                  className="text-red-600 hover:text-red-800"
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          )}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {row.dueDate ? formatWorkflowDateMMDDYYYY(row.dueDate) : '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {row.receiptDate ? formatWorkflowDateMMDDYYYY(row.receiptDate) : '—'}
                          </td>
                          <td className="px-4 py-3">
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
                          <td className="px-4 py-3">{row.typeLabel || row.kindLabel}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {formatCurrencyDisplay(row.amount, locale)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-semibold ${statusClass(row.status)}`}
                            >
                              {row.statusLabel}
                            </span>
                            {row.paidAt && (
                              <div className="text-xs text-gray-500 mt-1">
                                {formatDateTime(row.paidAt, locale)}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">{row.methodLabel || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {voidTarget && (
        <PaymentVoidModal
          payment={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoid={async () => {
            const ok = await updatePayment(voidTarget.paymentId, { status: 'void' });
            if (!ok) throw new Error('Could not update payment.');
          }}
          onPermanentDelete={() => deletePayment(voidTarget.paymentId)}
        />
      )}
      {deleteTarget && (
        <PaymentVoidModal
          payment={deleteTarget}
          startHardDelete
          onClose={() => setDeleteTarget(null)}
          onVoid={async () => {
            const ok = await updatePayment(deleteTarget.paymentId, { status: 'void' });
            if (!ok) throw new Error('Could not update payment.');
          }}
          onPermanentDelete={() => deletePayment(deleteTarget.paymentId)}
        />
      )}
    </div>
  );
}
