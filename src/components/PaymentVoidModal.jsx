import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import {
  clampDeleteConfirmationInput,
  getDeleteConfirmationMaxLength,
  getDeleteConfirmationTarget,
  matchesDeleteConfirmation,
} from '../utils/delete-confirmation.js';
import { paymentDeleteConfirmName } from '../utils/payments.js';

/**
 * Void (reversible) or permanently delete a ledger row.
 */
export default function PaymentVoidModal({
  payment,
  onClose,
  onVoid,
  onPermanentDelete,
  startHardDelete = false,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showHardDelete, setShowHardDelete] = useState(Boolean(startHardDelete));
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  if (!payment) return null;

  const confirmName = paymentDeleteConfirmName(payment);
  const confirmTarget = getDeleteConfirmationTarget(confirmName);

  const run = async (fn) => {
    setIsSubmitting(true);
    setError('');
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not update payment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-md p-6 space-y-4 bg-white rounded-lg shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {showHardDelete ? 'Permanently delete' : 'Void'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        {!showHardDelete ? (
          <>
            <p className="text-sm text-gray-700">
              Void <span className="font-bold">{confirmName}</span>?
            </p>
            {error && (
              <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                {error}
              </div>
            )}
            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowHardDelete(true);
                  setDeleteConfirmation('');
                  setError('');
                }}
                className="text-xs text-red-600 hover:text-red-800 underline"
                disabled={isSubmitting}
              >
                Permanently delete instead
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => run(onVoid)}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
                >
                  {isSubmitting ? 'Saving…' : 'Void'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 p-4 bg-red-50 border-2 border-red-400 rounded-md">
              <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
              <p className="text-sm font-bold text-red-900">This cannot be undone.</p>
            </div>
            <p className="text-sm text-gray-700">
              Permanently delete <span className="font-bold">{confirmName}</span>?
            </p>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Type at least{' '}
                <span className="font-bold text-red-600">{confirmTarget}</span>
                {String(confirmName).trim().length > confirmTarget.length ? (
                  <span className="text-gray-500 font-normal">
                    {' '}
                    (first {confirmTarget.length} characters of &quot;{confirmName}&quot;)
                  </span>
                ) : null}{' '}
                to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmation}
                maxLength={getDeleteConfirmationMaxLength(confirmName)}
                onChange={(e) =>
                  setDeleteConfirmation(
                    clampDeleteConfirmationInput(e.target.value, confirmName)
                  )
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                disabled={isSubmitting}
                autoComplete="off"
              />
            </div>
            {error && (
              <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (startHardDelete) {
                    onClose();
                    return;
                  }
                  setShowHardDelete(false);
                  setDeleteConfirmation('');
                  setError('');
                }}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!matchesDeleteConfirmation(deleteConfirmation, confirmName)) {
                    setError(`Type at least "${confirmTarget}" to confirm.`);
                    return;
                  }
                  run(onPermanentDelete);
                }}
                disabled={isSubmitting || !matchesDeleteConfirmation(deleteConfirmation, confirmName)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {isSubmitting ? 'Deleting…' : 'Permanently delete'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
