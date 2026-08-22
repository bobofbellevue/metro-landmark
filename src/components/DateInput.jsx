import React, { forwardRef, useMemo, useRef } from 'react';
import DatePicker from 'react-datepicker';
import { Calendar } from 'lucide-react';
import {
  formatWorkflowDateMMDDYYYY,
  todayWorkflowDate,
  workflowDateToLocalDate,
} from '../utils/workflow-date.js';

const DatePickerFieldInput = forwardRef(function DatePickerFieldInput(
  { className = '', disabled, ...rest },
  ref
) {
  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      disabled={disabled}
      className={`block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 ${
        disabled ? 'bg-gray-100 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    />
  );
});

/**
 * Date picker that stores MM-DD-YYYY and parses ISO or US dates without UTC shift.
 * Ignores the spurious onChange react-datepicker can fire when year/month dropdowns mount
 * (which otherwise writes January 1 of the current year).
 * Year dropdown spans 120 years so Date of Birth is not limited to a ~15-year child window
 * when maxDate is today (react-datepicker trims future years from the generated list).
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
  yearDropdownItemNumber = 120,
  ...props
}) {
  const dateValue = useMemo(() => workflowDateToLocalDate(value), [value]);
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
      <div className="relative">
        <DatePicker
          {...props}
          selected={dateValue}
          onChange={handleChange}
          onCalendarOpen={() => {
            openedRef.current = true;
          }}
          dateFormat="MM-dd-yyyy"
          maxDate={maxDate}
          minDate={minDate}
          openToDate={dateValue || undefined}
          placeholderText="MM-DD-YYYY"
          customInput={<DatePickerFieldInput className={className} />}
          wrapperClassName="w-full"
          popperClassName="datepicker-popper-portal"
          portalId="root"
          enableTabLoop={false}
          showYearDropdown
          showMonthDropdown
          scrollableYearDropdown
          yearDropdownItemNumber={yearDropdownItemNumber}
          required={required}
          readOnly={readOnly}
          disabled={readOnly}
          onChangeRaw={(e) => {
            e.preventDefault();
          }}
        />
        <Calendar
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        />
      </div>
    </div>
  );
}
