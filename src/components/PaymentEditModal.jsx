import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import PaymentLedgerForm from './PaymentLedgerForm.jsx';
import { api } from '../api';
import { fetchEnrichedLeases } from '../utils/fetch-enriched-leases.js';
import {
  applyPeriodToPaymentForm,
  paymentFormFromRow,
  paymentWritePayload,
} from '../utils/payment-form.js';
import { defaultAmountForKind } from '../utils/payments.js';
import { leaseAlignedPeriods as leasePeriods } from '../utils/payment-periods.js';

export default function PaymentEditModal({
  payment,
  types,
  methods,
  canEditCatalog,
  user,
  onClose,
  onSave,
  onPreviewProof,
}) {
  const [form, setForm] = useState(() => paymentFormFromRow(payment));
  const [lease, setLease] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [addingCategory, setAddingCategory] = useState('');
  const [newCatalogLabel, setNewCatalogLabel] = useState('');
  const [catalogTypes, setCatalogTypes] = useState(types);
  const [catalogMethods, setCatalogMethods] = useState(methods);

  useEffect(() => {
    setForm(paymentFormFromRow(payment));
    setFormError('');
  }, [payment]);

  useEffect(() => {
    let cancelled = false;
    async function loadLease() {
      if (!payment?.leaseId) return;
      try {
        const leases = await fetchEnrichedLeases([
          'active',
          'pending',
          'future',
          'ended',
          'expired',
        ]);
        if (cancelled) return;
        const match = leases.find(
          (item) => String(item.lease_id) === String(payment.leaseId)
        );
        setLease(match || null);
        if (match) {
          setForm((prev) => ({ ...prev, lease: match, leaseId: match.lease_id }));
        }
      } catch {
        if (!cancelled) setLease(null);
      }
    }
    loadLease();
    return () => {
      cancelled = true;
    };
  }, [payment?.leaseId]);

  const periods = useMemo(() => (lease ? leasePeriods(lease) : []), [lease]);

  const handleKindChange = (kind) => {
    setForm((prev) => ({
      ...prev,
      kind,
      amount: defaultAmountForKind(prev.lease, kind) ?? prev.amount,
    }));
    setFormError('');
  };

  const handlePeriodKeyChange = (key) => {
    if (!key) {
      setForm((prev) => ({ ...prev, periodKey: '' }));
      return;
    }
    const period = periods.find((p) => p.id === key);
    setForm((prev) => applyPeriodToPaymentForm(prev, period));
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
      if (data.types) setCatalogTypes(data.types);
      if (data.methods) setCatalogMethods(data.methods);
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await onSave(paymentWritePayload(form, { includeLease: false }));
      onClose();
    } catch (err) {
      setFormError(err?.message || 'Could not update payment.');
    } finally {
      setSaving(false);
    }
  };

  if (!payment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] bg-white rounded-lg shadow-xl flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">Edit Payment</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 overflow-y-auto p-6">
            <PaymentLedgerForm
              form={form}
              setForm={setForm}
              types={catalogTypes}
              methods={catalogMethods}
              canEditCatalog={canEditCatalog}
              addingCategory={addingCategory}
              setAddingCategory={setAddingCategory}
              newCatalogLabel={newCatalogLabel}
              setNewCatalogLabel={setNewCatalogLabel}
              onAddCatalog={handleAddCatalog}
              saving={saving}
              periods={periods}
              onLeaseChange={() => {}}
              onKindChange={handleKindChange}
              onPeriodKeyChange={handlePeriodKeyChange}
              mode="edit"
              leaseLabel={payment.leaseLabel}
              user={user}
              onPreviewProof={onPreviewProof}
            />
            {formError && (
              <p className="mt-4 text-sm text-red-600 whitespace-pre-wrap">{formError}</p>
            )}
          </div>
          <div className="flex justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || form.amount == null}
              className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
