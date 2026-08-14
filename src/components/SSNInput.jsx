import { useState, useEffect } from 'react';

/**
 * SSNInput component for US Social Security Numbers
 * Format: XXX-XX-XXXX
 * Validates format and checksum
 */
export default function SSNInput({
  value = '',
  onChange,
  label = 'Social Security Number',
  required = false,
  readOnly = false,
  className = ''
}) {
  const [displayValue, setDisplayValue] = useState('');
  const [error, setError] = useState('');

  // Format SSN: XXX-XX-XXXX
  const formatSSN = (str) => {
    const cleaned = str.replace(/\D/g, '');
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 5) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(5, 9)}`;
  };

  // Validate SSN format
  const validateSSN = (ssn) => {
    if (!ssn) return { valid: true, message: '' };
    const cleaned = ssn.replace(/\D/g, '');
    
    // Must be 9 digits
    if (cleaned.length !== 9) {
      return { valid: false, message: 'SSN must be 9 digits' };
    }

    // Cannot be all zeros
    if (cleaned === '000000000') {
      return { valid: false, message: 'Invalid SSN' };
    }

    // First 3 digits cannot be 000
    if (cleaned.slice(0, 3) === '000') {
      return { valid: false, message: 'Invalid SSN' };
    }

    // Middle 2 digits cannot be 00
    if (cleaned.slice(3, 5) === '00') {
      return { valid: false, message: 'Invalid SSN' };
    }

    // Last 4 digits cannot be 0000
    if (cleaned.slice(5) === '0000') {
      return { valid: false, message: 'Invalid SSN' };
    }

    // Cannot start with 666
    if (cleaned.slice(0, 3) === '666') {
      return { valid: false, message: 'Invalid SSN' };
    }

    // Cannot be in range 987-65-4320 through 987-65-4329 (advertising range)
    if (cleaned.slice(0, 3) === '987' && cleaned.slice(3, 5) === '65' && 
        cleaned.slice(5, 9) >= '4320' && cleaned.slice(5, 9) <= '4329') {
      return { valid: false, message: 'Invalid SSN' };
    }

    return { valid: true, message: '' };
  };

  useEffect(() => {
    if (value && value.trim() !== '') {
      setDisplayValue(formatSSN(value));
      const validation = validateSSN(value);
      setError(validation.message);
    } else {
      setDisplayValue('');
      setError('');
    }
  }, [value]);

  const handleChange = (e) => {
    const inputValue = e.target.value;
    const formatted = formatSSN(inputValue);
    setDisplayValue(formatted);
    
    const cleaned = formatted.replace(/\D/g, '');
    const validation = validateSSN(formatted);
    setError(validation.message);

    if (onChange) {
      onChange(cleaned.length === 9 ? formatted : formatted);
    }
  };

  const handleBlur = () => {
    const validation = validateSSN(displayValue);
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
        placeholder="XXX-XX-XXXX"
        maxLength={11} // XXX-XX-XXXX
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

