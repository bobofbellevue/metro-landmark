import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import DateInput from './DateInput';
import PhoneInput from './PhoneInput';
import AddressInput from './AddressInput';
import CurrencyInput from './CurrencyInput';
import SSNInput from './SSNInput';
import SINInput from './SINInput';
import PostalCodeInput from './PostalCodeInput';

// Helper to get nested value from object using dot notation path
const getNestedValue = (obj, path) => {
  return path.split('.').reduce((current, key) => current?.[key], obj);
};

// Helper to set nested value in object using dot notation path
const setNestedValue = (obj, path, value) => {
  if (!path) return;
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((current, key) => {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    return current[key];
  }, obj);
  if (value === null || value === undefined || value === '') {
    // Remove the key if value is empty
    delete target[lastKey];
    // Clean up empty parent objects
    if (keys.length > 0 && Object.keys(target).length === 0) {
      const parent = keys.reduce((current, key) => current?.[key], obj);
      if (parent) delete parent[keys[keys.length - 1]];
    }
  } else {
    target[lastKey] = value;
  }
};

// Helper to check if an object contains field definitions (not just data)
const isFieldDefinitionObject = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  // Check if any key has a structure that looks like a field definition
  // (has 'type', 'properties', 'items', 'description', etc.)
  return Object.values(obj).some(val => 
    val && typeof val === 'object' && ('type' in val || 'properties' in val || 'items' in val || 'description' in val)
  );
};

// Helper to format field name as label (e.g., "Last_Name" -> "Last Name")
const formatFieldName = (fieldKey) => {
  return fieldKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

// Helper to check if an object has all null/empty values
const isEmptyObject = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.values(obj).every(val => 
    val === null || val === undefined || val === '' || 
    (Array.isArray(val) && val.length === 0) ||
    (typeof val === 'object' && isEmptyObject(val))
  );
};

// Render a field based on its type definition
const FieldRenderer = ({ fieldKey, fieldDef, value, onChange, path = '', readOnly = false }) => {
  const fullPath = path ? `${path}.${fieldKey}` : fieldKey;
  // Note: "required" property has been removed - field requirements are determined by the user
  const description = fieldDef.description || '';
  const isSensitive = fieldDef.sensitive;


  // State for sensitive field visibility
  const [isFocused, setIsFocused] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const handleChange = (newValue) => {
    onChange(fullPath, newValue);
  };

  // Helper function to get display value for sensitive fields
  const getDisplayValue = (actualValue) => {
    if (!isSensitive || !actualValue) return actualValue || '';
    // Show real value when focused or when visibility is toggled on
    if (isFocused || isVisible) return actualValue;
    // Otherwise show asterisks
    return '*'.repeat(Math.min(actualValue.length, 20)); // Cap at 20 asterisks for very long values
  };

  // Handle objects without explicit type that contain field definitions directly
  // (e.g., current_employment which is {employer_name: {...}, employer_address: {...}})
  if (!fieldDef.type && isFieldDefinitionObject(fieldDef)) {
    return (
      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
        <h5 className="text-sm font-semibold text-gray-800 mb-3" title={description || ''}>
          {formatFieldName(fieldKey)}
        </h5>
        <div className="space-y-4">
          {Object.entries(fieldDef).map(([subKey, subDef]) => (
            <FieldRenderer
              key={subKey}
              fieldKey={subKey}
              fieldDef={subDef}
              value={getNestedValue(value, subKey)}
              onChange={(subPath, subValue) => {
                // subPath might be just the field key (like "employer_name") or the full path
                // If it already starts with fullPath (with a dot), use it directly, otherwise prepend fullPath
                const fullSubPath = (subPath === fullPath || subPath.startsWith(`${fullPath}.`))
                  ? subPath 
                  : `${fullPath}.${subPath}`;
                onChange(fullSubPath, subValue);
              }}
              path={fullPath}
              readOnly={readOnly}
            />
          ))}
        </div>
      </div>
    );
  }

  // Handle objects without explicit type (e.g., nested objects with properties)
  if ((fieldDef.type === 'object' || !fieldDef.type) && fieldDef.properties) {
    return (
      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
        <h5 className="text-sm font-semibold text-gray-800 mb-3" title={description || ''}>
          {formatFieldName(fieldKey)}
        </h5>
        <div className="space-y-4">
          {Object.entries(fieldDef.properties).map(([subKey, subDef]) => (
            <FieldRenderer
              key={subKey}
              fieldKey={subKey}
              fieldDef={subDef}
              value={getNestedValue(value, subKey)}
              onChange={(subPath, subValue) => {
                // subPath might be just the field key (like "address_line_1") or the full path
                // If it already starts with fullPath (with a dot), use it directly, otherwise prepend fullPath
                const fullSubPath = (subPath === fullPath || subPath.startsWith(`${fullPath}.`))
                  ? subPath 
                  : `${fullPath}.${subPath}`;
                onChange(fullSubPath, subValue);
              }}
              path={fullPath}
            />
          ))}
        </div>
      </div>
    );
  }

  // Handle arrays without explicit type
  if ((fieldDef.type === 'array' || !fieldDef.type) && fieldDef.items) {
    let arrayValue = Array.isArray(value) ? value : [];
    const itemDef = fieldDef.items;
    const minItems = fieldDef.min_items || 0;
    const maxItems = fieldDef.max_items;

    // Filter out empty items for Applicants array
    if (fieldKey === 'Applicants' || fieldKey.toLowerCase().includes('applicant')) {
      const originalLength = arrayValue.length;
      arrayValue = arrayValue.filter(item => !isEmptyObject(item));
    }

    const handleAddItem = () => {
      if (maxItems && arrayValue.length >= maxItems) return;
      // Create new item based on itemDef type
      let newItem;
      if (itemDef?.type === 'string') {
        newItem = '';
      } else if (itemDef?.type === 'number') {
        newItem = null; // Will be set by user input
      } else if (itemDef?.type === 'boolean') {
        newItem = false;
      } else if (itemDef?.type === 'object' || itemDef?.properties || isFieldDefinitionObject(itemDef)) {
        newItem = {};
      } else {
        // Default to empty string for primitive arrays
        newItem = '';
      }
      onChange(fullPath, [...arrayValue, newItem]);
    };

    const handleRemoveItem = (index) => {
      const newArray = arrayValue.filter((_, i) => i !== index);
      onChange(fullPath, newArray.length > 0 ? newArray : null);
    };

    const handleItemChange = (index, itemPath, itemValue) => {
      const newArray = [...arrayValue];
      // If itemDef is a primitive type (string, number, boolean), treat the item as a primitive value
      if (itemDef?.type === 'string' || itemDef?.type === 'number' || itemDef?.type === 'boolean') {
        // For primitive arrays, itemPath should be "value" and we set the item directly
        if (itemPath === 'value' || !itemPath.includes('.')) {
          newArray[index] = itemValue;
        } else {
          // Fallback: if somehow we have nested paths for primitives, handle as object
          if (typeof newArray[index] !== 'object' || newArray[index] === null) {
            newArray[index] = {};
          }
          setNestedValue(newArray[index], itemPath, itemValue);
        }
      } else if (itemPath.includes('.')) {
        // For object items with nested paths
        if (typeof newArray[index] !== 'object' || newArray[index] === null) {
          newArray[index] = {};
        }
        setNestedValue(newArray[index], itemPath, itemValue);
      } else {
        // For object items with simple property paths
        if (typeof newArray[index] !== 'object' || newArray[index] === null) {
          newArray[index] = {};
        }
        newArray[index] = { ...newArray[index], [itemPath]: itemValue };
      }
      onChange(fullPath, newArray);
    };

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700" title={description || ''}>
            {formatFieldName(fieldKey)}
            {minItems > 0 && (
              <span className="text-gray-500 text-xs ml-2">(Minimum {minItems})</span>
            )}
            {maxItems && (
              <span className="text-gray-500 text-xs ml-2">(Maximum {maxItems})</span>
            )}
          </label>
          {(!maxItems || arrayValue.length < maxItems) && (
            <button
              type="button"
              onClick={handleAddItem}
              className="flex items-center gap-1 px-2 py-1 text-sm text-indigo-600 hover:text-indigo-800"
            >
              <Plus size={16} />
              Add
            </button>
          )}
        </div>
        {arrayValue.map((item, index) => {
          return (
            <div key={index} className="border border-gray-200 rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between mb-3">
                <h6 className="text-sm font-medium text-gray-700" title={description || ''}>
                  {formatFieldName(fieldKey)} #{index + 1}
                </h6>
                {arrayValue.length > minItems && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(index)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {(() => {
                  // Check if itemDef is an object with properties (explicit type: "object")
                  if (itemDef.type === 'object' && itemDef.properties) {
                    // Sort entries to put 'type' field last (if it exists) to avoid displaying it first
                    const entries = Object.entries(itemDef.properties);
                    const sortedEntries = entries.sort(([keyA], [keyB]) => {
                      // Put 'type' field at the end
                      if (keyA === 'type') return 1;
                      if (keyB === 'type') return -1;
                      return 0;
                    });
                    
                    return sortedEntries.map(([subKey, subDef]) => (
                      <FieldRenderer
                        key={subKey}
                        fieldKey={subKey}
                        fieldDef={subDef}
                        value={item[subKey]}
                        onChange={(subPath, subValue) => {
                          handleItemChange(index, subPath, subValue);
                        }}
                        path=""
                      />
                    ));
                  }
                  // Check if itemDef is an object containing field definitions directly
                  else if (!itemDef.type && isFieldDefinitionObject(itemDef)) {
                    // Sort entries to put 'type' field last (if it exists) to avoid displaying it first
                    const entries = Object.entries(itemDef);
                    const sortedEntries = entries.sort(([keyA], [keyB]) => {
                      // Put 'type' field at the end
                      if (keyA === 'type') return 1;
                      if (keyB === 'type') return -1;
                      return 0;
                    });
                    
                    return sortedEntries.map(([subKey, subDef]) => (
                      <FieldRenderer
                        key={subKey}
                        fieldKey={subKey}
                        fieldDef={subDef}
                        value={item[subKey]}
                        onChange={(subPath, subValue) => {
                          handleItemChange(index, subPath, subValue);
                        }}
                        path=""
                      />
                    ));
                  }
                  // Otherwise render as a single field
                  else {
                    return (
                      <FieldRenderer
                        fieldKey="value"
                        fieldDef={itemDef}
                        value={item}
                        onChange={(_, subValue) => {
                          handleItemChange(index, 'value', subValue);
                        }}
                        path=""
                      />
                    );
                  }
                })()}
              </div>
            </div>
          );
        })}
        {arrayValue.length < minItems && (
          <button
            type="button"
            onClick={handleAddItem}
            className="w-full px-3 py-2 text-sm text-indigo-600 border border-indigo-300 rounded-md hover:bg-indigo-50"
          >
            <Plus size={16} className="inline mr-1" />
            Add {minItems - arrayValue.length} more item{minItems - arrayValue.length > 1 ? 's' : ''}
          </button>
        )}
      </div>
    );
  }

  // Helper to detect field type from field name
  const detectFieldType = (fieldKey, fieldDef) => {
    const keyLower = fieldKey.toLowerCase();
    
    // Phone number detection
    if (keyLower.includes('phone') || keyLower.includes('telephone') || keyLower.includes('mobile') || keyLower.includes('cell')) {
      return 'phone';
    }
    
    // SSN detection
    if (keyLower.includes('ssn') || keyLower.includes('social_security') || keyLower.includes('socialsecurity')) {
      return 'ssn';
    }
    
    // SIN detection
    if (keyLower.includes('sin') || keyLower.includes('social_insurance') || keyLower.includes('socialinsurance')) {
      return 'sin';
    }
    
    // Address detection
    if (keyLower.includes('address') && (fieldDef.type === 'object' || fieldDef.properties)) {
      return 'address';
    }
    
    // Postal/ZIP code detection
    if (keyLower.includes('postal') || keyLower.includes('zip') || keyLower.includes('postcode')) {
      return 'postal';
    }
    
    // Currency detection (for string fields that might contain currency)
    if (keyLower.includes('currency') || keyLower.includes('amount') || keyLower.includes('price') || 
        keyLower.includes('rent') || keyLower.includes('fee') || keyLower.includes('deposit') ||
        keyLower.includes('cost') || keyLower.includes('payment') || keyLower.includes('salary') ||
        keyLower.includes('income') || keyLower.includes('wage')) {
      if (fieldDef.type === 'number') {
        return 'currency';
      }
    }
    
    return null;
  };

  switch (fieldDef.type) {
    case 'string':
      // Check for specialized field types
      const stringFieldType = detectFieldType(fieldKey, fieldDef);
      
      if (stringFieldType === 'phone') {
        return (
          <PhoneInput
            value={value || ''}
            onChange={(formatted) => handleChange(formatted)}
            label={formatFieldName(fieldKey)}
            readOnly={readOnly}
            className=""
          />
        );
      }
      
      if (stringFieldType === 'ssn') {
        return (
          <SSNInput
            value={value || ''}
            onChange={(formatted) => handleChange(formatted)}
            label={formatFieldName(fieldKey)}
            readOnly={readOnly}
            className=""
          />
        );
      }
      
      if (stringFieldType === 'sin') {
        return (
          <SINInput
            value={value || ''}
            onChange={(formatted) => handleChange(formatted)}
            label={formatFieldName(fieldKey)}
            readOnly={readOnly}
            className=""
          />
        );
      }
      
      if (stringFieldType === 'postal') {
        // Try to determine country from parent context or default to US
        const country = value?.country || 'US';
        return (
          <PostalCodeInput
            value={value || ''}
            onChange={(formatted) => handleChange(formatted)}
            country={country}
            label={formatFieldName(fieldKey)}
            readOnly={readOnly}
            className=""
          />
        );
      }
      
      if (fieldDef.format === 'MM/YYYY' || fieldDef.format === 'MM/YY') {
        // Month/Year input - normalize MM/YY to MM/YYYY format
        const normalizeMonthYear = (val) => {
          if (!val) return '';
          // If value is in MM/YY format, convert to MM/YYYY
          const mmYyMatch = val.match(/^(\d{2})\/(\d{2})$/);
          if (mmYyMatch) {
            const month = mmYyMatch[1];
            const year = mmYyMatch[2];
            // Assume years 00-30 are 2000-2030, years 31-99 are 1931-1999
            const fullYear = parseInt(year) <= 30 ? `20${year}` : `19${year}`;
            return `${month}/${fullYear}`;
          }
          return val;
        };
        
        const displayValue = normalizeMonthYear(getDisplayValue(value));
        
        return (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700" title={description || ''}>
              {formatFieldName(fieldKey)}
            </label>
            <div className="relative">
              <input
                type="text"
                value={displayValue}
                onChange={(e) => {
                  const normalized = normalizeMonthYear(e.target.value);
                  handleChange(normalized);
                }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="MM/YYYY"
                pattern="[0-9]{2}/[0-9]{4}"
                className={`block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm ${
                  isSensitive ? 'bg-yellow-50' : ''
                }`}
              />
              {isSensitive && (
                <button
                  type="button"
                  onClick={() => setIsVisible(!isVisible)}
                  onMouseDown={(e) => e.preventDefault()} // Prevent input blur
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                  title={isVisible ? 'Hide' : 'Show'}
                >
                  {isVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              )}
            </div>
          </div>
        );
      }
      return (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700" title={description || ''}>
            {formatFieldName(fieldKey)}
          </label>
          <div className="relative">
            <input
              type="text"
              value={getDisplayValue(value)}
              onChange={(e) => handleChange(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              readOnly={readOnly}
              disabled={readOnly}
              className={`block w-full px-3 py-2 ${isSensitive ? 'pr-10' : ''} border border-gray-300 rounded-md shadow-sm ${
                isSensitive ? 'bg-yellow-50' : ''
              } ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
            />
            {isSensitive && (
              <button
                type="button"
                onClick={() => setIsVisible(!isVisible)}
                onMouseDown={(e) => e.preventDefault()} // Prevent input blur
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                title={isVisible ? 'Hide' : 'Show'}
              >
                {isVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            )}
          </div>
        </div>
      );

    case 'number':
      // Check for currency field type
      const numberFieldType = detectFieldType(fieldKey, fieldDef);
      
      if (numberFieldType === 'currency') {
        return (
          <CurrencyInput
            value={value}
            onChange={(numValue) => handleChange(numValue)}
            label={formatFieldName(fieldKey)}
            readOnly={readOnly}
            className=""
          />
        );
      }
      
      return (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700" title={description || ''}>
            {formatFieldName(fieldKey)}
          </label>
          <input
            type="number"
            value={value !== null && value !== undefined ? value : ''}
            onChange={(e) => {
              const inputValue = e.target.value;
              // Allow empty string, '0', and other numeric values
              if (inputValue === '') {
                handleChange(null);
              } else {
                const numValue = parseFloat(inputValue);
                handleChange(isNaN(numValue) ? null : numValue);
              }
            }}
            step="any"
            readOnly={readOnly}
            disabled={readOnly}
            className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          />
        </div>
      );

    case 'date': {
      // Ensure value is a string, not an object
      const dateValue = typeof value === 'string' ? value : (value && typeof value === 'object' ? '' : String(value || ''));
      return (
        <DateInput
          label={formatFieldName(fieldKey)}
          value={dateValue}
          onChange={(e) => handleChange(e.target.value || null)}
          readOnly={readOnly}
        />
      );
    }

    case 'datetime':
      return (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700" title={description || ''}>
            {formatFieldName(fieldKey)}
          </label>
          <input
            type="datetime-local"
            value={value || ''}
            onChange={(e) => handleChange(e.target.value || null)}
            readOnly={readOnly}
            disabled={readOnly}
            className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          />
        </div>
      );

    case 'boolean':
      return (
        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            checked={value || false}
            onChange={(e) => handleChange(e.target.checked)}
            readOnly={readOnly}
            disabled={readOnly}
            className={`h-4 w-4 text-indigo-600 border-gray-300 rounded ${readOnly ? 'cursor-not-allowed opacity-50' : ''}`}
          />
          <label className="text-sm font-medium text-gray-700" title={description || ''}>
            {formatFieldName(fieldKey)}
          </label>
        </div>
      );

    case 'object':
      // Check if this is an address object
      const objectFieldType = detectFieldType(fieldKey, fieldDef);
      
      if (objectFieldType === 'address') {
        return (
          <AddressInput
            value={value || {}}
            onChange={(addressObj) => handleChange(addressObj)}
            label={formatFieldName(fieldKey)}
            readOnly={readOnly}
            className=""
          />
        );
      }
      
      // This case should rarely be hit now since we handle objects without type above
      if (fieldDef.properties) {
        return (
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <h5 className="text-sm font-semibold text-gray-800 mb-3" title={description || ''}>
              {formatFieldName(fieldKey)}
            </h5>
            <div className="space-y-4">
              {Object.entries(fieldDef.properties).map(([subKey, subDef]) => {
                // For address objects, check if we have address_line_1 or similar
                const isAddressField = subKey.includes('address') || subKey.includes('postal') || subKey.includes('zip');
                const isPostalField = subKey.includes('postal') || subKey.includes('zip');
                
                // If this is a postal code field within an address, use PostalCodeInput
                if (isPostalField && (subKey.includes('postal') || subKey.includes('zip'))) {
                  const country = value?.country || 'US';
                  return (
                    <PostalCodeInput
                      key={subKey}
                      value={getNestedValue(value, subKey) || ''}
                      onChange={(formatted) => {
                        const fullSubPath = `${fullPath}.${subKey}`;
                        onChange(fullSubPath, formatted);
                      }}
                      country={country}
                      label={formatFieldName(subKey)}
                      readOnly={readOnly}
                      className=""
                    />
                  );
                }
                
                return (
                  <FieldRenderer
                    key={subKey}
                    fieldKey={subKey}
                    fieldDef={subDef}
                    value={getNestedValue(value, subKey)}
                    onChange={(subPath, subValue) => {
                      const fullSubPath = `${fullPath}.${subPath}`;
                      onChange(fullSubPath, subValue);
                    }}
                    path={fullPath}
                    readOnly={readOnly}
                  />
                );
              })}
            </div>
          </div>
        );
      }
      return null;

    case 'array': {
      const arrayValue = Array.isArray(value) ? value : [];
      const itemDef = fieldDef.items;
      const minItems = fieldDef.min_items || 0;
      const maxItems = fieldDef.max_items;

      const handleAddItem = () => {
        if (maxItems && arrayValue.length >= maxItems) return;
        // Create new item based on itemDef type
        let newItem;
        if (itemDef?.type === 'string') {
          newItem = '';
        } else if (itemDef?.type === 'number') {
          newItem = null; // Will be set by user input
        } else if (itemDef?.type === 'boolean') {
          newItem = false;
        } else if (itemDef?.type === 'object' || itemDef?.properties || isFieldDefinitionObject(itemDef)) {
          newItem = {};
        } else {
          // Default to empty string for primitive arrays
          newItem = '';
        }
        onChange(fullPath, [...arrayValue, newItem]);
      };

      const handleRemoveItem = (index) => {
        const newArray = arrayValue.filter((_, i) => i !== index);
        onChange(fullPath, newArray.length > 0 ? newArray : null);
      };

      const handleItemChange = (index, itemPath, itemValue) => {
        const newArray = [...arrayValue];
        // If itemDef is a primitive type (string, number, boolean), treat the item as a primitive value
        if (itemDef?.type === 'string' || itemDef?.type === 'number' || itemDef?.type === 'boolean') {
          // For primitive arrays, itemPath should be "value" and we set the item directly
          if (itemPath === 'value' || !itemPath.includes('.')) {
            newArray[index] = itemValue;
          } else {
            // Fallback: if somehow we have nested paths for primitives, handle as object
            if (typeof newArray[index] !== 'object' || newArray[index] === null) {
              newArray[index] = {};
            }
            setNestedValue(newArray[index], itemPath, itemValue);
          }
        } else if (itemPath.includes('.')) {
          // For object items with nested paths
          if (typeof newArray[index] !== 'object' || newArray[index] === null) {
            newArray[index] = {};
          }
          setNestedValue(newArray[index], itemPath, itemValue);
        } else {
          // For object items with simple property paths
          if (typeof newArray[index] !== 'object' || newArray[index] === null) {
            newArray[index] = {};
          }
          newArray[index] = { ...newArray[index], [itemPath]: itemValue };
        }
        onChange(fullPath, newArray);
      };

      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700" title={description || ''}>
              {formatFieldName(fieldKey)}
              {minItems > 0 && (
                <span className="text-gray-500 text-xs ml-2">(Minimum {minItems})</span>
              )}
              {maxItems && (
                <span className="text-gray-500 text-xs ml-2">(Maximum {maxItems})</span>
              )}
            </label>
            {(!readOnly && (!maxItems || arrayValue.length < maxItems)) && (
              <button
                type="button"
                onClick={handleAddItem}
                className="flex items-center gap-1 px-2 py-1 text-sm text-indigo-600 hover:text-indigo-800"
              >
                <Plus size={16} />
                Add
              </button>
            )}
          </div>
          {arrayValue.map((item, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between mb-3">
                <h6 className="text-sm font-medium text-gray-700" title={description || ''}>
                  {formatFieldName(fieldKey)} #{index + 1}
                </h6>
                {!readOnly && arrayValue.length > minItems && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(index)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {(() => {
                  // Check if itemDef is an object with properties (explicit type: "object")
                  if (itemDef.type === 'object' && itemDef.properties) {
                    // Sort entries to put 'type' field last (if it exists) to avoid displaying it first
                    const entries = Object.entries(itemDef.properties);
                    const sortedEntries = entries.sort(([keyA], [keyB]) => {
                      // Put 'type' field at the end
                      if (keyA === 'type') return 1;
                      if (keyB === 'type') return -1;
                      return 0;
                    });
                    
                    return sortedEntries.map(([subKey, subDef]) => (
                      <FieldRenderer
                        key={subKey}
                        fieldKey={subKey}
                        fieldDef={subDef}
                        value={item[subKey]}
                        onChange={(subPath, subValue) => {
                          handleItemChange(index, subPath, subValue);
                        }}
                        path=""
                        readOnly={readOnly}
                      />
                    ));
                  }
                  // Check if itemDef is an object containing field definitions directly
                  else if (!itemDef.type && isFieldDefinitionObject(itemDef)) {
                    // Sort entries to put 'type' field last (if it exists) to avoid displaying it first
                    const entries = Object.entries(itemDef);
                    const sortedEntries = entries.sort(([keyA], [keyB]) => {
                      // Put 'type' field at the end
                      if (keyA === 'type') return 1;
                      if (keyB === 'type') return -1;
                      return 0;
                    });
                    
                    return sortedEntries.map(([subKey, subDef]) => (
                      <FieldRenderer
                        key={subKey}
                        fieldKey={subKey}
                        fieldDef={subDef}
                        value={item[subKey]}
                        onChange={(subPath, subValue) => {
                          handleItemChange(index, subPath, subValue);
                        }}
                        path=""
                        readOnly={readOnly}
                      />
                    ));
                  }
                  // Otherwise render as a single field
                  else {
                    return (
                      <FieldRenderer
                        fieldKey="value"
                        fieldDef={itemDef}
                        value={item}
                        onChange={(_, subValue) => {
                          handleItemChange(index, 'value', subValue);
                        }}
                        path=""
                        readOnly={readOnly}
                      />
                    );
                  }
              })()}
              </div>
            </div>
          ))}
          {!readOnly && arrayValue.length < minItems && (
            <button
              type="button"
              onClick={handleAddItem}
              className="w-full px-3 py-2 text-sm text-indigo-600 border border-indigo-300 rounded-md hover:bg-indigo-50"
            >
              <Plus size={16} className="inline mr-1" />
              Add {minItems - arrayValue.length} more item{minItems - arrayValue.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      );
    }

    default:
      return (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700" title={description || ''}>
            {formatFieldName(fieldKey)}
          </label>
          <input
            type="text"
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            readOnly={readOnly}
            disabled={readOnly}
            className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          />
        </div>
      );
  }
};

// Main component
export const ApplicationFormBuilder = ({ documentData = {}, onChange, templatePath = null, templateData = null, readOnly = false }) => {
  const [template, setTemplate] = useState(null);
  const [formData, setFormData] = useState(documentData || {});
  const [templateError, setTemplateError] = useState(null);

  // Force reload key to trigger template reload
  const [reloadKey, setReloadKey] = useState(0);

  // Load template dynamically - ALWAYS loads fresh on mount (runtime generation)
  // This ensures template changes are picked up immediately
  useEffect(() => {
    const loadAndSetTemplate = async () => {
      setTemplateError(null);
      setTemplate(null); // Clear old template to show loading state
      
      try {
        let templateToLoad;
        
        // If templateData is provided directly, use it (takes precedence over templatePath)
        if (templateData) {
          // Parse if it's a string (e.g., from Supabase JSONB that wasn't auto-parsed)
          templateToLoad = typeof templateData === 'string' ? JSON.parse(templateData) : templateData;
        } else {
          // Always use cache-busting timestamp to ensure fresh template
          const timestamp = new Date().getTime();
          
          if (templatePath) {
            // If a specific template path is provided, use it with cache busting
            const response = await fetch(`${templatePath}?t=${timestamp}&r=${reloadKey}&_nocache=${Math.random()}`, {
              cache: 'no-store', // Prevent browser caching
              headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
              }
            });
            if (response.ok) {
              templateToLoad = await response.json();
            } else {
              throw new Error(`Failed to load template from ${templatePath}`);
            }
          } else {
            // Use default template loading with cache busting
            let response = await fetch(`/templates/system_default_rental_application.json?t=${timestamp}&r=${reloadKey}&_nocache=${Math.random()}`, {
              cache: 'no-store',
              headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
              }
            }).catch(() => null);
            
            if (!response || !response.ok) {
              response = await fetch(`/system_default_rental_application.json?t=${timestamp}&r=${reloadKey}&_nocache=${Math.random()}`, {
                cache: 'no-store',
                headers: {
                  'Cache-Control': 'no-cache, no-store, must-revalidate',
                  'Pragma': 'no-cache'
                }
              });
            }
            
            if (response && response.ok) {
              templateToLoad = await response.json();
            } else {
              throw new Error('Template not found');
            }
          }
        }
        
        if (templateToLoad && Object.keys(templateToLoad).length > 0) {
          // Preserve original order from template - only sort numbered keys numerically
          // Extract numeric prefix from keys and sort numbered ones properly (1, 2, ..., 9, 10, not 1, 10, 2, ...)
          // But preserve original order for unnumbered keys
          const keys = Object.keys(templateToLoad);
          const numberedKeys = [];
          const unnumberedKeys = [];
          const keyOrderMap = new Map();
          
          // Separate numbered and unnumbered keys, preserving original order
          keys.forEach((key, index) => {
            const match = key.match(/^(\d+)[_\-.]?/);
            if (match) {
              numberedKeys.push({ key, number: parseInt(match[1], 10), originalIndex: index });
            } else {
              unnumberedKeys.push({ key, originalIndex: index });
            }
            keyOrderMap.set(key, index);
          });
          
          // Sort numbered keys numerically
          numberedKeys.sort((a, b) => {
            if (a.number !== b.number) {
              return a.number - b.number;
            }
            // If numbers are equal, preserve original order
            return a.originalIndex - b.originalIndex;
          });
          
          // Keep unnumbered keys in original order (no sorting)
          unnumberedKeys.sort((a, b) => a.originalIndex - b.originalIndex);
          
          // Combine: numbered first (sorted by number), then unnumbered (in original order)
          const sortedKeys = [...numberedKeys.map(k => k.key), ...unnumberedKeys.map(k => k.key)];
          
          // Reconstruct object with keys in correct order
          const orderedTemplate = {};
          for (const key of sortedKeys) {
            orderedTemplate[key] = templateToLoad[key];
          }
          
          setTemplate(orderedTemplate);
        } else {
          throw new Error('Template is empty or invalid');
        }
      } catch (error) {
        console.error('Error loading template:', error);
        setTemplateError(error.message);
        setTemplate(null);
      }
    };
    
    // Always load template on mount (runtime generation)
    loadAndSetTemplate();
  }, [templatePath, templateData, reloadKey]); // Reload when templatePath, templateData, or reloadKey changes

  useEffect(() => {
    setFormData(documentData || {});
  }, [documentData]);

  const handleFieldChange = (path, value) => {
    const newData = JSON.parse(JSON.stringify(formData)); // Deep clone
    setNestedValue(newData, path, value);
    setFormData(newData);
    if (onChange) {
      onChange(newData);
    }
  };

  if (templateError) {
    return (
      <div className="text-center py-8">
        <div className="text-red-600 mb-2 font-medium">Error loading application template</div>
        <div className="text-sm text-gray-500 mb-4">{templateError}</div>
        <button
          type="button"
          onClick={() => setReloadKey(prev => prev + 1)}
          className="px-4 py-2 text-sm text-indigo-600 border border-indigo-300 rounded-md hover:bg-indigo-50"
        >
          Retry Loading Template
        </button>
      </div>
    );
  }
  
  if (!template) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="text-sm text-gray-600">Loading form template...</p>
          <div className="text-xs text-gray-400">Template is loaded dynamically from JSON file</div>
        </div>
      </div>
    );
  }

  // Dynamically extract categories from template - handles any category naming convention
  // Categories can be numbered (1_category_name) or just named (category_name)
  // IMPORTANT: Preserve original order from template - do not sort alphabetically
  
  const categoriesWithNumbers = Object.entries(template)
    .map(([key, value], originalIndex) => {
      // Try to extract number and name from keys like "1_personal_information" or just "personal_information"
      const numberedMatch = key.match(/^(\d+)[_\-.]?(.+)$/);
      if (numberedMatch) {
        return {
          number: parseInt(numberedMatch[1], 10), // Explicitly use base 10
          name: numberedMatch[2].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          key,
          fields: value,
          hasNumber: true,
          originalIndex // Preserve original order
        };
      } else {
        // No number prefix - preserve original order, don't add numbers
        return {
          number: null,
          name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          key,
          fields: value,
          hasNumber: false,
          originalIndex // Preserve original order
        };
      }
    })
    .filter(Boolean);

  // Separate numbered and unnumbered categories
  const numberedCategories = categoriesWithNumbers.filter(c => c.hasNumber);
  const unnumberedCategories = categoriesWithNumbers.filter(c => !c.hasNumber);

  // Sort numbered categories by their number (numeric sort, not string sort)
  // This ensures 1, 2, ..., 9, 10 order, not 1, 10, 2, ...
  numberedCategories.sort((a, b) => {
    if (a.number !== b.number) {
      return a.number - b.number;
    }
    // If numbers are equal, preserve original order
    return a.originalIndex - b.originalIndex;
  });

  // Preserve original order for unnumbered categories - DO NOT sort alphabetically
  unnumberedCategories.sort((a, b) => a.originalIndex - b.originalIndex);

  // Combine categories preserving order: numbered first (sorted by number), then unnumbered (in original order)
  // For sorting purposes, assign temporary sort numbers to unnumbered categories
  // but don't display them unless originally in template
  const maxNumber = numberedCategories.length > 0 
    ? Math.max(...numberedCategories.map(c => c.number))
    : 0;
  
  // Assign temporary sort numbers to unnumbered categories for ordering purposes only
  unnumberedCategories.forEach((category, index) => {
    category.sortNumber = maxNumber + index + 1; // For sorting only, not display
  });

  // Combine and sort: numbered by number, unnumbered by original order
  const categories = [...numberedCategories, ...unnumberedCategories].sort((a, b) => {
    if (a.hasNumber && b.hasNumber) {
      // Both numbered - sort by number
      return a.number - b.number;
    } else if (a.hasNumber && !b.hasNumber) {
      // Numbered comes before unnumbered
      return -1;
    } else if (!a.hasNumber && b.hasNumber) {
      // Unnumbered comes after numbered
      return 1;
    } else {
      // Both unnumbered - preserve original order
      return a.originalIndex - b.originalIndex;
    }
  });

  return (
    <div className="space-y-6">
      {categories.map((category) => {
        // Check if the category itself is an array definition (e.g., "Applicants", "Vehicles")
        const isCategoryArray = category.fields && typeof category.fields === 'object' && 
                                !Array.isArray(category.fields) &&
                                (category.fields.type === 'array' || category.fields.items);
        
        if (isCategoryArray) {
          // Category is itself an array - render it directly
          const value = formData[category.key];
          
          return (
            <div key={category.key} className="border border-gray-300 rounded-lg p-6 bg-white">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">
                {category.hasNumber ? `${category.number}. ` : ''}{category.name}
              </h3>
              <div className="space-y-4">
                <FieldRenderer
                  fieldKey={category.key}
                  fieldDef={category.fields}
                  value={value}
                  onChange={(subPath, subValue) => {
                    handleFieldChange(subPath, subValue);
                  }}
                  path=""
                  readOnly={readOnly}
                />
              </div>
            </div>
          );
        }
        
        // Category has fields - render each field
        return (
          <div key={category.key} className="border border-gray-300 rounded-lg p-6 bg-white">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">
              {category.hasNumber ? `${category.number}. ` : ''}{category.name}
            </h3>
            <div className="space-y-4">
              {Object.entries(category.fields).map(([fieldKey, fieldDef]) => {
                // Skip password fields - these are handled separately
                if (fieldKey === 'password' || fieldKey === 'confirm_password') {
                  return null;
                }
                
                const lookupPath = `${category.key}.${fieldKey}`;
                let value = getNestedValue(formData, lookupPath);
                
                // Special handling: If Vehicles is at top level but template has it under Additional_Details
                if (fieldKey === 'Vehicles' && !value && formData[fieldKey]) {
                  value = formData[fieldKey];
                }
                
                // Special handling: If Pets is at top level but template has it under Additional_Details
                if (fieldKey === 'Pets' && !value && formData[fieldKey]) {
                  value = formData[fieldKey];
                }
              return (
                <FieldRenderer
                  key={fieldKey}
                  fieldKey={fieldKey}
                  fieldDef={fieldDef}
                  value={value}
                  onChange={(subPath, subValue) => {
                    // subPath from FieldRenderer will be the full path (path + fieldKey) for simple fields
                    // or include additional nesting for complex fields (objects, arrays)
                    // If subPath doesn't start with category.key, prepend it
                    const fullPath = subPath.startsWith(category.key)
                      ? subPath
                      : `${category.key}.${subPath}`;
                    handleFieldChange(fullPath, subValue);
                  }}
                  path={category.key}
                  readOnly={readOnly}
                />
              );
            })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

