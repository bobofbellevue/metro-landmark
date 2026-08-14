import { useState, useEffect, useRef } from 'react';
import { countries, getCountryByPhoneCode, searchCountries } from '../utils/countryData';

/**
 * PhoneInput component with country code selector and flag display
 * Supports international phone numbers with country codes
 */
export default function PhoneInput({
  value = '',
  onChange,
  label = 'Phone Number',
  required = false,
  readOnly = false,
  className = '',
  defaultCountryCode = '1' // Default to US
}) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState(defaultCountryCode);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [countrySearchTerm, setCountrySearchTerm] = useState('');
  const countryDropdownRef = useRef(null);
  const countryInputRef = useRef(null);

  // Parse initial value if it includes country code
  useEffect(() => {
    if (value) {
      // Try multiple formats to extract country code and phone number
      // Format 1: +1 1234567890 or +1 (123) 456-7890
      // Format 2: US+1 1234567890 (with country name prefix)
      // Format 3: 1-1234567890 or 1 1234567890
      // Format 4: Just digits (assume US country code)
      
      let extractedCode = defaultCountryCode;
      let extractedNumber = '';
      
      // Try to match formats with country code prefix (e.g., +1, US+1, etc.)
      const matchWithCode = value.match(/(?:US\s*)?\+?(\d{1,3})[\s-]?(.+)$/i);
      if (matchWithCode) {
        extractedCode = matchWithCode[1];
        extractedNumber = matchWithCode[2];
      } else {
        // No country code found, try to extract just digits
        const digitsOnly = value.replace(/\D/g, '');
        // If it starts with 1 and has 11 digits, assume US country code
        if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
          extractedCode = '1';
          extractedNumber = digitsOnly.slice(1);
        } else if (digitsOnly.length === 10) {
          // 10 digits, assume US without country code
          extractedCode = '1';
          extractedNumber = digitsOnly;
      } else {
        extractedNumber = digitsOnly;
      }
      }
      
      const cleanedNumber = extractedNumber.replace(/\D/g, '');
      
      const country = getCountryByPhoneCode(extractedCode);
      if (country) {
        setCountryCode(extractedCode);
        setPhoneNumber(cleanedNumber);
      } else {
        setCountryCode(defaultCountryCode);
        setPhoneNumber(cleanedNumber);
      }
    } else {
      setPhoneNumber('');
      setCountryCode(defaultCountryCode);
    }
  }, [value, defaultCountryCode]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target) &&
          countryInputRef.current && !countryInputRef.current.contains(event.target)) {
        setShowCountryDropdown(false);
        setCountrySearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedCountry = getCountryByPhoneCode(countryCode) || countries[0];

  const handlePhoneChange = (e) => {
    const inputValue = e.target.value.replace(/\D/g, '');
    setPhoneNumber(inputValue);
    
    const formatted = formatPhoneNumber(inputValue, countryCode);
    if (onChange) {
      onChange(formatted);
    }
  };

  const handleCountrySelect = (country) => {
    setCountryCode(country.phoneCode);
    setShowCountryDropdown(false);
    setCountrySearchTerm('');
    
    const formatted = formatPhoneNumber(phoneNumber, country.phoneCode);
    if (onChange) {
      onChange(formatted);
    }
  };

  const formatPhoneNumber = (number, code) => {
    if (!number) return '';
    // Format based on country code
    if (code === '1') {
      // US/Canada format: (123) 456-7890
      const cleaned = number.replace(/\D/g, '');
      if (cleaned.length <= 3) return `+${code} ${cleaned}`;
      if (cleaned.length <= 6) return `+${code} (${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
      return `+${code} (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    }
    // International format: +86 123 4567 8901
    return `+${code} ${number}`;
  };

  const getDisplayValue = () => {
    if (!phoneNumber) return '';
    if (countryCode === '1') {
      const cleaned = phoneNumber.replace(/\D/g, '');
      if (cleaned.length <= 3) return cleaned;
      if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    }
    return phoneNumber;
  };

  const filteredCountries = searchCountries(countrySearchTerm);

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="flex gap-2">
        {/* Country Code Selector */}
        <div className="relative flex-shrink-0">
          <button
            ref={countryInputRef}
            type="button"
            onClick={() => !readOnly && setShowCountryDropdown(!showCountryDropdown)}
            disabled={readOnly}
            className={`flex items-center gap-1 px-2 py-2 border border-gray-300 rounded-md shadow-sm bg-white hover:bg-gray-50 ${
              readOnly ? 'bg-gray-100 cursor-not-allowed' : 'cursor-pointer'
            }`}
            title={`${selectedCountry.name} (+${selectedCountry.phoneCode})`}
          >
            <span className="text-lg">{selectedCountry.flag}</span>
            <span className="text-sm font-medium">+{selectedCountry.phoneCode}</span>
          </button>
          {showCountryDropdown && !readOnly && (
            <div
              ref={countryDropdownRef}
              className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 w-64 overflow-auto"
            >
              <div className="p-2 border-b">
                <input
                  type="text"
                  value={countrySearchTerm}
                  onChange={(e) => setCountrySearchTerm(e.target.value)}
                  placeholder="Search country..."
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                  autoFocus
                />
              </div>
              {filteredCountries.map((country) => (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => handleCountrySelect(country)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
                >
                  <span className="text-xl">{country.flag}</span>
                  <span className="flex-1">{country.name}</span>
                  <span className="text-sm text-gray-500">+{country.phoneCode}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Phone Number Input */}
        <div className="flex-1">
          <input
            type="tel"
            value={getDisplayValue()}
            onChange={handlePhoneChange}
            placeholder={countryCode === '1' ? '(123) 456-7890' : 'Phone number'}
            required={required}
            readOnly={readOnly}
            disabled={readOnly}
            className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          />
        </div>
      </div>
    </div>
  );
}

