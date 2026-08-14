import { useEffect, useRef } from 'react';

/**
 * Custom hook to persist form data to localStorage and restore it on mount
 * @param {string} formKey - Unique key for this form (e.g., 'add-landlord', 'add-user')
 * @param {Object} formState - Object containing all form state values
 * @param {Function} setFormState - Function to set form state (takes object with state keys)
 * @param {boolean} shouldPersist - Whether to persist (default: true, set to false after successful submit)
 */
export function useFormPersistence(formKey, formState, setFormState, shouldPersist = true) {
    const isInitialMount = useRef(true);
    const storageKey = `form-draft-${formKey}`;

    // Restore form data on mount
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // Restore all form state values
                    setFormState(parsed);
                }
            } catch (error) {
                console.warn(`Failed to restore form data for ${formKey}:`, error);
            }
        }
    }, [formKey, storageKey, setFormState]);

    // Save form data to localStorage whenever it changes
    useEffect(() => {
        if (!shouldPersist || isInitialMount.current) {
            return;
        }

        try {
            // Check if form has any non-empty values
            const hasData = Object.values(formState).some(value => {
                if (Array.isArray(value)) {
                    return value.length > 0 && value.some(item => 
                        typeof item === 'object' ? Object.values(item).some(v => v && v.toString().trim() !== '') : v && v.toString().trim() !== ''
                    );
                }
                if (typeof value === 'object' && value !== null) {
                    return Object.values(value).some(v => v && v.toString().trim() !== '');
                }
                return value && value.toString().trim() !== '';
            });

            if (hasData) {
                localStorage.setItem(storageKey, JSON.stringify(formState));
            } else {
                // Remove from localStorage if form is empty
                localStorage.removeItem(storageKey);
            }
        } catch (error) {
            console.warn(`Failed to save form data for ${formKey}:`, error);
        }
    }, [formState, formKey, storageKey, shouldPersist]);

    // Function to clear persisted data (call after successful submit)
    const clearPersistedData = () => {
        try {
            localStorage.removeItem(storageKey);
        } catch (error) {
            console.warn(`Failed to clear form data for ${formKey}:`, error);
        }
    };

    return { clearPersistedData };
}

