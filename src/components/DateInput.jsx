import React, { useState, useRef, useEffect, useMemo } from 'react';
import DatePicker from 'react-datepicker';

/**
 * Enhanced date input using react-datepicker
 * Provides year navigation within the calendar dropdown
 * Displays dates in MM-DD-YYYY format
 */
export default function DateInput({ 
    value, 
    onChange, 
    required = false, 
    className = '',
    label,
    readOnly = false,
    maxDate = null, // Maximum selectable date
    minDate = null, // Minimum selectable date
    ...props 
}) {
    // Convert string value (MM-DD-YYYY or YYYY-MM-DD) to Date object or null
    const dateValue = useMemo(() => {
        if (!value || typeof value !== 'string') return null;
        
        try {
            // Check if value is in MM-DD-YYYY format
            const mmddyyyyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
            if (mmddyyyyMatch) {
                const [, month, day, year] = mmddyyyyMatch;
                const monthNum = parseInt(month, 10);
                const dayNum = parseInt(day, 10);
                const yearNum = parseInt(year, 10);
                
                // Validate date values
                if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31 || yearNum < 1900 || yearNum > 2100) {
                    console.warn(`[DateInput] Invalid date values: ${value}`);
                    return null;
                }
                
                const date = new Date(yearNum, monthNum - 1, dayNum);
                // Check if date is valid
                if (isNaN(date.getTime())) {
                    console.warn(`[DateInput] Invalid date created from: ${value}`);
                    return null;
                }
                return date;
            }
            
            // Fallback to YYYY-MM-DD format (ISO)
            const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (isoMatch) {
                const date = new Date(value + 'T00:00:00');
                if (isNaN(date.getTime())) {
                    console.warn(`[DateInput] Invalid ISO date: ${value}`);
                    return null;
                }
                return date;
            }
            
            // Try parsing as-is
            const date = new Date(value);
            if (isNaN(date.getTime())) {
                console.warn(`[DateInput] Could not parse date: ${value}`);
                return null;
            }
            return date;
        } catch (error) {
            console.warn(`[DateInput] Error parsing date "${value}":`, error);
            return null;
        }
    }, [value]);
    const inputRef = useRef(null);
    const [displayValue, setDisplayValue] = useState('');

    // Format date for display in MM-DD-YYYY format
    useEffect(() => {
        if (!value && !dateValue) {
            if (displayValue !== '') setDisplayValue('');
            return;
        }

        if (dateValue) {
            const month = String(dateValue.getMonth() + 1).padStart(2, '0');
            const day = String(dateValue.getDate()).padStart(2, '0');
            const year = dateValue.getFullYear();
            const formatted = `${month}-${day}-${year}`;
            if (formatted !== displayValue) {
                setDisplayValue(formatted);
            }
        } else if (displayValue !== '') {
            setDisplayValue('');
        }
    }, [dateValue, value, displayValue]);

    const handleChange = (date) => {
        if (onChange) {
            // Convert Date object back to MM-DD-YYYY string format
            if (date) {
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const year = date.getFullYear();
                const dateString = `${month}-${day}-${year}`;
                onChange({ target: { value: dateString } });
            } else {
                onChange({ target: { value: '' } });
            }
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
                dateFormat="MM-dd-yyyy"
                maxDate={maxDate}
                minDate={minDate}
                customInput={
                    <input
                        ref={inputRef}
                        type="text"
                        value={displayValue}
                        readOnly
                        onChange={(e) => {
                            // Prevent any changes to the input - it's controlled by DatePicker
                            e.preventDefault();
                        }}
                        className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 ${readOnly ? 'bg-gray-100 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
                        placeholder="MM-DD-YYYY"
                    />
                }
                wrapperClassName="w-full"
                showYearDropdown
                showMonthDropdown
                dropdownMode="select"
                yearDropdownItemNumber={15}
                scrollableYearDropdown
                required={required}
                readOnly={readOnly}
                disabled={readOnly}
                onChangeRaw={(e) => {
                    // Prevent react-datepicker from formatting the input
                    e.preventDefault();
                }}
                {...props}
            />
        </div>
    );
}
