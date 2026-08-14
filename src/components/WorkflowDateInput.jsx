import React, { useEffect, useState } from 'react';
import {
  isCompleteWorkflowDate,
  WORKFLOW_DATE_MAX_YEAR,
  WORKFLOW_DATE_MIN_YEAR,
} from '../utils/workflow-date.js';

/**
 * Date input that keeps browser draft values while typing so month/day
 * are not wiped when the year is still incomplete. Parent state only
 * updates for empty or complete valid dates (year 1900–2200).
 */
export default function WorkflowDateInput({
  value = '',
  onChange,
  label,
  required = false,
  error = '',
  className = '',
  id,
}) {
  const [draft, setDraft] = useState(value || '');

  useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const handleChange = (e) => {
    const next = e.target.value;
    setDraft(next);

    if (!next) {
      onChange?.('');
      return;
    }

    if (isCompleteWorkflowDate(next)) {
      onChange?.(next);
    }
    // Incomplete / out-of-range years stay in draft only — no parent update,
    // so notice-period calc does not thrash and the UI is not reset to ''.
  };

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}
      <input
        id={id}
        type="date"
        value={draft}
        min={`${WORKFLOW_DATE_MIN_YEAR}-01-01`}
        max={`${WORKFLOW_DATE_MAX_YEAR}-12-31`}
        onChange={handleChange}
        className={`w-full px-3 py-2 border rounded-md ${
          error ? 'border-red-300' : 'border-gray-300'
        } ${className}`}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
