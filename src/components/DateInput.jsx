import React, { useMemo, useRef } from 'react';
import DatePicker from 'react-datepicker';
import {
  formatWorkflowDateMMDDYYYY,
  todayWorkflowDate,
  workflowDateToLocalDate,
} from '../utils/workflow-date.js';

/**
 * Date picker that stores MM-DD-YYYY and parses ISO or US dates without UTC shift.
 * Ignores the spurious onChange react-datepicker can fire when year/month dropdowns mount
 * (which otherwise writes January 1 of the current year).
 */
export default function DateInput({
  value,
  onChange,
  required = false,
  className = '',
  label,
  readOnly = false,
  maxDate = null,
  minDate = null,
  ...props
}) {
  const dateValue = useMemo(() => workflowDateToLocalDate(value), [value]);
  const displayValue = value ? formatWorkflowDateMMDDYYYY(value) : '';
  const openedRef = useRef(false);

  const handleChange = (date) => {
    if (!onChange || !openedRef.current) return;
    if (date) {
      onChange({ target: { value: formatWorkflowDateMMDDYYYY(todayWorkflowDate(date)) } });
    } else {
      onChange({ target: { value: '' } });
    }
  };

  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <DatePicker
        selected={dateValue}
        onChange={handleChange}
        onCalendarOpen={() => {
          openedRef.current = true;
        }}
        dateFormat="MM-dd-yyyy"
        maxDate={maxDate}
        minDate={minDate}
        openToDate={dateValue || undefined}
        customInput={
          <input
            type="text"
            value={displayValue}
            readOnly
            onChange={(e) => {
              e.preventDefault();
            }}
            className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 ${readOnly ? 'bg-gray-100 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
            placeholder="MM-DD-YYYY"
          />
        }
        wrapperClassName="w-full"
        showYearDropdown
        showMonthDropdown
        scrollableYearDropdown
        yearDropdownItemNumber={15}
        required={required}
        readOnly={readOnly}
        disabled={readOnly}
        onChangeRaw={(e) => {
          e.preventDefault();
        }}
        {...props}
      />
    </div>
  );
}
