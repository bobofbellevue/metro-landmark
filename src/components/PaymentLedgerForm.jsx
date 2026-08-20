import React from 'react';
import CurrencyInput from './CurrencyInput';
import DateInput from './DateInput';
import LeaseSelectionPicker from './LeaseSelectionPicker';
import WorkflowFileField from './WorkflowFileField';
import { formatWorkflowDateMMDDYYYY, todayWorkflowDate } from '../utils/workflow-date.js';
import { MEMO_MAX_LENGTH } from '../utils/payments.js';
import { PAYMENT_FORM_FIELD_CLASS } from '../utils/payment-form.js';
import { PROOF_OF_SERVICE_ACCEPT } from '../utils/proof-of-service-file.js';

const PROOF_OF_PAYMENT_TYPE = 'proof_of_payment';
const fieldClass = PAYMENT_FORM_FIELD_CLASS;

export default function PaymentLedgerForm({
  form,
  setForm,
  types,
  methods,
  canEditCatalog,
  addingCategory,
  setAddingCategory,
  newCatalogLabel,
  setNewCatalogLabel,
  onAddCatalog,
  saving,
  periods,
  onLeaseChange,
  onKindChange,
  onPeriodKeyChange,
  mode = 'create',
  leaseLabel = '',
  user,
  onlinePaymentsEnabled = false,
}) {
  const isCharge = form.intent === 'charge';
  const isEdit = mode === 'edit';
  const unit = form.lease?.units || form.lease?.unit;

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-4">
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">What to add</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`intent-${mode}`}
            checked={isCharge}
            onChange={() => setField('intent', 'charge')}
          />
          Open charge
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`intent-${mode}`}
            checked={!isCharge}
            onChange={() => {
              setForm((prev) => ({
                ...prev,
                intent: 'received',
                receiptDate:
                  prev.receiptDate || formatWorkflowDateMMDDYYYY(todayWorkflowDate()),
              }));
            }}
          />
          Already received
        </label>
      </fieldset>

      {isEdit ? (
        <div>
          <label className="block text-sm font-medium text-gray-700">Lease</label>
          <div className="mt-1 text-sm font-medium text-gray-900 break-words">
            {leaseLabel || '—'}
          </div>
        </div>
      ) : (
        <LeaseSelectionPicker
          value={form.leaseId}
          onChange={onLeaseChange}
          showRent
          showDeposit
        />
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700">Type</label>
        <select
          value={form.kind}
          onChange={(e) => onKindChange(e.target.value)}
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
          onChange={(e) => onPeriodKeyChange(e.target.value)}
          disabled={!form.leaseId && !isEdit}
          className={`${fieldClass} disabled:bg-gray-100`}
        >
          <option value="">
            {form.leaseId || isEdit ? 'Custom date range' : 'Select a lease first'}
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
              onClick={onAddCatalog}
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

      {onlinePaymentsEnabled && isCharge && !isEdit && (
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
  );
}
