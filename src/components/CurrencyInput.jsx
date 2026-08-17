import { useState, useEffect, useRef } from 'react';
import { formatCurrency as formatCurrencyAmount, formatCurrencyNumber, localeContextFromBrowser } from '../config/locale.js';

/**
 * CurrencyInput component
 * - Edits as plain number when focused
 * - Blurred value is grouped with cents; the grey prefix is the only $
 * - Uses product/org/property locale resolution (defaults USD / en-US)
 */
export default function CurrencyInput({
  value = null,
  onChange,
  label = 'Amount',
  required = false,
  readOnly = false,
  className = '',
  localeContext,
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState('');
  const inputRef = useRef(null);
  const resolvedLocale = localeContext || localeContextFromBrowser();

  // Format number as currency
  const formatCurrency = (num) => {
    if (num === null || num === undefined || num === '') return '';
    const numValue = typeof num === 'string' ? parseFloat(num.replace(/[^0-9.-]/g, '')) : num;
    if (isNaN(numValue)) return '';
    // Prefix already shows the currency symbol; do not include another in the value.
    return formatCurrencyNumber(numValue, resolvedLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Parse currency string to number
  const parseCurrency = (str) => {
    if (!str) return null;
    const cleaned = str.replace(/[^0-9.-]/g, '');
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  };

  // Update display value when value prop changes (but not when focused)
  useEffect(() => {
    if (!isFocused) {
      if (value === null || value === undefined || value === '') {
        setDisplayValue('');
      } else {
        setDisplayValue(formatCurrency(value));
      }
    }
  }, [value, isFocused]);

  const handleFocus = () => {
    setIsFocused(true);
    // Show raw number when focused
    if (value !== null && value !== undefined && value !== '') {
      setDisplayValue(value.toString());
    } else {
      setDisplayValue('');
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    // Format as currency when blurred
    const numValue = parseCurrency(displayValue);
    if (numValue !== null) {
      setDisplayValue(formatCurrency(numValue));
      if (onChange) {
        onChange(numValue);
      }
    } else {
      setDisplayValue('');
      if (onChange) {
        onChange(null);
      }
    }
  };

  const handleChange = (e) => {
    const inputValue = e.target.value;
    // Allow digits, decimal point, and minus sign
    const cleaned = inputValue.replace(/[^0-9.-]/g, '');
    
    // Prevent multiple decimal points
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      return; // Don't update if multiple decimals
    }
    
    // Prevent multiple minus signs
    if ((cleaned.match(/-/g) || []).length > 1) {
      return;
    }
    
    // Only allow minus at the beginning
    if (cleaned.includes('-') && !cleaned.startsWith('-')) {
      return;
    }

    setDisplayValue(cleaned);
  };

  const handleKeyDown = (e) => {
    // Allow: backspace, delete, tab, escape, enter, decimal point, minus
    if ([8, 9, 27, 13, 46, 110, 190, 189].indexOf(e.keyCode) !== -1 ||
        // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
        (e.keyCode === 65 && e.ctrlKey === true) ||
        (e.keyCode === 67 && e.ctrlKey === true) ||
        (e.keyCode === 86 && e.ctrlKey === true) ||
        (e.keyCode === 88 && e.ctrlKey === true) ||
        // Allow: home, end, left, right
        (e.keyCode >= 35 && e.keyCode <= 39)) {
      return;
    }
    // Ensure that it is a number and stop the keypress
    if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
      e.preventDefault();
    }
  };

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 pointer-events-none">
          $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="0.00"
          required={required}
          readOnly={readOnly}
          disabled={readOnly}
          className={`block w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md shadow-sm ${
            readOnly ? 'bg-gray-100 cursor-not-allowed' : ''
          }`}
        />
      </div>
    </div>
  );
}

/**
 * Format a number as currency for display (read-only)
 */
export function formatCurrencyDisplay(value, localeContext) {
  if (value === null || value === undefined || value === '') return '';
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return '';
  return formatCurrencyAmount(numValue, localeContext || localeContextFromBrowser(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

