import React, { useState } from 'react';
import { X, AlertTriangle, Archive } from 'lucide-react';
import {
  clampDeleteConfirmationInput,
  getDeleteConfirmationMaxLength,
  getDeleteConfirmationTarget,
  matchesDeleteConfirmation,
} from '../utils/delete-confirmation.js';

/**
 * Archive / permanent-delete modal for one or more documents.
 */
export default function DocumentArchiveModal({
  documents = [],
  onClose,
  onArchive,
  onPermanentDelete,
  isAdmin = true,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const list = Array.isArray(documents) ? documents.filter(Boolean) : [];
  const count = list.length;
  const isBulk = count > 1;
  const primary = list[0];
  const confirmName = isBulk
    ? `DELETE ${count} DOCUMENTS`
    : primary?.file_name || `document-${primary?.document_id || ''}`;
  const confirmTarget = getDeleteConfirmationTarget(confirmName);
  const canHardDelete = matchesDeleteConfirmation(deleteConfirmation, confirmName);

  if (count === 0) return null;

  const run = async (fn) => {
    setIsSubmitting(true);
    setError('');
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err.message || 'Operation failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-md p-6 space-y-4 bg-white rounded-lg shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {showHardDelete
              ? 'Permanently Delete Document' + (isBulk ? 's' : '')
              : 'Archive Document' + (isBulk ? 's' : '')}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        {!showHardDelete ? (
          <>
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                {isBulk ? (
                  <>
                    You&apos;re about to archive{' '}
                    <span className="font-bold">{count} documents</span>.
                  </>
                ) : (
                  <>
                    You&apos;re about to archive{' '}
                    <span className="font-bold">{primary.file_name}</span>.
                  </>
                )}
              </p>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-sm text-blue-800">
                  <strong>Archiving preserves the file and history.</strong> Archived
                  documents are hidden from the default Documents list but can be shown
                  again with &quot;Show Archived&quot;.
                </p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Reason for archiving (optional)
                </label>
                <textarea
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  placeholder="e.g., Superseded by regenerated notice"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                {error}
              </div>
            )}

            <div className="flex justify-between items-center pt-4">
              {isAdmin ? (
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
              ) : (
                <div />
              )}
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
                  onClick={() =>
                    run(() => onArchive(list, archiveReason.trim() || null))
                  }
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700"
                >
                  <Archive className="w-4 h-4" />
                  {isSubmitting ? 'Archiving...' : isBulk ? `Archive ${count}` : 'Archive'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-4 bg-red-50 border-2 border-red-400 rounded-md">
                <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
                <div className="space-y-2">
                  <p className="text-sm font-bold text-red-900">
                    WARNING: This permanently deletes the file(s)!
                  </p>
                  <ul className="text-xs text-red-800 space-y-1 list-disc list-inside">
                    <li>Cannot be undone</li>
                    <li>Storage file and database record are removed</li>
                    <li>Prefer archive unless this was a mistake or test file</li>
                  </ul>
                </div>
              </div>

              <p className="text-sm text-gray-700">
                {isBulk ? (
                  <>
                    Permanently delete <span className="font-bold">{count} documents</span>?
                  </>
                ) : (
                  <>
                    Permanently delete{' '}
                    <span className="font-bold">{primary.file_name}</span>?
                  </>
                )}
              </p>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Type at least{' '}
                  <span className="font-bold text-red-600">{confirmTarget}</span>
                  {confirmName.length > confirmTarget.length ? (
                    <span className="text-gray-500">
                      {' '}
                      (first {confirmTarget.length} characters of &quot;{confirmName}&quot;; more
                      is OK if it still matches)
                    </span>
                  ) : null}{' '}
                  to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmation}
                  onChange={(e) =>
                    setDeleteConfirmation(
                      clampDeleteConfirmationInput(e.target.value, confirmName)
                    )
                  }
                  maxLength={getDeleteConfirmationMaxLength(confirmName) || undefined}
                  placeholder={confirmTarget}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowHardDelete(false);
                  setDeleteConfirmation('');
                  setError('');
                }}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
              >
                Back to Archive
              </button>
              <button
                type="button"
                onClick={() => run(() => onPermanentDelete(list))}
                disabled={isSubmitting || !canHardDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
