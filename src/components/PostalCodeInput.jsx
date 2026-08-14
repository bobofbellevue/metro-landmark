import { useState, useEffect } from 'react';
import { validateUSZipCode, validateCanadianPostalCode, formatUSZipCode, formatCanadianPostalCode } from '../utils/countryData';

/**
 * PostalCodeInput component
 * Supports US ZIP codes and Canadian postal codes
 * Auto-formats and validates based on country
 */
export default function PostalCodeInput({
  value = '',
  onChange,
  country = 'US', // 'US' or 'CA'
  label = 'Postal Code',
  required = false,
  readOnly = false,
  className = ''
}) {
  const [displayValue, setDisplayValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (value) {
      if (country === 'US') {
        setDisplayValue(formatUSZipCode(value));
      } else if (country === 'CA') {
        setDisplayValue(formatCanadianPostalCode(value));
      } else {
        setDisplayValue(value);
      }
    } else {
      setDisplayValue('');
    }
  }, [value, country]);

  const handleChange = (e) => {
    const inputValue = e.target.value;
    let formatted = inputValue;
    let cleaned = inputValue;

    if (country === 'US') {
      cleaned = inputValue.replace(/\D/g, '');
      formatted = formatUSZipCode(cleaned);
    } else if (country === 'CA') {
      cleaned = inputValue.replace(/[\s-]/g, '').toUpperCase();
      formatted = formatCanadianPostalCode(cleaned);
    }

    setDisplayValue(formatted);

    // Validate
    const validation = country === 'US' 
      ? validateUSZipCode(formatted)
      : country === 'CA'
      ? validateCanadianPostalCode(formatted)
      : { valid: true, message: '' };

    setError(validation.message);

    if (onChange) {
      onChange(formatted);
    }
  };

  const handleBlur = () => {
    const validation = country === 'US' 
      ? validateUSZipCode(displayValue)
      : country === 'CA'
      ? validateCanadianPostalCode(displayValue)
      : { valid: true, message: '' };

    setError(validation.message);
  };

  const placeholder = country === 'US' 
    ? '12345 or 12345-6789'
    : country === 'CA'
    ? 'A1A 1A1'
    : 'Postal code';

  const labelText = country === 'US' 
    ? 'ZIP Code'
    : country === 'CA'
    ? 'Postal Code'
    : label;

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {labelText}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <input
        type="text"
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        required={required}
        readOnly={readOnly}
        disabled={readOnly}
        className={`block w-full px-3 py-2 border rounded-md shadow-sm ${
          error ? 'border-red-300' : 'border-gray-300'
        } ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
      />
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

