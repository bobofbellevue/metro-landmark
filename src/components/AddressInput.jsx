import { useState, useEffect, useRef } from 'react';
import { getCountryByCode, getRegionsForCountry, validateUSZipCode, validateCanadianPostalCode, formatUSZipCode, formatCanadianPostalCode, searchCountries } from '../utils/countryData';

/**
 * AddressInput component with country selection and validation
 * Supports US, Canadian, and international addresses
 */
export default function AddressInput({
  value = {},
  onChange,
  label = 'Address',
  required = false,
  readOnly = false,
  className = '',
  onCityBlur = null // Optional callback when city field loses focus
}) {
  const [address, setAddress] = useState({
    address_line_1: '',
    address_line_2: '',
    city: '',
    state_province_region: '',
    postal_code: '',
    country: 'US',
    ...value
  });

  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [countrySearchTerm, setCountrySearchTerm] = useState('');
  const countryDropdownRef = useRef(null);
  const countryInputRef = useRef(null);

  const regions = getRegionsForCountry(address.country);
  const selectedCountry = getCountryByCode(address.country);

  // Update local state when value prop changes
  useEffect(() => {
    if (value) {
      setAddress(prev => ({ ...prev, ...value }));
    }
  }, [value]);

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

  const handleFieldChange = (field, fieldValue) => {
    const newAddress = { ...address, [field]: fieldValue };
    
    // Auto-format postal/zip codes
    if (field === 'postal_code' && fieldValue) {
      if (newAddress.country === 'US') {
        newAddress.postal_code = formatUSZipCode(fieldValue);
      } else if (newAddress.country === 'CA') {
        newAddress.postal_code = formatCanadianPostalCode(fieldValue);
      }
    }

    setAddress(newAddress);
    if (onChange) {
      onChange(newAddress);
    }
  };

  const handleCountrySelect = (country) => {
    const newAddress = {
      ...address,
      country: country.code,
      state_province_region: '', // Clear state/province when country changes
      postal_code: '' // Clear postal code when country changes
    };
    setAddress(newAddress);
    setShowCountryDropdown(false);
    setCountrySearchTerm('');
    if (onChange) {
      onChange(newAddress);
    }
  };

  const filteredCountries = searchCountries(countrySearchTerm);

  // Validation
  const postalValidation = address.country === 'US' 
    ? validateUSZipCode(address.postal_code)
    : address.country === 'CA'
    ? validateCanadianPostalCode(address.postal_code)
    : { valid: true, message: '' };

  return (
    <div className={`space-y-3 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {/* Country Selection - First */}
      <div className="relative">
        <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
        <div className="relative">
          <input
            ref={countryInputRef}
            type="text"
            value={countrySearchTerm || selectedCountry.name}
            onChange={(e) => {
              setCountrySearchTerm(e.target.value);
              setShowCountryDropdown(true);
            }}
            onFocus={() => setShowCountryDropdown(true)}
            placeholder="Search country..."
            readOnly={readOnly}
            disabled={readOnly}
            className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          />
          {showCountryDropdown && !readOnly && (
            <div
              ref={countryDropdownRef}
              className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto overflow-x-hidden"
            >
              {filteredCountries.map((country) => (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => handleCountrySelect(country)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
                >
                  <span className="text-xl">{country.flag}</span>
                  <span>{country.name}</span>
                  <span className="ml-auto text-sm text-gray-500">+{country.phoneCode}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Address Line 1 */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Address Line 1
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <input
          type="text"
          value={address.address_line_1 || ''}
          onChange={(e) => handleFieldChange('address_line_1', e.target.value)}
          placeholder="Street address"
          required={required}
          readOnly={readOnly}
          disabled={readOnly}
          className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
        />
      </div>

      {/* Address Line 2 */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Address Line 2</label>
        <input
          type="text"
          value={address.address_line_2 || ''}
          onChange={(e) => handleFieldChange('address_line_2', e.target.value)}
          placeholder="Apartment, suite, etc. (optional)"
          readOnly={readOnly}
          disabled={readOnly}
          className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
        />
      </div>

      {/* City and State/Province */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            City
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <input
            type="text"
            value={address.city || ''}
            onChange={(e) => handleFieldChange('city', e.target.value)}
            onBlur={() => {
              if (onCityBlur) {
                onCityBlur(address);
              }
            }}
            placeholder="City"
            required={required}
            readOnly={readOnly}
            disabled={readOnly}
            className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {address.country === 'US' ? 'State' : address.country === 'CA' ? 'Province' : 'State/Province/Region'}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {regions.length > 0 ? (
            <select
              value={address.state_province_region || ''}
              onChange={(e) => handleFieldChange('state_province_region', e.target.value)}
              required={required}
              readOnly={readOnly}
              disabled={readOnly}
              className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
            >
              <option value="">Select...</option>
              {regions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={address.state_province_region || ''}
              onChange={(e) => handleFieldChange('state_province_region', e.target.value)}
              placeholder="State/Province/Region"
              required={required}
              readOnly={readOnly}
              disabled={readOnly}
              className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
            />
          )}
        </div>
      </div>

      {/* Postal/ZIP Code */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {address.country === 'US' ? 'ZIP Code' : address.country === 'CA' ? 'Postal Code' : 'Postal/ZIP Code'}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <input
          type="text"
          value={address.postal_code || ''}
          onChange={(e) => handleFieldChange('postal_code', e.target.value)}
          placeholder={address.country === 'US' ? '12345 or 12345-6789' : address.country === 'CA' ? 'A1A 1A1' : 'Postal code'}
          required={required}
          readOnly={readOnly}
          disabled={readOnly}
          className={`block w-full px-3 py-2 border rounded-md shadow-sm ${
            postalValidation.valid || !address.postal_code
              ? 'border-gray-300'
              : 'border-red-300'
          } ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
        />
        {!postalValidation.valid && address.postal_code && (
          <p className="mt-1 text-xs text-red-600">{postalValidation.message}</p>
        )}
      </div>
    </div>
  );
}

