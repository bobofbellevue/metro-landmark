import React, { useEffect, useState } from 'react';
import { toWorkflowTimeValue } from '../utils/workflow-time.js';

/**
 * Native time input (HH:MM). Counterpart to WorkflowDateInput.
 */
export default function WorkflowTimeInput({
  value = '',
  onChange,
  label,
  required = false,
  error = '',
  className = '',
  id,
}) {
  const normalized = toWorkflowTimeValue(value);
  const [draft, setDraft] = useState(normalized);

  useEffect(() => {
    setDraft(toWorkflowTimeValue(value));
  }, [value]);

  const handleChange = (e) => {
    const next = e.target.value;
    setDraft(next);
    onChange?.(toWorkflowTimeValue(next));
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
        type="time"
        value={draft}
        onChange={handleChange}
        className={`w-full px-3 py-2 border rounded-md ${
          error ? 'border-red-300' : 'border-gray-300'
        } ${className}`}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
