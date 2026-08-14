import { useState, useEffect } from 'react';

/**
 * SINInput component for Canadian Social Insurance Numbers
 * Format: XXX XXX XXX (with spaces, no hyphens)
 * Validates format and checksum using Luhn algorithm
 */
export default function SINInput({
  value = '',
  onChange,
  label = 'Social Insurance Number',
  required = false,
  readOnly = false,
  className = ''
}) {
  const [displayValue, setDisplayValue] = useState('');
  const [error, setError] = useState('');

  // Format SIN: XXX XXX XXX (spaces, no hyphens)
  const formatSIN = (str) => {
    const cleaned = str.replace(/\D/g, '');
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)}`;
  };

  // Luhn algorithm for SIN validation
  const validateSINChecksum = (sin) => {
    const cleaned = sin.replace(/\D/g, '');
    if (cleaned.length !== 9) return false;

    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let digit = parseInt(cleaned[i]);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) {
          digit = Math.floor(digit / 10) + (digit % 10);
        }
      }
      sum += digit;
    }
    return sum % 10 === 0;
  };

  // Validate SIN format
  const validateSIN = (sin) => {
    if (!sin) return { valid: true, message: '' };
    const cleaned = sin.replace(/\D/g, '');
    
    // Must be 9 digits
    if (cleaned.length !== 9) {
      return { valid: false, message: 'SIN must be 9 digits' };
    }

    // Cannot be all zeros
    if (cleaned === '000000000') {
      return { valid: false, message: 'Invalid SIN' };
    }

    // First digit cannot be 0 or 8
    if (cleaned[0] === '0' || cleaned[0] === '8') {
      return { valid: false, message: 'Invalid SIN' };
    }

    // Validate checksum
    if (!validateSINChecksum(cleaned)) {
      return { valid: false, message: 'Invalid SIN checksum' };
    }

    return { valid: true, message: '' };
  };

  useEffect(() => {
    if (value) {
      setDisplayValue(formatSIN(value));
      const validation = validateSIN(value);
      setError(validation.message);
    } else {
      setDisplayValue('');
      setError('');
    }
  }, [value]);

  const handleChange = (e) => {
    const inputValue = e.target.value;
    const formatted = formatSIN(inputValue);
    setDisplayValue(formatted);
    
    const cleaned = formatted.replace(/\D/g, '');
    const validation = validateSIN(formatted);
    setError(validation.message);

    if (onChange) {
      onChange(cleaned.length === 9 ? formatted : formatted);
    }
  };

  const handleBlur = () => {
    const validation = validateSIN(displayValue);
    setError(validation.message);
  };

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <input
        type="text"
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="XXX XXX XXX"
        maxLength={11} // XXX XXX XXX
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

