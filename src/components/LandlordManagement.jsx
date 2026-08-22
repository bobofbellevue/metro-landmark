import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react';
import { Pencil, Trash2, X, PlusCircle, ArrowUpDown, Search } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card } from './ui';
import { useSortableData } from '../hooks';
import ArchiveModal from './ArchiveModal';
import { useFormPersistence } from '../hooks/useFormPersistence';
import { useFinderLimit } from '../hooks/useFinderLimit';
import { insertWithAudit, updateWithAudit, deleteWithAudit } from '../lib/auditHelpers.js';
import ContactMethodTypeInput from './ContactMethodTypeInput';
import { PAGE_SEARCH_KEYS, readPageSearchSession, writePageSearchSession } from '../utils/page-search-session.js';

export default function LandlordManagement() {
    const { user } = useContext(AuthContext);
    const savedSearch = useMemo(
        () => readPageSearchSession(PAGE_SEARCH_KEYS.landlords, user?.user_id, {
            searchTerm: '',
            showArchived: false,
        }),
        [user?.user_id]
    );
    const [landlords, setLandlords] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [editingLandlord, setEditingLandlord] = useState(null);
    const [deletingLandlord, setDeletingLandlord] = useState(null);
    const [searchTerm, setSearchTerm] = useState(savedSearch.searchTerm);
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(savedSearch.searchTerm);
    const [showArchived, setShowArchived] = useState(savedSearch.showArchived);
    
    // Debounce search term to avoid excessive filtering
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300); // 300ms delay
        
        return () => clearTimeout(timer);
    }, [searchTerm]);

    useEffect(() => {
        if (!user?.user_id) return;
        writePageSearchSession(PAGE_SEARCH_KEYS.landlords, user.user_id, {
            searchTerm,
            showArchived,
        });
    }, [user?.user_id, searchTerm, showArchived]);
    
    // Filter landlords based on search term
    const filteredLandlords = useMemo(() => {

        if (!landlords || !Array.isArray(landlords)) {

            return [];
        }
        if (!debouncedSearchTerm.trim()) {

            return landlords;
        }
        
        const searchLower = debouncedSearchTerm.toLowerCase();
        return landlords.filter(landlord => {
            // Search in basic landlord fields
            const nameMatch = [
                landlord.first_name,
                landlord.last_name,
                landlord.middle_name,
                landlord.email
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            // Search in contact methods
            const contactMatch = landlord.contact_methods && landlord.contact_methods.some(method => 
                method.value && method.value.toLowerCase().includes(searchLower)
            );
            
            return nameMatch || contactMatch;
        });
    }, [landlords, debouncedSearchTerm]);

    const { items: sortedLandlords, requestSort, sortConfig } = useSortableData(filteredLandlords, { key: 'last_name', direction: 'ascending' });

    const fetchData = async () => {
        try {
            console.log('[LandlordManagement] Fetching landlords, showArchived:', showArchived);
            // Fetch landlords with related data
            let query = supabase
                .from('landlords')
                .select(`
                    *,
                    users!landlords_user_id_fkey(email, role)
                `);
            
            if (!showArchived) {
                query = query.eq('is_archived', false);
            }
            
            const { data: landlords, error: landlordsError } = await query;
            
            console.log('[LandlordManagement] Landlords query result:', {
                count: landlords?.length || 0,
                hasData: !!landlords,
                error: landlordsError,
                errorCode: landlordsError?.code,
                errorMessage: landlordsError?.message,
                errorDetails: landlordsError?.details,
                errorHint: landlordsError?.hint
            });
            
            if (landlordsError) {
                console.error('[LandlordManagement] Error fetching landlords:', landlordsError);
                setLandlords([]);
            } else {
                // Get contact information for each landlord
                const landlordIds = landlords?.map(l => l.landlord_id) || [];
                const { data: contacts } = await supabase
                    .from('contacts')
                    .select('*')
                    .in('contactable_id', landlordIds)
                    .eq('contactable_type', 'landlord');
                
            // Get contact methods for each contact
            const contactIds = contacts?.map(c => c.contact_id) || [];
            const { data: contactMethods } = await supabase
                .from('contact_methods')
                .select('*')
                .in('contact_id', contactIds);
            
            // Get addresses for each landlord
            const { data: addresses } = await supabase
                .from('addresses')
                .select('*')
                .in('addressable_id', landlordIds)
                .eq('addressable_type', 'landlord');
            
            // Get properties for each landlord
            const { data: properties } = await supabase
                .from('properties')
                .select('property_id, landlord_id')
                .in('landlord_id', landlordIds);
            
            // Get unit counts for each property
            const propertyIds = properties?.map(p => p.property_id) || [];
            const { data: units } = propertyIds.length > 0 ? await supabase
                .from('units')
                .select('property_id')
                .in('property_id', propertyIds) : { data: [] };
            
            // Count properties and units per landlord
            const propertyCounts = {};
            const unitCounts = {};
            properties?.forEach(property => {
                if (property.landlord_id) {
                    propertyCounts[property.landlord_id] = (propertyCounts[property.landlord_id] || 0) + 1;
                }
            });
            units?.forEach(unit => {
                const property = properties?.find(p => p.property_id === unit.property_id);
                if (property?.landlord_id) {
                    unitCounts[property.landlord_id] = (unitCounts[property.landlord_id] || 0) + 1;
                }
            });
            
            // Note: Managers are now assigned to properties, not landlords
            
            // Combine all data
            const landlordsWithData = landlords?.map(landlord => {
                const contact = contacts?.find(c => c.contactable_id === landlord.landlord_id);
                const methods = contactMethods?.filter(cm => cm.contact_id === contact?.contact_id) || [];
                const address = addresses?.find(a => a.addressable_id === landlord.landlord_id);
                // Note: Managers are now assigned to properties, not landlords
                
                return {
                    ...landlord,
                    first_name: contact?.first_name,
                    middle_name: contact?.middle_name,
                    last_name: contact?.last_name,
                    email: landlord.users?.email,
                    property_count: propertyCounts[landlord.landlord_id] || 0,
                    unit_count: unitCounts[landlord.landlord_id] || 0,
                    // Note: company_name removed - PM company relationship is indirect through properties
                    // Note: manager_name removed - managers are now assigned to properties
                    contact_methods: methods.map(cm => ({
                        type: cm.method_type,
                        value: cm.value,
                        is_primary: cm.is_primary
                    })),
                    address_line_1: address?.address_line_1 || '',
                    address_line_2: address?.address_line_2 || '',
                    city: address?.city || '',
                    state_province_region: address?.state_province_region || '',
                    postal_code: address?.postal_code || '',
                    country: address?.country || ''
                };
            }) || [];
                
                setLandlords(landlordsWithData);
            }
            
            // Fetch companies
            const { data: companiesData, error: companiesError } = await supabase
                .from('pm_companies')
                .select('*');
                
            if (companiesError) {
                console.error('Error fetching companies:', companiesError);
                setCompanies([]);
            } else {
                setCompanies(companiesData || []);
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            setLandlords([]);
            setCompanies([]);
        }
    };

    useEffect(() => {
        if (user?.role === 'global_admin' || user?.role === 'company_admin') {
            fetchData();
        }
    }, [user, showArchived]);
    
    const handleSuccess = () => {
        setEditingLandlord(null);
        setDeletingLandlord(null);
        fetchData();
    };
    
    const getSortIndicator = (name) => {
        if (!sortConfig || sortConfig.key !== name) return <ArrowUpDown size={14} className="ml-2 text-gray-400"/>;
        return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
    };

    const getPrimaryEmail = (landlord) => {
        return landlord.email || 'No email provided';
    };

    const formatLandlordName = (l) => {
        const first = l.first_name || '';
        const last = l.last_name || '';
        const middle = l.middle_name ? ` ${l.middle_name.charAt(0)}.` : '';
        return `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
    };

    // Utility function for formatting landlord recap for hover tooltip
    const formatLandlordRecap = (l) => {
        const parts = [];
        
        // Name
        const first = l.first_name || '';
        const middle = l.middle_name || '';
        const last = l.last_name || '';
        if (first || middle || last) {
            const nameParts = [first, middle, last].filter(Boolean);
            if (nameParts.length > 0) {
                parts.push(`Name: ${nameParts.join(' ')}`);
            }
        }
        
        // Email
        if (l.email) {
            parts.push(`Email: ${l.email}`);
        }
        
        // Address
        const addressParts = [];
        if (l.address_line_1) addressParts.push(l.address_line_1);
        if (l.address_line_2) addressParts.push(l.address_line_2);
        if (l.city) addressParts.push(l.city);
        if (l.state_province_region) addressParts.push(l.state_province_region);
        if (l.postal_code) addressParts.push(l.postal_code);
        if (l.country) addressParts.push(l.country);
        if (addressParts.length > 0) {
            parts.push(`Address: ${addressParts.join(', ')}`);
        }
        
        // Contact Methods (excluding email)
        const contactMethods = (l.contact_methods || []).filter(m => 
            m.type && m.type.toLowerCase() !== 'email' && m.value
        );
        if (contactMethods.length > 0) {
            const methodStrings = contactMethods.map(m => 
                `${m.type}: ${m.value}`
            );
            parts.push(`Contact Methods: ${methodStrings.join(', ')}`);
        }
        
        return parts.length > 0 ? parts.join('\n') : 'No additional information available';
    };

    const { visibleCount: landlordVisibleCount, hasMore: hasMoreLandlords, showMore: showMoreLandlords } = useFinderLimit(
        sortedLandlords.length,
        [debouncedSearchTerm, landlords.length]
    );
    const displayedLandlords = sortedLandlords.slice(0, landlordVisibleCount || sortedLandlords.length);

    return (
        <div className="finder-split">
            <CreateLandlordForm companies={companies} onLandlordCreated={handleSuccess} />
            <Card
                title="Landlord Search"
                className="max-h-[calc(100vh-160px)] min-h-0 lg:max-h-none"
                contentClassName="flex min-h-0 flex-col h-full"
            >
                <div className="flex min-h-0 flex-col h-full">
                {/* Search Box */}
                <div className="mb-4 flex-shrink-0">
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search landlords by name, email, phone, or company..."
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
                        sortedLandlords.length === 0 ? (
                            <span className="text-red-600">No landlords found matching "{debouncedSearchTerm}"</span>
                        ) : (
                            <span>Showing {sortedLandlords.length} of {landlords.length} landlords</span>
                        )
                    ) : (
                        <span>Showing {landlords.length} of {landlords.length} landlords</span>
                    )}
                </div>
                <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-auto h-full min-h-0 max-w-full">
                    <table className="finder-list w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">Actions</th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('last_name')} className="flex items-center">Landlord Name {getSortIndicator('last_name')}</button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('email')} className="flex items-center">Contact {getSortIndicator('email')}</button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('property_count')} className="flex items-center">Properties {getSortIndicator('property_count')}</button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('city')} className="flex items-center">Location {getSortIndicator('city')}</button>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {displayedLandlords.map(l => (
                                <tr key={l.landlord_id}>
                                    <td className="px-1.5 py-2 text-left whitespace-nowrap">
                                        <div className="flex items-center space-x-4">
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
                                                <button onClick={() => setEditingLandlord(l)} className="text-indigo-600 hover:text-indigo-900" title="Edit Landlord"><Pencil size={16}/></button>
                                                <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                    <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                        {formatLandlordRecap(l)}
                                                    </div>
                                                </div>
                                            </div>
                                            <button onClick={() => setDeletingLandlord(l)} className="text-red-600 hover:text-red-900" title="Delete Landlord"><Trash2 size={16}/></button>
                                        </div>
                                    </td>
                                    <td className="px-1.5 py-2 whitespace-nowrap">
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
                                            <span className="cursor-help">{formatLandlordName(l)}</span>
                                            <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                    {formatLandlordRecap(l)}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-1.5 py-2 whitespace-nowrap">
                                        <div className="space-y-1">
                                            {l.email && (
                                                <div>
                                                    Email: {l.email}
                                                </div>
                                            )}
                                            {l.contact_methods && l.contact_methods
                                                .filter(method => method.value && method.type && method.type.toLowerCase() !== 'email')
                                                .sort((a, b) => a.type.localeCompare(b.type))
                                                .map((method, index) => (
                                                    <div key={index} className="finder-secondary text-gray-500">
                                                        {method.type}: {method.value}
                                                    </div>
                                            ))}
                                            {!l.email && (!l.contact_methods || l.contact_methods.filter(m => m.value && m.type && m.type.toLowerCase() !== 'email').length === 0) && (
                                                <span className="text-gray-400">No contact methods</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-1.5 py-2 whitespace-nowrap">
                                        <div>{l.property_count || 0} {l.property_count === 1 ? 'property' : 'properties'}</div>
                                        <div className="finder-secondary text-gray-500">{l.unit_count || 0} {l.unit_count === 1 ? 'unit' : 'units'}</div>
                                    </td>
                                    <td className="px-1.5 py-2 whitespace-nowrap">
                                        {l.city && l.state_province_region ? `${l.city}, ${l.state_province_region}` : 
                                         l.city ? l.city : 
                                         l.state_province_region ? l.state_province_region : 
                                         'No address provided'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
                {hasMoreLandlords && (
                    <div className="pt-3 mt-4 border-t text-right flex-shrink-0">
                        <button
                            type="button"
                            onClick={showMoreLandlords}
                            className="text-indigo-600 hover:text-indigo-800 underline text-sm font-medium"
                        >
                            more
                        </button>
                    </div>
                )}
                </div>
            </Card>
            {editingLandlord && <EditLandlordModal landlord={editingLandlord} companies={companies} onClose={() => setEditingLandlord(null)} onUpdateSuccess={handleSuccess} />}
            {deletingLandlord && (
                <ArchiveModal 
                    entity={deletingLandlord}
                    entityType="landlord"
                    entityName={`${deletingLandlord.first_name}${deletingLandlord.middle_name ? ' ' + deletingLandlord.middle_name : ''} ${deletingLandlord.last_name}`}
                    idField="landlord_id"
                    onClose={() => setDeletingLandlord(null)}
                    onArchiveSuccess={handleSuccess}
                    showCascade={true}
                    cascadeMessage="Also archive all properties and units owned by this landlord"
                    requireReason={false}
                    isAdmin={user?.role === 'global_admin'}
                />
            )}
        </div>
    );
};

const CreateLandlordForm = ({ companies, onLandlordCreated }) => {
    const { user } = useContext(AuthContext);
    const [firstName, setFirstName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [lastName, setLastName] = useState('');
    // Note: pmc_id removed - PM company relationship is indirect through properties
    // Note: manager_id removed - managers are now assigned to properties
    // Note: managers state removed - managers are now assigned to properties
    const [email, setEmail] = useState('');
    const [contactMethods, setContactMethods] = useState([]);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [address, setAddress] = useState({
        address_line_1: '', address_line_2: '', city: '', state_province_region: '', postal_code: '', country: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const contactMethodInputRefs = useRef({});
    const formBodyRef = useRef(null);
    
    // Form persistence
    const { clearPersistedData } = useFormPersistence('add-landlord', {
        firstName, middleName, lastName, email, contactMethods, password, confirmPassword, address
    }, (state) => {
        setFirstName(state.firstName || '');
        setMiddleName(state.middleName || '');
        setLastName(state.lastName || '');
        // Note: pmc_id removed - PM company relationship is indirect through properties
        setEmail(state.email || '');
        setContactMethods(state.contactMethods || []);
        setPassword(state.password || '');
        setConfirmPassword(state.confirmPassword || '');
        setAddress(state.address || { address_line_1: '', address_line_2: '', city: '', state_province_region: '', postal_code: '', country: '' });
    });

    // Note: Manager assignment removed - managers are now assigned to properties, not landlords
    
    const handleAddressChange = (field, value) => setAddress(prev => ({ ...prev, [field]: value }));

    const handleMethodChange = (tempId, field, value) => {
        setContactMethods(prevMethods => 
            prevMethods.map(m => m.tempId === tempId ? { ...m, [field]: value } : m)
        );
    };

    const addMethod = () => {
        setContactMethods([...contactMethods, { type: '', value: '', tempId: Date.now() }]);
    };

    const removeMethod = (tempId) => {
        setContactMethods(contactMethods.filter(m => m.tempId !== tempId));
    };

    const resetForm = useCallback(() => {
        setFirstName('');
        setMiddleName('');
        setLastName('');
        setEmail('');
        setContactMethods([]);
        setPassword('');
        setConfirmPassword('');
        setAddress({
            address_line_1: '',
            address_line_2: '',
            city: '',
            state_province_region: '',
            postal_code: '',
            country: ''
        });
        setFormError('');
        clearPersistedData();
    }, [clearPersistedData]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        
        // Validate passwords match
        if (password !== confirmPassword) {
            setFormError('Passwords do not match.');
            setIsSubmitting(false);
            return;
        }
        try {
            // Hash password
            const bcrypt = await import('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password || 'temp_password_' + Math.random().toString(36).substring(7), salt);

            const userId = user?.user_id;
            
            // Step 1: Create user account first
            const userPayload = { 
                email, 
                password_hash: passwordHash,
                role: 'landlord'
            };
            
            const { data: userData, error: userError } = await insertWithAudit(
                'users',
                [userPayload],
                userId
            );
            
            const newUser = userData?.[0] || userData;
            if (userError || !newUser?.user_id) {
                setFormError(userError?.message || 'Failed to create user account.');
                return;
            }
            
            // Step 2: Create landlord record linked to the user (no name fields)
            const landlordPayload = { 
                // Note: pmc_id removed - PM company relationship is indirect through properties
                // Note: manager_id removed - managers are now assigned to properties
                user_id: newUser.user_id
            };
            
            const { data: landlordData, error: landlordError } = await insertWithAudit(
                'landlords',
                [landlordPayload],
                userId
            );
            
            const landlord = landlordData?.[0] || landlordData;
            if (landlordError || !landlord?.landlord_id) {
                // If landlord creation fails, clean up the user
                await deleteWithAudit('users', 'user_id', newUser.user_id, userId);
                setFormError(landlordError?.message || 'Failed to create landlord record.');
                return;
            }
            
            // Step 3: Create contact record for additional info
            const contactPayload = {
                contactable_id: landlord.landlord_id,
                contactable_type: 'landlord',
                first_name: firstName,
                middle_name: middleName,
                last_name: lastName
            };
            
            const { error: contactError } = await insertWithAudit(
                'contacts',
                [contactPayload],
                userId
            );
            
            if (contactError) {
                console.warn('Contact record creation failed:', contactError);
                // Don't fail the whole operation for contact record issues
            }
            
            // Step 4: Create address record if any address fields are provided
            const hasAddressData = Object.values(address).some(value => value && value.trim() !== '');
            if (hasAddressData) {
                const { error: addressError } = await insertWithAudit(
                    'addresses',
                    [{
                        addressable_id: landlord.landlord_id,
                        addressable_type: 'landlord',
                        ...address
                    }],
                    userId
                );
                    
                if (addressError) {
                    console.warn('Address record creation failed:', addressError);
                    // Don't fail the whole operation for address issues
                }
            }
            
            // Step 5: Add contact methods if provided
            const validContactMethods = contactMethods.filter(m => m.type && m.value);
            if (validContactMethods.length > 0) {
                // Get the contact_id for the landlord
                const { data: contactData } = await supabase
                    .from('contacts')
                    .select('contact_id')
                    .eq('contactable_id', landlord.landlord_id)
                    .eq('contactable_type', 'landlord')
                    .single();
                
                if (contactData) {
                    const contactMethodsToInsert = validContactMethods.map(method => ({
                        contact_id: contactData.contact_id,
                        method_type: method.type,
                        value: method.value
                    }));
                    
                    const { error: contactMethodsError } = await insertWithAudit(
                        'contact_methods',
                        contactMethodsToInsert,
                        userId
                    );
                    
                    if (contactMethodsError) {
                        console.error('Error inserting contact methods:', contactMethodsError);
                        setFormError(contactMethodsError.message || 'Failed to add contact methods.');
                        return;
                    }
                }
            }
            
            resetForm();
            onLandlordCreated();
            // Scroll form body to top after state updates
            setTimeout(() => {
                if (formBodyRef.current) {
                    formBodyRef.current.scrollTop = 0;
                }
            }, 0);
            
        } catch(err) {
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
        }, 0);
    };

    return (
        <Card hideTitle className="max-h-[calc(100vh-160px)] min-h-0 lg:max-h-none" contentClassName="flex min-h-0 flex-col h-full">
            <form onSubmit={handleCreate} className="flex min-h-0 flex-col h-full">
                <div className="flex items-start justify-between pb-4 mb-4 border-b">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Add Landlord</h2>
                    </div>
                </div>
                <div ref={formBodyRef} className="flex-1 overflow-y-auto pr-1 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700">First Name</label>
                        <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                    </div>
                    <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700">Middle</label>
                        <input type="text" value={middleName} onChange={e => setMiddleName(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                    </div>
                    <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700">Last Name</label>
                        <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Primary Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="off" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                </div>
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 my-2">Contact Methods</h4>
                    {contactMethods.map((method) => (
                        <div key={method.tempId} className="flex gap-2 mb-2 items-center">
                            <ContactMethodTypeInput value={method.type} onChange={value => handleMethodChange(method.tempId, 'type', value)} className="w-1/3 block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                            <input type="text" value={method.value} onChange={e => handleMethodChange(method.tempId, 'value', e.target.value)} placeholder="Value (e.g., 555-1234)" autoComplete="tel" name="contact-method-value" className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                            <button type="button" onClick={() => removeMethod(method.tempId)} className="p-2 text-red-500 hover:text-red-700"><Trash2 size={16}/></button>
                        </div>
                    ))}
                    <button type="button" onClick={addMethod} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 mt-2">
                        <PlusCircle size={16}/> Add Contact Method
                    </button>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Password</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
                    <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                </div>
                {/* Note: PM Company assignment removed - relationship is indirect through properties */}
                {/* Note: Manager assignment moved to properties - managers are assigned to properties, not landlords */}
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-2">Mailing Address (Optional)</h4>
                    <div className="space-y-2">
                        <input value={address.address_line_1} onChange={e => handleAddressChange('address_line_1', e.target.value)} placeholder="Address Line 1" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        <input value={address.address_line_2} onChange={e => handleAddressChange('address_line_2', e.target.value)} placeholder="Address Line 2" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input value={address.city} onChange={e => handleAddressChange('city', e.target.value)} placeholder="City" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            <input value={address.state_province_region} onChange={e => handleAddressChange('state_province_region', e.target.value)} placeholder="State / Province" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input value={address.postal_code} onChange={e => handleAddressChange('postal_code', e.target.value)} placeholder="Postal Code" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            <input value={address.country} onChange={e => handleAddressChange('country', e.target.value)} placeholder="Country" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        </div>
                    </div>
                </div>
                </div>
                <div className="pt-4 mt-4 border-t flex flex-col gap-3">
                    {formError && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{formError}</div>)}
                    <div className="flex justify-end gap-3 flex-wrap">
                        <button type="button" onClick={handleClear} className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">
                            Clear
                        </button>
                        <button type="submit" disabled={isSubmitting} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                            {isSubmitting ? 'Adding...' : 'Add Landlord'}
                        </button>
                    </div>
                </div>
            </form>
        </Card>
    );
};

const EditLandlordModal = ({ landlord, companies, onClose, onUpdateSuccess }) => {
    const { user } = useContext(AuthContext);
    const [firstName, setFirstName] = useState(landlord.first_name || '');
    const [middleName, setMiddleName] = useState(landlord.middle_name || '');
    const [lastName, setLastName] = useState(landlord.last_name || '');
    const [email, setEmail] = useState(landlord.email || '');
    // Note: pmc_id removed - PM company relationship is indirect through properties
    // Note: manager_id removed - managers are now assigned to properties
    // Note: managers state removed - managers are now assigned to properties
    const [address, setAddress] = useState({
        address_line_1: landlord.address_line_1 || '',
        address_line_2: landlord.address_line_2 || '',
        city: landlord.city || '',
        state_province_region: landlord.state_province_region || '',
        postal_code: landlord.postal_code || '',
        country: landlord.country || '',
    });
    const [contactMethods, setContactMethods] = useState(() => 
        (landlord.contact_methods || []).map(m => ({ 
            ...m, 
            type: m.type || m.method_type || '', 
            method_type: m.method_type || m.type || '',
            tempId: Date.now() + Math.random() 
        }))
    );
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const contactMethodInputRefs = useRef({});
    
    const handleAddressChange = (field, value) => setAddress(prev => ({ ...prev, [field]: value }));

    const handleMethodChange = (tempId, field, value) => {
        setContactMethods(prevMethods => 
            prevMethods.map(m => m.tempId === tempId ? { ...m, [field]: value } : m)
        );
    };

    const addMethod = () => {
        const newTempId = Date.now();
        setContactMethods([...contactMethods, { type: '', value: '', tempId: newTempId }]);
        // Focus the new input field after state update
        setTimeout(() => {
            const input = contactMethodInputRefs.current[newTempId];
            if (input) {
                input.focus();
            }
        }, 0);
    };

    const removeMethod = (tempId) => {
        setContactMethods(contactMethods.filter(m => m.tempId !== tempId));
    };

    // Note: Manager assignment removed - managers are now assigned to properties, not landlords

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Validate passwords if provided
        if (newPassword && newPassword !== confirmPassword) {
            console.error('New passwords do not match.');
            return;
        }
        
        try {
            // Update landlord record (no name fields) using audit helper
            const landlordPayload = { 
                // Note: pmc_id removed - PM company relationship is indirect through properties
                // Note: manager_id removed - managers are now assigned to properties
            };
            
            // Only update if there's actually data to update
            if (Object.keys(landlordPayload).length > 0) {
                const { error: landlordError } = await updateWithAudit(
                    'landlords',
                    landlordPayload,
                    'landlord_id',
                    landlord.landlord_id,
                    user.user_id
                );
                    
                if (landlordError) {
                    console.error('Error updating landlord:', landlordError);
                    return;
                }
            }
            
            // Update contact record with name information using audit helper
            // First, get the contact_id
            const { data: contactData } = await supabase
                .from('contacts')
                .select('contact_id')
                .eq('contactable_id', landlord.landlord_id)
                .eq('contactable_type', 'landlord')
                .maybeSingle();
            
            if (contactData?.contact_id) {
                const { error: contactError } = await updateWithAudit(
                    'contacts',
                    {
                        first_name: firstName,
                        middle_name: middleName,
                        last_name: lastName
                    },
                    'contact_id',
                    contactData.contact_id,
                    user.user_id
                );
                
                if (contactError) {
                    console.error('Error updating contact:', contactError);
                    return;
                }
            } else {
                console.error('Contact record not found for landlord');
                return;
            }
            
            // Update user email and password if changed
            const userUpdateData = {};
            if (email !== landlord.email) {
                userUpdateData.email = email;
            }
            if (newPassword) {
                // Hash the new password
                const bcrypt = await import('bcryptjs');
                const salt = await bcrypt.genSalt(10);
                const passwordHash = await bcrypt.hash(newPassword, salt);
                userUpdateData.password_hash = passwordHash;
            }
            
            if (Object.keys(userUpdateData).length > 0) {
                const { error: userError } = await updateWithAudit(
                    'users',
                    userUpdateData,
                    'user_id',
                    landlord.user_id,
                    user.user_id
                );
                    
                if (userError) {
                    console.error('Error updating user:', userError);
                    return;
                }
            }
            
            // Update address record
            const hasAddressData = Object.values(address).some(value => value && value.trim() !== '');
            if (hasAddressData) {
                // Check if address record exists
                const { data: existingAddress } = await supabase
                    .from('addresses')
                    .select('address_id')
                    .eq('addressable_id', landlord.landlord_id)
                    .eq('addressable_type', 'landlord')
                    .single();
                
                if (existingAddress) {
                    // Update existing address using audit helper
                    const { error: addressError } = await updateWithAudit(
                        'addresses',
                        address,
                        'address_id',
                        existingAddress.address_id,
                        user.user_id
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
                            addressable_id: landlord.landlord_id,
                            addressable_type: 'landlord',
                            ...address
                        }],
                        user.user_id
                    );
                        
                    if (addressError) {
                        console.error('Error creating address:', addressError);
                        return;
                    }
                }
            }
            
            // Update contact methods
            // Filter to only methods that have both type and value, and normalize the type field
            const validContactMethods = contactMethods
                .filter(m => {
                    const methodType = (m.type || m.method_type || '').trim();
                    const methodValue = (m.value || '').trim();
                    return methodType && methodValue && methodType.toLowerCase() !== 'email';
                })
                .map(m => ({
                    type: (m.type || m.method_type || '').trim(),
                    method_type: (m.type || m.method_type || '').trim(),
                    value: (m.value || '').trim()
                }));
            
            // Reuse contactData from earlier (already fetched for contact update)
            if (contactData?.contact_id) {
                const userId = user?.user_id;
                
                // Get existing non-email contact methods to compare
                const { data: existingMethods } = await supabase
                    .from('contact_methods')
                    .select('method_id, method_type, value')
                    .eq('contact_id', contactData.contact_id)
                    .neq('method_type', 'email');
                
                // Create a map of existing methods by type+value for comparison (normalized)
                const existingMethodsMap = new Map();
                if (existingMethods) {
                    existingMethods.forEach(m => {
                        const normalizedType = (m.method_type || '').trim();
                        const normalizedValue = (m.value || '').trim();
                        const key = `${normalizedType}:${normalizedValue}`;
                        existingMethodsMap.set(key, m.method_id);
                    });
                }
                
                // Determine which methods to delete (exist in DB but not in form)
                // We need to match form methods to DB methods one-to-one, handling duplicates
                const methodsToDelete = [];
                const matchedFormMethods = new Set(); // Track which form methods have been matched
                
                if (existingMethods) {
                    existingMethods.forEach(existing => {
                        const normalizedType = (existing.method_type || '').trim();
                        const normalizedValue = (existing.value || '').trim();
                        const key = `${normalizedType}:${normalizedValue}`;
                        
                        // Find a matching form method that hasn't been matched yet
                        let matched = false;
                        for (let i = 0; i < validContactMethods.length; i++) {
                            if (matchedFormMethods.has(i)) continue; // Skip already matched form methods
                            
                            const m = validContactMethods[i];
                            const methodType = (m.type || m.method_type || '').trim();
                            const methodValue = (m.value || '').trim();
                            const formKey = `${methodType}:${methodValue}`;
                            const matches = formKey === key;
                            
                            if (matches) {
                                matched = true;
                                matchedFormMethods.add(i); // Mark this form method as matched
                                break; // One DB method matches one form method, move to next DB method
                            }
                        }
                        
                        if (!matched) {
                            methodsToDelete.push(existing.method_id);
                        }
                    });
                }
                
                // Delete methods that are no longer in the form
                if (methodsToDelete.length > 0) {
                    for (const methodId of methodsToDelete) {
                        const { error: deleteError } = await deleteWithAudit(
                            'contact_methods',
                            'method_id',
                            methodId,
                            userId
                        );
                        if (deleteError) {
                            console.error('Error deleting contact method:', deleteError);
                        }
                    }
                }
                
                // Insert only new contact methods (that don't already exist)
                const methodsToInsert = validContactMethods.filter(method => {
                    const methodType = (method.type || method.method_type || '').trim();
                    const methodValue = (method.value || '').trim();
                    const key = `${methodType}:${methodValue}`;
                    return !existingMethodsMap.has(key);
                });
                
                if (methodsToInsert.length > 0) {
                    // Ensure we only include the fields needed for insert (exclude any ID fields)
                    const contactMethodsToInsert = methodsToInsert.map(method => {
                        const cleanMethod = {
                            contact_id: contactData.contact_id,
                            method_type: (method.type || method.method_type || '').trim(),
                            value: (method.value || '').trim()
                        };
                        // Explicitly remove any ID fields that might have been included
                        delete cleanMethod.method_id;
                        return cleanMethod;
                    });
                    
                    const { error: contactMethodsError } = await insertWithAudit(
                        'contact_methods',
                        contactMethodsToInsert,
                        userId
                    );
                    
                    if (contactMethodsError) {
                        console.error('Error inserting contact methods:', contactMethodsError);
                        return;
                    }
                }
            }
            
            onUpdateSuccess();
        } catch (error) {
            console.error('Error updating landlord:', error);
        }
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
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div 
                className="w-full max-w-lg max-h-[90vh] bg-white rounded-lg shadow-xl flex flex-col" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                {/* Fixed Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 className="text-2xl font-bold text-gray-800">Edit Landlord</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
                </div>
                
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto">
                    <form onSubmit={handleSubmit} className="p-6 space-y-4" id="edit-landlord-form">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div className="sm:col-span-1">
                                <label className="block text-sm font-medium text-gray-700">First Name</label>
                                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            </div>
                            <div className="sm:col-span-1">
                                <label className="block text-sm font-medium text-gray-700">Middle</label>
                                <input type="text" value={middleName} onChange={e => setMiddleName(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            </div>
                            <div className="sm:col-span-1">
                                <label className="block text-sm font-medium text-gray-700">Last Name</label>
                                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            </div>
                        </div>
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700">Primary Email</label>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="off" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        </div>
                        {/* Note: PM Company assignment removed - relationship is indirect through properties */}
                        {/* Note: Manager assignment moved to properties - managers are assigned to properties, not landlords */}
                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 mb-2">Mailing Address</h4>
                             <div className="space-y-2">
                                <input value={address.address_line_1} onChange={e => handleAddressChange('address_line_1', e.target.value)} placeholder="Address Line 1" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                <input value={address.address_line_2} onChange={e => handleAddressChange('address_line_2', e.target.value)} placeholder="Address Line 2" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <input value={address.city} onChange={e => handleAddressChange('city', e.target.value)} placeholder="City" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                    <input value={address.state_province_region} onChange={e => handleAddressChange('state_province_region', e.target.value)} placeholder="State / Province" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                </div>
                                 <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <input value={address.postal_code} onChange={e => handleAddressChange('postal_code', e.target.value)} placeholder="Postal Code" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                    <input value={address.country} onChange={e => handleAddressChange('country', e.target.value)} placeholder="Country" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                </div>
                            </div>
                        </div>
                         <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 my-2">Contact Methods</h4>
                            {contactMethods.map((method) => (
                                <div key={method.tempId} className="flex gap-2 mb-2 items-center">
                                    <ContactMethodTypeInput value={method.type} onChange={value => handleMethodChange(method.tempId, 'type', value)} className="w-1/3 block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                                    <input type="text" value={method.value} onChange={e => handleMethodChange(method.tempId, 'value', e.target.value)} placeholder="Value (e.g., 555-1234)" autoComplete="tel" name="contact-method-value" className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                                    <button type="button" onClick={() => removeMethod(method.tempId)} className="p-2 text-red-500 hover:text-red-700"><Trash2 size={16}/></button>
                                </div>
                            ))}
                            <button type="button" onClick={addMethod} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 mt-2">
                                <PlusCircle size={16}/> Add Contact Method
                            </button>
                        </div>
                        
                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 mb-4">Reset Password (Optional)</h4>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">New Password</label>
                                    <input 
                                        type="password" 
                                        value={newPassword} 
                                        onChange={(e) => setNewPassword(e.target.value)} 
                                        autoComplete="new-password" 
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" 
                                        placeholder="Leave blank to keep current password"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Confirm New Password</label>
                                    <input 
                                        type="password" 
                                        value={confirmPassword} 
                                        onChange={(e) => setConfirmPassword(e.target.value)} 
                                        autoComplete="new-password" 
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" 
                                        placeholder="Confirm new password"
                                    />
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
                
                {/* Fixed Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" form="edit-landlord-form" className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const DeleteLandlordModal = ({ landlord, onClose, onDeleteSuccess }) => {
    const { user } = useContext(AuthContext);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    const handleDelete = async () => {
        setIsSubmitting(true);
        setError('');
        try {
            // Use the safe landlord deletion function
            const { error } = await supabase.rpc('delete_landlord_with_properties', {
                p_landlord_id: landlord.landlord_id
            });
                
            if (error) {
                console.error('Error deleting landlord:', error);
                setError(error.message || 'Failed to delete landlord.');
                return;
            }
            
            onDeleteSuccess();
        } catch (err) {
            console.error('Error during landlord deletion:', err);
            setError('Could not connect to the server.');
        } finally {
            setIsSubmitting(false);
        }
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
                className="w-full max-w-md p-6 space-y-4 bg-white rounded-lg shadow-xl" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <h2 className="text-xl font-bold text-gray-900">Confirm Deletion</h2>
                <p className="text-sm text-gray-600">
                    Are you sure you want to permanently delete the landlord <span className="font-bold">{`${landlord.first_name}${landlord.middle_name ? ' ' + landlord.middle_name : ''} ${landlord.last_name}`}</span>? This action cannot be undone.
                </p>
                {error && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{error}</div>)}
                <div className="flex justify-end gap-4 pt-4">
                    <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                    <button type="button" onClick={handleDelete} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700">{isSubmitting ? 'Deleting...' : 'Delete Landlord'}</button>
                </div>
            </div>
        </div>
    );
};


