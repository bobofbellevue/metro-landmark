import React, { useContext, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, CheckCircle, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { AuthContext } from '../contexts';
import { api } from '../api';
import { Card } from '../components/ui';
import { useSortableData } from '../hooks';
import PaymentEditModal from '../components/PaymentEditModal';
import PaymentLedgerForm from '../components/PaymentLedgerForm';
import PaymentVoidModal from '../components/PaymentVoidModal';
import { formatCurrencyDisplay } from '../components/CurrencyInput';
import { formatDateTime, localeContextFromBrowser } from '../config/locale.js';
import { formatWorkflowDateMMDDYYYY, todayWorkflowDate } from '../utils/workflow-date.js';
import {
  PAYMENT_METHODS as DEFAULT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES as DEFAULT_TYPES,
  canEditPaymentCatalog,
  canEditPayments,
  defaultAmountForKind,
  filterPaymentsBySearch,
  restoreStatusForVoided,
  summarizePayments,
} from '../utils/payments.js';
import {
  applyPeriodToPaymentForm,
  emptyPaymentForm,
  paymentWritePayload,
} from '../utils/payment-form.js';
import {
  currentLeasePeriod as currentPeriod,
  leaseAlignedPeriods as leasePeriods,
  resolvedPeriodRange,
} from '../utils/payment-periods.js';

function statusClass(status) {
  if (status === 'paid') return 'bg-green-100 text-green-800';
  if (status === 'void') return 'bg-gray-100 text-gray-600';
  return 'bg-amber-100 text-amber-800';
}

function PaymentPeriodCell({ start, end, label }) {
  const range = resolvedPeriodRange(start, end);
  const startText = formatWorkflowDateMMDDYYYY(range.start);
  const endText = formatWorkflowDateMMDDYYYY(range.end);
  if (startText && endText) {
    return (
      <>
        <span className="whitespace-nowrap">{startText} –</span>
        <br />
        <span className="whitespace-nowrap">{endText}</span>
      </>
    );
  }
  if (startText || endText) {
    return <span className="whitespace-nowrap">{startText || endText}</span>;
  }
  return label || '—';
}

export default function PaymentsPage() {
  const { user } = useContext(AuthContext);
  const locale = localeContextFromBrowser();
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState(summarizePayments([]));
  const [types, setTypes] = useState(DEFAULT_TYPES);
  const [methods, setMethods] = useState(DEFAULT_METHODS);
  const [onlinePaymentsEnabled, setOnlinePaymentsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [form, setForm] = useState(emptyPaymentForm);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [addingCategory, setAddingCategory] = useState('');
  const [newCatalogLabel, setNewCatalogLabel] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);

  const canEdit = canEditPayments(user?.role);
  const canEditCatalog = canEditPaymentCatalog(user?.role);

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

  const filtered = useMemo(
    () => filterPaymentsBySearch(payments, searchTerm),
    [payments, searchTerm]
  );
  const { items: visible, requestSort, sortConfig } = useSortableData(filtered, {
    key: 'dueDate',
    direction: 'descending',
  });

  const getSortIndicator = (name) => {
    if (!sortConfig || sortConfig.key !== name) {
      return <ArrowUpDown size={14} className="ml-2 text-gray-400" />;
    }
    return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
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
      return applyPeriodToPaymentForm(next, period);
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
    setForm((prev) => applyPeriodToPaymentForm(prev, period));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setFormError('');
    setCheckoutUrl('');
    try {
      const data = await api.post(
        '/payments',
        paymentWritePayload(form, { includeLease: true, includeCollectOnline: true }),
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
      setForm(emptyPaymentForm());
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
    setForm(emptyPaymentForm());
    setFormError('');
    setCheckoutUrl('');
    setAddingCategory('');
    setNewCatalogLabel('');
  };

  const isCharge = form.intent === 'charge';

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-gray-800">Payments</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {canEdit && (
          <Card hideTitle className="lg:col-span-1 max-h-[calc(100vh-160px)]" contentClassName="h-full">
            <form onSubmit={handleCreate} className="flex flex-col h-full">
              <div className="flex items-start justify-between pb-4 mb-4 border-b">
                <h2 className="text-2xl font-bold text-gray-800">Add Payment</h2>
              </div>
              <div className="flex-1 overflow-y-auto pr-1">
                <PaymentLedgerForm
                  form={form}
                  setForm={(updater) => {
                    setForm(updater);
                    setFormError('');
                    setCheckoutUrl('');
                  }}
                  types={types}
                  methods={methods}
                  canEditCatalog={canEditCatalog}
                  addingCategory={addingCategory}
                  setAddingCategory={setAddingCategory}
                  newCatalogLabel={newCatalogLabel}
                  setNewCatalogLabel={setNewCatalogLabel}
                  onAddCatalog={handleAddCatalog}
                  saving={saving}
                  periods={periods}
                  onLeaseChange={handleLeaseChange}
                  onKindChange={handleKindChange}
                  onPeriodKeyChange={handlePeriodKeyChange}
                  mode="create"
                  user={user}
                  onlinePaymentsEnabled={onlinePaymentsEnabled}
                />
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
                  <table className="w-max divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        {canEdit && (
                          <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                            Actions
                          </th>
                        )}
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('dueDate')} className="flex items-center">
                            Due {getSortIndicator('dueDate')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('receiptDate')} className="flex items-center">
                            Received {getSortIndicator('receiptDate')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('leaseLabel')} className="flex items-center">
                            Lease {getSortIndicator('leaseLabel')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('periodStart')} className="flex items-center">
                            Period {getSortIndicator('periodStart')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('memo')} className="flex items-center">
                            Memo {getSortIndicator('memo')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('documentName')} className="flex items-center">
                            Proof {getSortIndicator('documentName')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('typeLabel')} className="flex items-center">
                            Type {getSortIndicator('typeLabel')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('amount')} className="flex items-center">
                            Amount {getSortIndicator('amount')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('statusLabel')} className="flex items-center">
                            Status {getSortIndicator('statusLabel')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button type="button" onClick={() => requestSort('methodLabel')} className="flex items-center">
                            Method {getSortIndicator('methodLabel')}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {visible.map((row) => (
                        <tr key={row.paymentId} className="align-top">
                          {canEdit && (
                            <td className="px-1.5 py-2 text-sm font-medium text-left whitespace-nowrap">
                              <div className="flex items-center space-x-3">
                                {row.status !== 'void' && (
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => setEditingPayment(row)}
                                    className="text-indigo-600 hover:text-indigo-900"
                                    title="Edit Payment"
                                  >
                                    <Pencil size={16} />
                                  </button>
                                )}
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
                                    className="text-green-600 hover:text-green-800"
                                    title="Mark paid"
                                  >
                                    <CheckCircle size={16} />
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
                                    className="text-green-600 hover:text-green-900"
                                    title="Restore Payment"
                                  >
                                    <RotateCcw size={16} />
                                  </button>
                                )}
                                {row.status !== 'void' && (
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => setVoidTarget(row)}
                                    className="text-red-600 hover:text-red-800"
                                    title="Void Payment"
                                  >
                                    <X size={20} strokeWidth={2.5} />
                                  </button>
                                )}
                                {row.status === 'void' && (
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => setDeleteTarget(row)}
                                    className="text-red-600 hover:text-red-900"
                                    title="Delete Payment"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                          <td className="px-1.5 py-2 whitespace-nowrap">
                            {row.dueDate ? formatWorkflowDateMMDDYYYY(row.dueDate) : '—'}
                          </td>
                          <td className="px-1.5 py-2 whitespace-nowrap">
                            {row.receiptDate ? formatWorkflowDateMMDDYYYY(row.receiptDate) : '—'}
                          </td>
                          <td className="px-1.5 py-2 max-w-[12rem] whitespace-normal break-words text-gray-900">
                            {row.leaseLabel || '—'}
                          </td>
                          <td className="px-1.5 py-2 whitespace-normal">
                            <PaymentPeriodCell
                              start={row.periodStart}
                              end={row.periodEnd}
                              label={row.periodLabel}
                            />
                          </td>
                          <td className="px-1.5 py-2 max-w-[12rem] whitespace-normal break-words">
                            {row.memo || '—'}
                          </td>
                          <td className="px-1.5 py-2 max-w-[10rem] whitespace-normal break-words">
                            {row.documentName || '—'}
                          </td>
                          <td className="px-1.5 py-2 whitespace-nowrap">
                            {row.typeLabel || row.kindLabel || '—'}
                          </td>
                          <td className="px-1.5 py-2 whitespace-nowrap">
                            {formatCurrencyDisplay(row.amount, locale)}
                          </td>
                          <td className="px-1.5 py-2 whitespace-nowrap">
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
                          <td className="px-1.5 py-2 whitespace-nowrap">{row.methodLabel || '—'}</td>
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

      {editingPayment && (
        <PaymentEditModal
          payment={editingPayment}
          types={types}
          methods={methods}
          canEditCatalog={canEditCatalog}
          user={user}
          onClose={() => setEditingPayment(null)}
          onSave={async (payload) => {
            const ok = await updatePayment(editingPayment.paymentId, payload);
            if (!ok) throw new Error('Could not update payment.');
          }}
        />
      )}
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
