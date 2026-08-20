import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react';
import { Pencil, Trash2, X, ArrowUpDown, PlusCircle, Search, Clock, MapPin, CheckCircle, AlertCircle, Check, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card, ConfirmationModal } from '../components/ui';
import { useSortableData } from '../hooks';
import { useFinderLimit } from '../hooks/useFinderLimit';
import { useFormPersistence } from '../hooks/useFormPersistence';
import ArchiveModal from '../components/ArchiveModal';
import ContactMethodTypeInput from '../components/ContactMethodTypeInput';

const SERVICE_SUFFIX_REGEX = /\s+(service|services)\s*$/i;

const formatServiceKeyword = (name = '') => {
    if (!name) return '';
    const cleaned = name.replace(SERVICE_SUFFIX_REGEX, '').trim();
    return cleaned || name.trim();
};

const sanitizeKeywordRecord = (keyword = {}) => ({
    ...keyword,
    keyword_name: formatServiceKeyword(keyword.keyword_name || '')
});

const STATE_ABBREVIATIONS = {
    alabama: 'AL',
    alaska: 'AK',
    arizona: 'AZ',
    arkansas: 'AR',
    california: 'CA',
    colorado: 'CO',
    connecticut: 'CT',
    delaware: 'DE',
    florida: 'FL',
    georgia: 'GA',
    hawaii: 'HI',
    idaho: 'ID',
    illinois: 'IL',
    indiana: 'IN',
    iowa: 'IA',
    kansas: 'KS',
    kentucky: 'KY',
    louisiana: 'LA',
    maine: 'ME',
    maryland: 'MD',
    massachusetts: 'MA',
    michigan: 'MI',
    minnesota: 'MN',
    mississippi: 'MS',
    missouri: 'MO',
    montana: 'MT',
    nebraska: 'NE',
    nevada: 'NV',
    'new hampshire': 'NH',
    'new jersey': 'NJ',
    'new mexico': 'NM',
    'new york': 'NY',
    'north carolina': 'NC',
    'north dakota': 'ND',
    ohio: 'OH',
    oklahoma: 'OK',
    oregon: 'OR',
    pennsylvania: 'PA',
    'rhode island': 'RI',
    'south carolina': 'SC',
    'south dakota': 'SD',
    tennessee: 'TN',
    texas: 'TX',
    utah: 'UT',
    vermont: 'VT',
    virginia: 'VA',
    washington: 'WA',
    'west virginia': 'WV',
    wisconsin: 'WI',
    wyoming: 'WY',
    'district of columbia': 'DC',
    'washington dc': 'DC'
};

const normalizeStateAbbreviation = (value = '') => {
    if (!value) return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.length === 2) return trimmed.toUpperCase();
    const lookup = STATE_ABBREVIATIONS[trimmed.toLowerCase()];
    return lookup || trimmed;
};

const ensureCityHasState = (city = '', state = '') => {
    if (!city) return '';
    const normalizedState = normalizeStateAbbreviation(state);
    if (!normalizedState) return city;
    const pattern = new RegExp(`,\\s*${normalizedState}$`, 'i');
    return pattern.test(city) ? city : `${city}, ${normalizedState}`;
};

const formatServiceAreaValue = (vendor, area) => {
    // Don't add state to cities or counties - just return the area value
    return area.area_value;
};

const formatServiceAreaChipLabel = (vendor, area) => {
    const value = formatServiceAreaValue(vendor, area);
    return area.area_type === 'city' ? value : `${area.area_type}: ${value}`;
};

const normalizeTimeValue = (value) => {
    if (value === null || value === undefined) return '';
    const str = value.toString().trim();
    if (!str) return '';
    const match = str.match(/(\d{1,2}):(\d{2})/);
    if (match) {
        const hours = match[1].padStart(2, '0');
        const minutes = match[2];
        return `${hours}:${minutes}`;
    }
    return str;
};

// Utility functions
const formatVendorName = (v) => {
    if (v.vendor_name) return v.vendor_name;
    if (v.company_name) return v.company_name; // Fallback for migrated data
    const first = v.first_name || '';
    const last = v.last_name || '';
    const middle = v.middle_name ? ` ${v.middle_name.charAt(0)}.` : '';
    return `${first}${middle} ${last}`.replace(/\s+/g, ' ').trim() || 'Unnamed Vendor';
};

// Utility function for formatting vendor recap for hover tooltip
const formatVendorRecap = (v) => {
    const parts = [];
    
    // Approval Status
    if (v.approvals && v.approvals.length > 0) {
        const approvalParts = ['Approved'];
        if (v.approvals.some(a => a.can_emergency_service)) {
            approvalParts.push('Approved for Emergencies');
        }
        parts.push(approvalParts.join(' - '));
    }
    
    // Company Name
    if (v.company_name || v.vendor_name) {
        parts.push(`Company: ${v.company_name || v.vendor_name}`);
    }
    
    // Personal Name
    const first = v.first_name || '';
    const middle = v.middle_name || '';
    const last = v.last_name || '';
    if (first || middle || last) {
        const nameParts = [first, middle, last].filter(Boolean);
        if (nameParts.length > 0) {
            parts.push(`Name: ${nameParts.join(' ')}`);
        }
    }
    
    // Email
    if (v.email) {
        parts.push(`Email: ${v.email}`);
    }
    
    // Job Title
    if (v.job_title) {
        parts.push(`Job Title: ${v.job_title}`);
    }
    
    // Description
    if (v.description) {
        parts.push(`Description: ${v.description.substring(0, 100)}${v.description.length > 100 ? '...' : ''}`);
    }
    
    // Address
    const addressParts = [];
    if (v.address_line_1) addressParts.push(v.address_line_1);
    if (v.address_line_2) addressParts.push(v.address_line_2);
    if (v.city) addressParts.push(v.city);
    if (v.state_province_region) addressParts.push(v.state_province_region);
    if (v.postal_code) addressParts.push(v.postal_code);
    if (v.country) addressParts.push(v.country);
    if (addressParts.length > 0) {
        parts.push(`Address: ${addressParts.join(', ')}`);
    }
    
    // Contact Methods
    const contactMethods = (v.contact_methods || []).filter(m => 
        m.method_type && m.method_type.toLowerCase() !== 'email' && m.value
    );
    if (contactMethods.length > 0) {
        const methodStrings = contactMethods.map(m => 
            `${m.method_type}: ${m.value}`
        );
        parts.push(`Contact Methods: ${methodStrings.join(', ')}`);
    }
    
    return parts.length > 0 ? parts.join('\n') : 'No additional information available';
};

const formatAddress = (v) => {
    if (!v.address_line_1 && !v.city) return 'No address';
    const addressParts = [
        v.address_line_1,
        v.address_line_2,
        v.city,
        v.state_province_region
    ].filter(Boolean);
    return addressParts.join(', ');
};

const getPhoneNumber = (v) => {
    if (!v.contact_methods || !Array.isArray(v.contact_methods)) return '';
    const phoneMethod = v.contact_methods.find(m => {
        const methodType = (m.method_type || '').toLowerCase();
        return methodType.includes('phone') && !methodType.includes('email');
    });
    return phoneMethod?.value || '';
};

export default function VendorsPage() {
    const { user } = useContext(AuthContext);
    const [vendors, setVendors] = useState([]);
    const [editingVendor, setEditingVendor] = useState(null);
    const [approvingVendor, setApprovingVendor] = useState(null);
    const [deletingVendor, setDeletingVendor] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    
    // Debounce search term
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);
    
    // Filter vendors based on search term
    const filteredVendors = useMemo(() => {
        if (!vendors || !Array.isArray(vendors)) return [];
        if (!debouncedSearchTerm.trim()) return vendors;
        
        const searchLower = debouncedSearchTerm.toLowerCase();
        return vendors.filter(vendor => {
            const nameMatch = formatVendorName(vendor).toLowerCase().includes(searchLower);
            const phoneMatch = getPhoneNumber(vendor).toLowerCase().includes(searchLower);
            const keywordMatch = vendor.keywords?.some(k => formatServiceKeyword(k.keyword_name)?.toLowerCase().includes(searchLower));
            const descriptionMatch = vendor.description?.toLowerCase().includes(searchLower);
            const serviceAreaMatch = vendor.service_areas?.some(sa => {
                const areaValue = formatServiceAreaValue(vendor, sa).toLowerCase();
                const areaType = sa.area_type?.toLowerCase() || '';
                return areaValue.includes(searchLower) || areaType.includes(searchLower);
            });
            
            return nameMatch || phoneMatch || keywordMatch || descriptionMatch || serviceAreaMatch;
        });
    }, [vendors, debouncedSearchTerm]);
    
    const { items: sortedVendors, requestSort, sortConfig } = useSortableData(filteredVendors.map(v => ({ 
        ...v, 
        name: formatVendorName(v),
        phone: getPhoneNumber(v),
        services: v.keywords?.map(k => formatServiceKeyword(k.keyword_name)).join(', ') || '',
        service_areas_sort: v.service_areas?.map(sa => `${sa.area_type}: ${formatServiceAreaValue(v, sa)}`).join(', ') || ''
    })), { key: 'name', direction: 'ascending' });
    const { visibleCount: vendorVisibleCount, hasMore: hasMoreVendors, showMore: showMoreVendors } = useFinderLimit(
        sortedVendors.length,
        [debouncedSearchTerm, vendors.length]
    );
    const displayedVendors = sortedVendors.slice(0, vendorVisibleCount || sortedVendors.length);
    
    const fetchData = async () => {
        try {
            // Fetch vendors
            const vendorsQuery = supabase.from('vendors').select('*');
            if (!showArchived) {
                vendorsQuery.eq('is_archived', false);
            }
            const { data: vendorsData, error: vendorsError } = await vendorsQuery;
            
            if (vendorsError) {
                console.error('Error fetching vendors:', vendorsError);
                setVendors([]);
                return;
            }
            
            if (!vendorsData || vendorsData.length === 0) {
                setVendors([]);
                return;
            }
            
            const vendorIds = vendorsData.map(v => v.vendor_id);
            const userIds = vendorsData.map(v => v.user_id).filter(Boolean);
            
            // Fetch users to get email
            const { data: users } = userIds.length > 0 ? await supabase
                .from('users')
                .select('user_id, email')
                .in('user_id', userIds) : { data: [] };
            
            // Fetch contacts
            const { data: contacts } = await supabase
                .from('contacts')
                .select('*')
                .in('contactable_id', vendorIds)
                .eq('contactable_type', 'vendor');
            
            // Fetch contact methods
            const contactIds = contacts?.map(c => c.contact_id) || [];
            const { data: contactMethods } = contactIds.length > 0 ? await supabase
                .from('contact_methods')
                .select('*')
                .in('contact_id', contactIds) : { data: [] };
            
            // Fetch addresses
            const { data: addresses } = await supabase
                .from('addresses')
                .select('*')
                .in('addressable_id', vendorIds)
                .eq('addressable_type', 'vendor');
            
            // Fetch keywords
            const { data: vendorKeywords } = await supabase
                .from('vendor_keywords')
                .select(`
                    *,
                    vendor_service_keywords(keyword_name, keyword_id)
                `)
                .in('vendor_id', vendorIds);
            
            // Fetch service areas
            const { data: serviceAreas } = await supabase
                .from('vendor_service_areas')
                .select('*')
                .in('vendor_id', vendorIds);
            
            // Fetch approvals
            const { data: approvals } = await supabase
                .from('vendor_approvals')
                .select(`
                    *,
                    pm_companies(company_name),
                    landlords(landlord_id),
                    properties(property_id, property_type)
                `)
                .in('vendor_id', vendorIds);
            
            // Fetch hours
            const { data: hours } = await supabase
                .from('vendor_hours')
                .select('*')
                .in('vendor_id', vendorIds);
            
            // Combine all data
                const vendorsWithData = vendorsData.map(vendor => {
                const user = users?.find(u => u.user_id === vendor.user_id);
                const contact = contacts?.find(c => c.contactable_id === vendor.vendor_id);
                const methods = contactMethods?.filter(cm => cm.contact_id === contact?.contact_id) || [];
                const address = addresses?.find(a => a.addressable_id === vendor.vendor_id);
                const keywords = vendorKeywords
                    ?.filter(vk => vk.vendor_id === vendor.vendor_id)
                    .map(vk => vk.vendor_service_keywords) || [];
                const areas = serviceAreas?.filter(sa => sa.vendor_id === vendor.vendor_id) || [];
                const vendorApprovals = approvals?.filter(a => a.vendor_id === vendor.vendor_id) || [];
                const vendorHours = hours?.filter(h => h.vendor_id === vendor.vendor_id) || [];
                
                return {
                    ...vendor,
                    email: user?.email || '',
                    first_name: contact?.first_name,
                    middle_name: contact?.middle_name,
                    last_name: contact?.last_name,
                    contact_methods: methods,
                    address_line_1: address?.address_line_1 || '',
                    address_line_2: address?.address_line_2 || '',
                    city: address?.city || '',
                    state_province_region: normalizeStateAbbreviation(address?.state_province_region || ''),
                    postal_code: address?.postal_code || '',
                    country: address?.country || '',
                    keywords: keywords,
                    service_areas: areas,
                    approvals: vendorApprovals,
                    hours: vendorHours
                };
            });
            
            setVendors(vendorsWithData);
        } catch (error) {
            console.error('Error fetching vendors:', error);
            setVendors([]);
        }
    };

    useEffect(() => {
        if (user) fetchData();
    }, [user, showArchived]);
    
    const handleSuccess = () => {
        setEditingVendor(null);
        setDeletingVendor(null);
        fetchData();
    };

    const handleRestore = async (vendorId) => {
        try {
            const { error } = await supabase.rpc('restore_entity', {
                p_table_name: 'vendors',
                p_entity_id: vendorId,
                p_restored_by_user_id: user.user_id
            });
            
            if (error) {
                console.error('Error restoring vendor:', error);
                alert('Failed to restore vendor: ' + error.message);
            } else {
                fetchData();
            }
        } catch (err) {
            console.error('Error restoring vendor:', err);
            alert('Could not connect to the server.');
        }
    };

    const getSortIndicator = (name) => {
        if (!sortConfig || sortConfig.key !== name) return <ArrowUpDown size={14} className="ml-2 text-gray-400"/>;
        return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
    };

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Vendors</h2>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <CreateVendorForm onVendorCreated={handleSuccess} />
                <Card
                    title="Vendor Search"
                    className="lg:col-span-2 max-h-[calc(100vh-160px)]"
                    contentClassName="flex flex-col h-full"
                >
                    <div className="flex flex-col h-full">
                    {/* Search Box */}
                    <div className="mb-4 flex-shrink-0">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="relative flex-1">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Search className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Search vendors by name, phone, keywords, or description..."
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
                                sortedVendors.length === 0 ? (
                                    <span className="text-red-600">No vendors found matching "{debouncedSearchTerm}"</span>
                                ) : (
                                    <span>Showing {sortedVendors.length} of {vendors.length} vendors</span>
                                )
                            ) : (
                                <span>Showing {vendors.length} of {vendors.length} vendors</span>
                            )}
                        </div>
                    </div>
                    <div className="flex-1 overflow-hidden rounded-lg border border-gray-200">
                        <div className="overflow-auto h-full max-w-full">
                        <table className="w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">Actions</th>
                                    <th className="px-3 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('name')} className="flex items-center">
                                            Name {getSortIndicator('name')}
                                        </button>
                                    </th>
                                    <th className="px-3 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('phone')} className="flex items-center">
                                            Contact {getSortIndicator('phone')}
                                        </button>
                                    </th>
                                    <th className="px-3 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('services')} className="flex items-center">
                                            Services {getSortIndicator('services')}
                                        </button>
                                    </th>
                                    <th className="px-3 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('service_areas_sort')} className="flex items-center">
                                            Service Areas {getSortIndicator('service_areas_sort')}
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {displayedVendors.map(v => (
                                    <tr key={v.vendor_id} className={v.is_archived ? 'opacity-60 italic' : ''}>
                                        <td className="px-3 py-2 text-sm font-medium text-left whitespace-nowrap">
                                            <div className="flex items-center space-x-4">
                                                {!v.is_archived && (
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
                                                            <button onClick={() => setEditingVendor(v)} className="text-indigo-600 hover:text-indigo-900" title="Edit Vendor">
                                                                <Pencil size={16}/>
                                                            </button>
                                                            <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                                <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                                    {formatVendorRecap(v)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button onClick={() => setApprovingVendor(v)} className="text-green-600 hover:text-green-900" title="Approve Vendor">
                                                            <CheckCircle size={16}/>
                                                        </button>
                                                    </>
                                                )}
                                                {v.is_archived && showArchived && (
                                                    <button onClick={() => handleRestore(v.vendor_id)} className="text-green-600 hover:text-green-900" title="Restore Vendor"><RotateCcw size={16}/></button>
                                                )}
                                                <button onClick={() => setDeletingVendor(v)} className="text-red-600 hover:text-red-900" title="Archive Vendor">
                                                    <Trash2 size={16}/>
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">
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
                                                {v.is_archived && (
                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 mr-2">Archived</span>
                                                )}
                                                <div className="flex items-center gap-2">
                                                    {v.approvals && v.approvals.length > 0 && (
                                                        <>
                                                            <CheckCircle 
                                                                size={16} 
                                                                className="text-green-600 flex-shrink-0" 
                                                            />
                                                            {v.approvals.some(a => a.can_emergency_service) && (
                                                                <AlertCircle 
                                                                    size={16} 
                                                                    className="text-orange-600 flex-shrink-0" 
                                                                />
                                                            )}
                                                        </>
                                                    )}
                                                    <span className="cursor-help font-medium text-gray-900">{formatVendorName(v)}</span>
                                                </div>
                                                {v.description && (
                                                    <div className="text-xs text-gray-500 mt-1">{v.description.substring(0, 50)}...</div>
                                                )}
                                                <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                    <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                        {formatVendorRecap(v)}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-500">
                                            <div className="space-y-1">
                                                {v.email && (
                                                    <div className="text-xs">
                                                        <span className="font-medium">Email:</span> {v.email}
                                                    </div>
                                                )}
                                                {v.contact_methods && v.contact_methods.length > 0 && (
                                                    <>
                                                        {v.contact_methods
                                                            .filter(m => m.method_type && m.method_type.toLowerCase() !== 'email' && m.value)
                                                            .map((method, idx) => (
                                                                <div key={idx} className="text-xs">
                                                                    <span className="font-medium capitalize">{method.method_type}:</span> {method.value}
                                                                </div>
                                                            ))}
                                                    </>
                                                )}
                                                {!v.email && (!v.contact_methods || v.contact_methods.filter(m => m.method_type && m.method_type.toLowerCase() !== 'email' && m.value).length === 0) && (
                                                    <span className="text-gray-400">No contact methods</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-500">
                                            {v.keywords && v.keywords.length > 0 ? (
                                                <div 
                                                    className="flex flex-wrap gap-1 max-h-12 overflow-hidden relative group cursor-help"
                                                    title={v.keywords.map(k => formatServiceKeyword(k.keyword_name)).join(', ')}
                                                >
                                                    {v.keywords.slice(0, 3).map((k, idx) => (
                                                        <span key={idx} className="px-2 py-1 text-xs bg-indigo-100 text-indigo-800 rounded">
                                                            {formatServiceKeyword(k.keyword_name)}
                                                        </span>
                                                    ))}
                                                    {v.keywords.length > 3 && (
                                                        <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                                                            +{v.keywords.length - 3}
                                                        </span>
                                                    )}
                                                    {v.keywords.length > 3 && (
                                                        <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg">
                                                            {v.keywords.map(k => formatServiceKeyword(k.keyword_name)).join(', ')}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">No services</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-sm">
                                            {v.service_areas && v.service_areas.length > 0 ? (
                                                <div 
                                                    className="flex flex-wrap gap-1 max-h-12 overflow-hidden relative group cursor-help"
                                                    title={v.service_areas.map(sa => formatServiceAreaChipLabel(v, sa)).join(', ')}
                                                >
                                                    {v.service_areas.slice(0, 3).map((sa, idx) => (
                                                        <span key={idx} className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                                                            {formatServiceAreaChipLabel(v, sa)}
                                                        </span>
                                                    ))}
                                                    {v.service_areas.length > 3 && (
                                                        <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                                                            +{v.service_areas.length - 3}
                                                        </span>
                                                    )}
                                                    {v.service_areas.length > 3 && (
                                                        <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg">
                                                            {v.service_areas.map(sa => formatServiceAreaChipLabel(v, sa)).join(', ')}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400 text-xs">No service areas</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                    </div>
                    {hasMoreVendors && (
                        <div className="pt-3 mt-4 border-t text-right flex-shrink-0">
                            <button
                                type="button"
                                onClick={showMoreVendors}
                                className="text-indigo-600 hover:text-indigo-800 underline text-sm font-medium"
                            >
                                more
                            </button>
                        </div>
                    )}
                    </div>
                </Card>
            </div>
            {editingVendor && <EditVendorModal vendor={editingVendor} onClose={() => setEditingVendor(null)} onUpdateSuccess={handleSuccess} />}
            {approvingVendor && <ApproveVendorModal vendor={approvingVendor} onClose={() => setApprovingVendor(null)} onApproveSuccess={handleSuccess} />}
            {deletingVendor && (
                <ArchiveModal 
                    entity={deletingVendor}
                    entityType="vendor"
                    entityName={formatVendorName(deletingVendor)}
                    idField="vendor_id"
                    onClose={() => setDeletingVendor(null)}
                    onArchiveSuccess={handleSuccess}
                    showCascade={false}
                    requireReason={false}
                    isAdmin={user?.role === 'global_admin'}
                />
            )}
        </div>
    );
}

// Service Keywords Autocomplete Component
const KeywordAutocomplete = ({ selectedKeywords, onKeywordsChange }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [allKeywords, setAllKeywords] = useState([]);
    const [filteredKeywords, setFilteredKeywords] = useState([]);
    
    useEffect(() => {
        const fetchKeywords = async () => {
            const { data, error } = await supabase
                .from('vendor_service_keywords')
                .select('*')
                .order('keyword_name');
            
            if (!error && data) {
                setAllKeywords(data.map(sanitizeKeywordRecord));
            }
        };
        fetchKeywords();
    }, []);
    
    useEffect(() => {
        if (!searchTerm.trim()) {
            setFilteredKeywords(allKeywords.filter(k => 
                !selectedKeywords.some(sk => sk.keyword_id === k.keyword_id)
            ));
        } else {
            const searchLower = searchTerm.toLowerCase();
            setFilteredKeywords(allKeywords.filter(k => 
                formatServiceKeyword(k.keyword_name).toLowerCase().startsWith(searchLower) &&
                !selectedKeywords.some(sk => sk.keyword_id === k.keyword_id)
            ));
        }
    }, [searchTerm, allKeywords, selectedKeywords]);
    
    const handleSelectKeyword = (keyword) => {
        onKeywordsChange([...selectedKeywords, sanitizeKeywordRecord(keyword)]);
        setSearchTerm('');
        setShowDropdown(false);
    };
    
    const handleCreateNew = async (keywordName) => {
        const nameToCreate = keywordName || searchTerm.trim().split(',')[0].trim();
        if (!nameToCreate) return;
        const sanitizedName = formatServiceKeyword(nameToCreate);
        
        try {
            const { data, error } = await supabase
                .from('vendor_service_keywords')
                .insert([{ keyword_name: sanitizedName }])
                .select()
                .single();
            
            if (error) {
                console.error('Error creating keyword:', error);
                // If it's a duplicate, try to find the existing one
                if (error.code === '23505') { // Unique violation
                    const existing = allKeywords.find(k => 
                        k.keyword_name.toLowerCase() === sanitizedName.toLowerCase()
                    );
                    if (existing) {
                        handleSelectKeyword(existing);
                        return;
                    }
                }
                return;
            }
            
            if (data) {
                const sanitizedKeyword = sanitizeKeywordRecord(data);
                setAllKeywords(prev => [...prev, sanitizedKeyword]);
                handleSelectKeyword(sanitizedKeyword);
            }
        } catch (err) {
            console.error('Error in handleCreateNew:', err);
        }
    };
    
    const handleAddKeywords = async () => {
        if (!searchTerm.trim()) return;
        
        try {
            // Handle comma-separated input
            const keywordsToAdd = searchTerm.split(',').map(k => k.trim()).filter(k => k.length > 0);
            const newKeywords = [...selectedKeywords];
            const updatedAllKeywords = [...allKeywords];
            
            for (const keywordName of keywordsToAdd) {
                const sanitizedName = formatServiceKeyword(keywordName);
                // Check if keyword already exists
                const existingKeyword = updatedAllKeywords.find(k => 
                    k.keyword_name.toLowerCase() === sanitizedName.toLowerCase()
                );
                
                if (existingKeyword) {
                    // Add existing keyword if not already selected
                    if (!newKeywords.some(sk => sk.keyword_id === existingKeyword.keyword_id)) {
                        newKeywords.push(existingKeyword);
                    }
                } else {
                    // Create new keyword
                    try {
                        const { data, error } = await supabase
                            .from('vendor_service_keywords')
                            .insert([{ keyword_name: sanitizedName }])
                            .select()
                            .single();
                        
                        if (error) {
                            console.error('Error creating keyword:', error);
                            // If duplicate, try to find existing
                            if (error.code === '23505') {
                                const existing = allKeywords.find(k => 
                                    k.keyword_name.toLowerCase() === sanitizedName.toLowerCase()
                                );
                                if (existing && !newKeywords.some(sk => sk.keyword_id === existing.keyword_id)) {
                                    newKeywords.push(existing);
                                }
                            }
                        } else if (data) {
                            const sanitizedKeyword = sanitizeKeywordRecord(data);
                            updatedAllKeywords.push(sanitizedKeyword);
                            newKeywords.push(sanitizedKeyword);
                        }
                    } catch (err) {
                        console.error('Error creating keyword:', err);
                    }
                }
            }
            
            setAllKeywords(updatedAllKeywords.map(sanitizeKeywordRecord));
            onKeywordsChange(newKeywords);
            setSearchTerm('');
            setShowDropdown(false);
        } catch (err) {
            console.error('Error in handleAddKeywords:', err);
        }
    };
    
    const removeKeyword = (keywordId) => {
        onKeywordsChange(selectedKeywords.filter(k => k.keyword_id !== keywordId));
    };
    
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (showDropdown && !event.target.closest('.keyword-autocomplete')) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showDropdown]);
    
    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !showDropdown) {
            e.preventDefault();
            handleAddKeywords();
        }
    };
    
    return (
        <div className="keyword-autocomplete">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <input
                        type="text"
                        placeholder="Type to search or enter keywords (comma-separated)..."
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setShowDropdown(true);
                        }}
                        onFocus={() => setShowDropdown(true)}
                        onKeyDown={handleKeyDown}
                        className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    {showDropdown && (filteredKeywords.length > 0 || searchTerm.trim()) && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto overflow-x-hidden">
                            {filteredKeywords.length > 0 && filteredKeywords.map(keyword => (
                                <button
                                    key={keyword.keyword_id}
                                    type="button"
                                    onClick={() => handleSelectKeyword(keyword)}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none min-w-0"
                                >
                                    <div className="truncate">{formatServiceKeyword(keyword.keyword_name)}</div>
                                </button>
                            ))}
                            {searchTerm.trim() && !filteredKeywords.some(k => k.keyword_name.toLowerCase() === formatServiceKeyword(searchTerm.trim().split(',')[0].trim()).toLowerCase()) && (
                                <button
                                    type="button"
                                    onClick={() => handleCreateNew()}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none text-indigo-600 font-medium"
                                >
                                    + Create "{searchTerm.trim().split(',')[0].trim()}"
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <button 
                    type="button" 
                    onClick={handleAddKeywords}
                    disabled={!searchTerm.trim()}
                    className="mt-1 px-4 py-2 h-[38px] text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed self-end"
                >
                    Add
                </button>
            </div>
            {selectedKeywords.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                    {selectedKeywords.map(keyword => (
                        <span key={keyword.keyword_id} className="inline-flex items-center px-2 py-1 text-sm bg-indigo-100 text-indigo-800 rounded">
                            {formatServiceKeyword(keyword.keyword_name)}
                            <button
                                type="button"
                                onClick={() => removeKeyword(keyword.keyword_id)}
                                className="ml-2 text-indigo-600 hover:text-indigo-800"
                            >
                                <X size={14} />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};

const CreateVendorForm = ({ onVendorCreated }) => {
    const { user } = useContext(AuthContext);
    const [companyName, setCompanyName] = useState('');
    const [firstName, setFirstName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [jobTitle, setJobTitle] = useState('');
    const [description, setDescription] = useState('');
    const [contactMethods, setContactMethods] = useState([]);
    const [selectedKeywords, setSelectedKeywords] = useState([]);
    const [serviceAreas, setServiceAreas] = useState([]);
    const [address, setAddress] = useState({
        address_line_1: '', address_line_2: '', city: '', state_province_region: '', postal_code: '', country: ''
    });
    const [availableForEmergencies, setAvailableForEmergencies] = useState(false);
    const [businessHoursNote, setBusinessHoursNote] = useState('');
    const [hours, setHours] = useState([
        { day_of_week: 0, day_name: 'Sun', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 1, day_name: 'Mon', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 2, day_name: 'Tue', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 3, day_name: 'Wed', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 4, day_name: 'Thu', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 5, day_name: 'Fri', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 6, day_name: 'Sat', open_time: '', close_time: '', is_closed: false }
    ]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const contactMethodInputRefs = useRef({});
    const formBodyRef = useRef(null);
    
    // Website lookup field
    const [lookupWebsite, setLookupWebsite] = useState('');
    const [isFinding, setIsFinding] = useState(false);
    const [findError, setFindError] = useState('');

    // Service area management
    const [newAreaType, setNewAreaType] = useState('city');
    const [newAreaValue, setNewAreaValue] = useState('');
    const [editingServiceArea, setEditingServiceArea] = useState(null);
    
    // Form persistence
    const { clearPersistedData } = useFormPersistence('add-vendor', {
        companyName, firstName, middleName, lastName, email, jobTitle, contactMethods, selectedKeywords, serviceAreas, businessHoursNote
    }, (state) => {
        setCompanyName(state.companyName || '');
        setFirstName(state.firstName || '');
        setMiddleName(state.middleName || '');
        setLastName(state.lastName || '');
        setEmail(state.email || '');
        setJobTitle(state.jobTitle || '');
        setContactMethods(state.contactMethods || []);
        setSelectedKeywords((state.selectedKeywords || []).map(sanitizeKeywordRecord));
        setServiceAreas(state.serviceAreas || []);
        setBusinessHoursNote(state.businessHoursNote || '');
    });
    
    const addServiceArea = () => {
        if (!newAreaValue.trim()) return;
        const trimmedValue = newAreaValue.trim();
        // Don't add state to city service areas - state can be inferred from property context
        const normalizedValue = trimmedValue;

        const isDuplicate = serviceAreas.some(sa => 
            sa.area_type === newAreaType && sa.area_value.toLowerCase() === normalizedValue.toLowerCase()
        );
        
        if (isDuplicate) {
            setFormError(`Service area "${newAreaType}: ${normalizedValue}" is already added.`);
            return;
        }
        
        setServiceAreas(prev => [...prev, { area_type: newAreaType, area_value: normalizedValue, tempId: Date.now() }]);
        setNewAreaValue('');
        setFormError('');
    };
    
    const removeServiceArea = (tempId) => {
        setServiceAreas(prev => prev.filter(sa => sa.tempId !== tempId));
    };
    
    const editServiceArea = (tempId) => {
        const area = serviceAreas.find(sa => sa.tempId === tempId);
        if (area) {
            setEditingServiceArea({ ...area });
        }
    };
    
    const saveServiceAreaEdit = () => {
        if (!editingServiceArea) return;
        setServiceAreas(serviceAreas.map(sa => 
            sa.tempId === editingServiceArea.tempId ? editingServiceArea : sa
        ));
        setEditingServiceArea(null);
    };
    
    const cancelServiceAreaEdit = () => {
        setEditingServiceArea(null);
    };
    
    const updateEditingServiceArea = (field, value) => {
        if (editingServiceArea) {
            setEditingServiceArea({ ...editingServiceArea, [field]: value });
        }
    };
    
    const handleMethodChange = (tempId, field, value) => {
        setContactMethods(prevMethods => 
            prevMethods.map(m => m.tempId === tempId ? { ...m, [field]: value } : m)
        );
    };
    
    const addMethod = () => {
        const newTempId = Date.now();
        setContactMethods(prev => [...prev, { method_type: '', value: '', tempId: newTempId }]);
        // Focus the new input field after state update
        setTimeout(() => {
            const input = contactMethodInputRefs.current[newTempId];
            if (input) {
                input.focus();
            }
        }, 0);
    };
    
    const removeMethod = (tempId) => {
        setContactMethods(prev => prev.filter(m => m.tempId !== tempId));
    };
    
    // Generate time options in 30-minute increments
    const generateTimeOptions = () => {
        const options = [];
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const timeString = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                const displayTime = hour === 0 
                    ? `12:${String(minute).padStart(2, '0')}am`
                    : hour < 12
                    ? `${hour}:${String(minute).padStart(2, '0')}am`
                    : hour === 12
                    ? `12:${String(minute).padStart(2, '0')}pm`
                    : `${hour - 12}:${String(minute).padStart(2, '0')}pm`;
                options.push({ value: timeString, label: displayTime });
            }
        }
        return options;
    };
    
    const handleAddressChange = (field, value) => setAddress(prev => ({ ...prev, [field]: value }));
    
    const handleHoursChange = (dayOfWeek, field, value) => {
        setHours(hours.map(h => 
            h.day_of_week === dayOfWeek ? { ...h, [field]: value } : h
        ));
    };
    
    const resetForm = useCallback(() => {
        setCompanyName('');
        setFirstName('');
        setMiddleName('');
        setLastName('');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setJobTitle('');
        setDescription('');
        setContactMethods([]);
        setSelectedKeywords([]);
        setServiceAreas([]);
        setAddress({ address_line_1: '', address_line_2: '', city: '', state_province_region: '', postal_code: '', country: '' });
        setAvailableForEmergencies(false);
        setBusinessHoursNote('');
        setHours([
            { day_of_week: 0, day_name: 'Sun', open_time: '', close_time: '', is_closed: false },
            { day_of_week: 1, day_name: 'Mon', open_time: '', close_time: '', is_closed: false },
            { day_of_week: 2, day_name: 'Tue', open_time: '', close_time: '', is_closed: false },
            { day_of_week: 3, day_name: 'Wed', open_time: '', close_time: '', is_closed: false },
            { day_of_week: 4, day_name: 'Thu', open_time: '', close_time: '', is_closed: false },
            { day_of_week: 5, day_name: 'Fri', open_time: '', close_time: '', is_closed: false },
            { day_of_week: 6, day_name: 'Sat', open_time: '', close_time: '', is_closed: false }
        ]);
        setNewAreaType('city');
        setNewAreaValue('');
        setFormError('');
        setLookupWebsite('');
        setFindError('');
        clearPersistedData();
    }, [clearPersistedData]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        
        // Validation: Either company name or personal name required
        if (!companyName.trim() && !firstName.trim() && !lastName.trim()) {
            setFormError('Either company name or personal name (first/last) is required.');
            setIsSubmitting(false);
            return;
        }
        
        // Validate passwords match if provided
        if (password && password !== confirmPassword) {
            setFormError('Passwords do not match.');
            setIsSubmitting(false);
            return;
        }
        
        try {
            // Check for duplicate email in users table (if email provided)
            if (email.trim()) {
                const { data: existingUsers } = await supabase
                    .from('users')
                    .select('user_id, email')
                    .eq('email', email.trim().toLowerCase());
                
                if (existingUsers && existingUsers.length > 0) {
                    setFormError(`A user with email "${email.trim()}" already exists.`);
                    setIsSubmitting(false);
                    return;
                }
            }
            
            // Check for duplicate company name (warn but allow)
            let duplicateWarning = '';
            if (companyName.trim()) {
                const { data: existingCompanies } = await supabase
                    .from('vendors')
                    .select('vendor_id, company_name')
                    .ilike('company_name', companyName.trim());
                
                if (existingCompanies && existingCompanies.length > 0) {
                    duplicateWarning = `Warning: A vendor with company name "${companyName.trim()}" already exists.`;
                }
            }
            
            // Check for duplicate personal name (warn but allow)
            if ((firstName.trim() || lastName.trim()) && !companyName.trim()) {
                const { data: existingContacts } = await supabase
                    .from('contacts')
                    .select('contact_id, first_name, last_name, contactable_id')
                    .eq('contactable_type', 'vendor')
                    .eq('first_name', firstName.trim() || '')
                    .eq('last_name', lastName.trim() || '');
                
                if (existingContacts && existingContacts.length > 0) {
                    // Check if any of these contacts belong to vendors
                    const contactIds = existingContacts.map(c => c.contactable_id);
                    const { data: vendorsWithSameName } = await supabase
                        .from('vendors')
                        .select('vendor_id, company_name')
                        .in('vendor_id', contactIds);
                    
                    if (vendorsWithSameName && vendorsWithSameName.length > 0) {
                        const nameStr = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
                        if (duplicateWarning) {
                            duplicateWarning += ` Also, a vendor with personal name "${nameStr}" already exists.`;
                        } else {
                            duplicateWarning = `Warning: A vendor with personal name "${nameStr}" already exists.`;
                        }
                    }
                }
            }
            
            // Generate company_name if not provided (required by database)
            let finalCompanyName = companyName.trim();
            if (!finalCompanyName) {
                const nameParts = [firstName.trim(), middleName.trim(), lastName.trim()].filter(Boolean);
                finalCompanyName = nameParts.join(' ') || 'Unnamed Vendor';
            }
            
            // Show warning if duplicates found but allow user to proceed
            if (duplicateWarning) {
                const proceed = window.confirm(duplicateWarning + '\n\nDo you want to continue?');
                if (!proceed) {
                    setIsSubmitting(false);
                    return;
                }
            }
            
            // Create user account if email provided (vendors can optionally have user accounts)
            let userId = null;
            if (email.trim()) {
                // Hash password if provided, otherwise use temporary password
                const bcrypt = await import('bcryptjs');
                const salt = await bcrypt.genSalt(10);
                const passwordToUse = password || 'temp_password_' + Math.random().toString(36).substring(7);
                const passwordHash = await bcrypt.hash(passwordToUse, salt);
                
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .insert([{
                        email: email.trim().toLowerCase(),
                        password_hash: passwordHash,
                        role: 'vendor'
                    }])
                    .select('user_id')
                    .single();
                
                if (userError) {
                    setFormError(userError.message || 'Failed to create user account.');
                    setIsSubmitting(false);
                    return;
                }
                
                userId = userData.user_id;
            }
            
            // Create vendor record
            const { data: vendorData, error: vendorError } = await supabase
                .from('vendors')
                .insert([{
                    company_name: finalCompanyName,
                    user_id: userId,
                    job_title: jobTitle.trim() || null,
                    description: description.trim() || null,
                    available_for_emergencies: availableForEmergencies,
                    business_hours_note: businessHoursNote.trim() || null
                }])
                .select('vendor_id, company_name, job_title, created_at, updated_at')
                .single();
            
            if (vendorError) {
                setFormError(vendorError.message || 'Failed to create vendor.');
                setIsSubmitting(false);
                return;
            }
            
            // Create contact if personal names, email, or contact methods provided
            if (firstName.trim() || middleName.trim() || lastName.trim() || email.trim() || contactMethods.length > 0) {
                const { data: contactData } = await supabase
                    .from('contacts')
                    .insert([{
                        contactable_id: vendorData.vendor_id,
                        contactable_type: 'vendor',
                        first_name: firstName.trim() || null,
                        middle_name: middleName.trim() || null,
                        last_name: lastName.trim() || null
                    }])
                    .select()
                    .single();
                
                // Create contact methods (including email if provided)
                if (contactData) {
                    const methodsToInsert = [];
                    
                    // Add email to contact methods if provided and not already in contactMethods
                    if (email.trim() && !contactMethods.some(m => 
                        m.method_type?.toLowerCase() === 'email' || 
                        m.value?.toLowerCase() === email.trim().toLowerCase()
                    )) {
                        methodsToInsert.push({
                            contact_id: contactData.contact_id,
                            method_type: 'Email',
                            value: email.trim().toLowerCase()
                        });
                    }
                    
                    // Add other contact methods
                    const validMethods = contactMethods.filter(m => m.method_type && m.value);
                    validMethods.forEach(m => {
                        methodsToInsert.push({
                            contact_id: contactData.contact_id,
                            method_type: m.method_type,
                            value: m.value
                        });
                    });
                    
                    if (methodsToInsert.length > 0) {
                        const { error: methodsError } = await supabase
                            .from('contact_methods')
                            .insert(methodsToInsert);
                        
                        if (methodsError) {
                            console.error('Error creating contact methods:', methodsError);
                        }
                    }
                }
            }
            
            // Create address if provided
            const hasAddressData = Object.values(address).some(v => v && v.trim());
            if (hasAddressData) {
                const { error: addressError } = await supabase
                    .from('addresses')
                    .insert([{
                        addressable_id: vendorData.vendor_id,
                        addressable_type: 'vendor',
                        ...address
                    }]);
                    
                if (addressError) {
                    console.error('Error creating address:', addressError);
                }
            }
            
            // Create vendor hours (store all days to preserve closed state)
            if (hours.length > 0) {
                const hoursToInsert = hours.map(h => {
                    const normalizedOpen = normalizeTimeValue(h.open_time);
                    const normalizedClose = normalizeTimeValue(h.close_time);
                    const isClosed = h.is_closed || !normalizedOpen || !normalizedClose;
                    return {
                        vendor_id: vendorData.vendor_id,
                        day_of_week: h.day_of_week,
                        open_time: isClosed ? null : normalizedOpen,
                        close_time: isClosed ? null : normalizedClose,
                        is_closed: isClosed,
                        available_for_emergencies: availableForEmergencies
                    };
                });
                
                const { error: hoursError } = await supabase
                    .from('vendor_hours')
                    .insert(hoursToInsert);
                    
                if (hoursError) {
                    console.error('Error creating vendor hours:', hoursError);
                }
            }
            
            // Create keywords
            if (selectedKeywords.length > 0) {
                const { error: keywordsError } = await supabase
                    .from('vendor_keywords')
                    .insert(selectedKeywords.map(k => ({
                        vendor_id: vendorData.vendor_id,
                        keyword_id: k.keyword_id
                    })));
                
                if (keywordsError) {
                    console.error('Error creating keywords:', keywordsError);
                }
            }
            
            // Create service areas
            if (serviceAreas.length > 0) {
                const { error: areasError } = await supabase
                    .from('vendor_service_areas')
                    .insert(serviceAreas.map(sa => ({
                        vendor_id: vendorData.vendor_id,
                        area_type: sa.area_type,
                        area_value: sa.area_value
                    })));
                
                if (areasError) {
                    console.error('Error creating service areas:', areasError);
                }
            }
            
            resetForm();
            onVendorCreated();
            // Scroll form body to top after state updates
            setTimeout(() => {
                if (formBodyRef.current) {
                    formBodyRef.current.scrollTop = 0;
                }
            }, 0);
        } catch (err) {
            console.error('Error creating vendor:', err);
            setFormError(err.message || 'Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleFind = async () => {
        if (!lookupWebsite) {
            setFindError('Please provide a website URL.');
            return;
        }

        setIsFinding(true);
        setFindError('');

        try {
            const response = await fetch('/api/vendors/find', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    website: lookupWebsite
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to find vendor information');
            }

            const result = await response.json();
            
            // Check if the API returned an error (e.g., 403 blocking)
            if (!result.success && result.error) {
                setFindError(result.error);
                setIsFinding(false);
                return;
            }
            
            const data = result.data;

            // Auto-fill form with extracted data
            if (data.company_name && !companyName) {
                setCompanyName(data.company_name);
            }
            
            if (data.description && !description) {
                setDescription(data.description);
            }
            
            if (data.email && !email) {
                setEmail(data.email);
            }
            
            // Add phone to contact methods if extracted
            if (data.phone) {
                const phoneValue = data.phone.trim();
                if (phoneValue) {
                    setContactMethods(prev => {
                        const normalize = (p) => (p || '').replace(/\D/g, '');
                        const hasPhone = prev.some(m => 
                            m.method_type?.toLowerCase().includes('phone') &&
                            normalize(m.value) === normalize(phoneValue)
                        );
                        if (hasPhone) {
                            return prev;
                        }
                        return [
                            ...prev,
                            {
                                method_type: 'Phone',
                                value: phoneValue,
                                tempId: Date.now()
                            }
                        ];
                    });
                }
            }

            // Add website to contact methods if not already present
            // First, remove any existing website entries to avoid duplicates from previous runs
            if (result.website_url) {
                setContactMethods(prev => {
                    // Remove any existing website entries
                    const withoutWebsites = prev.filter(m => 
                        !m.method_type?.toLowerCase().includes('website') && 
                        m.value !== result.website_url
                    );
                    // Add the new website
                    return [
                        ...withoutWebsites,
                        {
                            method_type: 'Website',
                            value: result.website_url,
                            tempId: Date.now()
                        }
                    ];
                });
            }

            // Fill address if extracted (partial or full)
            if (data.address) {
                const currentAddress = address;
                if (data.address.address_line_1 && !currentAddress.address_line_1) {
                    setAddress(prev => ({ ...prev, address_line_1: data.address.address_line_1 }));
                }
                if (data.address.address_line_2 && !currentAddress.address_line_2) {
                    setAddress(prev => ({ ...prev, address_line_2: data.address.address_line_2 }));
                }
                if (data.address.city && !currentAddress.city) {
                    setAddress(prev => ({ ...prev, city: data.address.city }));
                }
                if (data.address.state_province_region && !currentAddress.state_province_region) {
                    setAddress(prev => ({ ...prev, state_province_region: normalizeStateAbbreviation(data.address.state_province_region) }));
                }
                if (data.address.postal_code && !currentAddress.postal_code) {
                    setAddress(prev => ({ ...prev, postal_code: data.address.postal_code }));
                }
                if (data.address.country && !currentAddress.country) {
                    setAddress(prev => ({ ...prev, country: data.address.country }));
                }
            }

            // Fill available for emergencies
            if (data.available_for_emergencies !== null && data.available_for_emergencies !== undefined) {
                setAvailableForEmergencies(data.available_for_emergencies);
            }

            // Fill business hours if extracted
            if (data.business_hours) {
                const dayMap = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
                setHours(prevHours => prevHours.map(day => {
                    const dayName = Object.keys(dayMap).find(key => dayMap[key] === day.day_of_week);
                    if (dayName && data.business_hours[dayName]) {
                        const dayHours = data.business_hours[dayName];
                        return {
                            ...day,
                            open_time: normalizeTimeValue(dayHours.open),
                            close_time: normalizeTimeValue(dayHours.close),
                            is_closed: dayHours.closed || false
                        };
                    }
                    return day;
                }));
            }

            if (data.business_hours_note && !businessHoursNote) {
                setBusinessHoursNote(data.business_hours_note);
            }

            // Fill personal name if extracted
            if (data.personal_name) {
                if (data.personal_name.first_name && !firstName) {
                    setFirstName(data.personal_name.first_name);
                }
                if (data.personal_name.middle_name && !middleName) {
                    setMiddleName(data.personal_name.middle_name);
                }
                if (data.personal_name.last_name && !lastName) {
                    setLastName(data.personal_name.last_name);
                }
            }

            // Add service areas
            if (data.service_areas && Array.isArray(data.service_areas)) {
                const inferredState = normalizeStateAbbreviation(data.address?.state_province_region || address.state_province_region);
                const existingKeys = new Set(serviceAreas.map(sa => `${sa.area_type}:${sa.area_value.toLowerCase()}`));
                const pendingAreas = [];
                const baseTimestamp = Date.now();

                data.service_areas.forEach((area, index) => {
                    if (!area) return;
                    // Try to determine area type
                    let areaType = 'city';
                    const lowerArea = area.toLowerCase();
                    if (lowerArea.includes('county')) {
                        areaType = 'county';
                    } else if (lowerArea.match(/^\d{5}(-\d{4})?$/)) {
                        areaType = 'zip_code';
                    } else if (area.length === 2 || area.length === 3) {
                        areaType = 'state';
                    }

                    let areaValue = area.replace(/county|state|zip code/gi, '').trim();
                    if (!areaValue) return;

                    // Don't add state to city service areas - state can be inferred from property context
                    // if (areaType === 'city') {
                    //     areaValue = ensureCityHasState(areaValue, inferredState);
                    // }

                    const key = `${areaType}:${areaValue.toLowerCase()}`;
                    if (!existingKeys.has(key)) {
                        existingKeys.add(key);
                        pendingAreas.push({
                            area_type: areaType,
                            area_value: areaValue,
                            tempId: baseTimestamp + index
                        });
                    }
                });

                if (pendingAreas.length > 0) {
                    setServiceAreas(prev => {
                        const prevKeys = new Set(prev.map(sa => `${sa.area_type}:${sa.area_value.toLowerCase()}`));
                        const merged = [...prev];
                        pendingAreas.forEach(area => {
                            const key = `${area.area_type}:${area.area_value.toLowerCase()}`;
                            if (!prevKeys.has(key)) {
                                prevKeys.add(key);
                                merged.push(area);
                            }
                        });
                        return merged;
                    });
                }
            }

            // Auto-populate service keywords from extracted services
            if (data.services && Array.isArray(data.services) && data.services.length > 0) {
                // Fetch all existing keywords to match against
                const { data: rawKeywords } = await supabase
                    .from('vendor_service_keywords')
                    .select('*')
                    .order('keyword_name');
                
                const allKeywords = (rawKeywords || []).map(sanitizeKeywordRecord);
                const keywordsToAdd = [];
                const keywordsToCreate = [];
                
                for (const service of data.services) {
                    const cleanedService = formatServiceKeyword(service.trim());
                    if (!cleanedService) {
                        continue;
                    }
                    
                    // Try to find matching keyword (case-insensitive, partial match)
                    const matchingKeyword = allKeywords?.find(k => 
                        k.keyword_name.toLowerCase() === cleanedService.toLowerCase() ||
                        cleanedService.toLowerCase().includes(k.keyword_name.toLowerCase()) ||
                        k.keyword_name.toLowerCase().includes(cleanedService.toLowerCase())
                    );
                    
                    if (matchingKeyword) {
                        // Use existing keyword if not already selected
                        if (!selectedKeywords.some(sk => sk.keyword_id === matchingKeyword.keyword_id)) {
                            keywordsToAdd.push(matchingKeyword);
                        }
                    } else {
                        // Create new keyword with cleaned name
                        keywordsToCreate.push(cleanedService);
                    }
                }
                
                // Create new keywords
                if (keywordsToCreate.length > 0) {
                    const { data: newKeywords, error: createError } = await supabase
                        .from('vendor_service_keywords')
                        .insert(keywordsToCreate.map(name => ({ keyword_name: name })))
                        .select();
                    
                    if (!createError && newKeywords) {
                        // Handle duplicates - if keyword was created by another process, fetch it
                        for (const newKeyword of newKeywords) {
                            if (!keywordsToAdd.some(k => k.keyword_id === newKeyword.keyword_id)) {
                                keywordsToAdd.push(newKeyword);
                            }
                        }
                        
                        // For any that failed due to duplicates, try to find them
                        for (const serviceName of keywordsToCreate) {
                            const existing = allKeywords?.find(k => 
                                k.keyword_name.toLowerCase() === serviceName.toLowerCase()
                            );
                            if (existing && !keywordsToAdd.some(k => k.keyword_id === existing.keyword_id)) {
                                keywordsToAdd.push(existing);
                            }
                        }
                    } else if (createError) {
                        console.error('Error creating keywords:', createError);
                    }
                }
                
                // Add all matched/created keywords to selected keywords
                if (keywordsToAdd.length > 0) {
                    setSelectedKeywords(prev => {
                        const existingIds = prev.map(k => k.keyword_id);
                        const newKeywords = keywordsToAdd.filter(k => !existingIds.includes(k.keyword_id));
                        if (!newKeywords.length) {
                            return prev;
                        }
                        return [...prev, ...newKeywords];
                    });
                }
            }

            // Warnings are not displayed to users - they're for internal debugging only

        } catch (error) {
            console.error('Error finding vendor:', error);
            setFindError(error.message || 'Failed to find vendor information. Please try again or enter manually.');
        } finally {
            setIsFinding(false);
        }
    };

    const handleClear = () => {
        resetForm();
        setLookupWebsite('');
        setFindError('');
        // Scroll form body to top after state updates
        setTimeout(() => {
            if (formBodyRef.current) {
                formBodyRef.current.scrollTop = 0;
            }
        }, 0);
    };
    
    return (
        <Card 
            hideTitle
            className="lg:col-span-1 max-h-[calc(100vh-160px)]"
            contentClassName="flex flex-col h-full"
        >
            <form onSubmit={handleCreate} className="flex flex-col h-full">
                <div className="flex items-start justify-between pb-4 mb-4 border-b">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Add Vendor</h2>
                    </div>
                </div>
                <div ref={formBodyRef} className="flex-1 overflow-y-auto pr-2 space-y-4">
                {/* Website Lookup Section */}
                <div className="pt-4 pb-4 border-b border-gray-200 bg-gray-50 rounded-lg p-4">
                    <h4 className="text-md font-medium text-gray-800 mb-3">Find Vendor Information</h4>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Website URL</label>
                            <input
                                type="url"
                                value={lookupWebsite}
                                onChange={e => setLookupWebsite(e.target.value)}
                                placeholder="https://example.com"
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handleFind}
                            disabled={isFinding || !lookupWebsite}
                            className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isFinding ? (
                                <>
                                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    <span>Finding...</span>
                                </>
                            ) : (
                                <>
                                    <Search size={16} />
                                    <span>Find Vendor</span>
                                </>
                            )}
                        </button>
                        {findError && (
                            <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                {findError}
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Company Name</label>
                    <input
                        type="text"
                        value={companyName}
                        onChange={e => setCompanyName(e.target.value)}
                        placeholder="Company name"
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                    />
                </div>
                
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-2">Personal Name</h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First Name" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        <input value={middleName} onChange={e => setMiddleName(e.target.value)} placeholder="Middle Name" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last Name" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                    </div>
                </div>
                
                <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                    />
                </div>
                
                <div className="pt-4 border-t">
                    <p className="text-sm font-medium text-gray-700 mb-2">Password (Optional)</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                autoComplete="new-password"
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                autoComplete="new-password"
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">If left blank, a temporary password will be generated.</p>
                </div>
                
                <div>
                    <label className="block text-sm font-medium text-gray-700">Job Title</label>
                    <input
                        type="text"
                        value={jobTitle}
                        onChange={e => setJobTitle(e.target.value)}
                        placeholder="Job title"
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                    />
                </div>
                
                <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        rows={3}
                        placeholder="Company description"
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                    />
                </div>
                
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-2">Contact Methods</h4>
                    {contactMethods.map((method) => (
                        <div key={method.tempId} className="flex gap-2 mb-2 items-center">
                            <ContactMethodTypeInput value={method.method_type || ''} onChange={value => handleMethodChange(method.tempId, 'method_type', value)} className="w-1/3 block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                            <input type="text" value={method.value} onChange={e => handleMethodChange(method.tempId, 'value', e.target.value)} placeholder="Value" autoComplete="tel" name="contact-method-value" className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                            <button type="button" onClick={() => removeMethod(method.tempId)} className="p-2 text-red-500 hover:text-red-700"><Trash2 size={16}/></button>
                        </div>
                    ))}
                    <button type="button" onClick={addMethod} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 mt-2">
                        <PlusCircle size={16}/> Add Contact Method
                    </button>
                </div>
                
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-2">Services</h4>
                    <KeywordAutocomplete selectedKeywords={selectedKeywords} onKeywordsChange={setSelectedKeywords} />
                </div>
                
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-2">Service Areas</h4>
                    <div className="flex gap-2 mb-2 flex-wrap">
                        <select value={newAreaType} onChange={e => setNewAreaType(e.target.value)} className="block px-3 py-2 border border-gray-300 rounded-md shadow-sm">
                            <option value="zip_code">Zip Code</option>
                            <option value="city">City</option>
                            <option value="county">County</option>
                            <option value="state">State</option>
                            <option value="country">Country</option>
                            <option value="area">Area</option>
                        </select>
                        <input type="text" value={newAreaValue} onChange={e => setNewAreaValue(e.target.value)} placeholder="Value (e.g., Seattle, 98101, King County)" className="flex-grow block px-3 py-2 border border-gray-300 rounded-md shadow-sm min-w-[200px]"/>
                    </div>
                    <button type="button" onClick={addServiceArea} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 mb-2">
                        Add
                    </button>
                    {serviceAreas.length > 0 && (
                        <div className="space-y-1">
                            {serviceAreas.map((sa, idx) => (
                                editingServiceArea?.tempId === sa.tempId ? (
                                    <div key={sa.tempId} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                                        <select 
                                            value={editingServiceArea.area_type} 
                                            onChange={e => updateEditingServiceArea('area_type', e.target.value)}
                                            className="block px-2 py-1 text-sm border border-gray-300 rounded-md shadow-sm"
                                        >
                                            <option value="zip_code">Zip Code</option>
                                            <option value="city">City</option>
                                            <option value="county">County</option>
                                            <option value="state">State</option>
                                            <option value="country">Country</option>
                                            <option value="area">Area</option>
                                        </select>
                                        <input 
                                            type="text" 
                                            value={editingServiceArea.area_value} 
                                            onChange={e => updateEditingServiceArea('area_value', e.target.value)} 
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    saveServiceAreaEdit();
                                                }
                                            }}
                                            className="flex-grow block px-2 py-1 text-sm border border-gray-300 rounded-md shadow-sm"
                                            placeholder="Value"
                                        />
                                        <button type="button" onClick={saveServiceAreaEdit} className="text-green-600 hover:text-green-700">
                                            <Check size={14} />
                                        </button>
                                        <button type="button" onClick={cancelServiceAreaEdit} className="text-gray-500 hover:text-gray-700">
                                            <X size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <div key={sa.tempId} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                        <span className="text-sm">
                                            <span className="font-medium">{sa.area_type}:</span>{' '}
                                            {sa.area_value}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button type="button" onClick={() => editServiceArea(sa.tempId)} className="text-indigo-600 hover:text-indigo-700">
                                                <Pencil size={14} />
                                            </button>
                                            <button type="button" onClick={() => removeServiceArea(sa.tempId)} className="text-red-500 hover:text-red-700">
                                                <X size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )
                            ))}
                        </div>
                    )}
                </div>
                
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-2">Address (Optional)</h4>
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
                    <h4 className="text-md font-medium text-gray-800 mb-2">Business Hours (Optional)</h4>
                    <div className="space-y-2">
                        {hours.map((day) => (
                            <div key={day.day_of_week} className="flex items-center gap-2">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={!day.is_closed}
                                        onChange={e => handleHoursChange(day.day_of_week, 'is_closed', !e.target.checked)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="w-12 text-sm font-medium text-gray-700">{day.day_name}</span>
                                </label>
                                {!day.is_closed && (
                                    <>
                                        <select
                                            value={day.open_time}
                                            onChange={e => handleHoursChange(day.day_of_week, 'open_time', e.target.value)}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                                        >
                                            <option value="">Open</option>
                                            {generateTimeOptions().map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                        <span className="text-gray-500">to</span>
                                        <select
                                            value={day.close_time}
                                            onChange={e => handleHoursChange(day.day_of_week, 'close_time', e.target.value)}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                                        >
                                            <option value="">Close</option>
                                            {generateTimeOptions().map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="mt-4">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={availableForEmergencies}
                                onChange={e => setAvailableForEmergencies(e.target.checked)}
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm font-medium text-gray-700">Available for Emergencies</span>
                        </label>
                    </div>
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700">Business Hours Note</label>
                        <textarea
                            value={businessHoursNote}
                            onChange={e => setBusinessHoursNote(e.target.value)}
                            placeholder="e.g. Saturday/Sunday by appointment"
                            rows={2}
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>
                </div>
                
                </div>
                <div className="pt-4 mt-4 border-t flex flex-col gap-3">
                    {formError && (
                        <div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">
                            {formError}
                        </div>
                    )}
                    <div className="flex justify-end gap-3 flex-wrap">
                        <button 
                            type="button"
                            onClick={handleClear}
                            className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                        >
                            Clear
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSubmitting} 
                            className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {isSubmitting ? 'Adding...' : 'Add Vendor'}
                        </button>
                    </div>
                </div>
            </form>
        </Card>
    );
};

const EditVendorModal = ({ vendor, onClose, onUpdateSuccess }) => {
    const { user } = useContext(AuthContext);
    const [companyName, setCompanyName] = useState(vendor.company_name || vendor.vendor_name || '');
    const [firstName, setFirstName] = useState(vendor.first_name || '');
    const [middleName, setMiddleName] = useState(vendor.middle_name || '');
    const [lastName, setLastName] = useState(vendor.last_name || '');
    const [email, setEmail] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [jobTitle, setJobTitle] = useState(vendor.job_title || '');
    const [description, setDescription] = useState(vendor.description || '');
    const [contactMethods, setContactMethods] = useState([]);
    const [address, setAddress] = useState({
        address_line_1: vendor.address_line_1 || '',
        address_line_2: vendor.address_line_2 || '',
        city: vendor.city || '',
        state_province_region: vendor.state_province_region || '',
        postal_code: vendor.postal_code || '',
        country: vendor.country || ''
    });
    const [selectedKeywords, setSelectedKeywords] = useState((vendor.keywords || []).map(sanitizeKeywordRecord));
    const [serviceAreas, setServiceAreas] = useState([]);
    const [availableForEmergencies, setAvailableForEmergencies] = useState(false);
    const [businessHoursNote, setBusinessHoursNote] = useState(vendor.business_hours_note || '');
    const [hours, setHours] = useState([
        { day_of_week: 0, day_name: 'Sun', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 1, day_name: 'Mon', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 2, day_name: 'Tue', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 3, day_name: 'Wed', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 4, day_name: 'Thu', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 5, day_name: 'Fri', open_time: '', close_time: '', is_closed: false },
        { day_of_week: 6, day_name: 'Sat', open_time: '', close_time: '', is_closed: false }
    ]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    
    // Service area management
    const [newAreaType, setNewAreaType] = useState('city');
    const [newAreaValue, setNewAreaValue] = useState('');
    const [editingServiceArea, setEditingServiceArea] = useState(null);
    
    // Generate time options in 30-minute increments
    const generateTimeOptions = () => {
        const options = [];
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const timeString = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                const displayTime = hour === 0 
                    ? `12:${String(minute).padStart(2, '0')}am`
                    : hour < 12
                    ? `${hour}:${String(minute).padStart(2, '0')}am`
                    : hour === 12
                    ? `12:${String(minute).padStart(2, '0')}pm`
                    : `${hour - 12}:${String(minute).padStart(2, '0')}pm`;
                options.push({ value: timeString, label: displayTime });
            }
        }
        return options;
    };
    
    const timeOptions = useMemo(() => generateTimeOptions(), []);
    
    // Load existing data
    useEffect(() => {
        const loadVendorData = async () => {
            try {
                // Load vendor job_title and emergency availability
                const { data: vendorData } = await supabase
                    .from('vendors')
                    .select('job_title, available_for_emergencies, business_hours_note')
                    .eq('vendor_id', vendor.vendor_id)
                    .single();
                
                if (vendorData) {
                    setJobTitle(vendorData.job_title || '');
                    setAvailableForEmergencies(vendorData.available_for_emergencies || false);
                    setBusinessHoursNote(vendorData.business_hours_note || vendor.business_hours_note || '');
                }
                
                // Check if vendor already has contact methods loaded
                let methods = vendor.contact_methods || [];
                
                // Load contact
                const { data: contact, error: contactError } = await supabase
                    .from('contacts')
                    .select('contact_id, first_name, middle_name, last_name')
                    .eq('contactable_id', vendor.vendor_id)
                    .eq('contactable_type', 'vendor')
                    .maybeSingle();
                
                if (contactError && contactError.code !== 'PGRST116') {
                    console.error('Error loading contact:', contactError);
                }
                
                if (contact) {
                    setFirstName(contact.first_name || '');
                    setMiddleName(contact.middle_name || '');
                    setLastName(contact.last_name || '');
                    
                    // Load contact methods if not already loaded
                    if (!methods || methods.length === 0) {
                        const { data: fetchedMethods } = await supabase
                            .from('contact_methods')
                            .select('*')
                            .eq('contact_id', contact.contact_id);
                        
                        if (fetchedMethods) {
                            methods = fetchedMethods;
                        }
                    }
                }
                
                // Set contact methods and extract email
                if (methods && methods.length > 0) {
                    const emailMethod = methods.find(m => 
                        m.method_type?.toLowerCase() === 'email' || 
                        m.method_type?.toLowerCase().includes('email')
                    );
                    if (emailMethod) {
                        setEmail(emailMethod.value || '');
                    }
                    setContactMethods(methods.map(m => ({ ...m, tempId: m.method_id || Date.now() + Math.random() })));
                }
                
                // Load address
                const { data: addressData, error: addressError } = await supabase
                    .from('addresses')
                    .select('*')
                    .eq('addressable_id', vendor.vendor_id)
                    .eq('addressable_type', 'vendor')
                    .maybeSingle();
                
                if (addressError && addressError.code !== 'PGRST116') {
                    console.error('Error loading address:', addressError);
                }
                
                if (addressData) {
                    setAddress({
                        address_line_1: addressData.address_line_1 || '',
                        address_line_2: addressData.address_line_2 || '',
                        city: addressData.city || '',
                        state_province_region: normalizeStateAbbreviation(addressData.state_province_region || ''),
                        postal_code: addressData.postal_code || '',
                        country: addressData.country || ''
                    });
                }
                
                // Load service areas directly from database
                const { data: serviceAreasData, error: areasError } = await supabase
                    .from('vendor_service_areas')
                    .select('*')
                    .eq('vendor_id', vendor.vendor_id);
                
                if (areasError) {
                    console.error('Error loading service areas:', areasError);
                } else if (serviceAreasData && serviceAreasData.length > 0) {
                    setServiceAreas(serviceAreasData.map(sa => ({ ...sa, tempId: sa.service_area_id || Date.now() })));
                }
                
                // Load hours directly from database
                const { data: hoursData, error: hoursError } = await supabase
                    .from('vendor_hours')
                    .select('*')
                    .eq('vendor_id', vendor.vendor_id);
                
                if (hoursError) {
                    console.error('Error loading hours:', hoursError);
                } else if (hoursData && hoursData.length > 0) {
                    const hoursMap = {};
                    hoursData.forEach(h => {
                        hoursMap[h.day_of_week] = h;
                    });
                    
                    const defaultHours = [
                        { day_of_week: 0, day_name: 'Sun', open_time: '', close_time: '', is_closed: false },
                        { day_of_week: 1, day_name: 'Mon', open_time: '', close_time: '', is_closed: false },
                        { day_of_week: 2, day_name: 'Tue', open_time: '', close_time: '', is_closed: false },
                        { day_of_week: 3, day_name: 'Wed', open_time: '', close_time: '', is_closed: false },
                        { day_of_week: 4, day_name: 'Thu', open_time: '', close_time: '', is_closed: false },
                        { day_of_week: 5, day_name: 'Fri', open_time: '', close_time: '', is_closed: false },
                        { day_of_week: 6, day_name: 'Sat', open_time: '', close_time: '', is_closed: false }
                    ];
                    
                    setHours(defaultHours.map(day => {
                        const existing = hoursMap[day.day_of_week];
                        if (existing) {
                            return {
                                ...day,
                                open_time: normalizeTimeValue(existing.open_time),
                                close_time: normalizeTimeValue(existing.close_time),
                                is_closed: existing.is_closed || false
                            };
                        }
                        return day;
                    }));
                }
            } catch (err) {
                console.error('Error loading vendor data:', err);
            }
        };
        
        if (vendor && vendor.vendor_id) {
            loadVendorData();
        }
    }, [vendor.vendor_id]);
    
    const addServiceArea = () => {
        if (!newAreaValue.trim()) return;
        const trimmedValue = newAreaValue.trim();
        // Don't add state to city service areas - state can be inferred from property context
        const normalizedValue = trimmedValue;
        const isDuplicate = serviceAreas.some(sa => 
            sa.area_type === newAreaType && sa.area_value.toLowerCase() === normalizedValue.toLowerCase()
        );
        
        if (isDuplicate) {
            setFormError(`Service area "${newAreaType}: ${normalizedValue}" is already added.`);
            return;
        }
        
        setServiceAreas(prev => [...prev, { area_type: newAreaType, area_value: normalizedValue, tempId: Date.now() }]);
        setNewAreaValue('');
        setFormError('');
    };
    
    const removeServiceArea = (tempId) => {
        setServiceAreas(prev => prev.filter(sa => sa.tempId !== tempId));
    };
    
    const editServiceArea = (tempId) => {
        const area = serviceAreas.find(sa => sa.tempId === tempId);
        if (area) {
            setEditingServiceArea({ ...area });
        }
    };
    
    const saveServiceAreaEdit = () => {
        if (!editingServiceArea) return;
        setServiceAreas(serviceAreas.map(sa => 
            sa.tempId === editingServiceArea.tempId ? editingServiceArea : sa
        ));
        setEditingServiceArea(null);
    };
    
    const cancelServiceAreaEdit = () => {
        setEditingServiceArea(null);
    };
    
    const updateEditingServiceArea = (field, value) => {
        if (editingServiceArea) {
            setEditingServiceArea({ ...editingServiceArea, [field]: value });
        }
    };
    
    const handleMethodChange = (tempId, field, value) => {
        setContactMethods(prevMethods => 
            prevMethods.map(m => m.tempId === tempId ? { ...m, [field]: value } : m)
        );
    };
    
    const addMethod = () => {
        const newTempId = Date.now();
        setContactMethods(prev => [...prev, { method_type: '', value: '', tempId: newTempId }]);
        // Focus the new input field after state update
        setTimeout(() => {
            const input = contactMethodInputRefs.current[newTempId];
            if (input) {
                input.focus();
            }
        }, 0);
    };
    
    const removeMethod = (tempId) => {
        setContactMethods(prev => prev.filter(m => m.tempId !== tempId));
    };
    
    const handleHoursChange = (dayOfWeek, field, value) => {
        // Don't allow changing available_for_emergencies per day anymore
        if (field === 'available_for_emergencies') {
            return;
        }
        setHours(hours.map(h => 
            h.day_of_week === dayOfWeek ? { ...h, [field]: value } : h
        ));
    };
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        
        // Validation: Either company name or personal name required
        if (!companyName.trim() && !firstName.trim() && !lastName.trim()) {
            setFormError('Either company name or personal name (first/last) is required.');
            setIsSubmitting(false);
            return;
        }
        
        // Validate passwords match if provided
        if (newPassword && newPassword !== confirmPassword) {
            setFormError('Passwords do not match.');
            setIsSubmitting(false);
            return;
        }
        
        try {
            // Update or create user account if email provided
            if (email.trim()) {
                // Check if vendor has existing user account
                const { data: vendorData } = await supabase
                    .from('vendors')
                    .select('user_id')
                    .eq('vendor_id', vendor.vendor_id)
                    .single();
                
                if (vendorData?.user_id) {
                    // Update existing user account
                    const updateData = {
                        email: email.trim().toLowerCase()
                    };
                    
                    // Update password if provided
                    if (newPassword) {
                        const bcrypt = await import('bcryptjs');
                        const salt = await bcrypt.genSalt(10);
                        const passwordHash = await bcrypt.hash(newPassword, salt);
                        updateData.password_hash = passwordHash;
                    }
                    
                    const { error: userError } = await supabase
                        .from('users')
                        .update(updateData)
                        .eq('user_id', vendorData.user_id);
                    
                    if (userError) {
                        setFormError(userError.message || 'Failed to update user account.');
                        setIsSubmitting(false);
                        return;
                    }
                } else {
                    // Create new user account
                    const bcrypt = await import('bcryptjs');
                    const salt = await bcrypt.genSalt(10);
                    const passwordToUse = newPassword || 'temp_password_' + Math.random().toString(36).substring(7);
                    const passwordHash = await bcrypt.hash(passwordToUse, salt);
                    
                    const { data: userData, error: userError } = await supabase
                        .from('users')
                        .insert([{
                            email: email.trim().toLowerCase(),
                            password_hash: passwordHash,
                            role: 'vendor'
                        }])
                        .select('user_id')
                        .single();
                    
                    if (userError) {
                        setFormError(userError.message || 'Failed to create user account.');
                        setIsSubmitting(false);
                        return;
                    }
                    
                    // Link user to vendor
                    await supabase
                        .from('vendors')
                        .update({ user_id: userData.user_id })
                        .eq('vendor_id', vendor.vendor_id);
                }
            }
            
            // Update vendor record
            const { error: vendorError } = await supabase
                .from('vendors')
                .update({
                    company_name: companyName.trim() || null,
                    job_title: jobTitle.trim() || null,
                    description: description.trim() || null,
                    available_for_emergencies: availableForEmergencies,
                    business_hours_note: businessHoursNote.trim() || null
                })
                .eq('vendor_id', vendor.vendor_id);
            
            if (vendorError) {
                setFormError(vendorError.message || 'Failed to update vendor.');
                setIsSubmitting(false);
                return;
            }
            
            // Get or create contact
            let contactId = null;
            const { data: existingContact, error: contactCheckError } = await supabase
                .from('contacts')
                .select('contact_id')
                .eq('contactable_id', vendor.vendor_id)
                .eq('contactable_type', 'vendor')
                .maybeSingle();
            
            if (contactCheckError && contactCheckError.code !== 'PGRST116') {
                console.error('Error checking existing contact:', contactCheckError);
            }
            
            // Get or create contact (even if no name, we need it for contact methods)
            if (existingContact) {
                // Update existing contact
                await supabase
                    .from('contacts')
                    .update({
                        first_name: firstName.trim() || null,
                        middle_name: middleName.trim() || null,
                        last_name: lastName.trim() || null
                    })
                    .eq('contact_id', existingContact.contact_id);
                contactId = existingContact.contact_id;
            } else if (firstName.trim() || middleName.trim() || lastName.trim() || email.trim() || contactMethods.length > 0) {
                // Create new contact if we have names, email, or contact methods
                const { data: newContact } = await supabase
                    .from('contacts')
                    .insert([{
                        contactable_id: vendor.vendor_id,
                        contactable_type: 'vendor',
                        first_name: firstName.trim() || null,
                        middle_name: middleName.trim() || null,
                        last_name: lastName.trim() || null
                    }])
                    .select()
                    .single();
                contactId = newContact?.contact_id;
            }
            
            // Update contact methods (always, even if no name)
            if (contactId) {
                // Delete existing methods
                await supabase
                    .from('contact_methods')
                    .delete()
                    .eq('contact_id', contactId);
                
                // Insert new methods (including email if provided)
                const methodsToInsert = [];
                
                // Add email to contact methods if provided and not already in contactMethods
                if (email.trim() && !contactMethods.some(m => 
                    m.method_type?.toLowerCase() === 'email' || 
                    m.value?.toLowerCase() === email.trim().toLowerCase()
                )) {
                    methodsToInsert.push({
                        contact_id: contactId,
                        method_type: 'Email',
                        value: email.trim().toLowerCase()
                    });
                }
                
                // Add other contact methods
                const validMethods = contactMethods.filter(m => m.method_type && m.value);
                validMethods.forEach(m => {
                    methodsToInsert.push({
                        contact_id: contactId,
                        method_type: m.method_type,
                        value: m.value
                    });
                });
                
                if (methodsToInsert.length > 0) {
                    const { error: methodsError } = await supabase
                        .from('contact_methods')
                        .insert(methodsToInsert);
                    
                    if (methodsError) {
                        console.error('Error saving contact methods:', methodsError);
                    }
                }
            }
            
            // Remove contact only if no names AND no contact methods
            if (existingContact && !firstName.trim() && !middleName.trim() && !lastName.trim() && contactMethods.length === 0) {
                await supabase
                    .from('contacts')
                    .delete()
                    .eq('contact_id', existingContact.contact_id);
            }
            
            // Update address
            const hasAddressData = Object.values(address).some(v => v && v.trim());
            const { data: existingAddress, error: addressCheckError } = await supabase
                .from('addresses')
                .select('address_id')
                .eq('addressable_id', vendor.vendor_id)
                .eq('addressable_type', 'vendor')
                .maybeSingle();
            
            if (addressCheckError && addressCheckError.code !== 'PGRST116') {
                console.error('Error checking existing address:', addressCheckError);
            }
            
            if (hasAddressData) {
                if (existingAddress) {
                    const { error: updateError } = await supabase
                        .from('addresses')
                        .update(address)
                        .eq('address_id', existingAddress.address_id);
                    
                    if (updateError) {
                        console.error('Error updating address:', updateError);
                    }
                } else {
                    const { error: insertError } = await supabase
                        .from('addresses')
                        .insert([{
                            addressable_id: vendor.vendor_id,
                            addressable_type: 'vendor',
                            ...address
                        }]);
                    
                    if (insertError) {
                        console.error('Error inserting address:', insertError);
                    }
                }
            } else if (existingAddress) {
                const { error: deleteError } = await supabase
                    .from('addresses')
                    .delete()
                    .eq('address_id', existingAddress.address_id);
                
                if (deleteError) {
                    console.error('Error deleting address:', deleteError);
                }
            }
            
            // Update keywords - delete all and reinsert
            const { error: keywordsDeleteError } = await supabase
                .from('vendor_keywords')
                .delete()
                .eq('vendor_id', vendor.vendor_id);
            
            if (keywordsDeleteError) {
                console.error('Error deleting keywords:', keywordsDeleteError);
            }
            
            if (selectedKeywords.length > 0) {
                const { error: keywordsInsertError } = await supabase
                    .from('vendor_keywords')
                    .insert(selectedKeywords.map(k => ({
                        vendor_id: vendor.vendor_id,
                        keyword_id: k.keyword_id
                    })));
                
                if (keywordsInsertError) {
                    console.error('Error inserting keywords:', keywordsInsertError);
                }
            }
            
            // Update service areas - delete all and reinsert
            const { error: areasDeleteError } = await supabase
                .from('vendor_service_areas')
                .delete()
                .eq('vendor_id', vendor.vendor_id);
            
            if (areasDeleteError) {
                console.error('Error deleting service areas:', areasDeleteError);
            }
            
            if (serviceAreas.length > 0) {
                const { error: areasInsertError } = await supabase
                    .from('vendor_service_areas')
                    .insert(serviceAreas.map(sa => ({
                        vendor_id: vendor.vendor_id,
                        area_type: sa.area_type,
                        area_value: sa.area_value
                    })));
                
                if (areasInsertError) {
                    console.error('Error inserting service areas:', areasInsertError);
                }
            }
            
            // Update hours - delete all and reinsert
            const { error: hoursDeleteError } = await supabase
                .from('vendor_hours')
                .delete()
                .eq('vendor_id', vendor.vendor_id);
            
            if (hoursDeleteError) {
                console.error('Error deleting hours:', hoursDeleteError);
            }
            
            if (hours.length > 0) {
                const normalizedHours = hours.map(h => {
                    const normalizedOpen = normalizeTimeValue(h.open_time);
                    const normalizedClose = normalizeTimeValue(h.close_time);
                    const isClosed = h.is_closed || !normalizedOpen || !normalizedClose;
                    return {
                        vendor_id: vendor.vendor_id,
                        day_of_week: h.day_of_week,
                        open_time: isClosed ? null : normalizedOpen,
                        close_time: isClosed ? null : normalizedClose,
                        is_closed: isClosed,
                        available_for_emergencies: availableForEmergencies
                    };
                });
                
                const { error: hoursInsertError } = await supabase
                    .from('vendor_hours')
                    .insert(normalizedHours);
                
                if (hoursInsertError) {
                    console.error('Error inserting hours:', hoursInsertError);
                }
            }
            
            onUpdateSuccess();
        } catch (err) {
            setFormError('Could not connect to server.');
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
                className="w-full max-w-4xl bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col"
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-6 border-b">
                    <h2 className="text-xl font-bold text-gray-800">Edit Vendor</h2>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                    <form onSubmit={handleSubmit} className="space-y-4" id="edit-vendor-form">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Company Name</label>
                            <input
                                type="text"
                                value={companyName}
                                onChange={e => setCompanyName(e.target.value)}
                                placeholder="Company name"
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        
                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 mb-2">Personal Name</h4>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First Name" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                <input value={middleName} onChange={e => setMiddleName(e.target.value)} placeholder="Middle Name" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last Name" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="email@example.com"
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        
                        <div className="pt-4 border-t">
                            <p className="text-sm font-medium text-gray-700 mb-2">Reset Password (Optional)</p>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">New Password</label>
                                    <input
                                        type="password"
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        autoComplete="new-password"
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        autoComplete="new-password"
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    />
                                </div>
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Job Title</label>
                            <input
                                type="text"
                                value={jobTitle}
                                onChange={e => setJobTitle(e.target.value)}
                                placeholder="Job title"
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        
                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 mb-2">Contact Methods</h4>
                            {contactMethods.map((method) => (
                                <div key={method.tempId} className="flex gap-2 mb-2 items-center">
                                    <ContactMethodTypeInput value={method.method_type || ''} onChange={value => handleMethodChange(method.tempId, 'method_type', value)} className="w-1/3 block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                                    <input type="text" value={method.value} onChange={e => handleMethodChange(method.tempId, 'value', e.target.value)} placeholder="Value" autoComplete="tel" name="contact-method-value" className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                                    <button type="button" onClick={() => removeMethod(method.tempId)} className="p-2 text-red-500 hover:text-red-700"><Trash2 size={16}/></button>
                                </div>
                            ))}
                            <button type="button" onClick={addMethod} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 mt-2">
                                <PlusCircle size={16}/> Add Contact Method
                            </button>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Description</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Vendor description..."
                                rows={3}
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        
                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 mb-2">Address</h4>
                            <div className="space-y-2">
                                <input value={address.address_line_1} onChange={e => setAddress({...address, address_line_1: e.target.value})} placeholder="Address Line 1" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                <input value={address.address_line_2} onChange={e => setAddress({...address, address_line_2: e.target.value})} placeholder="Address Line 2" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <input value={address.city} onChange={e => setAddress({...address, city: e.target.value})} placeholder="City" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                    <input value={address.state_province_region} onChange={e => setAddress({...address, state_province_region: e.target.value})} placeholder="State / Province" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <input value={address.postal_code} onChange={e => setAddress({...address, postal_code: e.target.value})} placeholder="Postal Code" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                    <input value={address.country} onChange={e => setAddress({...address, country: e.target.value})} placeholder="Country" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                </div>
                            </div>
                        </div>
                        
                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 mb-2">Services</h4>
                            <KeywordAutocomplete selectedKeywords={selectedKeywords} onKeywordsChange={setSelectedKeywords} />
                        </div>
                        
                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 mb-2">Service Areas</h4>
                            <div className="flex gap-2 mb-2 flex-wrap">
                                <select value={newAreaType} onChange={e => setNewAreaType(e.target.value)} className="block px-3 py-2 border border-gray-300 rounded-md shadow-sm">
                                    <option value="zip_code">Zip Code</option>
                                    <option value="city">City</option>
                                    <option value="county">County</option>
                                    <option value="state">State</option>
                                    <option value="country">Country</option>
                                    <option value="area">Area</option>
                                </select>
                                <input type="text" value={newAreaValue} onChange={e => setNewAreaValue(e.target.value)} placeholder="Value (e.g., Seattle, 98101, King County)" className="flex-grow block px-3 py-2 border border-gray-300 rounded-md shadow-sm min-w-[200px]"/>
                            </div>
                            <button type="button" onClick={addServiceArea} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 mb-2">
                                Add
                            </button>
                            {serviceAreas.length > 0 && (
                                <div className="space-y-1">
                                    {serviceAreas.map((sa, idx) => (
                                        editingServiceArea?.tempId === sa.tempId ? (
                                            <div key={sa.tempId} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                                                <select 
                                                    value={editingServiceArea.area_type} 
                                                    onChange={e => updateEditingServiceArea('area_type', e.target.value)}
                                                    className="block px-2 py-1 text-sm border border-gray-300 rounded-md shadow-sm"
                                                >
                                                    <option value="zip_code">Zip Code</option>
                                                    <option value="city">City</option>
                                                    <option value="county">County</option>
                                                    <option value="state">State</option>
                                                    <option value="country">Country</option>
                                                    <option value="area">Area</option>
                                                </select>
                                                <input 
                                                    type="text" 
                                                    value={editingServiceArea.area_value} 
                                                    onChange={e => updateEditingServiceArea('area_value', e.target.value)} 
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            saveServiceAreaEdit();
                                                        }
                                                    }}
                                                    className="flex-grow block px-2 py-1 text-sm border border-gray-300 rounded-md shadow-sm"
                                                    placeholder="Value"
                                                />
                                                <button type="button" onClick={saveServiceAreaEdit} className="text-green-600 hover:text-green-700">
                                                    <Check size={14} />
                                                </button>
                                                <button type="button" onClick={cancelServiceAreaEdit} className="text-gray-500 hover:text-gray-700">
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div key={sa.tempId} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                                <span className="text-sm">
                                                    <span className="font-medium">{sa.area_type}:</span>{' '}
                                                    {sa.area_type === 'city'
                                                        ? ensureCityHasState(sa.area_value, vendor.state_province_region)
                                                        : sa.area_value}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <button type="button" onClick={() => editServiceArea(sa.tempId)} className="text-indigo-600 hover:text-indigo-700">
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button type="button" onClick={() => removeServiceArea(sa.tempId)} className="text-red-500 hover:text-red-700">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    ))}
                                </div>
                            )}
                        </div>
                        
                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 mb-2">Hours of Operation</h4>
                            <div className="space-y-2">
                                {hours.map(day => (
                                    <div key={day.day_of_week} className="flex items-center gap-2">
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={!day.is_closed}
                                                onChange={e => handleHoursChange(day.day_of_week, 'is_closed', !e.target.checked)}
                                                className="rounded"
                                            />
                                            <span className="w-12 text-sm font-medium">{day.day_name}</span>
                                        </label>
                                        {!day.is_closed && (
                                            <>
                                                <select
                                                    value={day.open_time}
                                                    onChange={e => handleHoursChange(day.day_of_week, 'open_time', e.target.value)}
                                                    className="flex-1 px-2 py-1 border border-gray-300 rounded-md text-sm"
                                                >
                                                    <option value="">Select time</option>
                                                    {timeOptions.map(option => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                                <span className="text-sm">to</span>
                                                <select
                                                    value={day.close_time}
                                                    onChange={e => handleHoursChange(day.day_of_week, 'close_time', e.target.value)}
                                                    className="flex-1 px-2 py-1 border border-gray-300 rounded-md text-sm"
                                                >
                                                    <option value="">Select time</option>
                                                    {timeOptions.map(option => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 pt-4 border-t">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={availableForEmergencies}
                                        onChange={e => setAvailableForEmergencies(e.target.checked)}
                                        className="rounded"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Available for Emergency Service</span>
                                </label>
                            </div>
                            <div className="mt-4">
                                <label className="block text-sm font-medium text-gray-700">Business Hours Note</label>
                                <textarea
                                    value={businessHoursNote}
                                    onChange={e => setBusinessHoursNote(e.target.value)}
                                    placeholder="e.g. Saturday/Sunday by appointment"
                                    rows={2}
                                    className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                />
                            </div>
                        </div>
                        
                        {formError && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{formError}</div>)}
                    </form>
                </div>
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" form="edit-vendor-form" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">
                            {isSubmitting ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ApproveVendorModal = ({ vendor, onClose, onApproveSuccess }) => {
    const { user } = useContext(AuthContext);

    // Existing approvals list
    const [existingApprovals, setExistingApprovals] = useState([]);
    const [isLoadingApprovals, setIsLoadingApprovals] = useState(true);
    const [approvalIdToDelete, setApprovalIdToDelete] = useState(null);

    // Form state (for adding or editing)
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [editingApproval, setEditingApproval] = useState(null);
    const [approvalLevel, setApprovalLevel] = useState('global');
    const [selectedPmCompany, setSelectedPmCompany] = useState(null);
    const [selectedLandlord, setSelectedLandlord] = useState(null);
    const [selectedProperty, setSelectedProperty] = useState(null);
    const [website, setWebsite] = useState('');
    const [scheduleLink, setScheduleLink] = useState('');
    const [schedulePhone, setSchedulePhone] = useState('');
    const [canEmergencyService, setCanEmergencyService] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    
    // Search state for dropdowns
    const [landlordSearchTerm, setLandlordSearchTerm] = useState('');
    const [showLandlordDropdown, setShowLandlordDropdown] = useState(false);
    const [propertySearchTerm, setPropertySearchTerm] = useState('');
    const [showPropertyDropdown, setShowPropertyDropdown] = useState(false);

    // Reference data
    const [pmCompanies, setPmCompanies] = useState([]);
    const [landlords, setLandlords] = useState([]);
    const [properties, setProperties] = useState([]);
    const [existingContactMethods, setExistingContactMethods] = useState([]);
    const [vendorOffersEmergency, setVendorOffersEmergency] = useState(false);
    
    // Reset form when vendor changes
    useEffect(() => {
        setIsFormVisible(false);
        setEditingApproval(null);
        setWebsite('');
        setScheduleLink('');
        setSchedulePhone('');
        setApprovalLevel('global');
        setSelectedPmCompany(null);
        setSelectedLandlord(null);
        setSelectedProperty(null);
        setLandlordSearchTerm('');
        setPropertySearchTerm('');
        setShowLandlordDropdown(false);
        setShowPropertyDropdown(false);
        setCanEmergencyService(false);
        setFormError('');
    }, [vendor?.vendor_id]);

    // Fetch existing approvals for this vendor
    const fetchApprovals = async () => {
        setIsLoadingApprovals(true);
        try {
            const { data, error } = await supabase
                .from('vendor_approvals')
                .select(`
                    approval_id,
                    approval_level,
                    approved_by_pmc_id,
                    approved_by_landlord_id,
                    approved_by_property_id,
                    can_emergency_service,
                    approved_at,
                    approved_by_user_id
                `)
                .eq('vendor_id', vendor.vendor_id)
                .order('approved_at', { ascending: false });

            if (error) throw error;
            setExistingApprovals(data || []);
        } catch (error) {
            console.error('Error fetching approvals:', error);
        } finally {
            setIsLoadingApprovals(false);
        }
    };
    
    // Fetch PM companies, landlords, properties, and vendor contact methods
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch PM companies
                const { data: companies } = await supabase
                    .from('pm_companies')
                    .select('*')
                    .order('company_name');
                setPmCompanies(companies || []);
                
                // Fetch landlords
                const { data: landlordsData } = await supabase
                    .from('landlords')
                    .select('landlord_id');
                const landlordIds = landlordsData?.map(l => l.landlord_id) || [];
                const { data: contacts } = await supabase
                    .from('contacts')
                    .select('*')
                    .in('contactable_id', landlordIds)
                    .eq('contactable_type', 'landlord');
                
                const enrichedLandlords = (landlordsData || []).map(landlord => {
                    const contact = contacts?.find(c => c.contactable_id === landlord.landlord_id);
                    const name = contact ? [contact.first_name, contact.middle_name, contact.last_name]
                        .filter(Boolean).join(' ') || 'Unknown' : 'Unknown';
                    return {
                        ...landlord,
                        name,
                        first_name: contact?.first_name || '',
                        middle_name: contact?.middle_name || '',
                        last_name: contact?.last_name || ''
                    };
                });
                setLandlords(enrichedLandlords);
                
                // Fetch properties
                const { data: propertiesData } = await supabase
                    .from('properties')
                    .select('property_id, property_type, property_name')
                    .order('property_type');
                setProperties(propertiesData || []);
                
                // Check if vendor already has contact methods loaded
                let methods = vendor.contact_methods || [];
                
                // If not, fetch vendor contact methods
                if (!methods || methods.length === 0) {
                    const { data: contact } = await supabase
                        .from('contacts')
                        .select('contact_id')
                        .eq('contactable_id', vendor.vendor_id)
                        .eq('contactable_type', 'vendor')
                        .maybeSingle();
                    
                    if (contact) {
                        const { data: fetchedMethods } = await supabase
                            .from('contact_methods')
                            .select('*')
                            .eq('contact_id', contact.contact_id);
                        methods = fetchedMethods || [];
                    }
                }
                
                setExistingContactMethods(methods || []);
                
                // Check if website, schedule link, or schedule phone already exist (with variations)
                const methodTypeLower = (m) => m.method_type?.toLowerCase() || '';
                const isUrl = (value) => value && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('www.'));
                
                const existingWebsite = methods?.find(m => {
                    const type = methodTypeLower(m);
                    return type.includes('website') || type === 'website';
                });
                const existingScheduleLink = methods?.find(m => {
                    const type = methodTypeLower(m);
                    const value = m.value || '';
                    // Match if it's a schedule link/url/web, OR if it's just "schedule" with a URL value
                    return (type.includes('schedule') && (type.includes('link') || type.includes('url') || type.includes('web'))) ||
                           (type === 'schedule' && isUrl(value));
                });
                const existingSchedulePhone = methods?.find(m => {
                    const type = methodTypeLower(m);
                    return (type.includes('schedule') && type.includes('phone')) || 
                           (type.includes('phone') && !type.includes('email'));
                });
                
                if (existingWebsite) setWebsite(existingWebsite.value);
                if (existingScheduleLink) setScheduleLink(existingScheduleLink.value);
                if (existingSchedulePhone) setSchedulePhone(existingSchedulePhone.value);
                
                // Check if vendor offers emergency services
                const { data: vendorData } = await supabase
                    .from('vendors')
                    .select('available_for_emergencies')
                    .eq('vendor_id', vendor.vendor_id)
                    .single();

                const offersEmergency = vendorData?.available_for_emergencies || false;
                setVendorOffersEmergency(offersEmergency);

                // Fetch existing approvals
                await fetchApprovals();
            } catch (error) {
                console.error('Error fetching data:', error);
            }
        };

        fetchData();
    }, [vendor.vendor_id]);

    // Filter landlords based on search term
    const filteredLandlords = useMemo(() => {
        if (!landlordSearchTerm.trim()) {
            return landlords;
        }
        
        const searchLower = landlordSearchTerm.toLowerCase();
        return landlords.filter(landlord => {
            const nameMatch = landlord.name?.toLowerCase().includes(searchLower);
            return nameMatch;
        });
    }, [landlords, landlordSearchTerm]);

    // Filter properties based on search term
    const filteredProperties = useMemo(() => {
        if (!propertySearchTerm.trim()) {
            return properties;
        }
        
        const searchLower = propertySearchTerm.toLowerCase();
        return properties.filter(property => {
            const nameMatch = property.property_name?.toLowerCase().includes(searchLower);
            const typeMatch = property.property_type?.toLowerCase().includes(searchLower);
            return nameMatch || typeMatch;
        });
    }, [properties, propertySearchTerm]);

    // Get selected landlord name for display
    const selectedLandlordName = useMemo(() => {
        if (!selectedLandlord) return '';
        const landlord = landlords.find(l => l.landlord_id === selectedLandlord);
        return landlord?.name || '';
    }, [landlords, selectedLandlord]);

    // Get selected property name for display
    const selectedPropertyName = useMemo(() => {
        if (!selectedProperty) return '';
        const property = properties.find(p => p.property_id === selectedProperty);
        return property?.property_name || property?.property_type || `Property ${property?.property_id}`;
    }, [properties, selectedProperty]);

    // Sync search terms with selected values when data loads
    useEffect(() => {
        if (selectedLandlord && landlords.length > 0 && !landlordSearchTerm) {
            const landlord = landlords.find(l => l.landlord_id === selectedLandlord);
            if (landlord) {
                setLandlordSearchTerm(landlord.name);
            }
        }
    }, [selectedLandlord, landlords, landlordSearchTerm]);

    useEffect(() => {
        if (selectedProperty && properties.length > 0 && !propertySearchTerm) {
            const property = properties.find(p => p.property_id === selectedProperty);
            if (property) {
                const displayName = property.property_name || property.property_type || `Property ${property.property_id}`;
                setPropertySearchTerm(displayName);
            }
        }
    }, [selectedProperty, properties, propertySearchTerm]);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (showLandlordDropdown && !event.target.closest('.landlord-dropdown')) {
                setShowLandlordDropdown(false);
            }
            if (showPropertyDropdown && !event.target.closest('.property-dropdown')) {
                setShowPropertyDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showLandlordDropdown, showPropertyDropdown]);
    
    // Helper functions
    const methodTypeLower = (m) => m.method_type?.toLowerCase() || '';
    const isUrl = (value) => value && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('www.'));
    
    // Get phone numbers from existing contact methods (check for variations)
    const phoneNumbers = useMemo(() => {
        const phones = existingContactMethods
            .filter(m => {
                const type = methodTypeLower(m);
                const value = (m.value || '').toString();
                
                // Check if method type indicates it's a phone number
                // Using includes() to match any phrase containing these words (e.g., "Cell Phone", "Mobile Number", "Phone", "Cell", etc.)
                const isPhoneType = type.includes('phone') || 
                                   type.includes('cell') || 
                                   type.includes('mobile') || 
                                   type.includes('telephone') ||
                                   type.includes('tel');
                
                // Also check if the value looks like a phone number (contains digits and phone-like characters)
                const hasDigits = /\d/.test(value);
                const looksLikePhone = hasDigits && (
                    value.includes('-') || 
                    value.includes('(') || 
                    value.includes(')') ||
                    value.includes(' ') ||
                    (value.replace(/\D/g, '').length >= 7) // At least 7 digits
                );
                
                // Include if it's a phone type (and not email) OR if it looks like a phone number
                const isPhone = (isPhoneType && !type.includes('email')) || 
                               (looksLikePhone && !type.includes('email') && !type.includes('website') && !type.includes('url'));
                
                return isPhone;
            })
            .map(m => ({ method_type: m.method_type || '', value: m.value || '' }))
            .filter(m => m.value);
        return phones;
    }, [existingContactMethods]);
    
    // Get website URLs from existing contact methods (check for variations)
    const websiteUrls = useMemo(() => {
        const websites = existingContactMethods
            .filter(m => {
                const type = methodTypeLower(m);
                const isWebsite = type.includes('website') || type === 'website';
                return isWebsite;
            })
            .map(m => ({ method_type: m.method_type || '', value: m.value || '' }))
            .filter(m => m.value);
        return websites;
    }, [existingContactMethods]);
    
    // Get schedule link URLs from existing contact methods (check for variations)
    const scheduleLinkUrls = useMemo(() => {
        const links = existingContactMethods
            .filter(m => {
                const type = methodTypeLower(m);
                const value = m.value || '';
                // Match if it's a schedule link/url/web, OR if it's just "schedule" with a URL value
                const isScheduleLink = (type.includes('schedule') && (type.includes('link') || type.includes('url') || type.includes('web'))) ||
                       (type === 'schedule' && isUrl(value));
                return isScheduleLink;
            })
            .map(m => ({ method_type: m.method_type || '', value: m.value || '' }))
            .filter(m => m.value);
        return links;
    }, [existingContactMethods]);

    // Check if a global approval exists
    const hasGlobalApproval = existingApprovals.some(a => a.approval_level === 'global');

    // Handler functions for approval management
    const handleAddNew = () => {
        setEditingApproval(null);
        setApprovalLevel('global');
        setSelectedPmCompany(null);
        setSelectedLandlord(null);
        setSelectedProperty(null);
        setLandlordSearchTerm('');
        setPropertySearchTerm('');
        setShowLandlordDropdown(false);
        setShowPropertyDropdown(false);
        setCanEmergencyService(false);
        setIsFormVisible(true);
        setFormError('');
    };

    const handleEdit = (approval) => {
        setEditingApproval(approval);
        setApprovalLevel(approval.approval_level);
        setSelectedPmCompany(approval.approved_by_pmc_id);
        setSelectedLandlord(approval.approved_by_landlord_id);
        setSelectedProperty(approval.approved_by_property_id);
        // Set search terms to display selected values
        if (approval.approved_by_landlord_id) {
            const landlord = landlords.find(l => l.landlord_id === approval.approved_by_landlord_id);
            setLandlordSearchTerm(landlord?.name || '');
        } else {
            setLandlordSearchTerm('');
        }
        if (approval.approved_by_property_id) {
            const property = properties.find(p => p.property_id === approval.approved_by_property_id);
            setPropertySearchTerm(property?.property_name || property?.property_type || `Property ${property?.property_id}` || '');
        } else {
            setPropertySearchTerm('');
        }
        setShowLandlordDropdown(false);
        setShowPropertyDropdown(false);
        setCanEmergencyService(approval.can_emergency_service);
        setIsFormVisible(true);
        setFormError('');
    };

    const handleDeleteClick = (approvalId) => {
        setApprovalIdToDelete(approvalId);
    };

    const handleDelete = async () => {
        if (!approvalIdToDelete) return;

        setIsSubmitting(true);
        setFormError('');
        try {
            const { error } = await supabase
                .from('vendor_approvals')
                .delete()
                .eq('approval_id', approvalIdToDelete);

            if (error) throw error;

            await fetchApprovals();
            onApproveSuccess();
            setApprovalIdToDelete(null);
        } catch (error) {
            console.error('Error deleting approval:', error);
            setFormError('Failed to delete approval: ' + (error.message || 'Unknown error'));
            setIsSubmitting(false);
            // Don't re-throw - let the error display in the UI
        }
    };

    const handleCancelForm = () => {
        setIsFormVisible(false);
        setEditingApproval(null);
        setLandlordSearchTerm('');
        setPropertySearchTerm('');
        setShowLandlordDropdown(false);
        setShowPropertyDropdown(false);
        setFormError('');
    };

    // Helper function to capitalize approval level tag
    const capitalizeApprovalLevel = (level) => {
        if (!level) return '';
        // Handle special case for PM Company (acronym)
        if (level === 'pm_company') return 'PM Company';
        return level
            .replace('_', ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    };

    // Helper function to get entity name for approval
    const getApprovalEntityName = (approval) => {
        if (approval.approval_level === 'global') {
            return 'Global';
        } else if (approval.approval_level === 'pm_company') {
            const pmc = pmCompanies.find(p => p.pmc_id === approval.approved_by_pmc_id);
            return pmc?.company_name || `PM Company #${approval.approved_by_pmc_id}`;
        } else if (approval.approval_level === 'landlord') {
            const landlord = landlords.find(l => l.landlord_id === approval.approved_by_landlord_id);
            if (landlord) {
                const first = landlord.first_name || '';
                const last = landlord.last_name || '';
                const middle = landlord.middle_name ? (landlord.middle_name.length === 1 ? ` ${landlord.middle_name}.` : ` ${landlord.middle_name.charAt(0)}.`) : '';
                const formatted = `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
                return formatted || landlord.name || `Landlord #${approval.approved_by_landlord_id}`;
            }
            return `Landlord #${approval.approved_by_landlord_id}`;
        } else if (approval.approval_level === 'property') {
            const property = properties.find(p => p.property_id === approval.approved_by_property_id);
            return property?.property_name || property?.property_type || `Property #${approval.approved_by_property_id}`;
        }
        return 'Unknown';
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');

        try {
            // Validation
            if (approvalLevel === 'pm_company' && !selectedPmCompany) {
                setFormError('Please select a PM Company');
                setIsSubmitting(false);
                return;
            }
            if (approvalLevel === 'landlord' && !selectedLandlord) {
                setFormError('Please select a Landlord');
                setIsSubmitting(false);
                return;
            }
            if (approvalLevel === 'property' && !selectedProperty) {
                setFormError('Please select a Property');
                setIsSubmitting(false);
                return;
            }

            // If adding a global approval and other approvals exist, confirm deletion
            if (approvalLevel === 'global' && !editingApproval && existingApprovals.length > 0) {
                const nonGlobalApprovals = existingApprovals.filter(a => a.approval_level !== 'global');
                if (nonGlobalApprovals.length > 0) {
                    const confirmMsg = `Adding a global approval will remove ${nonGlobalApprovals.length} existing lower-level approval(s). Continue?`;
                    if (!confirm(confirmMsg)) {
                        setIsSubmitting(false);
                        return;
                    }
                }
            }

            // Get contact for vendor
            let contactId = null;
            const { data: contact } = await supabase
                .from('contacts')
                .select('contact_id')
                .eq('contactable_id', vendor.vendor_id)
                .eq('contactable_type', 'vendor')
                .maybeSingle();

            if (!contact) {
                // Create contact if it doesn't exist
                const { data: newContact } = await supabase
                    .from('contacts')
                    .insert([{
                        contactable_id: vendor.vendor_id,
                        contactable_type: 'vendor'
                    }])
                    .select()
                    .single();
                contactId = newContact?.contact_id;
            } else {
                contactId = contact.contact_id;
            }

            // Update or create contact methods
            if (contactId) {
                const methodTypeLower = (m) => m.method_type?.toLowerCase() || '';
                const isUrl = (value) => value && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('www.'));

                // Website - delete all website variations, then insert standard one
                if (website.trim()) {
                    const websiteMethodIds = existingContactMethods
                        .filter(m => {
                            const methodId = m.method_id || m.method_id;
                            if (!methodId) return false;
                            const type = methodTypeLower(m);
                            return type.includes('website') || type === 'website';
                        })
                        .map(m => m.method_id || m.method_id);

                    if (websiteMethodIds.length > 0) {
                        await supabase
                            .from('contact_methods')
                            .delete()
                            .in('method_id', websiteMethodIds);
                    }

                    await supabase
                        .from('contact_methods')
                        .insert([{
                            contact_id: contactId,
                            method_type: 'Website',
                            value: website.trim()
                        }]);
                }

                // Schedule Link - delete all schedule link variations, then insert standard one
                if (scheduleLink.trim()) {
                    const scheduleLinkMethodIds = existingContactMethods
                        .filter(m => {
                            const methodId = m.method_id || m.method_id;
                            if (!methodId) return false;
                            const type = methodTypeLower(m);
                            const value = m.value || '';
                            return (type.includes('schedule') && (type.includes('link') || type.includes('url') || type.includes('web'))) ||
                                   (type === 'schedule' && isUrl(value));
                        })
                        .map(m => m.method_id || m.method_id);

                    if (scheduleLinkMethodIds.length > 0) {
                        await supabase
                            .from('contact_methods')
                            .delete()
                            .in('method_id', scheduleLinkMethodIds);
                    }

                    await supabase
                        .from('contact_methods')
                        .insert([{
                            contact_id: contactId,
                            method_type: 'Schedule Link',
                            value: scheduleLink.trim()
                        }]);
                }

                // Schedule Phone - delete all schedule phone variations, then insert standard one
                if (schedulePhone.trim()) {
                    const schedulePhoneMethodIds = existingContactMethods
                        .filter(m => {
                            const methodId = m.method_id || m.method_id;
                            if (!methodId) return false;
                            const type = methodTypeLower(m);
                            return (type.includes('schedule') && type.includes('phone')) ||
                                   (type.includes('phone') && !type.includes('email'));
                        })
                        .map(m => m.method_id || m.method_id);

                    if (schedulePhoneMethodIds.length > 0) {
                        await supabase
                            .from('contact_methods')
                            .delete()
                            .in('method_id', schedulePhoneMethodIds);
                    }

                    await supabase
                        .from('contact_methods')
                        .insert([{
                            contact_id: contactId,
                            method_type: 'Schedule Phone',
                            value: schedulePhone.trim()
                        }]);
                }
            }

            // Create or update approval record
            const approvalData = {
                vendor_id: vendor.vendor_id,
                approval_level: approvalLevel,
                can_emergency_service: canEmergencyService && vendorOffersEmergency,
                approved_by_user_id: user?.user_id || null
            };

            if (approvalLevel === 'pm_company' && selectedPmCompany) {
                approvalData.approved_by_pmc_id = selectedPmCompany;
            } else if (approvalLevel === 'landlord' && selectedLandlord) {
                approvalData.approved_by_landlord_id = selectedLandlord;
            } else if (approvalLevel === 'property' && selectedProperty) {
                approvalData.approved_by_property_id = selectedProperty;
            }

            let approvalError = null;
            if (editingApproval) {
                // Update existing approval
                const { error } = await supabase
                    .from('vendor_approvals')
                    .update(approvalData)
                    .eq('approval_id', editingApproval.approval_id);
                approvalError = error;
            } else {
                // Insert new approval
                const { error } = await supabase
                    .from('vendor_approvals')
                    .insert([approvalData]);
                approvalError = error;

                // If adding global approval, delete all other approvals
                if (!approvalError && approvalLevel === 'global') {
                    const nonGlobalApprovals = existingApprovals.filter(a => a.approval_level !== 'global');
                    if (nonGlobalApprovals.length > 0) {
                        const idsToDelete = nonGlobalApprovals.map(a => a.approval_id);
                        await supabase
                            .from('vendor_approvals')
                            .delete()
                            .in('approval_id', idsToDelete);
                    }
                }
            }

            if (approvalError) {
                setFormError(approvalError.message || 'Failed to save approval.');
                setIsSubmitting(false);
                return;
            }

            // Refresh approvals list and hide form
            await fetchApprovals();
            setIsFormVisible(false);
            setEditingApproval(null);
            onApproveSuccess();
        } catch (err) {
            console.error('Error saving approval:', err);
            setFormError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const [isDragging, setIsDragging] = useState(false);
    
    const handleBackdropClick = (e) => {
        // Prevent closing on backdrop click - only close via buttons
        e.stopPropagation();
    };

    const handleModalMouseDown = (e) => {
        e.stopPropagation();
    };
    
    return (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div
                className="w-full max-w-3xl bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col"
                onMouseDown={handleModalMouseDown}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-6 border-b">
                    <h2 className="text-xl font-bold text-gray-800">
                        Vendor Approvals - {formatVendorName(vendor)}
                    </h2>
                    <button onClick={onClose}>
                        <X size={24} className="text-gray-400 hover:text-gray-600" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {/* Loading state */}
                    {isLoadingApprovals && (
                        <div className="text-center py-8 text-gray-500">
                            Loading approvals...
                        </div>
                    )}

                    {/* Approvals list view */}
                    {!isLoadingApprovals && !isFormVisible && (
                        <div className="space-y-4">
                            {/* Global approval notice */}
                            {hasGlobalApproval && (
                                <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                                    <div className="flex items-center gap-2 text-green-800 font-medium">
                                        <CheckCircle size={20} />
                                        <span>This vendor is approved globally</span>
                                    </div>
                                </div>
                            )}

                            {/* Existing approvals */}
                            {existingApprovals.length > 0 ? (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-700 mb-3">
                                        Current Approvals ({existingApprovals.length})
                                    </h3>
                                    <div className="space-y-2">
                                        {existingApprovals.map((approval) => (
                                            <div
                                                key={approval.approval_id}
                                                className="flex items-center justify-between p-4 border border-gray-200 rounded-md bg-gray-50"
                                            >
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-gray-900">
                                                            {getApprovalEntityName(approval)}
                                                        </span>
                                                        <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                                                            {capitalizeApprovalLevel(approval.approval_level)}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                                                        <span>
                                                            {new Date(approval.approved_at).toLocaleDateString()}
                                                        </span>
                                                        {approval.can_emergency_service && (
                                                            <span className="flex items-center gap-1 text-orange-600">
                                                                <AlertCircle size={14} />
                                                                Emergency approved
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleEdit(approval)}
                                                        className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                                                        title="Edit approval"
                                                    >
                                                        <Pencil size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteClick(approval.approval_id)}
                                                        className="p-2 text-red-600 hover:bg-red-50 rounded"
                                                        title="Delete approval"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-8 text-gray-500">
                                    No approvals yet. Click "Add Approval" to create one.
                                </div>
                            )}

                            {/* Add new approval button */}
                            {!hasGlobalApproval && (
                                <button
                                    onClick={handleAddNew}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-green-700 bg-green-50 border border-green-300 rounded-md hover:bg-green-100"
                                >
                                    <PlusCircle size={18} />
                                    Add Approval
                                </button>
                            )}
                        </div>
                    )}

                    {/* Form view (add or edit) */}
                    {!isLoadingApprovals && isFormVisible && (
                        <form onSubmit={handleSubmit} className="space-y-4" id="approve-vendor-form">
                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
                                {editingApproval ? 'Editing approval' : 'Adding new approval'}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700">Approval Level</label>
                                <select
                                    value={approvalLevel}
                                    onChange={e => {
                                        setApprovalLevel(e.target.value);
                                        setSelectedPmCompany(null);
                                        setSelectedLandlord(null);
                                        setSelectedProperty(null);
                                        setLandlordSearchTerm('');
                                        setPropertySearchTerm('');
                                        setShowLandlordDropdown(false);
                                        setShowPropertyDropdown(false);
                                    }}
                                    disabled={editingApproval !== null}
                                    className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm disabled:bg-gray-100"
                                >
                                    <option value="global">Global</option>
                                    <option value="pm_company">PM Company</option>
                                    <option value="landlord">Landlord</option>
                                    <option value="property">Property</option>
                                </select>
                            </div>

                            {approvalLevel === 'pm_company' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">PM Company</label>
                                    <select
                                        value={selectedPmCompany || ''}
                                        onChange={e => setSelectedPmCompany(e.target.value ? parseInt(e.target.value) : null)}
                                        disabled={editingApproval !== null}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm disabled:bg-gray-100"
                                    >
                                        <option value="">Select PM Company</option>
                                        {pmCompanies.map(pmc => (
                                            <option key={pmc.pmc_id} value={pmc.pmc_id}>{pmc.company_name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {approvalLevel === 'landlord' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Landlord</label>
                                    <div className="relative landlord-dropdown">
                                        <input
                                            type="text"
                                            placeholder="Search landlords by name..."
                                            value={landlordSearchTerm}
                                            onChange={(e) => {
                                                setLandlordSearchTerm(e.target.value);
                                                setShowLandlordDropdown(true);
                                                if (!e.target.value) {
                                                    setSelectedLandlord(null);
                                                }
                                            }}
                                            onFocus={() => setShowLandlordDropdown(true)}
                                            disabled={editingApproval !== null}
                                            className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                                        />
                                        {showLandlordDropdown && !editingApproval && (
                                            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto overflow-x-hidden">
                                                {filteredLandlords.length === 0 ? (
                                                    <div className="px-3 py-2 text-sm text-gray-500">No landlords found</div>
                                                ) : (
                                                    filteredLandlords.map(landlord => (
                                                        <button
                                                            key={landlord.landlord_id}
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedLandlord(landlord.landlord_id);
                                                                setLandlordSearchTerm(landlord.name);
                                                                setShowLandlordDropdown(false);
                                                            }}
                                                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none min-w-0"
                                                        >
                                                            <div className="truncate">{landlord.name}</div>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {selectedLandlord && (
                                        <div className="mt-1 text-sm text-gray-600">
                                            Selected: {selectedLandlordName}
                                        </div>
                                    )}
                                </div>
                            )}

                            {approvalLevel === 'property' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Property</label>
                                    <div className="relative property-dropdown">
                                        <input
                                            type="text"
                                            placeholder="Search properties by name or type..."
                                            value={propertySearchTerm}
                                            onChange={(e) => {
                                                setPropertySearchTerm(e.target.value);
                                                setShowPropertyDropdown(true);
                                                if (!e.target.value) {
                                                    setSelectedProperty(null);
                                                }
                                            }}
                                            onFocus={() => setShowPropertyDropdown(true)}
                                            disabled={editingApproval !== null}
                                            className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                                        />
                                        {showPropertyDropdown && !editingApproval && (
                                            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto overflow-x-hidden">
                                                {filteredProperties.length === 0 ? (
                                                    <div className="px-3 py-2 text-sm text-gray-500">No properties found</div>
                                                ) : (
                                                    filteredProperties.map(property => {
                                                        const displayName = property.property_name || property.property_type || `Property ${property.property_id}`;
                                                        return (
                                                            <button
                                                                key={property.property_id}
                                                                type="button"
                                                                onClick={() => {
                                                                    setSelectedProperty(property.property_id);
                                                                    setPropertySearchTerm(displayName);
                                                                    setShowPropertyDropdown(false);
                                                                }}
                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none min-w-0"
                                                            >
                                                                <div className="truncate">{displayName}</div>
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {selectedProperty && (
                                        <div className="mt-1 text-sm text-gray-600">
                                            Selected: {selectedPropertyName}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700">Website</label>
                                {websiteUrls.length > 0 && (
                                    <select
                                        value={websiteUrls.some(item => item.value === website) ? website : ''}
                                        onChange={e => setWebsite(e.target.value)}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select from list</option>
                                        {websiteUrls.map((item, idx) => (
                                            <option key={idx} value={item.value}>{item.method_type}: {item.value}</option>
                                        ))}
                                    </select>
                                )}
                                <input
                                    type="url"
                                    value={website}
                                    onChange={e => setWebsite(e.target.value)}
                                    placeholder={websiteUrls.length > 0 ? "Or enter a new website URL" : "https://example.com"}
                                    className={`block w-full px-3 py-2 ${websiteUrls.length > 0 ? 'mt-2' : 'mt-1'} border border-gray-300 rounded-md shadow-sm`}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700">Scheduling Web Link</label>
                                {scheduleLinkUrls.length > 0 && (
                                    <select
                                        value={scheduleLinkUrls.some(item => item.value === scheduleLink) ? scheduleLink : ''}
                                        onChange={e => setScheduleLink(e.target.value)}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select from list</option>
                                        {scheduleLinkUrls.map((item, idx) => (
                                            <option key={idx} value={item.value}>{item.method_type}: {item.value}</option>
                                        ))}
                                    </select>
                                )}
                                <input
                                    type="url"
                                    value={scheduleLink}
                                    onChange={e => setScheduleLink(e.target.value)}
                                    placeholder={scheduleLinkUrls.length > 0 ? "Or enter a new scheduling web link" : "https://schedule.example.com"}
                                    className={`block w-full px-3 py-2 ${scheduleLinkUrls.length > 0 ? 'mt-2' : 'mt-1'} border border-gray-300 rounded-md shadow-sm`}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700">Scheduling Phone</label>
                                {phoneNumbers.length > 0 && (
                                    <select
                                        value={phoneNumbers.some(item => item.value === schedulePhone) ? schedulePhone : ''}
                                        onChange={e => setSchedulePhone(e.target.value)}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select from list</option>
                                        {phoneNumbers.map((item, idx) => (
                                            <option key={idx} value={item.value}>{item.method_type}: {item.value}</option>
                                        ))}
                                    </select>
                                )}
                                <input
                                    type="tel"
                                    value={schedulePhone}
                                    onChange={e => setSchedulePhone(e.target.value)}
                                    placeholder={phoneNumbers.length > 0 ? "Or enter a new phone number" : "Enter phone number"}
                                    className={`block w-full px-3 py-2 ${phoneNumbers.length > 0 ? 'mt-2' : 'mt-1'} border border-gray-300 rounded-md shadow-sm`}
                                />
                            </div>

                            <div>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={canEmergencyService}
                                        onChange={e => setCanEmergencyService(e.target.checked)}
                                        disabled={!vendorOffersEmergency}
                                        className="rounded"
                                    />
                                    <span className={`text-sm font-medium ${!vendorOffersEmergency ? 'text-gray-400' : 'text-gray-700'}`}>
                                        Manager/Landlord approved for emergency service
                                    </span>
                                </label>
                                {!vendorOffersEmergency && (
                                    <p className="text-xs text-gray-500 mt-1 ml-6">Vendor does not offer emergency services</p>
                                )}
                            </div>

                            {formError && (
                                <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                    {formError}
                                </div>
                            )}
                        </form>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    {isFormVisible ? (
                        <div className="flex justify-end gap-4">
                            <button
                                type="button"
                                onClick={handleCancelForm}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="approve-vendor-form"
                                disabled={isSubmitting}
                                className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 disabled:opacity-50"
                            >
                                {isSubmitting ? 'Saving...' : editingApproval ? 'Update Approval' : 'Add Approval'}
                            </button>
                        </div>
                    ) : (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                            >
                                Close
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            <ConfirmationModal
                isOpen={!!approvalIdToDelete}
                onClose={() => setApprovalIdToDelete(null)}
                onConfirm={handleDelete}
                title="Delete Approval"
                message="Are you sure you want to delete this approval? This action cannot be undone."
                confirmText="Delete"
                cancelText="Cancel"
                isDestructive={true}
                isLoading={isSubmitting}
            />
        </div>
    );
};


