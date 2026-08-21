import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react';
import { Pencil, Trash2, X, ArrowUpDown, PlusCircle, Home, Search, User, Building, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card, ConfirmationModal } from '../components/ui';
import { useSortableData } from '../hooks';
import { geocodeAddress } from '../utils/geocoding.js';
import { useFinderLimit } from '../hooks/useFinderLimit';
import { useFormPersistence } from '../hooks/useFormPersistence';
import ArchiveModal from '../components/ArchiveModal';
import { insertWithAudit, updateWithAudit } from '../lib/auditHelpers.js';
import {
    defaultUnlabeledUnit,
    formatUnitQualifier,
    normalizeStoredUnitNumber,
    unitNumberText,
    validatePropertyUnitNumbers,
} from '../utils/unit-display.js';

// Utility functions
const formatLandlordName = (l) => {
    const first = l.first_name || '';
    const last = l.last_name || '';
    const middle = l.middle_name ? ` ${l.middle_name.charAt(0)}.` : '';
    return `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
};

// Format name as 'First M. Last' - single letter middle name gets period, longer gets first letter + period
const formatManagerName = (contact) => {
    if (!contact) return 'Unnamed Manager';
    const first = contact.first_name || '';
    const last = contact.last_name || '';
    let middle = '';
    if (contact.middle_name) {
        const middleName = contact.middle_name.trim();
        if (middleName.length === 1) {
            middle = ` ${middleName}.`;
        } else if (middleName.length > 1) {
            middle = ` ${middleName.charAt(0)}.`;
        }
    }
    return `${first}${middle} ${last}`.replace(/\s+/g, ' ').trim() || 'Unnamed Manager';
};

// Utility function for formatting property recap for hover tooltip
const formatPropertyRecap = (p) => {
    const parts = [];
    
    // Property Name
    if (p.property_name) {
        parts.push(`Property Name: ${p.property_name}`);
    }
    
    // Address
    const addressParts = [];
    if (p.address_line_1) addressParts.push(p.address_line_1);
    if (p.address_line_2) addressParts.push(p.address_line_2);
    if (p.city) addressParts.push(p.city);
    if (p.state_province_region) addressParts.push(p.state_province_region);
    if (p.postal_code) addressParts.push(p.postal_code);
    if (p.country) addressParts.push(p.country);
    if (addressParts.length > 0) {
        parts.push(`Address: ${addressParts.join(', ')}`);
    }
    
    // Property Type
    if (p.property_type) {
        parts.push(`Property Type: ${p.property_type}`);
    }
    
    // Landlord
    if (p.landlord_name) {
        parts.push(`Landlord: ${p.landlord_name}`);
    }
    
    // City/County of Jurisdiction
    if (p.city_of_jurisdiction || p.county_of_jurisdiction) {
        const jurisdictionParts = [];
        if (p.city_of_jurisdiction) jurisdictionParts.push(`City: ${p.city_of_jurisdiction}`);
        if (p.county_of_jurisdiction) jurisdictionParts.push(`County: ${p.county_of_jurisdiction}`);
        parts.push(`Jurisdiction: ${jurisdictionParts.join(', ')}`);
    }
    
    // Unit Count
    if (p.unit_count !== undefined && p.unit_count !== null) {
        parts.push(`Units: ${p.unit_count}`);
    }
    
    return parts.length > 0 ? parts.join('\n') : 'No additional information available';
};

const formatAddress = (p) => {
    if (!p.address_line_1 && !p.city) return 'No address';
    const addressParts = [
        p.address_line_1,
        p.address_line_2,
        p.city,
        p.state_province_region
    ].filter(Boolean);
    return addressParts.join(', ');
};

const formatAddressMultiLine = (p) => {
    if (!p.address_line_1 && !p.city) return 'No address';
    const lines = [];
    if (p.address_line_1) lines.push(p.address_line_1);
    if (p.address_line_2) lines.push(p.address_line_2);
    if (p.city || p.state_province_region) {
        const cityState = [p.city, p.state_province_region].filter(Boolean).join(', ');
        if (cityState) lines.push(cityState);
    }
    return lines;
};

const toNumberOrNull = (val) => {
    if (val === null || val === undefined) return null;
    const trimmed = typeof val === 'string' ? val.trim() : val;
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
};

const normalizeYesNo = (val) => {
    if (val === true) return 'yes';
    if (val === false) return 'no';
    const s = (val || '').toString().trim().toLowerCase();
    if (s === 'yes' || s === 'y' || s === 'true' || s === '1') return 'yes';
    if (s === 'no' || s === 'n' || s === 'false' || s === '0') return 'no';
    return '';
};

const buildPropertyParkingAmenityNames = (parking) => {
    const names = [];
    const garage = toNumberOrNull(parking?.garage_spaces);
    const carport = toNumberOrNull(parking?.carport_spaces);
    const driveway = toNumberOrNull(parking?.paved_driveway_spaces);
    const offStreet = toNumberOrNull(parking?.off_street_spaces);
    const street = normalizeYesNo(parking?.street_parking_available);

    if (garage !== null) names.push(`parking_garage_spaces:${garage}`);
    if (carport !== null) names.push(`parking_carport_spaces:${carport}`);
    if (driveway !== null) names.push(`parking_paved_driveway_spaces:${driveway}`);
    if (offStreet !== null) names.push(`parking_off_street_spaces:${offStreet}`);
    if (street) names.push(`parking_street_parking_available:${street}`);

    return names;
};

const buildUnitParkingFeatureNames = (parking) => {
    const names = [];
    const rule = (parking?.parking_rule || '').toString();
    if (rule === 'dedicated' || rule === 'both') names.push('parking_rule:dedicated');
    if (rule === 'first_come_first_serve' || rule === 'both') names.push('parking_rule:first_come_first_serve');

    if (rule === 'dedicated' || rule === 'both') {
        const garage = toNumberOrNull(parking?.dedicated_garage_spaces);
        const carport = toNumberOrNull(parking?.dedicated_carport_spaces);
        const driveway = toNumberOrNull(parking?.dedicated_paved_driveway_spaces);
        const offStreet = toNumberOrNull(parking?.dedicated_off_street_spaces);

        if (garage !== null) names.push(`parking_dedicated_garage_spaces:${garage}`);
        if (carport !== null) names.push(`parking_dedicated_carport_spaces:${carport}`);
        if (driveway !== null) names.push(`parking_dedicated_paved_driveway_spaces:${driveway}`);
        if (offStreet !== null) names.push(`parking_dedicated_off_street_spaces:${offStreet}`);
    }

    return names;
};

export default function PropertiesPage() {
    const { user } = useContext(AuthContext);
    const [properties, setProperties] = useState([]);
    const [landlords, setLandlords] = useState([]);
    const [propertyTypes, setPropertyTypes] = useState([]);
    const [editingProperty, setEditingProperty] = useState(null);
    const [deletingProperty, setDeletingProperty] = useState(null);
    const [managingUnitsFor, setManagingUnitsFor] = useState(null);
    const [choosingManagerFor, setChoosingManagerFor] = useState(null);
    const [companies, setCompanies] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    
    // Debounce search term to avoid excessive filtering
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300); // 300ms delay
        
        return () => clearTimeout(timer);
    }, [searchTerm]);
    
    // Filter properties based on search term
    const filteredProperties = useMemo(() => {
        if (!properties || !Array.isArray(properties)) {
            return [];
        }
        if (!debouncedSearchTerm.trim()) {
            return properties;
        }
        
        const searchLower = debouncedSearchTerm.toLowerCase();
        return properties.filter(property => {
            // Search in address fields
            const addressMatch = [
                property.address_line_1,
                property.address_line_2,
                property.city,
                property.state_province_region,
                property.postal_code,
                property.country
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            // Search in property details
            const propertyMatch = [
                property.property_type,
                property.landlord_name
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            return addressMatch || propertyMatch;
        });
    }, [properties, debouncedSearchTerm]);
    const { items: sortedProperties, requestSort, sortConfig } = useSortableData(filteredProperties, { key: 'address', direction: 'ascending' });
    const { visibleCount: propertyVisibleCount, hasMore: hasMoreProperties, showMore: showMoreProperties } = useFinderLimit(
        sortedProperties.length,
        [debouncedSearchTerm, properties.length]
    );
    const displayedProperties = sortedProperties.slice(0, propertyVisibleCount || sortedProperties.length);
    const fetchData = useCallback(async () => {
        try {
            console.log('[PropertiesPage] Fetching properties, showArchived:', showArchived);
            const propertiesQuery = supabase.from('properties').select('*');
            if (!showArchived) {
                propertiesQuery.eq('is_archived', false);
            }
            
            const [propertiesResult, propertyTypesResult, companiesResult] = await Promise.all([
                propertiesQuery,
                supabase.from('property_types').select('*'),
                supabase.from('pm_companies').select('*').order('company_name')
            ]);
            
            console.log('[PropertiesPage] Properties query result:', {
                count: propertiesResult.data?.length || 0,
                hasData: !!propertiesResult.data,
                error: propertiesResult.error,
                errorCode: propertiesResult.error?.code,
                errorMessage: propertiesResult.error?.message,
                errorDetails: propertiesResult.error?.details,
                errorHint: propertiesResult.error?.hint
            });
            console.log('[PropertiesPage] Property types query result:', {
                count: propertyTypesResult.data?.length || 0,
                hasData: !!propertyTypesResult.data,
                error: propertyTypesResult.error
            });
            console.log('[PropertiesPage] Companies query result:', {
                count: companiesResult.data?.length || 0,
                hasData: !!companiesResult.data,
                error: companiesResult.error
            });
            
            if (propertiesResult.error) {
                console.error('[PropertiesPage] Error fetching properties:', propertiesResult.error);
                setProperties([]);
                return;
            }
            
            // Get unique landlord IDs from properties (including archived landlords if referenced)
            const landlordIds = [...new Set(
                propertiesResult.data
                    ?.map(p => p.landlord_id)
                    .filter(Boolean) || []
            )];
            
            // Fetch landlords that are referenced by properties (include archived ones)
            // Also fetch all non-archived landlords for the dropdown/selection
            const [referencedLandlordsResult, allLandlordsResult] = await Promise.all([
                landlordIds.length > 0 
                    ? supabase.from('landlords').select(`
                        *,
                        users!landlords_user_id_fkey(email, role)
                    `).in('landlord_id', landlordIds)
                    : { data: [], error: null },
                supabase.from('landlords').select(`
                    *,
                    users!landlords_user_id_fkey(email, role)
                `).eq('is_archived', false)
            ]);
            
            
            // Process landlords - use referenced landlords for property display, all landlords for dropdown
            const landlordsToProcess = referencedLandlordsResult.data || [];
            const allLandlordsForDropdown = allLandlordsResult.data || [];
            
            // Create map of landlords with contact info for property matching
            const landlordMap = new Map();
            
            if (landlordsToProcess.length > 0 || allLandlordsForDropdown.length > 0) {
                // Get contact information for all landlords (both referenced and all non-archived)
                const allLandlordIds = [...new Set([
                    ...landlordsToProcess.map(l => l.landlord_id),
                    ...allLandlordsForDropdown.map(l => l.landlord_id)
                ])];
                
                const { data: contacts } = await supabase
                    .from('contacts')
                    .select('*')
                    .in('contactable_id', allLandlordIds)
                    .eq('contactable_type', 'landlord');
                
                // Populate map with referenced landlords (for property display)
                landlordsToProcess.forEach(landlord => {
                    const contact = contacts?.find(c => c.contactable_id === landlord.landlord_id);
                    const landlordWithContact = {
                        ...landlord,
                        first_name: contact?.first_name,
                        middle_name: contact?.middle_name,
                        last_name: contact?.last_name,
                        email: landlord.users?.email
                    };
                    landlordMap.set(landlord.landlord_id, landlordWithContact);
                });
                
                // Set landlords for dropdown (all non-archived landlords with contact info)
                const landlordsForDropdown = allLandlordsForDropdown.map(landlord => {
                    const contact = contacts?.find(c => c.contactable_id === landlord.landlord_id);
                    return {
                        ...landlord,
                        first_name: contact?.first_name,
                        middle_name: contact?.middle_name,
                        last_name: contact?.last_name,
                        email: landlord.users?.email
                    };
                });
                setLandlords(landlordsForDropdown);
            }
            
            // Get address information for each property
            const propertyIds = propertiesResult.data?.map(p => p.property_id) || [];
            const { data: addresses } = await supabase
                .from('addresses')
                .select('*')
                .in('addressable_id', propertyIds)
                .eq('addressable_type', 'property');
            
            // Get unit counts for each property
            const { data: unitCounts } = await supabase
                .from('units')
                .select('property_id')
                .in('property_id', propertyIds);
            
            // Count units per property
            const unitCountMap = {};
            unitCounts?.forEach(unit => {
                unitCountMap[unit.property_id] = (unitCountMap[unit.property_id] || 0) + 1;
            });
            
            // Get PM companies and managers for properties
            const pmCompanyMap = new Map();
            companiesResult.data?.forEach(pmc => pmCompanyMap.set(pmc.pmc_id, pmc.company_name));
            
            // Get manager information
            const managerIds = [...new Set(propertiesResult.data?.map(p => p.manager_id).filter(Boolean) || [])];
            const { data: managerContacts } = managerIds.length > 0 ? await supabase
                .from('contacts')
                .select('contactable_id, first_name, middle_name, last_name')
                .in('contactable_id', managerIds)
                .eq('contactable_type', 'user') : { data: [] };
            
            const managerNameMap = new Map();
            managerContacts?.forEach(contact => {
                // Format name with period for single-letter middle names
                const first = contact.first_name || '';
                const last = contact.last_name || '';
                const middle = contact.middle_name ? (contact.middle_name.length === 1 ? ` ${contact.middle_name}.` : ` ${contact.middle_name}`) : '';
                const name = `${first}${middle} ${last}`.replace(/\s+/g, ' ').trim();
                managerNameMap.set(contact.contactable_id, name);
            });
            
            // Combine property data with address information, unit counts, landlord information, and management info
            const propertiesWithData = propertiesResult.data?.map(property => {
                const address = addresses?.find(a => a.addressable_id === property.property_id);
                const landlord = landlordMap.get(property.landlord_id);
                
                const pmCompanyName = property.pmc_id ? pmCompanyMap.get(property.pmc_id) : null;
                const managerName = property.manager_id ? managerNameMap.get(property.manager_id) : null;
                
                // Determine management display
                // Manager can only exist with a PM company, so show both when both are present
                // Store as object to allow multi-line display
                let managementDisplay = { company: null, manager: null };
                if (pmCompanyName) {
                    managementDisplay.company = pmCompanyName;
                    if (managerName) {
                        managementDisplay.manager = managerName;
                    }
                }
                
                return {
                    ...property,
                    address_line_1: address?.address_line_1 || '',
                    address_line_2: address?.address_line_2 || '',
                    city: address?.city || '',
                    state_province_region: address?.state_province_region || '',
                    postal_code: address?.postal_code || '',
                    country: address?.country || '',
                    unit_count: unitCountMap[property.property_id] || 0,
                    landlord_name: landlord ? formatLandlordName(landlord) : 'No landlord assigned',
                    management_display: managementDisplay
                };
            }) || [];
            
            setProperties(propertiesWithData);
            
            if (propertyTypesResult.error) {
                console.error('Error fetching property types:', propertyTypesResult.error);
                setPropertyTypes([]);
            } else {
                setPropertyTypes(propertyTypesResult.data || []);
            }
            setCompanies(companiesResult.data || []);
        } catch (error) {
            console.error('Error fetching data:', error);
            setProperties([]);
            setLandlords([]);
            setPropertyTypes([]);
        }
    }, [showArchived]);

    useEffect(() => {
        if (user) fetchData();
    }, [user, fetchData]);
    
    const handleSuccess = () => {
        setEditingProperty(null);
        setDeletingProperty(null);
        setManagingUnitsFor(null);
        fetchData();
    };

    const handleRestore = async (propertyId) => {
        try {
            const { error } = await supabase.rpc('restore_entity', {
                p_table_name: 'properties',
                p_entity_id: propertyId,
                p_restored_by_user_id: user.user_id
            });
            
            if (error) {
                console.error('Error restoring property:', error);
                alert('Failed to restore property: ' + error.message);
            } else {
                fetchData();
            }
        } catch (err) {
            console.error('Error restoring property:', err);
            alert('Could not connect to the server.');
        }
    };

    const handleDataRefresh = () => {
        fetchData(); // Only refresh data, don't close modals
    };
    
    const handlePropertyCreated = () => {
        fetchData();
        // Don't open the Manage Units modal - units are now created directly in the form
    };

    const getSortIndicator = (name) => {
        if (!sortConfig || sortConfig.key !== name) return <ArrowUpDown size={14} className="ml-2 text-gray-400"/>;
        return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
    };

    return (
        <div className="finder-page">
            <h2 className="text-3xl font-bold text-gray-800">Properties</h2>
            <div className="finder-split">
                <CreatePropertyForm landlords={landlords} propertyTypes={propertyTypes} onPropertyCreated={handlePropertyCreated} />
                <Card
                    title="Property Search"
                    className="max-h-[calc(100vh-160px)] min-h-0 lg:max-h-none"
                    contentClassName="flex min-h-0 flex-col overflow-hidden"
                >
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="mb-4 flex-shrink-0">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="relative flex-1">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Search className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Search properties by address, city, landlord, or type..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                />
                                {searchTerm !== debouncedSearchTerm ? (
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                                    </div>
                                ) : searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchTerm('')}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                                        title="Clear search"
                                    >
                                        <X size={16} />
                                    </button>
                                )}
                            </div>
                            <label className="flex items-center gap-2 whitespace-nowrap">
                                <input
                                    type="checkbox"
                                    checked={showArchived}
                                    onChange={(e) => setShowArchived(e.target.checked)}
                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="text-sm text-gray-700">Show Archived</span>
                            </label>
                        </div>
                        <div className="mt-2 text-sm text-gray-600">
                            {debouncedSearchTerm ? (
                                sortedProperties.length === 0 ? (
                                    <span className="text-red-600">No properties found matching "{debouncedSearchTerm}"</span>
                                ) : (
                                    <span>Showing {sortedProperties.length} of {properties.length} properties</span>
                                )
                            ) : (
                                <span>Showing {properties.length} of {properties.length} properties</span>
                            )}
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200">
                        <table className="finder-list w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">Actions</th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase"><button onClick={() => requestSort('address')} className="flex items-center">Address {getSortIndicator('address')}</button></th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase"><button onClick={() => requestSort('landlord_name')} className="flex items-center">Landlord {getSortIndicator('landlord_name')}</button></th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase"><button onClick={() => requestSort('property_type')} className="flex items-center">Type {getSortIndicator('property_type')}</button></th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase"><button onClick={() => requestSort('unit_count')} className="flex items-center">Units {getSortIndicator('unit_count')}</button></th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase"><button onClick={() => requestSort('management_display')} className="flex items-center">Management {getSortIndicator('management_display')}</button></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {displayedProperties.map(p => (
                                    <tr key={p.property_id} className={p.is_archived ? 'opacity-60 italic' : ''}>
                                        <td className="px-1.5 py-2 text-left whitespace-nowrap">
                                             <div className="flex items-center space-x-4">
                                                {!p.is_archived && (
                                                    <>
                                                        <div className="relative group" onMouseEnter={(e) => {
                                                            const tooltip = e.currentTarget.querySelector('.tooltip-content');
                                                            if (tooltip) {
                                                                const rect = e.currentTarget.getBoundingClientRect();
                                                                const viewportHeight = window.innerHeight;
                                                                const spaceBelow = viewportHeight - rect.bottom;
                                                                const tooltipHeight = 200;
                                                                if (spaceBelow < tooltipHeight + 20) {
                                                                    tooltip.classList.add('bottom-full', 'mb-2');
                                                                    tooltip.classList.remove('top-full', 'mt-2');
                                                                } else {
                                                                    tooltip.classList.add('top-full', 'mt-2');
                                                                    tooltip.classList.remove('bottom-full', 'mb-2');
                                                                }
                                                            }
                                                        }}>
                                                            <button onClick={() => setEditingProperty(p)} className="text-indigo-600 hover:text-indigo-900" title="Edit Property"><Pencil size={16}/></button>
                                                            <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                                <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                                    {formatPropertyRecap(p)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button onClick={() => setManagingUnitsFor(p)} className="text-gray-500 hover:text-indigo-600" title="Manage Units"><Home size={16}/></button>
                                                        <button onClick={() => setChoosingManagerFor(p)} className="text-blue-600 hover:text-blue-900" title="Choose Manager"><User size={16}/></button>
                                                    </>
                                                )}
                                                {p.is_archived && showArchived && (
                                                    <button onClick={() => handleRestore(p.property_id)} className="text-green-600 hover:text-green-900" title="Restore Property"><RotateCcw size={16}/></button>
                                                )}
                                                <button onClick={() => setDeletingProperty(p)} className="text-red-600 hover:text-red-900" title={p.is_archived ? "Archive Property" : "Archive Property"}><Trash2 size={16}/></button>
                                            </div>
                                        </td>
                                        <td className="px-1.5 py-2">
                                            <div className="relative group inline-block" onMouseEnter={(e) => {
                                                const tooltip = e.currentTarget.querySelector('.tooltip-content');
                                                if (tooltip) {
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    const viewportHeight = window.innerHeight;
                                                    const spaceBelow = viewportHeight - rect.bottom;
                                                    const tooltipHeight = 200;
                                                    if (spaceBelow < tooltipHeight + 20) {
                                                        tooltip.classList.add('bottom-full', 'mb-2');
                                                        tooltip.classList.remove('top-full', 'mt-2');
                                                    } else {
                                                        tooltip.classList.add('top-full', 'mt-2');
                                                        tooltip.classList.remove('bottom-full', 'mb-2');
                                                    }
                                                }
                                            }}>
                                                <div className="space-y-1">
                                                    {p.is_archived && (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full finder-secondary bg-gray-100 text-gray-600 mr-2">Archived</span>
                                                    )}
                                                    {formatAddressMultiLine(p).map((line, index) => (
                                                        <div key={index} className={`block cursor-help ${index > 0 ? 'finder-secondary text-gray-500' : ''}`}>{line}</div>
                                                    ))}
                                                </div>
                                                <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                    <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                        {formatPropertyRecap(p)}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">{p.landlord_name}</td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">{p.property_type}</td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">{p.unit_count || 0}</td>
                                        <td className="px-1.5 py-2">
                                            {p.management_display?.company ? (
                                                <div>
                                                    <div>{p.management_display.company}</div>
                                                    {p.management_display.manager && (
                                                        <div className="finder-secondary text-gray-500">{p.management_display.manager}</div>
                                                    )}
                                                </div>
                                            ) : (
                                                'Self-Managed'
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {hasMoreProperties && (
                        <div className="pt-3 mt-4 border-t text-right flex-shrink-0">
                            <button
                                type="button"
                                onClick={showMoreProperties}
                                className="text-indigo-600 hover:text-indigo-800 underline text-sm font-medium"
                            >
                                more
                            </button>
                        </div>
                    )}
                    </div>
                </Card>
            </div>
            {editingProperty && <EditPropertyModal property={editingProperty} landlords={landlords} propertyTypes={propertyTypes} onClose={() => setEditingProperty(null)} onUpdateSuccess={handleSuccess} />}
            {deletingProperty && (
                <ArchiveModal 
                    entity={deletingProperty}
                    entityType="property"
                    entityName={formatAddress(deletingProperty)}
                    idField="property_id"
                    onClose={() => setDeletingProperty(null)}
                    onArchiveSuccess={handleSuccess}
                    showCascade={true}
                    cascadeMessage="Also archive all units in this property"
                    requireReason={false}
                    isAdmin={user?.role === 'global_admin'}
                />
            )}
            {managingUnitsFor && <ManageUnitsModal property={managingUnitsFor} onClose={() => setManagingUnitsFor(null)} onUpdateSuccess={handleDataRefresh} />}
            {choosingManagerFor && <ChooseManagerModal property={choosingManagerFor} companies={companies} onClose={() => setChoosingManagerFor(null)} onUpdateSuccess={handleDataRefresh} />}
        </div>
    );
}

const ChooseManagerModal = ({ property, companies, onClose, onUpdateSuccess }) => {
    const [selectedPmcId, setSelectedPmcId] = useState(property.pmc_id?.toString() || '');
    const [selectedManagerId, setSelectedManagerId] = useState(property.manager_id?.toString() || '');
    const [managers, setManagers] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    // Reset state when property changes
    useEffect(() => {
        setSelectedPmcId(property.pmc_id?.toString() || '');
        setSelectedManagerId(property.manager_id?.toString() || '');
        setManagers([]);
        setError('');
    }, [property.property_id, property.pmc_id, property.manager_id]);

    // Fetch managers when PM company is selected
    useEffect(() => {
        const fetchManagers = async () => {
            if (!selectedPmcId) {
                setManagers([]);
                setSelectedManagerId('');
                return;
            }

            try {
                const { data: managersData, error: managerError } = await supabase
                    .from('users')
                    .select('user_id')
                    .eq('pmc_id', parseInt(selectedPmcId))
                    .in('role', ['manager', 'company_admin'])
                    .eq('is_archived', false);

                if (managerError) {
                    console.error('Error fetching managers:', managerError);
                    setManagers([]);
                } else {
                    // Get contact information for managers
                    const managerIds = (managersData || []).map(m => m.user_id);
                    let formattedManagers = [];
                    
                    if (managerIds.length > 0) {
                        const { data: contactsData } = await supabase
                            .from('contacts')
                            .select('contactable_id, first_name, last_name, middle_name')
                            .in('contactable_id', managerIds)
                            .eq('contactable_type', 'user');
                        
                        formattedManagers = (managersData || []).map(m => {
                            const contact = contactsData?.find(c => c.contactable_id === m.user_id);
                            return {
                                user_id: m.user_id,
                                name: formatManagerName(contact)
                            };
                        });
                    }
                    
                    setManagers(formattedManagers);
                    
                    // Clear manager selection if current selection is not in the new list
                    if (selectedManagerId && !formattedManagers.find(m => m.user_id === parseInt(selectedManagerId))) {
                        setSelectedManagerId('');
                    }
                }
            } catch (error) {
                console.error('Error fetching managers:', error);
                setManagers([]);
            }
        };

        fetchManagers();
    }, [selectedPmcId, selectedManagerId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');

        try {
            // Update pmc_id first
            const pmcUpdateData = {
                pmc_id: selectedPmcId ? parseInt(selectedPmcId) : null
            };

            const { error: pmcUpdateError } = await supabase
                .from('properties')
                .update(pmcUpdateData)
                .eq('property_id', property.property_id);

            if (pmcUpdateError) {
                console.error('Error updating pmc_id:', pmcUpdateError);
                setError(pmcUpdateError.message || 'Failed to update PM company.');
                setIsSubmitting(false);
                return;
            }

            // Update manager_id separately using RPC to bypass schema cache issues
            try {
                const { error: managerUpdateError } = await supabase.rpc('update_property_manager', {
                    p_property_id: property.property_id,
                    p_manager_id: selectedManagerId ? parseInt(selectedManagerId) : null
                });

                if (managerUpdateError) {
                    // Check if it's a schema cache issue - suppress these errors
                    if (managerUpdateError.code === '42703' || managerUpdateError.message?.includes('schema cache') || managerUpdateError.message?.includes('does not exist')) {
                        console.warn('manager_id column may not be in schema cache, but update may have succeeded');
                    } else {
                        console.error('Error updating manager_id:', managerUpdateError);
                        // Fallback to direct update
                        const { error: fallbackError } = await supabase
                            .from('properties')
                            .update({ manager_id: selectedManagerId ? parseInt(selectedManagerId) : null })
                            .eq('property_id', property.property_id);
                        
                        if (fallbackError) {
                            // If both fail, check if it's a schema cache issue
                            if (fallbackError.code === '42703' || fallbackError.message?.includes('schema cache') || fallbackError.message?.includes('does not exist')) {
                                console.warn('manager_id column may not be in schema cache, but update may have succeeded');
                            } else {
                                setError(fallbackError.message || 'Failed to update manager.');
                                setIsSubmitting(false);
                                return;
                            }
                        }
                    }
                }
            } catch (err) {
                // Check if it's a schema cache issue
                if (err.code === '42703' || err.message?.includes('schema cache') || err.message?.includes('does not exist')) {
                    console.warn('manager_id column may not be in schema cache, but update may have succeeded');
                } else {
                    console.error('Error calling update_property_manager RPC:', err);
                    // Try direct update as fallback
                    const { error: fallbackError } = await supabase
                        .from('properties')
                        .update({ manager_id: selectedManagerId ? parseInt(selectedManagerId) : null })
                        .eq('property_id', property.property_id);
                    
                    if (fallbackError) {
                        if (fallbackError.code === '42703' || fallbackError.message?.includes('schema cache') || fallbackError.message?.includes('does not exist')) {
                            console.warn('manager_id column may not be in schema cache, but update may have succeeded');
                        } else {
                            setError(fallbackError.message || 'Failed to update manager.');
                            setIsSubmitting(false);
                            return;
                        }
                    }
                }
            }

            onUpdateSuccess();
            onClose();
        } catch (err) {
            console.error('Error updating property:', err);
            setError('Could not connect to the server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget && !isDragging) {
            // Don't close on backdrop click
            return;
        }
    };

    const handleModalMouseDown = (e) => {
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleModalMouseMove = (e) => {
        if (e.buttons === 1) {
            setIsDragging(true);
        }
    };

    const handleModalMouseUp = (e) => {
        e.stopPropagation();
        setTimeout(() => setIsDragging(false), 100);
    };

    return (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div 
                className="w-full max-w-lg bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-gray-900">Choose Manager for {property.property_name || formatAddress(property)}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
                </div>

                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto">
                    <form onSubmit={handleSubmit} className="p-6 space-y-4" id="choose-manager-form">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">PM Company</label>
                            <select
                                value={selectedPmcId}
                                onChange={e => setSelectedPmcId(e.target.value)}
                                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="">(No PM Company)</option>
                                {companies.map(c => (
                                    <option key={c.pmc_id} value={c.pmc_id}>{c.company_name}</option>
                                ))}
                            </select>
                        </div>

                        {selectedPmcId && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Manager (Optional)</label>
                                <select
                                    value={selectedManagerId}
                                    onChange={e => setSelectedManagerId(e.target.value)}
                                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                >
                                    <option value="">(No Manager Assigned)</option>
                                    {managers.map(m => (
                                        <option key={m.user_id} value={m.user_id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {error && (
                            <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                {error}
                            </div>
                        )}
                    </form>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            form="choose-manager-form"
                            disabled={isSubmitting}
                            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {isSubmitting ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CreatePropertyForm = ({ landlords, propertyTypes, onPropertyCreated }) => {
    const { user } = useContext(AuthContext);
    const [landlordId, setLandlordId] = useState('');
    const [propertyName, setPropertyName] = useState('');
    const [propertyType, setPropertyType] = useState('');
    const [customPropertyType, setCustomPropertyType] = useState('');
    const [address, setAddress] = useState({ address_line_1: '', address_line_2: '', city: '', state_province_region: '', postal_code: '', country: '' });
    const [cityOfJurisdiction, setCityOfJurisdiction] = useState('');
    const [countyOfJurisdiction, setCountyOfJurisdiction] = useState('');
    const [geocodedCity, setGeocodedCity] = useState(null);
    const [geocodedCounty, setGeocodedCounty] = useState(null);
    const [geocodingError, setGeocodingError] = useState(null);
    const [isGeocoding, setIsGeocoding] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    
    // Landlord search functionality
    const [landlordSearchTerm, setLandlordSearchTerm] = useState('');
    const [showLandlordDropdown, setShowLandlordDropdown] = useState(false);
    // Chrome treats the first text field as an email/username box; keep it locked
    // until after focus so the saved-email overlay does not cover our list.
    const [landlordLookupLocked, setLandlordLookupLocked] = useState(true);
    
    // Unit creation functionality
    const [units, setUnits] = useState([]);
    const [unitNumber, setUnitNumber] = useState('');
    const [beds, setBeds] = useState('');
    const [baths, setBaths] = useState('');
    const [sqft, setSqft] = useState('');
    const formBodyRef = useRef(null);

    // Property parking (stored via property_amenities)
    // Note: Property-level parking totals removed from UI but state kept for backward compatibility
    const [_garageSpaces, _setGarageSpaces] = useState('');
    const [_carportSpaces, _setCarportSpaces] = useState('');
    const [_pavedDrivewaySpaces, _setPavedDrivewaySpaces] = useState('');
    const [_offStreetSpaces, _setOffStreetSpaces] = useState('');
    const [streetParkingAvailableYes, setStreetParkingAvailableYes] = useState(false);
    const [streetParkingAvailableNo, setStreetParkingAvailableNo] = useState(true); // default to No

    // Unit parking (stored via unit_features)
    // Parking rule always defaults to 'dedicated' - UI removed but logic remains
    const [dedicatedGarageSpaces, setDedicatedGarageSpaces] = useState('');
    const [dedicatedCarportSpaces, setDedicatedCarportSpaces] = useState('');
    const [dedicatedPavedDrivewaySpaces, setDedicatedPavedDrivewaySpaces] = useState('');
    const [dedicatedOffStreetSpaces, setDedicatedOffStreetSpaces] = useState('');
    
    // Form persistence (excluding units, geocoding state, and search terms)
    const { clearPersistedData } = useFormPersistence('add-property', {
        landlordId, propertyName, propertyType, customPropertyType, address, cityOfJurisdiction, countyOfJurisdiction
    }, (state) => {
        setLandlordId(state.landlordId || '');
        setPropertyName(state.propertyName || '');
        setPropertyType(state.propertyType || '');
        setCustomPropertyType(state.customPropertyType || '');
        setAddress(state.address || { address_line_1: '', address_line_2: '', city: '', state_province_region: '', postal_code: '', country: '' });
        setCityOfJurisdiction(state.cityOfJurisdiction || '');
        setCountyOfJurisdiction(state.countyOfJurisdiction || '');
    });
    
    // Filter landlords based on search term
    const filteredLandlords = useMemo(() => {
        if (!landlordSearchTerm.trim()) {
            return landlords;
        }
        
        const searchLower = landlordSearchTerm.toLowerCase();
        return landlords.filter(landlord => {
            const nameMatch = formatLandlordName(landlord).toLowerCase().includes(searchLower);
            const emailMatch = landlord.email?.toLowerCase().includes(searchLower);
            const companyMatch = landlord.company_name?.toLowerCase().includes(searchLower);
            
            return nameMatch || emailMatch || companyMatch;
        });
    }, [landlords, landlordSearchTerm]);
    
    // Get selected landlord name for display
    const selectedLandlord = landlords.find(l => l.landlord_id === landlordId);
    const selectedLandlordName = selectedLandlord ? formatLandlordName(selectedLandlord) : '';

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (showLandlordDropdown && !event.target.closest('.landlord-dropdown')) {
                setShowLandlordDropdown(false);
                setLandlordLookupLocked(true);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showLandlordDropdown]);

    const handleAddressChange = (field, value) => {
        setAddress(prev => ({ ...prev, [field]: value }));
        // Clear geocoding results when address changes
        setGeocodedCity(null);
        setGeocodedCounty(null);
        setGeocodingError(null);

        // Auto-generate property name if property_name is empty or looks auto-generated
        // Property name is considered auto-generated if it ends with the property type
        const finalPropertyType = propertyType === 'Other' ? customPropertyType : propertyType;
        const looksAutoGenerated = propertyName && finalPropertyType && propertyName.trim().endsWith(` ${finalPropertyType}`);
        if ((!propertyName || looksAutoGenerated) && (field === 'address_line_1' || field === 'city' || field === 'address_line_2') && finalPropertyType) {
            const newAddress = { ...address, [field]: value };
            if (newAddress.address_line_1 && newAddress.city) {
                // Build property name: address_line_1 + unit (if condo) + city + property_type
                let suggestedName = newAddress.address_line_1;
                
                // For condos, check if address_line_2 has a unit number
                if (finalPropertyType.toLowerCase().includes('condo') && newAddress.address_line_2) {
                    // Extract unit number from address_line_2 (e.g., "#599" or "Unit 599")
                    const unitMatch = newAddress.address_line_2.match(/#?\s*(\d+)/i);
                    if (unitMatch) {
                        suggestedName += ` Unit #${unitMatch[1]}`;
                    } else {
                        // If no number found, use the whole address_line_2
                        suggestedName += ` ${newAddress.address_line_2}`;
                    }
                }
                
                suggestedName += ` ${newAddress.city} ${finalPropertyType}`;
                setPropertyName(suggestedName);
            }
        }
    };

    // Auto-generate property name when user finishes entering city
    const handleCityBlur = () => {
        const finalPropertyType = propertyType === 'Other' ? customPropertyType : propertyType;
        if (!propertyName && address.address_line_1 && address.city && finalPropertyType) {
            let suggestedName = address.address_line_1;
            
            // For condos, check if address_line_2 has a unit number
            if (finalPropertyType.toLowerCase().includes('condo') && address.address_line_2) {
                const unitMatch = address.address_line_2.match(/#?\s*(\d+)/i);
                if (unitMatch) {
                    suggestedName += ` Unit #${unitMatch[1]}`;
                } else {
                    suggestedName += ` ${address.address_line_2}`;
                }
            }
            
            suggestedName += ` ${address.city} ${finalPropertyType}`;
            setPropertyName(suggestedName);
        }
    };

    // Geocode address when it's complete enough
    const handleGeocodeAddress = useCallback(async () => {
        const hasAddressData = address.address_line_1 && 
                              (address.city || address.postal_code || address.state_province_region);
        
        if (!hasAddressData) {
            return;
        }

        setIsGeocoding(true);
        setGeocodingError(null);
        
        try {
            const result = await geocodeAddress(address);
            
            if (result.error) {
                setGeocodingError(result.error);
                setGeocodedCity(null);
                setGeocodedCounty(null);
            } else {
                setGeocodedCity(result.city);
                setGeocodedCounty(result.county);
                setGeocodingError(null);
                
                // Auto-fill jurisdiction fields if they're empty
                if (!cityOfJurisdiction && result.city) {
                    setCityOfJurisdiction(result.city);
                }
                if (!countyOfJurisdiction && result.county) {
                    setCountyOfJurisdiction(result.county);
                }
            }
        } catch {
            setGeocodingError('Failed to geocode address. Please try again.');
            setGeocodedCity(null);
            setGeocodedCounty(null);
        } finally {
            setIsGeocoding(false);
        }
    }, [address, cityOfJurisdiction, countyOfJurisdiction]);

    // Auto-geocode when address fields are filled
    useEffect(() => {
        const timer = setTimeout(() => {
            handleGeocodeAddress();
        }, 1000); // Debounce for 1 second

        return () => clearTimeout(timer);
    }, [handleGeocodeAddress]);

    // Check if jurisdiction values are overridden (different from geocoded)
    const isCityOverridden = geocodedCity && cityOfJurisdiction && 
                            cityOfJurisdiction.toLowerCase() !== geocodedCity.toLowerCase();
    const isCountyOverridden = geocodedCounty && countyOfJurisdiction && 
                               countyOfJurisdiction.toLowerCase() !== geocodedCounty.toLowerCase();
    
    // Unit management functions
    const addUnit = () => {
        const parkingRule = 'dedicated';
        const newUnit = {
            unit_number: normalizeStoredUnitNumber(unitNumber),
            beds: beds || null,
            baths: baths || null,
            square_footage: sqft || null,
            parking: {
                parking_rule: parkingRule,
                dedicated_garage_spaces: dedicatedGarageSpaces,
                dedicated_carport_spaces: dedicatedCarportSpaces,
                dedicated_paved_driveway_spaces: dedicatedPavedDrivewaySpaces,
                dedicated_off_street_spaces: dedicatedOffStreetSpaces,
            }
        };
        const next = [...units, newUnit];
        const check = validatePropertyUnitNumbers(next);
        if (!check.ok) {
            setFormError(check.message);
            return;
        }
        setFormError('');
        setUnits(next);
        setUnitNumber('');
        setBeds('');
        setBaths('');
        setSqft('');
        setDedicatedGarageSpaces('');
        setDedicatedCarportSpaces('');
        setDedicatedPavedDrivewaySpaces('');
        setDedicatedOffStreetSpaces('');
    };
    
    const removeUnit = (index) => {
        setUnits(units.filter((_, i) => i !== index));
    };

    const resetForm = useCallback(() => {
        setLandlordId('');
        setLandlordSearchTerm('');
        setShowLandlordDropdown(false);
        setLandlordLookupLocked(true);
        setPropertyName('');
        setPropertyType('');
        setCustomPropertyType('');
        setAddress({ address_line_1: '', address_line_2: '', city: '', state_province_region: '', postal_code: '', country: '' });
        setCityOfJurisdiction('');
        setCountyOfJurisdiction('');
        setGeocodedCity(null);
        setGeocodedCounty(null);
        setGeocodingError(null);
        setUnits([]);
        setUnitNumber('');
        setBeds('');
        setBaths('');
        setSqft('');
        _setGarageSpaces('');
        _setCarportSpaces('');
        _setPavedDrivewaySpaces('');
        _setOffStreetSpaces('');
        setStreetParkingAvailableYes(false);
        setStreetParkingAvailableNo(true); // Reset to default (No)
        setDedicatedGarageSpaces('');
        setDedicatedCarportSpaces('');
        setDedicatedPavedDrivewaySpaces('');
        setDedicatedOffStreetSpaces('');
        setFormError('');
        clearPersistedData();
    }, [clearPersistedData]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        try {
            const parkingDraft = {
                parking_rule: 'dedicated',
                dedicated_garage_spaces: dedicatedGarageSpaces,
                dedicated_carport_spaces: dedicatedCarportSpaces,
                dedicated_paved_driveway_spaces: dedicatedPavedDrivewaySpaces,
                dedicated_off_street_spaces: dedicatedOffStreetSpaces,
            };
            const hasParkingDraft = [
                dedicatedGarageSpaces,
                dedicatedCarportSpaces,
                dedicatedPavedDrivewaySpaces,
                dedicatedOffStreetSpaces,
            ].some((v) => String(v || '').trim() !== '');
            const hasDraftUnit =
                !!unitNumberText(unitNumber) ||
                !!String(beds || '').trim() ||
                !!String(baths || '').trim() ||
                !!String(sqft || '').trim() ||
                hasParkingDraft;

            let finalUnits = [...units];
            if (hasDraftUnit) {
                const draft = {
                    unit_number: normalizeStoredUnitNumber(unitNumber),
                    beds: beds || null,
                    baths: baths || null,
                    square_footage: sqft || null,
                    parking: parkingDraft,
                };
                const draftNumber = unitNumberText(draft);
                const duplicate = draftNumber
                    && finalUnits.some((u) => unitNumberText(u).toLowerCase() === draftNumber.toLowerCase());
                if (!duplicate) finalUnits = [...finalUnits, draft];
            }
            if (finalUnits.length === 0) {
                finalUnits = [defaultUnlabeledUnit()];
            }
            const unitCheck = validatePropertyUnitNumbers(finalUnits);
            if (!unitCheck.ok) {
                setFormError(unitCheck.message);
                return;
            }
            
            const finalPropertyType = propertyType === 'Other' ? customPropertyType : propertyType;
            
            // Step 0: Geocode address if we haven't already or if address changed
            let finalCityOfJurisdiction = cityOfJurisdiction;
            let finalCountyOfJurisdiction = countyOfJurisdiction;
            
            const hasAddressData = Object.values(address).some(value => value && value.trim() !== '');
            if (hasAddressData && (!geocodedCity || !geocodedCounty)) {
                setIsGeocoding(true);
                const geocodeResult = await geocodeAddress(address);
                setIsGeocoding(false);
                
                if (!geocodeResult.error) {
                    setGeocodedCity(geocodeResult.city);
                    setGeocodedCounty(geocodeResult.county);
                    // Use geocoded values if jurisdiction fields are empty
                    if (!finalCityOfJurisdiction && geocodeResult.city) {
                        finalCityOfJurisdiction = geocodeResult.city;
                    }
                    if (!finalCountyOfJurisdiction && geocodeResult.county) {
                        // Remove "County" suffix if present
                        finalCountyOfJurisdiction = geocodeResult.county.replace(/\s+County$/i, '');
                    }
                } else {
                    setGeocodingError(geocodeResult.error);
                }
            }
            
            // Step 1: Create property record with jurisdiction fields
            const propertyPayload = {
                landlord_id: landlordId || null,
                property_name: propertyName || null,
                property_type: finalPropertyType,
                city_of_jurisdiction: finalCityOfJurisdiction || null,
                county_of_jurisdiction: finalCountyOfJurisdiction || null
            };
            
            const { data: propertyData, error: propertyError } = await supabase
                .from('properties')
                .insert([propertyPayload])
                .select()
                .single();
            
            if (propertyError) {
                setFormError(propertyError.message || 'Failed to create property.');
                return;
            }
            
            // Step 2: Create address record if any address fields are provided
            if (hasAddressData) {
                const { error: addressError } = await supabase
                    .from('addresses')
                    .insert([{
                        addressable_id: propertyData.property_id,
                        addressable_type: 'property',
                        ...address
                    }]);
                    
                if (addressError) {
                    console.warn('Address record creation failed:', addressError);
                    // Don't fail the whole operation for address issues
                }
            }
            
            // Step 3: Always create at least one unit (unlabeled when the dwelling has no Unit #).
            const unitPayloads = finalUnits.map((unit) => ({
                unit_number: normalizeStoredUnitNumber(unit.unit_number),
                beds: unit.beds,
                baths: unit.baths,
                square_footage: unit.square_footage,
                property_id: propertyData.property_id
            }));

            const { data: insertedUnits, error: unitsError } = await supabase
                .from('units')
                .insert(unitPayloads)
                .select('unit_id, unit_number');

            if (unitsError) {
                setFormError(unitsError.message || 'Failed to create the property unit.');
                return;
            }

            try {
                const desiredFeatureNames = [];
                finalUnits.forEach((u) => desiredFeatureNames.push(...buildUnitParkingFeatureNames(u.parking)));
                const uniqueNames = [...new Set(desiredFeatureNames)].filter(Boolean);
                if (uniqueNames.length > 0) {
                    const { data: existingFeatures } = await supabase
                        .from('features')
                        .select('feature_id, feature_name')
                        .in('feature_name', uniqueNames);
                    const existingMap = new Map((existingFeatures || []).map(f => [f.feature_name, f.feature_id]));
                    const missing = uniqueNames.filter(n => !existingMap.has(n));
                    if (missing.length > 0) {
                        const { data: createdFeatures } = await supabase
                            .from('features')
                            .insert(missing.map(feature_name => ({ feature_name })))
                            .select('feature_id, feature_name');
                        (createdFeatures || []).forEach(f => existingMap.set(f.feature_name, f.feature_id));
                    }

                    const junctionRows = [];
                    (insertedUnits || []).forEach((inserted, index) => {
                        const u = finalUnits[index];
                        if (!u || !inserted?.unit_id) return;
                        const names = buildUnitParkingFeatureNames(u.parking);
                        names.forEach((name) => {
                            const featureId = existingMap.get(name);
                            if (featureId) junctionRows.push({ unit_id: inserted.unit_id, feature_id: featureId });
                        });
                    });
                    if (junctionRows.length > 0) {
                        await insertWithAudit('unit_features', junctionRows, user?.user_id);
                    }
                }
            } catch (err) {
                console.warn('Unit features creation failed:', err);
            }

            // Step 4: Store property parking info in property_amenities (name-encoded)
            // Only store street parking available - property-level parking totals removed
            try {
                const amenityNames = buildPropertyParkingAmenityNames({
                    garage_spaces: '',
                    carport_spaces: '',
                    paved_driveway_spaces: '',
                    off_street_spaces: '',
                    street_parking_available: streetParkingAvailableYes ? 'yes' : (streetParkingAvailableNo ? 'no' : ''),
                });
                if (amenityNames.length > 0) {
                    const { data: existingAmenities } = await supabase
                        .from('amenities')
                        .select('amenity_id, amenity_name')
                        .in('amenity_name', amenityNames);
                    const existingMap = new Map((existingAmenities || []).map(a => [a.amenity_name, a.amenity_id]));
                    const missing = amenityNames.filter(n => !existingMap.has(n));
                    if (missing.length > 0) {
                        const { data: createdAmenities } = await supabase
                            .from('amenities')
                            .insert(missing.map(amenity_name => ({ amenity_name })))
                            .select('amenity_id, amenity_name');
                        (createdAmenities || []).forEach(a => existingMap.set(a.amenity_name, a.amenity_id));
                    }
                    const junctionRows = amenityNames
                        .map(n => existingMap.get(n))
                        .filter(Boolean)
                        .map(amenity_id => ({ property_id: propertyData.property_id, amenity_id }));
                    if (junctionRows.length > 0) {
                        await insertWithAudit('property_amenities', junctionRows, user?.user_id);
                    }
                }
            } catch (err) {
                console.warn('Property amenities creation failed:', err);
            }
            
            resetForm();
            onPropertyCreated();
            // Scroll form body to top after state updates and data refresh
            setTimeout(() => {
                if (formBodyRef.current) {
                    formBodyRef.current.scrollTop = 0;
                }
            }, 100);
            
        } catch (_ERR) {
            console.error('Error creating property:', _ERR);
            setFormError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClear = () => {
        resetForm();
        // Scroll form body to top after state updates
        setTimeout(() => {
            if (formBodyRef.current) {
                formBodyRef.current.scrollTop = 0;
            }
        }, 100);
    };

    return (
        <Card hideTitle className="max-h-[calc(100vh-160px)] min-h-0 lg:max-h-none" contentClassName="flex min-h-0 flex-col h-full">
            <form onSubmit={handleCreate} className="flex min-h-0 flex-col h-full" autoComplete="off">
                <div className="flex items-start justify-between pb-4 mb-4 border-b">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Add Property</h2>
                    </div>
                </div>
                <div ref={formBodyRef} className="flex-1 overflow-y-auto pr-1 space-y-4">
                <div>
                    <label htmlFor="ml-add-property-landlord" className="block text-sm font-medium text-gray-700">Landlord</label>
                    <div className="relative landlord-dropdown">
                        <input
                            id="ml-add-property-landlord"
                            name="ml-add-property-landlord"
                            type="search"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded={showLandlordDropdown}
                            aria-haspopup="listbox"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            inputMode="search"
                            data-lpignore="true"
                            data-1p-ignore="true"
                            data-bwignore="true"
                            data-form-type="other"
                            readOnly={landlordLookupLocked}
                            onFocus={() => {
                                setShowLandlordDropdown(true);
                                requestAnimationFrame(() => setLandlordLookupLocked(false));
                            }}
                            placeholder="Search by name or company"
                            value={landlordSearchTerm}
                            onChange={(e) => {
                                setLandlordSearchTerm(e.target.value);
                                setShowLandlordDropdown(true);
                            }}
                            className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                        />
                        {showLandlordDropdown && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto overflow-x-hidden finder-list">
                                {filteredLandlords.length === 0 ? (
                                    <div className="px-3 py-2 text-sm text-gray-500">No landlords found</div>
                                ) : (
                                    filteredLandlords.map(landlord => (
                                        <button
                                            key={landlord.landlord_id}
                                            type="button"
                                            onMouseDown={(event) => {
                                                event.preventDefault();
                                                setLandlordId(landlord.landlord_id);
                                                setLandlordSearchTerm(formatLandlordName(landlord));
                                                setShowLandlordDropdown(false);
                                                setLandlordLookupLocked(true);
                                            }}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none min-w-0"
                                        >
                                            <div className="finder-primary truncate">{formatLandlordName(landlord)}</div>
                                            {landlord.email && (
                                                <div className="finder-secondary text-gray-500 truncate">{landlord.email}</div>
                                            )}
                                            {landlord.company_name && (
                                                <div className="finder-secondary text-gray-500 truncate">{landlord.company_name}</div>
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                    {landlordId && (
                        <div className="mt-1 text-sm text-gray-600">
                            Selected: {selectedLandlordName}
                        </div>
                    )}
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">
                        Property or Complex Name <span className="text-gray-500 text-xs">(optional, but recommended)</span>
                    </label>
                    <input
                        type="text"
                        value={propertyName}
                        onChange={e => setPropertyName(e.target.value)}
                        placeholder="e.g., Wuthering Heights, Sunset Apartments, or leave blank for auto-fill"
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                        For apartment complexes, enter the property name. For houses, this will auto-fill from the address if left blank.
                    </p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Property Type</label>
                    <select value={propertyType} onChange={e => setPropertyType(e.target.value)} required className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm">
                        <option value="">Select Type</option>
                        {propertyTypes.map(type => (
                            <option key={type.type_id} value={type.type_name}>{type.type_name}</option>
                        ))}
                    </select>
                </div>
                {propertyType === 'Other' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Custom Property Type</label>
                        <input 
                            type="text" 
                            value={customPropertyType} 
                            onChange={e => setCustomPropertyType(e.target.value)} 
                            placeholder="Enter property type (e.g., Ranch, Bungalow, etc.)"
                            required 
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>
                )}
                 <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-2">Address</h4>
                    <div className="space-y-2">
                        <input value={address.address_line_1} onChange={e => handleAddressChange('address_line_1', e.target.value)} placeholder="Address Line 1" required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        <input value={address.address_line_2} onChange={e => handleAddressChange('address_line_2', e.target.value)} placeholder="Address Line 2" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input value={address.city} onChange={e => handleAddressChange('city', e.target.value)} onBlur={handleCityBlur} placeholder="City" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            <input value={address.state_province_region} onChange={e => handleAddressChange('state_province_region', e.target.value)} placeholder="State / Province" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        </div>
                         <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input value={address.postal_code} onChange={e => handleAddressChange('postal_code', e.target.value)} placeholder="Postal Code" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            <input value={address.country} onChange={e => handleAddressChange('country', e.target.value)} placeholder="Country" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        </div>
                    </div>
                </div>
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-2">Jurisdiction</h4>
                    {isGeocoding && (
                        <div className="mb-2 text-sm text-gray-600">Geocoding address...</div>
                    )}
                    {geocodingError && (
                        <div className="mb-2 p-2 text-sm text-yellow-700 bg-yellow-100 border border-yellow-400 rounded-md">
                            ⚠️ {geocodingError}
                        </div>
                    )}
                    <div className="space-y-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">
                                City of Jurisdiction {isCityOverridden && <span className="text-red-600">*</span>}
                            </label>
                            <input 
                                value={cityOfJurisdiction} 
                                onChange={e => setCityOfJurisdiction(e.target.value)} 
                                placeholder="Auto-filled from address"
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                            {isCityOverridden && (
                                <p className="mt-1 text-xs text-gray-500">Geocoded: {geocodedCity}</p>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">
                                County of Jurisdiction {isCountyOverridden && <span className="text-red-600">*</span>}
                            </label>
                            <input 
                                value={countyOfJurisdiction} 
                                onChange={e => setCountyOfJurisdiction(e.target.value)} 
                                placeholder="Auto-filled from address"
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                            {isCountyOverridden && (
                                <p className="mt-1 text-xs text-gray-500">Geocoded: {geocodedCounty}</p>
                            )}
                        </div>
                    </div>
                </div>
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-4">Units</h4>
                    
                    {/* Add Unit Form */}
                    <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 mb-4">
                        <div className="space-y-4 mb-4">
                            {/* First Row: Unit Number and Beds */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit #</label>
                                    <input 
                                        value={unitNumber} 
                                        onChange={e => setUnitNumber(e.target.value)} 
                                        placeholder="e.g., 1A, 2B"
                                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Beds</label>
                                    <input 
                                        type="number" 
                                        value={beds} 
                                        onChange={e => setBeds(e.target.value)} 
                                        placeholder="0"
                                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                            </div>
                            
                            {/* Second Row: Baths and Square Footage */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Baths</label>
                                    <input 
                                        type="number" 
                                        step="0.5"
                                        value={baths} 
                                        onChange={e => setBaths(e.target.value)} 
                                        placeholder="0"
                                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Sq Ft</label>
                                    <input 
                                        type="number" 
                                        value={sqft} 
                                        onChange={e => setSqft(e.target.value)} 
                                        placeholder="0"
                                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                            </div>

                            {/* Unit Parking */}
                            <div className="pt-2 border-t border-gray-200">
                                <h5 className="text-sm font-medium text-gray-700 mb-2">Unit Parking</h5>
                                <div className="mt-3 grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Garage Spaces</label>
                                        <input type="number" value={dedicatedGarageSpaces} onChange={e => setDedicatedGarageSpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Carport Spaces</label>
                                        <input type="number" value={dedicatedCarportSpaces} onChange={e => setDedicatedCarportSpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Paved Driveway Spaces</label>
                                        <input type="number" value={dedicatedPavedDrivewaySpaces} onChange={e => setDedicatedPavedDrivewaySpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Off-Street Spaces</label>
                                        <input type="number" value={dedicatedOffStreetSpaces} onChange={e => setDedicatedOffStreetSpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button 
                            type="button" 
                            onClick={addUnit}
                            disabled={units.length >= 1 && !unitNumberText(unitNumber)}
                            className="px-4 py-2 text-sm font-medium text-indigo-600 bg-white border border-indigo-300 rounded-md shadow-sm hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Add Unit
                        </button>
                    </div>
                    
                    {/* Units List */}
                    {units.length > 0 && (
                        <div className="space-y-2">
                            <h5 className="text-sm font-medium text-gray-700">Added Units:</h5>
                            {units.map((unit, index) => (
                                <div key={index} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-md">
                                    <div className="flex items-center space-x-4">
                                        <span className="font-medium">{formatUnitQualifier(unit)}</span>
                                        {unit.beds && <span className="text-sm text-gray-500">{unit.beds} bed{unit.beds !== '1' ? 's' : ''}</span>}
                                        {unit.baths && <span className="text-sm text-gray-500">{unit.baths} bath{unit.baths !== '1' ? 's' : ''}</span>}
                                        {unit.square_footage && <span className="text-sm text-gray-500">{unit.square_footage} sq ft</span>}
                                        {(() => {
                                            const parking = unit.parking || {};
                                            const spots = [];
                                            if (parking.dedicated_garage_spaces) spots.push(`${parking.dedicated_garage_spaces} garage`);
                                            if (parking.dedicated_carport_spaces) spots.push(`${parking.dedicated_carport_spaces} carport`);
                                            if (parking.dedicated_paved_driveway_spaces) spots.push(`${parking.dedicated_paved_driveway_spaces} driveway`);
                                            if (parking.dedicated_off_street_spaces) spots.push(`${parking.dedicated_off_street_spaces} off-street`);
                                            return spots.length > 0 ? (
                                                <span className="text-sm text-gray-500">
                                                    Parking: {spots.join(', ')}
                                                </span>
                                            ) : null;
                                        })()}
                                    </div>
                                    <button 
                                        type="button"
                                        onClick={() => removeUnit(index)}
                                        className="text-red-600 hover:text-red-800"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="pt-4 border-t">
                    <div className="flex items-center space-x-4">
                        <label className="block text-sm font-medium text-gray-700">Street Parking Available</label>
                        <div className="flex items-center space-x-4">
                            <label className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={streetParkingAvailableYes}
                                    onChange={e => {
                                        setStreetParkingAvailableYes(e.target.checked);
                                        if (e.target.checked) setStreetParkingAvailableNo(false);
                                    }}
                                    className="mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                />
                                <span className="text-sm text-gray-700">Yes</span>
                            </label>
                            <label className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={streetParkingAvailableNo}
                                    onChange={e => {
                                        setStreetParkingAvailableNo(e.target.checked);
                                        if (e.target.checked) setStreetParkingAvailableYes(false);
                                    }}
                                    className="mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                />
                                <span className="text-sm text-gray-700">No</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                </div>
                <div className="pt-4 mt-4 border-t flex flex-col gap-3">
                    {formError && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{formError}</div>)}
                    <div className="flex justify-end gap-3 flex-wrap">
                        <button type="button" onClick={handleClear} className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Clear</button>
                        <button type="submit" disabled={isSubmitting} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50">{isSubmitting ? 'Adding...' : 'Add Property'}</button>
                    </div>
                </div>
            </form>
        </Card>
    );
};

const EditPropertyModal = ({ property, landlords, propertyTypes, onClose, onUpdateSuccess }) => {
    const { user } = useContext(AuthContext);
    const [landlordId, setLandlordId] = useState(property.landlord_id || '');
    const [propertyName, setPropertyName] = useState(property.property_name || '');
    const [propertyType, setPropertyType] = useState(property.property_type || '');
    const [customPropertyType, setCustomPropertyType] = useState('');
    const [address, setAddress] = useState({
        address_line_1: property.address_line_1 || '',
        address_line_2: property.address_line_2 || '',
        city: property.city || '',
        state_province_region: property.state_province_region || '',
        postal_code: property.postal_code || '',
        country: property.country || '',
    });
    const [cityOfJurisdiction, setCityOfJurisdiction] = useState(property.city_of_jurisdiction || '');
    const [countyOfJurisdiction, setCountyOfJurisdiction] = useState(property.county_of_jurisdiction || '');
    const [geocodedCity, setGeocodedCity] = useState(null);
    const [geocodedCounty, setGeocodedCounty] = useState(null);
    const [geocodingError, setGeocodingError] = useState(null);
    const [isGeocoding, setIsGeocoding] = useState(false);
    const [_isDragging, setIsDragging] = useState(false);
    const [units, setUnits] = useState([]);
    const [showManageUnits, setShowManageUnits] = useState(false);
    const [_pmcId, setPmcId] = useState(property.pmc_id || '');
    const [managerId, _setManagerId] = useState(property.manager_id || '');
    const [_managers, setManagers] = useState([]);

    // Property parking (stored via property_amenities as name-encoded values)
    const [garageSpaces, setGarageSpaces] = useState('');
    const [carportSpaces, setCarportSpaces] = useState('');
    const [pavedDrivewaySpaces, setPavedDrivewaySpaces] = useState('');
    const [offStreetSpaces, setOffStreetSpaces] = useState('');
    const [streetParkingAvailableYes, setStreetParkingAvailableYes] = useState(false);
    const [streetParkingAvailableNo, setStreetParkingAvailableNo] = useState(true); // default to No

    // Load existing parking amenities for this property (best-effort)
    useEffect(() => {
        const loadParkingAmenities = async () => {
            try {
                const { data } = await supabase
                    .from('property_amenities')
                    .select('amenity_id, amenities(amenity_name)')
                    .eq('property_id', property.property_id);

                const names = (data || [])
                    .map(row => row?.amenities?.amenity_name)
                    .filter(Boolean);

                const getCount = (prefix) => {
                    const hit = names.find(n => n.startsWith(prefix));
                    if (!hit) return '';
                    const m = hit.match(/:(\d+)$/);
                    return m ? m[1] : '';
                };
                const getYesNo = (prefix) => {
                    const hit = names.find(n => n.startsWith(prefix));
                    if (!hit) return '';
                    const m = hit.match(/:(yes|no)$/);
                    return m ? m[1] : '';
                };

                setGarageSpaces(getCount('parking_garage_spaces:'));
                setCarportSpaces(getCount('parking_carport_spaces:'));
                setPavedDrivewaySpaces(getCount('parking_paved_driveway_spaces:'));
                setOffStreetSpaces(getCount('parking_off_street_spaces:'));
                const streetParkingValue = getYesNo('parking_street_parking_available:');
                setStreetParkingAvailableYes(streetParkingValue === 'yes');
                setStreetParkingAvailableNo(streetParkingValue === 'no' || !streetParkingValue);
            } catch (err) {
                console.warn('Failed to load property parking amenities:', err);
            }
        };

        if (property?.property_id) loadParkingAmenities();
    }, [property?.property_id]);

    // Check if the current property type is not in the dynamic list
    const isCustomType = property.property_type && !propertyTypes.some(type => type.type_name === property.property_type);
    
    // Set initial values
    React.useEffect(() => {
        if (isCustomType) {
            setPropertyType('Other');
            setCustomPropertyType(property.property_type);
        }
    }, [property.property_type, isCustomType, propertyTypes]);

    // Fetch PM company and managers for this property
    useEffect(() => {
        const fetchPmcAndManagers = async () => {
            // Get PM company from property
            if (property.pmc_id) {
                setPmcId(property.pmc_id.toString());
                
                // Fetch managers for the PM company
                try {
                    const { data: managersData, error } = await supabase
                        .from('users')
                        .select('user_id')
                        .eq('pmc_id', property.pmc_id)
                        .in('role', ['manager', 'company_admin'])
                        .eq('is_archived', false);

                    if (error) {
                        console.error('Error fetching managers:', error);
                        setManagers([]);
                    } else {
                        // Get contact information for managers
                        const managerIds = (managersData || []).map(m => m.user_id);
                        let formattedManagers = [];
                        
                        if (managerIds.length > 0) {
                            const { data: contactsData } = await supabase
                                .from('contacts')
                                .select('contactable_id, first_name, last_name, middle_name')
                                .in('contactable_id', managerIds)
                                .eq('contactable_type', 'user');
                            
                            formattedManagers = (managersData || []).map(m => {
                                const contact = contactsData?.find(c => c.contactable_id === m.user_id);
                                return {
                                    user_id: m.user_id,
                                    name: formatManagerName(contact)
                                };
                            });
                        }
                        
                        setManagers(formattedManagers);
                    }
                } catch (error) {
                    console.error('Error fetching managers:', error);
                    setManagers([]);
                }
            } else {
                setPmcId('');
                setManagers([]);
            }
        };

        fetchPmcAndManagers();
    }, [property.pmc_id]);

    // Fetch units for this property
    useEffect(() => {
        const fetchUnits = async () => {
            const { data, error } = await supabase
                .from('units')
                .select('*')
                .eq('property_id', property.property_id);
            
            if (!error && data) {
                setUnits(data || []);
            }
        };
        
        fetchUnits();
    }, [property.property_id]);

    const handleAddressChange = (field, value) => {
        setAddress(prev => ({ ...prev, [field]: value }));
        // Clear geocoding results when address changes
        setGeocodedCity(null);
        setGeocodedCounty(null);
        setGeocodingError(null);

        // Auto-generate property name if property_name is empty or looks auto-generated
        // Property name is considered auto-generated if it ends with the property type
        const finalPropertyType = propertyType === 'Other' ? customPropertyType : propertyType;
        const looksAutoGenerated = propertyName && finalPropertyType && propertyName.trim().endsWith(` ${finalPropertyType}`);
        if ((!propertyName || looksAutoGenerated) && (field === 'address_line_1' || field === 'city' || field === 'address_line_2') && finalPropertyType) {
            const newAddress = { ...address, [field]: value };
            if (newAddress.address_line_1 && newAddress.city) {
                // Build property name: address_line_1 + unit (if condo) + city + property_type
                let suggestedName = newAddress.address_line_1;
                
                // For condos, check if address_line_2 has a unit number
                if (finalPropertyType.toLowerCase().includes('condo') && newAddress.address_line_2) {
                    // Extract unit number from address_line_2 (e.g., "#599" or "Unit 599")
                    const unitMatch = newAddress.address_line_2.match(/#?\s*(\d+)/i);
                    if (unitMatch) {
                        suggestedName += ` Unit #${unitMatch[1]}`;
                    } else {
                        // If no number found, use the whole address_line_2
                        suggestedName += ` ${newAddress.address_line_2}`;
                    }
                }
                
                suggestedName += ` ${newAddress.city} ${finalPropertyType}`;
                setPropertyName(suggestedName);
            }
        }
    };

    // Auto-generate property name when user finishes entering city
    const handleCityBlur = () => {
        const finalPropertyType = propertyType === 'Other' ? customPropertyType : propertyType;
        if (!propertyName && address.address_line_1 && address.city && finalPropertyType) {
            let suggestedName = address.address_line_1;
            
            // For condos, check if address_line_2 has a unit number
            if (finalPropertyType.toLowerCase().includes('condo') && address.address_line_2) {
                const unitMatch = address.address_line_2.match(/#?\s*(\d+)/i);
                if (unitMatch) {
                    suggestedName += ` Unit #${unitMatch[1]}`;
                } else {
                    suggestedName += ` ${address.address_line_2}`;
                }
            }
            
            suggestedName += ` ${address.city} ${finalPropertyType}`;
            setPropertyName(suggestedName);
        }
    };

    // Geocode address when it's complete enough
    const handleGeocodeAddress = useCallback(async () => {
        const hasAddressData = address.address_line_1 && 
                              (address.city || address.postal_code || address.state_province_region);
        
        if (!hasAddressData) {
            return;
        }

        setIsGeocoding(true);
        setGeocodingError(null);
        
        try {
            const result = await geocodeAddress(address);
            
            if (result.error) {
                setGeocodingError(result.error);
                setGeocodedCity(null);
                setGeocodedCounty(null);
            } else {
                setGeocodedCity(result.city);
                setGeocodedCounty(result.county);
                setGeocodingError(null);
                
                // Auto-fill jurisdiction fields if they're empty
                if (!cityOfJurisdiction && result.city) {
                    setCityOfJurisdiction(result.city);
                }
                if (!countyOfJurisdiction && result.county) {
                    setCountyOfJurisdiction(result.county);
                }
            }
        } catch {
            setGeocodingError('Failed to geocode address. Please try again.');
            setGeocodedCity(null);
            setGeocodedCounty(null);
        } finally {
            setIsGeocoding(false);
        }
    }, [address, cityOfJurisdiction, countyOfJurisdiction]);

    // Auto-geocode when address fields are filled
    useEffect(() => {
        const timer = setTimeout(() => {
            handleGeocodeAddress();
        }, 1000); // Debounce for 1 second

        return () => clearTimeout(timer);
    }, [handleGeocodeAddress]);

    // Check if jurisdiction values are overridden (different from geocoded)
    const isCityOverridden = geocodedCity && cityOfJurisdiction && 
                            cityOfJurisdiction.toLowerCase() !== geocodedCity.toLowerCase();
    const isCountyOverridden = geocodedCounty && countyOfJurisdiction && 
                               countyOfJurisdiction.toLowerCase() !== geocodedCounty.toLowerCase();

    const handleSubmit = async (e) => {
        e.preventDefault();
        const finalPropertyType = propertyType === 'Other' ? customPropertyType : propertyType;
        
        // Geocode address if we haven't already or if address changed
        let finalCityOfJurisdiction = cityOfJurisdiction;
        let finalCountyOfJurisdiction = countyOfJurisdiction;
        
        const hasAddressData = Object.values(address).some(value => value && value.trim() !== '');
        if (hasAddressData && (!geocodedCity || !geocodedCounty)) {
            setIsGeocoding(true);
            const geocodeResult = await geocodeAddress(address);
            setIsGeocoding(false);
            
            if (!geocodeResult.error) {
                setGeocodedCity(geocodeResult.city);
                setGeocodedCounty(geocodeResult.county);
                // Use geocoded values if jurisdiction fields are empty
                if (!finalCityOfJurisdiction && geocodeResult.city) {
                    finalCityOfJurisdiction = geocodeResult.city;
                }
                if (!finalCountyOfJurisdiction && geocodeResult.county) {
                    // Remove "County" suffix if present
                    finalCountyOfJurisdiction = geocodeResult.county.replace(/\s+County$/i, '');
                }
            } else {
                setGeocodingError(geocodeResult.error);
            }
        }

        // Update property record using audit helper
        // Note: manager_id is updated separately to avoid issues with update_with_audit function
        // that may have stale type definitions
        const propertyUpdateData = {
            landlord_id: landlordId || null,
            property_name: propertyName || null,
            property_type: finalPropertyType,
            city_of_jurisdiction: finalCityOfJurisdiction || null,
            county_of_jurisdiction: finalCountyOfJurisdiction || null
        };
        
        const { error: propertyError } = await updateWithAudit(
            'properties',
            propertyUpdateData,
            'property_id',
            property.property_id,
            user?.user_id
        );
            
        if (propertyError) {
            console.error('Error updating property:', propertyError);
            return;
        }
        
            // Update manager_id separately using RPC to bypass schema cache issues
            // This avoids PostgREST schema cache validation problems with manager_id
            if (managerId !== (property.manager_id || '')) {
                try {
                    const { error: managerError } = await supabase.rpc('update_property_manager', {
                        p_property_id: property.property_id,
                        p_manager_id: managerId ? parseInt(managerId) : null
                    });
                
                    if (managerError) {
                        // Check if it's a schema cache issue - suppress these errors
                        if (managerError.code === '42703' || managerError.message?.includes('schema cache') || managerError.message?.includes('does not exist')) {
                            console.warn('manager_id column may not be in schema cache, but update may have succeeded');
                        } else {
                            console.error('Error updating manager_id:', managerError);
                            // Don't return - continue with other updates
                        }
                    }
                } catch (err) {
                    // Check if it's a schema cache issue
                    if (err.code === '42703' || err.message?.includes('schema cache') || err.message?.includes('does not exist')) {
                        console.warn('manager_id column may not be in schema cache, but update may have succeeded');
                    } else {
                        console.error('Error calling update_property_manager RPC:', err);
                        // Fallback to direct update (may fail due to schema cache, but worth trying)
                        const { error: managerError } = await supabase
                            .from('properties')
                            .update({ manager_id: managerId || null })
                            .eq('property_id', property.property_id);
                        
                        if (managerError) {
                            if (managerError.code === '42703' || managerError.message?.includes('schema cache') || managerError.message?.includes('does not exist')) {
                                console.warn('manager_id column may not be in schema cache, but update may have succeeded');
                            } else {
                                console.error('Error updating manager_id (fallback):', managerError);
                            }
                        }
                    }
                }
            }
        
        // Update address record
        if (hasAddressData) {
            // Check if address record exists
            const { data: existingAddress } = await supabase
                .from('addresses')
                .select('address_id')
                .eq('addressable_id', property.property_id)
                .eq('addressable_type', 'property')
                .maybeSingle();
            
            if (existingAddress?.address_id) {
                // Update existing address using audit helper
                const { error: addressError } = await updateWithAudit(
                    'addresses',
                    address,
                    'address_id',
                    existingAddress.address_id,
                    user?.user_id
                );
                    
                if (addressError) {
                    console.error('Error updating address:', addressError);
                    return;
                }
            } else {
                // Create new address record using audit helper
                const { error: addressError } = await insertWithAudit(
                    'addresses',
                    [{
                        addressable_id: property.property_id,
                        addressable_type: 'property',
                        ...address
                    }],
                    user?.user_id
                );
                    
                if (addressError) {
                    console.error('Error creating address:', addressError);
                    return;
                }
            }
        }

        // Sync parking amenities (best-effort; don't block save)
        try {
            const { data: existingRows } = await supabase
                .from('property_amenities')
                .select('amenity_id, amenities(amenity_name)')
                .eq('property_id', property.property_id);

            const parkingAmenityIdsToDelete = (existingRows || [])
                .filter(r => (r?.amenities?.amenity_name || '').startsWith('parking_'))
                .map(r => r.amenity_id)
                .filter(Boolean);

            if (parkingAmenityIdsToDelete.length > 0) {
                await supabase
                    .from('property_amenities')
                    .delete()
                    .eq('property_id', property.property_id)
                    .in('amenity_id', parkingAmenityIdsToDelete);
            }

            const desiredAmenityNames = buildPropertyParkingAmenityNames({
                garage_spaces: garageSpaces,
                carport_spaces: carportSpaces,
                paved_driveway_spaces: pavedDrivewaySpaces,
                off_street_spaces: offStreetSpaces,
                street_parking_available: streetParkingAvailableYes ? 'yes' : (streetParkingAvailableNo ? 'no' : ''),
            });

            if (desiredAmenityNames.length > 0) {
                const { data: existingAmenities } = await supabase
                    .from('amenities')
                    .select('amenity_id, amenity_name')
                    .in('amenity_name', desiredAmenityNames);
                const existingMap = new Map((existingAmenities || []).map(a => [a.amenity_name, a.amenity_id]));
                const missing = desiredAmenityNames.filter(n => !existingMap.has(n));
                if (missing.length > 0) {
                    const { data: createdAmenities } = await supabase
                        .from('amenities')
                        .insert(missing.map(amenity_name => ({ amenity_name })))
                        .select('amenity_id, amenity_name');
                    (createdAmenities || []).forEach(a => existingMap.set(a.amenity_name, a.amenity_id));
                }
                const junctionRows = desiredAmenityNames
                    .map(n => existingMap.get(n))
                    .filter(Boolean)
                    .map(amenity_id => ({ property_id: property.property_id, amenity_id }));
                if (junctionRows.length > 0) {
                    await insertWithAudit('property_amenities', junctionRows, user?.user_id);
                }
            }
        } catch (err) {
            console.warn('Failed to sync property parking amenities:', err);
        }
        
        onUpdateSuccess();
    };

    const handleBackdropClick = (e) => {
        // Prevent closing modal when clicking outside - only close via buttons
        e.stopPropagation();
    };

    const handleModalMouseDown = (e) => {
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleModalMouseMove = (e) => {
        if (e.buttons === 1) { // Left mouse button is pressed
            setIsDragging(true);
        }
    };

    const handleModalMouseUp = (e) => {
        e.stopPropagation();
        // Reset dragging state after a short delay to allow click events to process
        setTimeout(() => setIsDragging(false), 100);
    };
    
    return (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div 
                className="w-full max-w-lg bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <div className="flex items-center justify-between p-6 border-b">
                    <h2 className="text-xl font-bold text-gray-800">Edit Property</h2>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                    <form onSubmit={handleSubmit} className="p-6 space-y-4" id="edit-property-form">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Landlord</label>
                        <select value={landlordId} onChange={(e) => setLandlordId(e.target.value)} className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm">
                            <option value="">Select Landlord</option>
                            {landlords.map(l => <option key={l.landlord_id} value={l.landlord_id}>{formatLandlordName(l)}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">
                            Property or Complex Name <span className="text-gray-500 text-xs">(optional, but recommended)</span>
                        </label>
                        <input
                            type="text"
                            value={propertyName}
                            onChange={e => setPropertyName(e.target.value)}
                            placeholder="e.g., Wuthering Heights, Sunset Apartments, or leave blank for auto-fill"
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            For apartment complexes, enter the property name. For houses, this will auto-fill from the address if left blank.
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Property Type</label>
                        <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm">
                            <option value="">Select Type</option>
                            {propertyTypes.map(type => (
                                <option key={type.type_id} value={type.type_name}>{type.type_name}</option>
                            ))}
                        </select>
                    </div>
                    {propertyType === 'Other' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Custom Property Type</label>
                            <input 
                                type="text" 
                                value={customPropertyType} 
                                onChange={e => setCustomPropertyType(e.target.value)} 
                                placeholder="Enter property type (e.g., Ranch, Bungalow, etc.)"
                                required 
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Address Line 1</label>
                        <input type="text" value={address.address_line_1} onChange={(e) => handleAddressChange('address_line_1', e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Address Line 2</label>
                        <input type="text" value={address.address_line_2} onChange={(e) => handleAddressChange('address_line_2', e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">City</label>
                            <input type="text" value={address.city} onChange={(e) => handleAddressChange('city', e.target.value)} onBlur={handleCityBlur} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">State</label>
                            <input type="text" value={address.state_province_region} onChange={(e) => handleAddressChange('state_province_region', e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Postal Code</label>
                            <input type="text" value={address.postal_code} onChange={(e) => handleAddressChange('postal_code', e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Country</label>
                            <input type="text" value={address.country} onChange={(e) => handleAddressChange('country', e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                        </div>
                    </div>
                    <div className="pt-4 border-t">
                        <h4 className="text-md font-medium text-gray-800 mb-2">Jurisdiction</h4>
                        {isGeocoding && (
                            <div className="mb-2 text-sm text-gray-600">Geocoding address...</div>
                        )}
                        {geocodingError && (
                            <div className="mb-2 p-2 text-sm text-yellow-700 bg-yellow-100 border border-yellow-400 rounded-md">
                                ⚠️ {geocodingError}
                            </div>
                        )}
                        <div className="space-y-2">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">
                                    City of Jurisdiction {isCityOverridden && <span className="text-red-600">*</span>}
                                </label>
                                <input 
                                    type="text"
                                    value={cityOfJurisdiction} 
                                    onChange={e => setCityOfJurisdiction(e.target.value)} 
                                    placeholder="Auto-filled from address"
                                    className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                />
                                {isCityOverridden && (
                                    <p className="mt-1 text-xs text-gray-500">Geocoded: {geocodedCity}</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">
                                    County of Jurisdiction {isCountyOverridden && <span className="text-red-600">*</span>}
                                </label>
                                <input 
                                    type="text"
                                    value={countyOfJurisdiction} 
                                    onChange={e => setCountyOfJurisdiction(e.target.value)} 
                                    placeholder="Auto-filled from address"
                                    className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                />
                                {isCountyOverridden && (
                                    <p className="mt-1 text-xs text-gray-500">Geocoded: {geocodedCounty}</p>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="pt-4 border-t">
                        <h4 className="text-md font-medium text-gray-800 mb-4">Parking (Property)</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Total Garage Spaces</label>
                                <input type="number" value={garageSpaces} onChange={e => setGarageSpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Total Carport Spaces</label>
                                <input type="number" value={carportSpaces} onChange={e => setCarportSpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Total Paved Driveway Spaces</label>
                                <input type="number" value={pavedDrivewaySpaces} onChange={e => setPavedDrivewaySpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Total Off-Street Spaces</label>
                                <input type="number" value={offStreetSpaces} onChange={e => setOffStreetSpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Street Parking Available</label>
                                <div className="space-y-2">
                                    <label className="flex items-center">
                                        <input
                                            type="checkbox"
                                            checked={streetParkingAvailableYes}
                                            onChange={e => {
                                                setStreetParkingAvailableYes(e.target.checked);
                                                if (e.target.checked) setStreetParkingAvailableNo(false);
                                            }}
                                            className="mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                        />
                                        <span className="text-sm text-gray-700">Yes</span>
                                    </label>
                                    <label className="flex items-center">
                                        <input
                                            type="checkbox"
                                            checked={streetParkingAvailableNo}
                                            onChange={e => {
                                                setStreetParkingAvailableNo(e.target.checked);
                                                if (e.target.checked) setStreetParkingAvailableYes(false);
                                            }}
                                            className="mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                        />
                                        <span className="text-sm text-gray-700">No</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        
                    </div>
                    <div className="pt-4 border-t">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-md font-medium text-gray-800">Units ({units.length})</h4>
                            <button 
                                type="button"
                                onClick={() => setShowManageUnits(true)}
                                className="px-3 py-1 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100"
                            >
                                Manage Units
                            </button>
                        </div>
                        {units.length > 0 ? (
                            <div className="space-y-2">
                                {units.map(unit => (
                                    <div key={unit.unit_id} className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <span className="font-medium text-gray-800">{formatUnitQualifier(unit)}</span>
                                                {(unit.beds || unit.baths || unit.square_footage) && (
                                                    <span className="ml-2 text-sm text-gray-600">
                                                        {unit.beds ? `${unit.beds} bed` : ''}
                                                        {unit.beds && unit.baths ? ', ' : ''}
                                                        {unit.baths ? `${unit.baths} bath` : ''}
                                                        {unit.square_footage ? `, ${unit.square_footage} sq ft` : ''}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">No units added yet. Click "Manage Units" to add units.</p>
                        )}
                    </div>
                    </form>
                </div>
                
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" form="edit-property-form" className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">Save Changes</button>
                    </div>
                </div>
            </div>
            {showManageUnits && (
                <ManageUnitsModal 
                    property={property} 
                    onClose={() => {
                        setShowManageUnits(false);
                        // Refresh units list
                        const fetchUnits = async () => {
                            const { data, error } = await supabase
                                .from('units')
                                .select('*')
                                .eq('property_id', property.property_id);
                            
                            if (!error && data) {
                                setUnits(data || []);
                            }
                        };
                        fetchUnits();
                    }} 
                    onUpdateSuccess={() => {
                        // Refresh units list in EditPropertyModal (don't call parent onUpdateSuccess to avoid closing modals)
                        const fetchUnits = async () => {
                            const { data, error } = await supabase
                                .from('units')
                                .select('*')
                                .eq('property_id', property.property_id);
                            
                            if (!error && data) {
                                setUnits(data || []);
                            }
                        };
                        fetchUnits();
                    }} 
                />
            )}
        </div>
    );
};

const ManageUnitsModal = ({ property, onClose, onUpdateSuccess }) => {
    const { user } = useContext(AuthContext);
    const [units, setUnits] = useState([]);
    const [unitNumber, setUnitNumber] = useState('');
    const [beds, setBeds] = useState('');
    const [baths, setBaths] = useState('');
    const [sqft, setSqft] = useState('');
    // Parking rule always defaults to 'dedicated' - UI removed but logic remains
    const [dedicatedGarageSpaces, setDedicatedGarageSpaces] = useState('');
    const [dedicatedCarportSpaces, setDedicatedCarportSpaces] = useState('');
    const [dedicatedPavedDrivewaySpaces, setDedicatedPavedDrivewaySpaces] = useState('');
    const [dedicatedOffStreetSpaces, setDedicatedOffStreetSpaces] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [_isDragging, setIsDragging] = useState(false);
    const [validationError, setValidationError] = useState('');
    const [editingUnit, setEditingUnit] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null); // For confirmation modal

    const parseUnitParkingFromFeatures = (unit) => {
        const featureNames =
            unit?.unit_features?.map(uf => uf?.features?.feature_name).filter(Boolean) || [];

        const counts = {
            garage: '',
            carport: '',
            paved_driveway: '',
            off_street: '',
        };

        for (const name of featureNames) {
            const m = name.match(/^parking_dedicated_(garage|carport|paved_driveway|off_street)_spaces:(\d+)$/);
            if (m) {
                counts[m[1]] = m[2];
            }
        }

        // Always default to 'dedicated' rule
        const rule = 'dedicated';

        return {
            rule,
            counts,
        };
    };

    const syncUnitParkingFeatures = async (unitId) => {
        // Remove existing parking_* features, then insert desired (best-effort)
        // Always default to 'dedicated' parking rule
        const desiredNames = buildUnitParkingFeatureNames({
            parking_rule: 'dedicated',
            dedicated_garage_spaces: dedicatedGarageSpaces,
            dedicated_carport_spaces: dedicatedCarportSpaces,
            dedicated_paved_driveway_spaces: dedicatedPavedDrivewaySpaces,
            dedicated_off_street_spaces: dedicatedOffStreetSpaces,
        });

        // Fetch current feature links for this unit
        const { data: existingLinks } = await supabase
            .from('unit_features')
            .select('feature_id, features(feature_name)')
            .eq('unit_id', unitId);

        const parkingFeatureIdsToDelete = (existingLinks || [])
            .filter(r => (r?.features?.feature_name || '').startsWith('parking_'))
            .map(r => r.feature_id)
            .filter(Boolean);

        if (parkingFeatureIdsToDelete.length > 0) {
            await supabase
                .from('unit_features')
                .delete()
                .eq('unit_id', unitId)
                .in('feature_id', parkingFeatureIdsToDelete);
        }

        if (desiredNames.length === 0) return;

        // Ensure features exist
        const { data: existingFeatures } = await supabase
            .from('features')
            .select('feature_id, feature_name')
            .in('feature_name', desiredNames);
        const existingMap = new Map((existingFeatures || []).map(f => [f.feature_name, f.feature_id]));
        const missing = desiredNames.filter(n => !existingMap.has(n));
        if (missing.length > 0) {
            const { data: createdFeatures } = await supabase
                .from('features')
                .insert(missing.map(feature_name => ({ feature_name })))
                .select('feature_id, feature_name');
            (createdFeatures || []).forEach(f => existingMap.set(f.feature_name, f.feature_id));
        }

        const junctionRows = desiredNames
            .map(n => existingMap.get(n))
            .filter(Boolean)
            .map(feature_id => ({ unit_id: unitId, feature_id }));
        if (junctionRows.length > 0) {
            await insertWithAudit('unit_features', junctionRows, user?.user_id);
        }
    };

    const fetchUnits = useCallback(async () => {
        try {
            const { data: unitsData, error } = await supabase
                .from('units')
                .select(`
                    *,
                    unit_features(
                        feature_id,
                        features(feature_name)
                    )
                `)
                .eq('property_id', property.property_id);
                
            if (error) {
                console.error('Error fetching units:', error);
                setUnits([]);
            } else {
                setUnits(unitsData || []);
            }
        } catch (error) {
            console.error('Error fetching units:', error);
            setUnits([]);
        }
    }, [property.property_id]);

    useEffect(() => {
        fetchUnits();
    }, [fetchUnits]);

    const handleAddUnit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        const payload = {
            unit_number: normalizeStoredUnitNumber(unitNumber),
            beds,
            baths,
            square_footage: sqft,
        };
        const nextUnits = [...units, payload];
        const check = validatePropertyUnitNumbers(nextUnits);
        if (!check.ok) {
            setValidationError(check.message);
            setIsSubmitting(false);
            return;
        }

        const { data: insertedUnit, error } = await supabase
            .from('units')
            .insert([{
                ...payload,
                property_id: property.property_id
            }])
            .select()
            .single();
            
        if (error) {
            console.error('Error creating unit:', error);
            setValidationError(error.message || 'Failed to create unit.');
        } else {
            try {
                await syncUnitParkingFeatures(insertedUnit.unit_id);
            } catch (err) {
                console.warn('Failed to sync unit parking features:', err);
            }
            setUnitNumber(''); setBeds(''); setBaths(''); setSqft('');
            setDedicatedGarageSpaces('');
            setDedicatedCarportSpaces('');
            setDedicatedPavedDrivewaySpaces('');
            setDedicatedOffStreetSpaces('');
            fetchUnits(); // Refresh the list
            setValidationError(''); // Clear any validation errors
            onUpdateSuccess(); // Refresh the properties list to update unit count
        }
        setIsSubmitting(false);
    };
    
    const handleDeleteUnit = async (unitId) => {
        setConfirmDelete(unitId);
    };

    // Actually perform the deletion
    const performDelete = async () => {
        if (!confirmDelete) return;
        
        const { error } = await supabase
            .from('units')
            .delete()
            .eq('unit_id', confirmDelete);
            
        if (error) {
            console.error('Error deleting unit:', error);
        } else {
            fetchUnits(); // Refresh
            setValidationError('');
            onUpdateSuccess(); // Refresh the properties list to update unit count
        }
        setConfirmDelete(null);
    };

    const handleEditUnit = (unit) => {
        setEditingUnit(unit);
        setUnitNumber(unit.unit_number || '');
        setBeds(unit.beds || '');
        setBaths(unit.baths || '');
        setSqft(unit.square_footage || '');

        const parsed = parseUnitParkingFromFeatures(unit);
        setDedicatedGarageSpaces(parsed.counts.garage || '');
        setDedicatedCarportSpaces(parsed.counts.carport || '');
        setDedicatedPavedDrivewaySpaces(parsed.counts.paved_driveway || '');
        setDedicatedOffStreetSpaces(parsed.counts.off_street || '');
    };

    const handleUpdateUnit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        const payload = { 
            unit_number: normalizeStoredUnitNumber(unitNumber), 
            beds, 
            baths, 
            square_footage: sqft
        };
        const nextUnits = units.map((u) =>
            u.unit_id === editingUnit.unit_id ? { ...u, unit_number: payload.unit_number } : u
        );
        const check = validatePropertyUnitNumbers(nextUnits);
        if (!check.ok) {
            setValidationError(check.message);
            setIsSubmitting(false);
            return;
        }
        const { error } = await supabase
            .from('units')
            .update(payload)
            .eq('unit_id', editingUnit.unit_id);
            
        if (error) {
            console.error('Error updating unit:', error);
            setValidationError(error.message || 'Failed to update unit.');
        } else {
            try {
                await syncUnitParkingFeatures(editingUnit.unit_id);
            } catch (err) {
                console.warn('Failed to sync unit parking features:', err);
            }
            setUnitNumber(''); setBeds(''); setBaths(''); setSqft('');
            setDedicatedGarageSpaces('');
            setDedicatedCarportSpaces('');
            setDedicatedPavedDrivewaySpaces('');
            setDedicatedOffStreetSpaces('');
            setEditingUnit(null);
            fetchUnits(); // Refresh the list
            setValidationError(''); // Clear any validation errors
            onUpdateSuccess(); // Refresh the properties list to update unit count
        }
        setIsSubmitting(false);
    };

    const handleCancelEdit = () => {
        setEditingUnit(null);
        setUnitNumber(''); setBeds(''); setBaths(''); setSqft('');
        setDedicatedGarageSpaces('');
        setDedicatedCarportSpaces('');
        setDedicatedPavedDrivewaySpaces('');
        setDedicatedOffStreetSpaces('');
        setValidationError('');
    };

    const handleClose = () => {
        setValidationError('');
        onClose();
    };

    const handleBackdropClick = (e) => {
        // Prevent closing on backdrop click - only close via buttons
        e.stopPropagation();
    };

    const handleModalMouseDown = (e) => {
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleModalMouseMove = (e) => {
        if (e.buttons === 1) { // Left mouse button is pressed
            setIsDragging(true);
        }
    };

    const handleModalMouseUp = (e) => {
        e.stopPropagation();
        // Reset dragging state after a short delay to allow click events to process
        setTimeout(() => setIsDragging(false), 100);
    };
    
    return (
         <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50" onClick={handleBackdropClick}>
            <div 
                className="w-full max-w-2xl p-6 bg-white rounded-lg shadow-xl" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">Manage Units for {formatAddress(property)}</h2>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
                </div>
                
                <div className="mb-4">
                    <h3 className="text-lg font-medium text-gray-800 mb-3">
                        {editingUnit ? 'Edit Unit' : 'Add Unit'}
                    </h3>
                    <form onSubmit={editingUnit ? handleUpdateUnit : handleAddUnit} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                        <div className="grid grid-cols-4 gap-4 mb-4">
                            <div className="col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Unit #</label>
                                <input 
                                    value={unitNumber} 
                                    onChange={e => setUnitNumber(e.target.value)} 
                                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Beds</label>
                                <input 
                                    type="number" 
                                    value={beds} 
                                    onChange={e => setBeds(e.target.value)} 
                                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Baths</label>
                                <input 
                                    type="number" 
                                    step="0.5" 
                                    value={baths} 
                                    onChange={e => setBaths(e.target.value)} 
                                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Sq. Ft.</label>
                                <input 
                                    type="number" 
                                    value={sqft} 
                                    onChange={e => setSqft(e.target.value)} 
                                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                        </div>
                        <div className="pt-3 border-t border-gray-200 mb-4">
                            <h4 className="text-sm font-medium text-gray-800 mb-2">Parking (Unit)</h4>
                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Garage Spaces</label>
                                    <input type="number" value={dedicatedGarageSpaces} onChange={e => setDedicatedGarageSpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Carport Spaces</label>
                                    <input type="number" value={dedicatedCarportSpaces} onChange={e => setDedicatedCarportSpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Paved Driveway Spaces</label>
                                    <input type="number" value={dedicatedPavedDrivewaySpaces} onChange={e => setDedicatedPavedDrivewaySpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Off-Street Spaces</label>
                                    <input type="number" value={dedicatedOffStreetSpaces} onChange={e => setDedicatedOffStreetSpaces(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            {editingUnit && (
                                <button 
                                    type="button" 
                                    onClick={handleCancelEdit}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                >
                                    Cancel
                                </button>
                            )}
                            <button 
                                type="submit" 
                                disabled={isSubmitting} 
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                            >
                                {isSubmitting ? (editingUnit ? 'Updating...' : 'Adding...') : (editingUnit ? 'Update Unit' : 'Add Unit')}
                            </button>
                        </div>
                    </form>
                </div>

                {validationError && (
                    <div className="mt-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                        {validationError}
                    </div>
                )}

                <div className="mt-6 border-t border-gray-200 pt-4">
                    <h3 className="text-lg font-medium text-gray-800 mb-3">Existing Units</h3>
                    {units.length === 0 ? (
                        <div className="text-center text-gray-500 p-8 border border-gray-200 rounded-lg bg-gray-50">
                            <p className="text-sm">No units created for this property yet.</p>
                            <p className="text-xs mt-1">Add your first unit using the form above.</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg bg-white">
                            {units.map(unit => (
                                <li key={unit.unit_id} className="flex justify-between items-center p-4 hover:bg-gray-50">
                                    <span className="text-sm text-gray-700">
                                        <span className="font-medium">{formatUnitQualifier(unit)}</span> 
                                        <span className="text-gray-500 ml-2">
                                            ({unit.beds} bed / {unit.baths} bath{unit.square_footage ? `, ${unit.square_footage} sqft` : ''})
                                        </span>
                                        {parseUnitParkingFromFeatures(unit).summary ? (
                                            <span className="text-gray-500 ml-2">
                                                • {parseUnitParkingFromFeatures(unit).summary}
                                            </span>
                                        ) : null}
                                    </span>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => handleEditUnit(unit)} 
                                            className="text-indigo-600 hover:text-indigo-800 p-1 rounded hover:bg-indigo-50"
                                            title="Edit Unit"
                                        >
                                            <Pencil size={16} />
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteUnit(unit.unit_id)} 
                                            disabled={units.length <= 1}
                                            className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                            title="Delete Unit"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="flex justify-end mt-6 pt-4 border-t border-gray-200">
                    <button 
                        onClick={handleClose} 
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                        Done
                    </button>
                </div>

                {/* Confirmation Modal */}
                <ConfirmationModal
                    isOpen={!!confirmDelete}
                    onClose={() => setConfirmDelete(null)}
                    onConfirm={performDelete}
                    title="Delete Unit"
                    message="Are you sure you want to delete this unit? This action cannot be undone."
                    confirmText="Delete"
                    cancelText="Cancel"
                    isDestructive={true}
                    isLoading={false}
                />
            </div>
        </div>
    );
};

