import { useState, useMemo } from 'react';

/**
 * Resolve a display/sort name from contact or top-level name fields.
 * Prefer last-name-first to match admin table formatting ("Last, First").
 * @param {Object} item
 * @returns {{ last: string, first: string, fallback: string }}
 */
export function resolvePersonNameParts(item) {
    if (!item) {
        return { last: '', first: '', fallback: '' };
    }

    const contact = item.contact;
    const first = (contact?.first_name ?? item.first_name ?? '').toString().trim();
    const last = (contact?.last_name ?? item.last_name ?? '').toString().trim();
    const fallback = (item.email || item.name || item.company_name || item.landlord_name || '').toString().trim();

    return { last, first, fallback };
}

/**
 * Comparable string for person-name columns (last, first, then email/fallback).
 * @param {Object} item
 * @returns {string}
 */
export function resolvePersonSortValue(item) {
    const { last, first, fallback } = resolvePersonNameParts(item);
    if (last || first) {
        return `${last}\u0000${first}`.toLowerCase();
    }
    return fallback.toLowerCase();
}

/**
 * A reusable hook for managing client-side sorting logic for admin tables
 * @param {Array} items - Array of items to sort
 * @param {Object} config - Initial sort configuration { key: string, direction: 'ascending'|'descending' }
 * @returns {Object} Object containing sortedItems, requestSort function, and sortConfig
 */
export const useSortableData = (items, config = null) => {
    const [sortConfig, setSortConfig] = useState(config);

    const sortedItems = useMemo(() => {
        let sortableItems = [...(items || [])];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                // Generic key access
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];
                
                // Handle special sorting cases for derived/formatted names
                if (sortConfig.key === 'name' || sortConfig.key === 'landlord_name' || sortConfig.key === 'company_name') {
                    if (sortConfig.key === 'company_name' && (a.company_name || b.company_name)) {
                        aValue = (a.company_name || '').toString();
                        bValue = (b.company_name || '').toString();
                    } else if (sortConfig.key === 'landlord_name' && (a.landlord_name || b.landlord_name) && !a.contact && !b.contact && !a.first_name && !b.first_name) {
                        aValue = (a.landlord_name || '').toString();
                        bValue = (b.landlord_name || '').toString();
                    } else {
                        aValue = resolvePersonSortValue(a);
                        bValue = resolvePersonSortValue(b);
                    }
                }
                 // Handle special case for contact (sort by email, or first contact method value for PM companies)
                if (sortConfig.key === 'contact') {
                    // For PM companies, sort by first contact method value
                    if (a.contact?.methods && a.contact.methods.length > 0) {
                        aValue = a.contact.methods[0].value || '';
                    } else if (b.contact?.methods && b.contact.methods.length > 0) {
                        aValue = '';
                    } else {
                        // For other entities, sort by email
                        aValue = a.email || '';
                    }
                    if (b.contact?.methods && b.contact.methods.length > 0) {
                        bValue = b.contact.methods[0].value || '';
                    } else if (a.contact?.methods && a.contact.methods.length > 0) {
                        bValue = '';
                    } else {
                        // For other entities, sort by email
                        bValue = b.email || '';
                    }
                }
                // Handle special case for address (sort by city)
                if (sortConfig.key === 'address') {
                    aValue = a.city || '';
                    bValue = b.city || '';
                }
                // Handle special case for city sorting
                if (sortConfig.key === 'city') {
                    aValue = a.city || '';
                    bValue = b.city || '';
                }
                // Tenants / similar: Property column uses address_line_1 (+ unit)
                if (sortConfig.key === 'property') {
                    aValue = `${a.address_line_1 || ''}\u0000${a.unit_number || ''}`.toLowerCase();
                    bValue = `${b.address_line_1 || ''}\u0000${b.unit_number || ''}`.toLowerCase();
                }

                const aStr = aValue == null ? '' : String(aValue);
                const bStr = bValue == null ? '' : String(bValue);
                const comparison = aStr.localeCompare(bStr, undefined, { sensitivity: 'base', numeric: true });

                if (comparison !== 0) {
                    return sortConfig.direction === 'ascending' ? comparison : -comparison;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [items, sortConfig]);

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    return { items: sortedItems, requestSort, sortConfig };
};
