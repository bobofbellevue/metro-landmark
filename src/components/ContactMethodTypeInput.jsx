import { useState, useEffect, useId, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Contact method "type" field (Cell, Phone, Email, …) with suggestion dropdown.
 * Width and autocomplete are controlled here so every form gets the same behavior:
 * - Stable ~4-character field width in flex rows (avoids w-1/3 collapse on a wrapper)
 * - Attributes that discourage browsers from treating this as a phone/autofill field
 * - Dropdown closes after a selection; full list returns when reopened
 */
const DEFAULT_INPUT_CLASS =
  'block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm';

function normalizeInputClassName(className) {
  const raw = (className || '').trim();
  if (!raw) return DEFAULT_INPUT_CLASS;

  // Call sites historically passed w-1/3 for a flex sibling; that percentage applies to the
  // unsized wrapper and collapses to ~1ch. Strip width utilities; wrapper owns width.
  const withoutWidth = raw
    .split(/\s+/)
    .filter((token) => token && !/^(w-|min-w-|max-w-|flex-|basis-|shrink-|grow-)/.test(token))
    .join(' ');

  const withFullWidth = /\bw-full\b/.test(withoutWidth)
    ? withoutWidth
    : `w-full ${withoutWidth}`.trim();

  return withFullWidth;
}

export default function ContactMethodTypeInput({ value, onChange, className = '' }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  // Filter applies only while typing. Cleared on select/focus so the full list returns.
  const [typeFilter, setTypeFilter] = useState(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const inputId = useId();
  // Unique, non-contact autofill token so Chrome/Safari don't treat this as tel/email.
  const autofillName = `sl-contact-method-type-${inputId.replace(/:/g, '')}`;
  const inputClassName = normalizeInputClassName(className);

  let displayedSuggestions = suggestions;
  if (typeFilter != null && typeFilter !== '') {
    const needle = typeFilter.toLowerCase();
    displayedSuggestions = suggestions.filter((s) => s.toLowerCase().includes(needle));
  }

  useEffect(() => {
    fetchSuggestions();
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        inputRef.current &&
        !inputRef.current.contains(event.target)
      ) {
        setShowDropdown(false);
        setTypeFilter(null);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function fetchSuggestions() {
    try {
      const { data, error } = await supabase
        .from('contact_methods')
        .select('method_type');

      if (error) throw error;

      if (data) {
        const uniqueTypes = [...new Set(data.map(item => item.method_type).filter(Boolean))].sort();
        setSuggestions(uniqueTypes);
      }
    } catch (error) {
      console.error('Error fetching contact method types:', error);
    }
  }

  function handleInputChange(e) {
    const newValue = e.target.value;
    onChange(newValue);
    setTypeFilter(newValue);

    // If the typed text uniquely and exactly matches one suggestion (case-insensitive),
    // treat it as complete and close the list (e.g. typing "Cell" when only Cell matches).
    const needle = newValue.trim().toLowerCase();
    if (needle) {
      const matches = suggestions.filter((s) => s.toLowerCase().includes(needle));
      const exactUnique =
        matches.length === 1 && matches[0].toLowerCase() === needle;
      setShowDropdown(!exactUnique);
      return;
    }

    setShowDropdown(true);
  }

  function handleSuggestionMouseDown(event, suggestion) {
    // Prevent input blur/focus churn that would reopen the list after close.
    event.preventDefault();
    onChange(suggestion);
    setTypeFilter(null);
    setShowDropdown(false);
  }

  function handleFocus() {
    setTypeFilter(null);
    setShowDropdown(true);
  }

  const listOpen = showDropdown && displayedSuggestions.length > 0;

  return (
    // ~4ch text + horizontal padding (box-sizing: border-box)
    <div className="relative w-[calc(4ch+1.75rem)] shrink-0">
      <input
        ref={inputRef}
        id={autofillName}
        name={autofillName}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={handleFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="text"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={`${autofillName}-listbox`}
        placeholder="Type"
        title="Contact method type (e.g., Cell, Phone, Email)"
        className={inputClassName}
      />
      {listOpen && (
        <div
          id={`${autofillName}-listbox`}
          ref={dropdownRef}
          role="listbox"
          className="absolute z-50 left-0 min-w-full w-max mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto"
        >
          {displayedSuggestions.map((suggestion, index) => (
            <div
              key={`${suggestion}-${index}`}
              role="option"
              onMouseDown={(event) => handleSuggestionMouseDown(event, suggestion)}
              className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm whitespace-nowrap"
            >
              {suggestion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
