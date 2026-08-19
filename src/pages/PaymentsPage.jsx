import React, { useContext, useEffect, useMemo, useState } from 'react';
import { DollarSign } from 'lucide-react';
import { AuthContext } from '../contexts';
import { api } from '../api';
import { Card } from '../components/ui';
import CurrencyInput, { formatCurrencyDisplay } from '../components/CurrencyInput';
import DateInput from '../components/DateInput';
import LeaseSelectionPicker from '../components/LeaseSelectionPicker';
import { formatDateTime, localeContextFromBrowser } from '../config/locale.js';
import { formatWorkflowDateMMDDYYYY, todayWorkflowDate } from '../utils/workflow-date.js';
import {
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  currentRentPeriodLabel,
  defaultAmountForKind,
  filterPaymentsBySearch,
  summarizePayments,
} from '../utils/payments.js';

const emptyForm = () => ({
  leaseId: null,
  lease: null,
  kind: 'rent',
  amount: null,
  dueDate: formatWorkflowDateMMDDYYYY(todayWorkflowDate()),
  method: '',
  status: 'due',
  memo: '',
  periodLabel: currentRentPeriodLabel(),
  collectOnline: false,
});

function statusClass(status) {
  if (status === 'paid') return 'bg-green-100 text-green-800';
  if (status === 'void') return 'bg-gray-100 text-gray-600';
  return 'bg-amber-100 text-amber-800';
}

export default function PaymentsPage() {
  const { user } = useContext(AuthContext);
  const locale = localeContextFromBrowser();
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState(summarizePayments([]));
  const [canEdit, setCanEdit] = useState(false);
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
      setCanEdit(Boolean(data.canEdit));
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
      return {
        ...prev,
        leaseId,
        lease,
        amount: keepAmount ? prev.amount : suggested,
        periodLabel:
          nextKind === 'rent' ? prev.periodLabel || currentRentPeriodLabel() : prev.periodLabel,
      };
    });
    setSuccess('');
  };

  const handleKindChange = (kind) => {
    setForm((prev) => ({
      ...prev,
      kind,
      amount: defaultAmountForKind(prev.lease, kind) ?? prev.amount,
      periodLabel: kind === 'rent' ? prev.periodLabel || currentRentPeriodLabel() : prev.periodLabel,
    }));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError('');
    setSuccess('');
    setCheckoutUrl('');
    try {
      const data = await api.post(
        '/payments',
        {
          leaseId: form.leaseId,
          kind: form.kind,
          amount: form.amount,
          dueDate: form.dueDate,
          method: form.status === 'paid' || form.collectOnline ? form.method || 'card' : form.method,
          status: form.status,
          memo: form.memo,
          periodLabel: form.kind === 'rent' ? form.periodLabel : form.periodLabel,
          collectOnline: form.collectOnline,
        },
        user
      );
      if (!data?.success) {
        setError(data?.error || 'Could not record payment.');
        return;
      }
      if (data.checkoutError && !data.checkoutUrl) {
        setError(data.checkoutError);
      }
      setSuccess(
        data.checkoutUrl
          ? 'Charge recorded. Open the Stripe Checkout link to collect the card payment.'
          : 'Payment recorded.'
      );
      setCheckoutUrl(data.checkoutUrl || '');
      setForm(emptyForm());
      await load();
    } catch {
      setError('Could not record payment.');
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
      setSuccess('Payment updated.');
      await load();
    } catch {
      setError('Could not update payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
          <DollarSign className="w-8 h-8 text-indigo-600" />
          Payments
        </h2>
        <p className="mt-2 text-sm text-gray-600 max-w-3xl">
          Record rent, deposits, and fees against a lease. Cash, check, ACH, and
          card received in person can be marked paid here.
          {onlinePaymentsEnabled
            ? ' Stripe Checkout is configured on this deploy for online card collection.'
            : ' Online card Checkout is available later, after Stripe keys are set on the deploy.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card title="Open charges">
          <p className="text-2xl font-semibold text-gray-900">
            {formatCurrencyDisplay(summary.dueAmount, locale) || '$0.00'}
          </p>
          <p className="text-sm text-gray-500">{summary.dueCount} due</p>
        </Card>
        <Card title="Recorded as paid">
          <p className="text-2xl font-semibold text-gray-900">
            {formatCurrencyDisplay(summary.paidAmount, locale) || '$0.00'}
          </p>
          <p className="text-sm text-gray-500">{summary.paidCount} paid</p>
        </Card>
      </div>

      {canEdit && (
        <Card title="Record a payment">
          <form onSubmit={handleCreate} className="space-y-4">
            <LeaseSelectionPicker
              value={form.leaseId}
              onChange={handleLeaseChange}
              showRent
              showDeposit
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kind</label>
                <select
                  value={form.kind}
                  onChange={(e) => handleKindChange(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                >
                  {PAYMENT_KINDS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
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
              {form.kind === 'rent' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Period (YYYY-MM)
                  </label>
                  <input
                    type="text"
                    value={form.periodLabel}
                    onChange={(e) => setField('periodLabel', e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                    placeholder="2026-08"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setField('status', e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                >
                  <option value="due">Due (charge now, collect later)</option>
                  <option value="paid">Paid (already received)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                <select
                  value={form.method}
                  onChange={(e) => setField('method', e.target.value)}
                  required={form.status === 'paid'}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                >
                  <option value="">Select…</option>
                  {PAYMENT_METHODS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Memo</label>
              <input
                type="text"
                value={form.memo}
                onChange={(e) => setField('memo', e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                maxLength={2000}
              />
            </div>
            {onlinePaymentsEnabled && form.status === 'due' && (
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
              {saving ? 'Saving…' : 'Record'}
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
            <option value="all">All kinds</option>
            {PAYMENT_KINDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
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
                  <th className="py-2 pr-4 font-medium">Lease</th>
                  <th className="py-2 pr-4 font-medium">Kind</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Method</th>
                  {canEdit && <th className="py-2 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.paymentId} className="border-b last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {row.dueDate ? formatWorkflowDateMMDDYYYY(row.dueDate) : '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="font-medium text-gray-900">{row.leaseLabel}</div>
                      {row.periodLabel && (
                        <div className="text-xs text-gray-500">{row.periodLabel}</div>
                      )}
                      {row.memo && <div className="text-xs text-gray-500">{row.memo}</div>}
                    </td>
                    <td className="py-2 pr-4">{row.kindLabel}</td>
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
