import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react';
import { UserPlus, Pencil, Trash2, X, ArrowUpDown, Home, PlusCircle, Edit, Trash, Search, FileText, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card } from '../components/ui';
import { useSortableData } from '../hooks';
import { useFinderLimit } from '../hooks/useFinderLimit';
import { useFormPersistence } from '../hooks/useFormPersistence';
import DateInput from '../components/DateInput';
import SSNInput from '../components/SSNInput';
import DocumentManagement from '../components/DocumentManagement';
import ArchiveModal from '../components/ArchiveModal';
import { deleteWithAudit, updateWithAudit, insertWithAudit } from '../lib/auditHelpers.js';
import ContactMethodTypeInput from '../components/ContactMethodTypeInput';

// Utility function for formatting tenant names
const formatTenantName = (t) => {
    const first = t.contact?.first_name || '';
    const last = t.contact?.last_name || '';
    const middle = t.contact?.middle_name ? ` ${t.contact.middle_name.charAt(0)}.` : '';
    const name = `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
    // Return email as fallback if no name, or "Unknown" if no contact at all
    if (!name || name === ',') {
        return t.email || 'Unknown Tenant';
    }
    return name;
};

// Utility function for formatting tenant recap for hover tooltip
const formatTenantRecap = (t) => {
    const parts = [];
    
    // Name
    const first = t.contact?.first_name || '';
    const middle = t.contact?.middle_name || '';
    const last = t.contact?.last_name || '';
    if (first || middle || last) {
        const nameParts = [first, middle, last].filter(Boolean);
        if (nameParts.length > 0) {
            parts.push(`Name: ${nameParts.join(' ')}`);
        }
    }
    
    // Email
    if (t.email) {
        parts.push(`Email: ${t.email}`);
    }
    
    // Date of Birth
    if (t.date_of_birth) {
        const dob = formatDate(t.date_of_birth);
        if (dob) {
            parts.push(`Date of Birth: ${dob}`);
        }
    }
    
    // SSN
    if (t.social_security_number) {
        parts.push(`SSN: ${t.social_security_number}`);
    }
    
    // Gender
    if (t.gender) {
        parts.push(`Gender: ${t.gender}`);
    }
    
    // Contact Methods (excluding email)
    const contactMethods = (t.contact_methods || []).filter(m => 
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

// Utility function for formatting dates
const formatDate = (dateString) => {
    if (!dateString) return '';
    // Handle date-only strings (YYYY-MM-DD) by parsing as local date to avoid timezone issues
    if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
};

// Utility function for formatting dates for HTML date inputs (yyyy-MM-dd)
const formatDateForInput = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
};

// Utility function for formatting unit address
const formatUnitAddress = (unit) => {
    if (!unit) return 'N/A';
    
    // Get address from the property_address field
    const address = unit.property_address;
    if (!address) {
        return `Unit ${unit.unit_number} - No Address`;
    }
    
    const addressParts = [
        address.address_line_1,
        address.address_line_2,
        address.city,
        address.state_province_region
    ].filter(Boolean);
    
    const addressString = addressParts.join(', ');
    return `Unit ${unit.unit_number} - ${addressString}`;
};

// This is the main component for the Tenants page
export default function TenantsPage() {
    const { user } = useContext(AuthContext);
    const [tenants, setTenants] = useState([]);
    const [units, setUnits] = useState([]);
    const [editingTenant, setEditingTenant] = useState(null);
    const [deletingTenant, setDeletingTenant] = useState(null);
    const [managingUnitsFor, setManagingUnitsFor] = useState(null);
    const [reviewingDocumentsFor, setReviewingDocumentsFor] = useState(null);
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
    
    // Filter tenants based on search term
    const filteredTenants = useMemo(() => {
        if (!tenants || !Array.isArray(tenants)) {
            return [];
        }
        if (!debouncedSearchTerm.trim()) {
            return tenants;
        }
        
        const searchLower = debouncedSearchTerm.toLowerCase();
        return tenants.filter(tenant => {
            // Search in basic tenant fields
            const nameMatch = [
                tenant.contact?.first_name,
                tenant.contact?.last_name,
                tenant.contact?.middle_name,
                tenant.email,
                tenant.date_of_birth,
                tenant.social_security_number,
                tenant.gender
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            // Search in address fields
            const addressMatch = [
                tenant.address_line_1,
                tenant.city,
                tenant.state_province_region,
                tenant.unit_number
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            // Search in contact methods
            const contactMatch = tenant.contact_methods && tenant.contact_methods.some(method => 
                method.value && method.value.toLowerCase().includes(searchLower)
            );
            
            return nameMatch || addressMatch || contactMatch;
        });
    }, [tenants, debouncedSearchTerm]);
    const { items: sortedTenants, requestSort, sortConfig } = useSortableData(filteredTenants, { key: 'name', direction: 'ascending' });
    const { visibleCount: tenantVisibleCount, hasMore: hasMoreTenants, showMore: showMoreTenants } = useFinderLimit(
        sortedTenants.length,
        [debouncedSearchTerm, tenants.length]
    );
    const displayedTenants = sortedTenants.slice(0, tenantVisibleCount || sortedTenants.length);
    const fetchData = async () => {
        try {
            // Fetch users, contacts, clients, client_units, units, addresses, and contact methods separately
            // Tenants = clients with unit assignments in client_units (any start_date, as long as not archived and not ended)
            // This includes approved applicants with future start dates (approved tenants-to-be)
            // Users should have role = 'client'
            // client_units shows which units tenants occupy (from applications, leases, or direct assignment)
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
            const clientsQuery = supabase.from('clients').select('*');
            if (!showArchived) {
                clientsQuery.eq('is_archived', false);
            }
            
            const [usersResult, contactsResult, clientsResult, clientUnitsResult, unitsResult, addressesResult, contactMethodsResult] = await Promise.all([
                supabase.from('users').select('*').eq('role', 'client'),
                supabase.from('contacts').select('*').eq('contactable_type', 'client'),
                clientsQuery,
                // Get all non-archived client_units assignments (active, future, or past but not ended)
                // This includes approved applicants who haven't started yet (future start_date)
                supabase.from('client_units').select(`
                    client_id,
                    unit_id,
                    application_id,
                    lease_id,
                    assignment_type,
                    assigned_at,
                    start_date,
                    end_date
                `).eq('is_archived', false)
                    .or(`end_date.is.null,end_date.gte.${today}`),
                supabase.from('units').select('*'),
                supabase.from('addresses').select('*').eq('addressable_type', 'property'),
                supabase.from('contact_methods').select('method_id, method_type, value, contact_id, contacts!inner(contactable_id, contactable_type)').eq('contacts.contactable_type', 'client')
            ]);
            
            if (usersResult.error) {
                console.error('Error fetching users:', usersResult.error);
                setTenants([]);
            } else if (contactsResult.error) {
                console.error('Error fetching contacts:', contactsResult.error);
                setTenants([]);
            } else if (clientsResult.error) {
                console.error('Error fetching clients:', clientsResult.error);
                setTenants([]);
            } else if (addressesResult.error) {
                console.error('Error fetching addresses:', addressesResult.error);
                setTenants([]);
            } else if (contactMethodsResult.error) {
                console.error('Error fetching contact methods:', contactMethodsResult.error);
                setTenants([]);
            } else {
                // Join users with their contacts, tenant data, client_units, and contact methods
                const users = usersResult.data || [];
                const contacts = contactsResult.data || [];
                const allClients = clientsResult.data || [];
                // Handle client_units query error gracefully - continue with empty array if it fails
                const activeClientUnits = clientUnitsResult.error ? [] : (clientUnitsResult.data || []);
                if (clientUnitsResult.error) {
                    console.error('Error fetching client units:', clientUnitsResult.error);
                    // Continue anyway - tenants can still be displayed without units
                }
                const addresses = addressesResult.data || [];
                const contactMethods = contactMethodsResult.data || [];
                
                // Get set of client_ids that have unit assignments (active, future, or past but not ended)
                // These are tenants (or approved tenants-to-be with future start dates)
                const clientsWithAssignments = new Set(
                    activeClientUnits.map(cu => cu.client_id)
                );
                
                // Filter to only clients with assignments (tenants, including future start dates)
                const tenantRecords = allClients.filter(cr => clientsWithAssignments.has(cr.client_id));
                
                // Fetch all leases and applications for all tenants in batch queries
                const tenantClientIds = tenantRecords.map(cr => cr.client_id).filter(Boolean);
                let allLeasesData = [];
                let allApplicationsData = [];
                if (tenantClientIds.length > 0) {
                    const [leasesResult, applicationsResult] = await Promise.all([
                        supabase
                            .from('lease_clients')
                            .select(`
                                client_id,
                                lease_id,
                                leases!inner(
                                    lease_id,
                                    start_date,
                                    end_date,
                                    status,
                                    unit_id
                                )
                            `)
                            .in('client_id', tenantClientIds),
                        supabase
                            .from('client_applications')
                            .select('application_id, client_id, unit_id, status')
                            .in('client_id', tenantClientIds)
                    ]);
                    
                    if (leasesResult?.data) {
                        allLeasesData = leasesResult.data;
                    }
                    if (applicationsResult?.data) {
                        allApplicationsData = applicationsResult.data;
                    }
                }
                
                // Match tenant records (clients with active unit assignments) to users
                // tenantRecords are actually client records from the clients table
                const tenantsWithContacts = tenantRecords
                    .map(clientRecord => {
                        // Find the user for this tenant/client
                        const user = users.find(u => u.user_id === clientRecord.user_id);
                        if (!user) {
                            // No user account - skip this tenant
                            return null;
                        }
                        
                        // Map client record to tenant record structure for compatibility
                        // client_id maps to tenant_id in the tenants view
                        const tenantRecord = {
                            tenant_id: clientRecord.client_id, // Map client_id to tenant_id
                            user_id: clientRecord.user_id,
                            status: clientRecord.status,
                            risk_tier: clientRecord.risk_tier,
                            date_of_birth: clientRecord.date_of_birth,
                            social_security_number: clientRecord.social_security_number,
                            gender: clientRecord.gender,
                            document_data: clientRecord.document_data,
                            profile_data: clientRecord.profile_data,
                            created_at: clientRecord.created_at,
                            updated_at: clientRecord.updated_at,
                            is_archived: clientRecord.is_archived,
                            archived_at: clientRecord.archived_at,
                            archived_by_user_id: clientRecord.archived_by_user_id,
                            archive_reason: clientRecord.archive_reason
                        };
                        
                        return { user, tenantRecord };
                    })
                    .filter(Boolean) // Remove null entries
                    .map(({ user, tenantRecord }) => {
                    // Find contact for this tenant (following landlords pattern)
                    const contact = tenantRecord 
                        ? contacts.find(c => c.contactable_id === user.user_id && c.contactable_type === 'client')
                        : null;
                    
                    // Get contact methods for this tenant's contact
                    const tenantContactMethods = contact
                        ? contactMethods
                            .filter(cm => cm.contact_id === contact.contact_id)
                            .map(cm => ({
                                method_id: cm.method_id,
                                method_type: cm.method_type,
                                value: cm.value
                            }))
                        : [];
                    
                    // Find client_units for this tenant
                    const tenantClientUnits = tenantRecord 
                        ? activeClientUnits.filter(cu => cu.client_id === tenantRecord.tenant_id)
                        : [];
                    
                    // Fetch additional data for client_units (units, leases, applications)
                    // Join units data
                    const tenantUnitsWithData = tenantClientUnits.map(cu => {
                        const unit = (unitsResult.data || []).find(u => u.unit_id === cu.unit_id);
                        return { ...cu, unit };
                    });
                    
                    // Filter to show units where application_id is NULL or application is approved
                    // For now, show all units (we'll filter by application status later if needed)
                    const validTenantUnits = tenantUnitsWithData;
                    
                    // Get lease data for this tenant (look for lease first, then assignment)
                    let leaseData = null;
                    let lease_start_date = null;
                    let lease_end_date = null;
                    
                    if (tenantRecord) {
                        // Find leases for this tenant from the batch we fetched
                        const tenantLeases = allLeasesData.filter(lc => lc.client_id === tenantRecord.tenant_id);
                        
                        if (tenantLeases.length > 0) {
                            // Find active lease first, then any lease
                            const activeLease = tenantLeases.find(lc => lc.leases?.status === 'active');
                            const leaseToUse = activeLease || tenantLeases[0];
                            
                            if (leaseToUse?.leases) {
                                leaseData = leaseToUse.leases;
                                lease_start_date = leaseData.start_date;
                                lease_end_date = leaseData.end_date;
                            }
                        }
                        
                        // If no lease found, check client_units for assignment dates
                        if (!leaseData && validTenantUnits.length > 0) {
                            const unitWithDates = validTenantUnits.find(cu => cu.start_date || cu.end_date);
                            if (unitWithDates) {
                                lease_start_date = unitWithDates.start_date;
                                lease_end_date = unitWithDates.end_date;
                            }
                        }
                    }
                    
                    // Find the primary unit (prefer unit with lease, then any)
                    let primaryUnit = null;
                    let leaseStatus = 'None';
                    let address_line_1 = null;
                    let unit_number = null;
                    
                    if (validTenantUnits.length > 0) {
                        // Prefer unit with lease_id
                        const unitWithLease = validTenantUnits.find(cu => cu.lease_id);
                        
                        if (unitWithLease) {
                            primaryUnit = unitWithLease;
                            if (leaseData) {
                                leaseStatus = leaseData.status === 'active' ? 'Active' : 
                                             leaseData.status === 'future' ? 'Future' : 
                                             leaseData.status === 'expired' ? 'Ended' : 
                                             leaseData.status === 'terminated' ? 'Ended' : 'Leased';
                            } else {
                                leaseStatus = 'Leased';
                            }
                        } else {
                            // Use first available unit
                            primaryUnit = validTenantUnits[0];
                            if (primaryUnit.application_id) {
                                // Check if the application is approved
                                const application = allApplicationsData.find(
                                    app => app.application_id === primaryUnit.application_id
                                );
                                if (application && application.status === 'approved') {
                                    leaseStatus = 'Approved';
                                } else {
                                    leaseStatus = 'Applied';
                                }
                            } else {
                                leaseStatus = 'Assigned';
                            }
                        }
                        
                        if (primaryUnit && primaryUnit.unit) {
                            const unit = primaryUnit.unit;
                            unit_number = unit.unit_number;
                            
                            // Find address for this property
                            const propertyAddress = addresses.find(addr => 
                                addr.addressable_id === unit.property_id && 
                                addr.addressable_type === 'property'
                            );
                            if (propertyAddress) {
                                address_line_1 = propertyAddress.address_line_1;
                            }
                        }
                    }
                    
                    return {
                        ...user,
                        ...tenantRecord,
                        contact: contact || null,
                        contact_methods: tenantContactMethods,
                        date_of_birth: tenantRecord?.date_of_birth,
                        social_security_number: tenantRecord?.social_security_number,
                        gender: tenantRecord?.gender,
                        address_line_1,
                        unit_number,
                        lease_status: leaseStatus,
                        lease_start_date,
                        lease_end_date
                    };
                });
                
                setTenants(tenantsWithContacts);
            }
            
            if (unitsResult.error) {
                console.error('Error fetching units:', unitsResult.error);
                setUnits([]);
            } else {
                // Join units with their property addresses
                const unitsWithAddresses = (unitsResult.data || []).map(unit => {
                    const propertyAddress = (addressesResult.data || []).find(
                        addr => addr.addressable_id === unit.property_id && addr.addressable_type === 'property'
                    );
                    return {
                        ...unit,
                        property_address: propertyAddress
                    };
                });
                setUnits(unitsWithAddresses);
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            setTenants([]);
            setUnits([]);
        }
    };

    useEffect(() => {
        if (user) fetchData();
    }, [user, showArchived]);

    const handleSuccess = () => {
        setEditingTenant(null);
        setDeletingTenant(null);
        setManagingUnitsFor(null);
        fetchData(); // This will refresh the tenant list with current assignments
    };

    const handleRestore = async (clientId) => {
        try {
            const { error } = await supabase.rpc('restore_entity', {
                p_table_name: 'clients',
                p_entity_id: clientId,
                p_restored_by_user_id: user.user_id
            });
            
            if (error) {
                console.error('Error restoring tenant:', error);
                alert('Failed to restore tenant: ' + error.message);
            } else {
                fetchData();
            }
        } catch (err) {
            console.error('Error restoring tenant:', err);
            alert('Could not connect to the server.');
        }
    };

    const getSortIndicator = (name) => {
        if (!sortConfig || sortConfig.key !== name) return <ArrowUpDown size={14} className="ml-2 text-gray-400"/>;
        return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
    };

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Tenants</h2>
            <div className="finder-split">
                <CreateTenantForm units={units} onTenantCreated={handleSuccess} />
                <Card
                    title="Tenant Search"
                    className="max-h-[calc(100vh-160px)]"
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
                                    placeholder="Search tenants by name, email, phone, address, or employer..."
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
                                sortedTenants.length === 0 ? (
                                    <span className="text-red-600">No tenants found matching "{debouncedSearchTerm}"</span>
                                ) : (
                                    <span>Showing {sortedTenants.length} of {tenants.length} tenants</span>
                                )
                            ) : (
                                <span>Showing {tenants.length} of {tenants.length} tenants</span>
                            )}
                        </div>
                    </div>
                    <div className="flex-1 overflow-hidden rounded-lg border border-gray-200">
                        <div className="overflow-auto h-full max-w-full">
                        <table className="finder-list w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">Actions</th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase"><button onClick={() => requestSort('name')} className="flex items-center">Name {getSortIndicator('name')}</button></th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase"><button onClick={() => requestSort('contact')} className="flex items-center">Contact {getSortIndicator('contact')}</button></th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase"><button onClick={() => requestSort('property')}>Property / Unit {getSortIndicator('property')}</button></th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase"><button onClick={() => requestSort('lease_status')}>Lease Status {getSortIndicator('lease_status')}</button></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {displayedTenants.map(t => (
                                    <tr key={t.user_id} className={t.is_archived ? 'opacity-60 italic' : ''}>
                                        <td className="px-1.5 py-2 text-left whitespace-nowrap">
                                            <div className="flex items-center space-x-4">
                                                {!t.is_archived && (
                                                    <>
                                                        <div className="relative group" onMouseEnter={(e) => {
                                                            const tooltip = e.currentTarget.querySelector('.tooltip-content');
                                                            if (tooltip) {
                                                                const rect = e.currentTarget.getBoundingClientRect();
                                                                const viewportHeight = window.innerHeight;
                                                                const spaceBelow = viewportHeight - rect.bottom;
                                                                const tooltipHeight = 200; // Estimated tooltip height
                                                                if (spaceBelow < tooltipHeight + 20) {
                                                                    tooltip.classList.add('bottom-full', 'mb-2');
                                                                    tooltip.classList.remove('top-full', 'mt-2');
                                                                } else {
                                                                    tooltip.classList.add('top-full', 'mt-2');
                                                                    tooltip.classList.remove('bottom-full', 'mb-2');
                                                                }
                                                            }
                                                        }}>
                                                            <button onClick={() => setEditingTenant(t)} className="text-indigo-600 hover:text-indigo-900" title="Edit Tenant"><Pencil size={16}/></button>
                                                            <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                                <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                                    {formatTenantRecap(t)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button onClick={() => setReviewingDocumentsFor(t)} className="text-blue-600 hover:text-blue-900" title="Review Documents"><FileText size={16}/></button>
                                                        <button onClick={() => setManagingUnitsFor(t)} className="text-gray-500 hover:text-indigo-600" title="Assign Unit"><Home size={16}/></button>
                                                    </>
                                                )}
                                                {t.is_archived && showArchived && (
                                                    <button onClick={() => handleRestore(t.tenant_id)} className="text-green-600 hover:text-green-900" title="Restore Tenant"><RotateCcw size={16}/></button>
                                                )}
                                                <button onClick={() => setDeletingTenant(t)} className="text-red-600 hover:text-red-900" title="Archive Tenant"><Trash2 size={16}/></button>
                                            </div>
                                        </td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">
                                            <div className="relative group inline-block" onMouseEnter={(e) => {
                                                const tooltip = e.currentTarget.querySelector('.tooltip-content');
                                                if (tooltip) {
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    const viewportHeight = window.innerHeight;
                                                    const spaceBelow = viewportHeight - rect.bottom;
                                                    const tooltipHeight = 200; // Estimated tooltip height
                                                    if (spaceBelow < tooltipHeight + 20) {
                                                        tooltip.classList.add('bottom-full', 'mb-2');
                                                        tooltip.classList.remove('top-full', 'mt-2');
                                                    } else {
                                                        tooltip.classList.add('top-full', 'mt-2');
                                                        tooltip.classList.remove('bottom-full', 'mb-2');
                                                    }
                                                }
                                            }}>
                                                {t.is_archived && (
                                                    <span className="inline-flex items-center px-2 py-1 rounded-full finder-secondary bg-gray-100 text-gray-600 mr-2">Archived</span>
                                                )}
                                                <span className="cursor-help">{formatTenantName(t)}</span>
                                                <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                    <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                        {formatTenantRecap(t)}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-1.5 py-2">
                                            <div className="space-y-1">
                                                {t.email && (
                                                    <div>
                                                        Email: {t.email}
                                                    </div>
                                                )}
                                                {t.contact_methods && t.contact_methods.length > 0 && (
                                                    <>
                                                        {t.contact_methods.slice(0, t.email ? 1 : 2).map((method, idx) => (
                                                            <div key={idx} className={t.email ? 'finder-secondary text-gray-500' : ''}>
                                                                {method.method_type}: {method.value}
                                                            </div>
                                                        ))}
                                                        {t.contact_methods.length > (t.email ? 1 : 2) && (
                                                            <div className="finder-secondary text-gray-400">+{t.contact_methods.length - (t.email ? 1 : 2)} more</div>
                                                        )}
                                                    </>
                                                )}
                                                {!t.email && (!t.contact_methods || t.contact_methods.length === 0) && (
                                                    <span className="text-gray-400">No contact methods</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">{t.address_line_1 ? `${t.address_line_1}${t.unit_number ? `, Unit ${t.unit_number}` : ''}` : 'None'}</td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">
                                            {(() => {
                                                const formatDate = (dateStr) => {
                                                    if (!dateStr) return null;
                                                    // Parse date string (YYYY-MM-DD) directly to avoid timezone issues
                                                    // Split the date string and create a date in local timezone
                                                    const parts = dateStr.split('-');
                                                    if (parts.length === 3) {
                                                        const year = parseInt(parts[0], 10);
                                                        const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
                                                        const day = parseInt(parts[2], 10);
                                                        const date = new Date(year, month, day);
                                                        return date.toLocaleDateString();
                                                    }
                                                    // Fallback to original method if format is unexpected
                                                    return new Date(dateStr).toLocaleDateString();
                                                };
                                                
                                                const startDate = formatDate(t.lease_start_date);
                                                const endDate = formatDate(t.lease_end_date);
                                                const dateRange = startDate 
                                                    ? (endDate ? `${startDate} - ${endDate}` : `${startDate} - Ongoing`)
                                                    : null;
                                                
                                                if (t.lease_status === 'Future') {
                                                    return (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                                                            Future{dateRange ? ` - ${dateRange}` : ''}
                                                        </span>
                                                    );
                                                } else if (t.lease_status === 'Active') {
                                                    return (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-100 text-green-800">
                                                            Active{dateRange ? ` - ${dateRange}` : ''}
                                                        </span>
                                                    );
                                                } else if (t.lease_status === 'Ended') {
                                                    return (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-red-100 text-red-800">
                                                            Ended{dateRange ? ` - ${dateRange}` : ''}
                                                        </span>
                                                    );
                                                } else if (t.lease_status === 'Leased') {
                                                    return (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-indigo-100 text-indigo-800">
                                                            Leased{dateRange ? ` - ${dateRange}` : ''}
                                                        </span>
                                                    );
                                                } else if (t.lease_status === 'Assigned') {
                                                    return (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-yellow-100 text-yellow-800">
                                                            Assigned{dateRange ? ` - ${dateRange}` : ''}
                                                        </span>
                                                    );
                                                } else if (t.lease_status === 'Applied') {
                                                    return (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-purple-100 text-purple-800">
                                                            Applied{dateRange ? ` - ${dateRange}` : ''}
                                                        </span>
                                                    );
                                                } else if (t.lease_status === 'Approved') {
                                                    return (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-100 text-green-800">
                                                            Approved{dateRange ? ` - ${dateRange}` : ''}
                                                        </span>
                                                    );
                                                } else {
                                                    return (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-800">
                                                            {t.lease_status || 'None'}
                                                        </span>
                                                    );
                                                }
                                            })()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                    </div>
                    {hasMoreTenants && (
                        <div className="pt-3 mt-4 border-t text-right flex-shrink-0">
                            <button
                                type="button"
                                onClick={showMoreTenants}
                                className="text-indigo-600 hover:text-indigo-800 underline text-sm font-medium"
                            >
                                more
                            </button>
                        </div>
                    )}
                    </div>
                </Card>
            </div>
            {/* Modals for editing and deleting would be added here */}
            {editingTenant && <EditTenantModal tenant={editingTenant} onClose={() => setEditingTenant(null)} onUpdateSuccess={handleSuccess} />}
            {deletingTenant && (
                <ArchiveModal 
                    entity={deletingTenant}
                    entityType="client"
                    entityName={formatTenantName(deletingTenant)}
                    idField="tenant_id"
                    onClose={() => setDeletingTenant(null)}
                    onArchiveSuccess={handleSuccess}
                    showCascade={false}
                    requireReason={false}
                    isAdmin={user?.role === 'global_admin'}
                />
            )}
            {reviewingDocumentsFor && (
                <TenantDocumentsModal 
                    tenant={reviewingDocumentsFor} 
                    onClose={() => setReviewingDocumentsFor(null)} 
                />
            )}
            {managingUnitsFor && (
                <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={(e) => { e.stopPropagation(); }}>
                    <div className="w-full max-w-4xl bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
                            <h2 className="text-xl font-bold text-gray-800">Assign Unit for {formatTenantName(managingUnitsFor)}</h2>
                            <button onClick={() => setManagingUnitsFor(null)}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
                        </div>
                        {/* Scrollable Body */}
                        <div className="flex-1 overflow-y-auto p-6">
                            <AssignUnitForm tenant={managingUnitsFor} units={units} onAssignmentSuccess={handleSuccess} />
                        </div>
                        {/* Footer */}
                        <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end flex-shrink-0">
                            <button 
                                type="button" 
                                onClick={() => setManagingUnitsFor(null)} 
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const CreateTenantForm = ({ units, onTenantCreated }) => {
    const { user } = useContext(AuthContext);
    const [firstName, setFirstName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [contactMethods, setContactMethods] = useState([]);
    const [dateOfBirth, setDateOfBirth] = useState('');
    const [socialSecurityNumber, setSocialSecurityNumber] = useState('');
    const [gender, setGender] = useState('');
    const [selectedUnitId, setSelectedUnitId] = useState('');
    const [unitStartDate, setUnitStartDate] = useState('');
    const [unitEndDate, setUnitEndDate] = useState('');
    const [unitSearchTerm, setUnitSearchTerm] = useState('');
    const [showUnitDropdown, setShowUnitDropdown] = useState(false);
    const [selectedUnit, setSelectedUnit] = useState(null);
    const [unitFilter, setUnitFilter] = useState('all'); // 'all', 'unoccupied', 'occupied'
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const contactMethodInputRefs = useRef({});
    const formBodyRef = useRef(null);

    // Form persistence
    const { clearPersistedData } = useFormPersistence('add-tenant', {
        firstName, middleName, lastName, email, password, confirmPassword, contactMethods, dateOfBirth, socialSecurityNumber, gender, selectedUnitId, unitStartDate, unitEndDate, unitFilter
    }, (state) => {
        setFirstName(state.firstName || '');
        setMiddleName(state.middleName || '');
        setLastName(state.lastName || '');
        setEmail(state.email || '');
        setPassword(state.password || '');
        setConfirmPassword(state.confirmPassword || '');
        setContactMethods(state.contactMethods || []);
        setDateOfBirth(state.dateOfBirth || '');
        setSocialSecurityNumber(state.socialSecurityNumber || '');
        setGender(state.gender || '');
        setSelectedUnitId(state.selectedUnitId || '');
        setUnitStartDate(state.unitStartDate || '');
        setUnitEndDate(state.unitEndDate || '');
        setUnitFilter(state.unitFilter || 'all');
    });

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
    
    // Get occupied unit IDs from client_units
    const [occupiedUnitIds, setOccupiedUnitIds] = useState(new Set());
    
    useEffect(() => {
        const fetchOccupiedUnits = async () => {
            try {
                const today = new Date().toISOString().split('T')[0];
                const { data: clientUnits } = await supabase
                    .from('client_units')
                    .select('unit_id')
                    .eq('is_archived', false)
                    .lte('start_date', today)
                    .or(`end_date.is.null,end_date.gte.${today}`);
                
                if (clientUnits) {
                    setOccupiedUnitIds(new Set(clientUnits.map(cu => cu.unit_id)));
                }
            } catch (error) {
                console.error('Error fetching occupied units:', error);
            }
        };
        
        if (units.length > 0) {
            fetchOccupiedUnits();
        }
    }, [units]);
    
    // Filter units based on search term and filter
    const filteredUnits = useMemo(() => {
        if (!units || !Array.isArray(units)) return [];
        
        let filtered = units;
        
        // Apply occupancy filter
        if (unitFilter === 'unoccupied') {
            filtered = filtered.filter(unit => !occupiedUnitIds.has(unit.unit_id));
        } else if (unitFilter === 'occupied') {
            filtered = filtered.filter(unit => occupiedUnitIds.has(unit.unit_id));
        }
        
        // Apply search filter
        if (unitSearchTerm.trim()) {
            const searchLower = unitSearchTerm.toLowerCase();
            filtered = filtered.filter(unit => {
                const unitNumber = unit.unit_number?.toString().toLowerCase() || '';
                const address = unit.property_address;
                const addressLine1 = address?.address_line_1?.toLowerCase() || '';
                const city = address?.city?.toLowerCase() || '';
                const state = address?.state_province_region?.toLowerCase() || '';
                
                return unitNumber.includes(searchLower) ||
                       addressLine1.includes(searchLower) ||
                       city.includes(searchLower) ||
                       state.includes(searchLower);
            });
        }
        
        return filtered;
    }, [units, unitSearchTerm, unitFilter, occupiedUnitIds]);
    
    // Click outside to close dropdown
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (showUnitDropdown && !event.target.closest('.unit-search-dropdown')) {
                setShowUnitDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showUnitDropdown]);
    
    const handleUnitSelect = (unit) => {
        setSelectedUnit(unit);
        setSelectedUnitId(unit.unit_id);
        setUnitSearchTerm(formatUnitAddress(unit));
        setShowUnitDropdown(false);
    };

    const resetForm = useCallback(() => {
        setFirstName(''); 
        setMiddleName(''); 
        setLastName(''); 
        setEmail(''); 
        setPassword(''); 
        setConfirmPassword(''); 
        setContactMethods([]);
        setDateOfBirth(''); 
        setSocialSecurityNumber(''); 
        setGender('');
        setSelectedUnitId('');
        setUnitStartDate('');
        setUnitEndDate('');
        setUnitSearchTerm('');
        setSelectedUnit(null);
        setUnitFilter('all');
        setShowUnitDropdown(false);
        setFormError('');
        clearPersistedData();
    }, [clearPersistedData]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        
        // Validate unit is selected
        if (!selectedUnitId) {
            setFormError('Please select a unit.');
            setIsSubmitting(false);
            return;
        }
        
        // Validate passwords match
        if (password !== confirmPassword) {
            setFormError('Passwords do not match.');
            setIsSubmitting(false);
            return;
        }
        try {
            const payload = { 
                firstName, middleName, lastName, email, password,
                date_of_birth: dateOfBirth || null,
                social_security_number: socialSecurityNumber || null,
                gender: gender || null
            };
            // Hash password
            const bcrypt = await import('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(payload.password, salt);
            
            // Create user account
            // Users should have role = 'client'
            const { data: userData, error: userError } = await supabase
                .from('users')
                .insert([{
                    email: payload.email,
                    password_hash: passwordHash,
                    role: 'client'
                }])
                .select()
                .single();
            
            if (userError) {
                setFormError(userError.message || 'Failed to create user account.');
                return;
            }
            
            // Create client record
            const { data: clientData, error: clientError } = await supabase
                .from('clients')
                .insert([{
                    user_id: userData.user_id,
                    status: 'active',
                    date_of_birth: payload.date_of_birth || null,
                    social_security_number: payload.social_security_number || null,
                    gender: payload.gender || null
                }])
                .select()
                .single();
            
            if (clientError) {
                // Clean up user if client creation fails
                await deleteWithAudit('users', 'user_id', userData.user_id, user?.user_id);
                setFormError(clientError.message || 'Failed to create client record.');
                return;
            }
            
            // Create contact record (use user_id as contactable_id for consistency with applicants)
            const { error: contactError } = await supabase
                .from('contacts')
                .insert([{
                    contactable_id: userData.user_id,
                    contactable_type: 'client',
                    first_name: payload.firstName,
                    middle_name: payload.middleName,
                    last_name: payload.lastName
                }]);
            
            if (contactError) {
                // Clean up user and client if contact creation fails
                await deleteWithAudit('clients', 'client_id', clientData.client_id, user?.user_id);
                await deleteWithAudit('users', 'user_id', userData.user_id, user?.user_id);
                setFormError(contactError.message || 'Failed to create contact record.');
                return;
            }
            
            // Add contact methods if provided
            const validContactMethods = contactMethods.filter(m => m.type && m.value && m.type.toLowerCase() !== 'email');
            if (validContactMethods.length > 0) {
                // Get the contact_id for the client
                const { data: contactData } = await supabase
                    .from('contacts')
                    .select('contact_id')
                    .eq('contactable_id', userData.user_id)
                    .eq('contactable_type', 'client')
                    .single();
                
                if (contactData) {
                    const contactMethodsToInsert = validContactMethods.map(method => ({
                        contact_id: contactData.contact_id,
                        method_type: method.type,
                        value: method.value
                    }));
                    
                    const { error: contactMethodsError } = await supabase
                        .from('contact_methods')
                        .insert(contactMethodsToInsert);
                    
                    if (contactMethodsError) {
                        console.error('Error inserting contact methods:', contactMethodsError);
                        setFormError(contactMethodsError.message || 'Failed to add contact methods.');
                        return;
                    }
                }
            }
            
            // Create client_units record to mark as tenant (not applicant)
            // This ensures they appear on the Tenants page
            // selectedUnitId is required, so this should always execute
            const startDate = unitStartDate || new Date().toISOString().split('T')[0]; // Use provided start date or today
            const { error: clientUnitError } = await supabase
                .from('client_units')
                .insert([{
                    client_id: clientData.client_id,
                    unit_id: parseInt(selectedUnitId),
                    assignment_type: 'direct',
                    start_date: startDate,
                    end_date: unitEndDate || null
                }]);
            
            if (clientUnitError) {
                console.error('Error creating client_units entry:', clientUnitError);
                setFormError(clientUnitError.message || 'Failed to assign unit to tenant.');
                setIsSubmitting(false);
                return;
            }
            
            resetForm();
            onTenantCreated();
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
        <Card hideTitle className="max-h-[calc(100vh-160px)]" contentClassName="h-full">
            <form onSubmit={handleCreate} className="flex flex-col h-full" autoComplete="off">
                <div className="flex items-start justify-between pb-4 mb-4 border-b">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Add Tenant</h2>
                    </div>
                </div>
                <div ref={formBodyRef} className="flex-1 overflow-y-auto pr-1 space-y-4">
                <h4 className="font-medium text-gray-800 border-b pb-2">Tenant Information</h4>
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
                <div><label className="block text-sm font-medium text-gray-700">Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="off" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/></div>
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
                <div><label className="block text-sm font-medium text-gray-700">Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/></div>
                <div><label className="block text-sm font-medium text-gray-700">Confirm Password</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/></div>

                <h4 className="font-medium text-gray-800 border-b pb-2 mt-6">Unit Assignment</h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <DateInput 
                            label="Start Date" 
                            value={unitStartDate} 
                            onChange={e => setUnitStartDate(e.target.value)} 
                            required
                        />
                    </div>
                    <div>
                        <DateInput 
                            label="End Date (Optional)" 
                            value={unitEndDate} 
                            onChange={e => setUnitEndDate(e.target.value)} 
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Unit <span className="text-red-500">*</span></label>
                    <div className="space-y-2">
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="radio"
                                    name="unitFilter"
                                    value="all"
                                    checked={unitFilter === 'all'}
                                    onChange={e => setUnitFilter(e.target.value)}
                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>All Units</span>
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="radio"
                                    name="unitFilter"
                                    value="unoccupied"
                                    checked={unitFilter === 'unoccupied'}
                                    onChange={e => setUnitFilter(e.target.value)}
                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>Unoccupied Units</span>
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="radio"
                                    name="unitFilter"
                                    value="occupied"
                                    checked={unitFilter === 'occupied'}
                                    onChange={e => setUnitFilter(e.target.value)}
                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>Occupied Units</span>
                            </label>
                        </div>
                        <div className="relative unit-search-dropdown">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                                type="text"
                                value={unitSearchTerm}
                                onChange={e => {
                                    setUnitSearchTerm(e.target.value);
                                    setShowUnitDropdown(true);
                                    if (!e.target.value.trim()) {
                                        setSelectedUnit(null);
                                        setSelectedUnitId('');
                                    }
                                }}
                                onFocus={() => setShowUnitDropdown(true)}
                                placeholder="Search for unit by number or address..."
                                className={`block w-full pl-10 pr-3 py-2 border rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 ${!selectedUnitId ? 'border-red-300' : 'border-gray-300'}`}
                            />
                            {!selectedUnitId && unitSearchTerm && (
                                <p className="text-xs text-red-600 mt-1">Please select a unit from the dropdown</p>
                            )}
                            {showUnitDropdown && filteredUnits.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto finder-list">
                                    {filteredUnits.slice(0, 20).map(unit => (
                                        <div
                                            key={unit.unit_id}
                                            onClick={() => handleUnitSelect(unit)}
                                            className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                        >
                                            <div className="text-gray-900">{formatUnitAddress(unit)}</div>
                                            {occupiedUnitIds.has(unit.unit_id) && (
                                                <div className="finder-secondary text-orange-600 mt-1">Occupied</div>
                                            )}
                                        </div>
                                    ))}
                                    {filteredUnits.length > 20 && (
                                        <div className="p-2 text-xs text-gray-500 text-center border-t">
                                            Showing first 20 of {filteredUnits.length} units
                                        </div>
                                    )}
                                </div>
                            )}
                            {showUnitDropdown && filteredUnits.length === 0 && unitSearchTerm && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-3 text-sm text-gray-500">
                                    No units found matching "{unitSearchTerm}"
                                </div>
                            )}
                        </div>
                        {selectedUnit && (
                            <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded border">
                                Selected: {formatUnitAddress(selectedUnit)}
                            </div>
                        )}
                        <p className="text-xs text-gray-500">Selecting a unit ensures the tenant appears on the Tenants page</p>
                    </div>
                </div>

                <h4 className="font-medium text-gray-800 border-b pb-2 mt-6">Additional Information (Optional)</h4>
                <DateInput 
                    label="Date of Birth" 
                    value={dateOfBirth} 
                    onChange={e => setDateOfBirth(e.target.value)} 
                    maxDate={new Date()} 
                />
                <SSNInput 
                    label="Social Security Number" 
                    value={socialSecurityNumber} 
                    onChange={e => setSocialSecurityNumber(e.target.value)} 
                />
                <div><label className="block text-sm font-medium text-gray-700">Gender</label>
                    <select value={gender} onChange={e => setGender(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
                        <option value="">Select...</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Non-binary">Non-binary</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
                </div>
                <div className="pt-4 mt-4 border-t flex flex-col gap-3">
                    {formError && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{formError}</div>)}
                    <div className="flex justify-end gap-3 flex-wrap">
                        <button type="button" onClick={handleClear} className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Clear</button>
                        <button type="submit" disabled={isSubmitting} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50">{isSubmitting ? 'Adding...' : 'Add Tenant'}</button>
                    </div>
                </div>
            </form>
        </Card>
    );
};

const EditTenantModal = ({ tenant, onClose, onUpdateSuccess }) => {
    const { user } = useContext(AuthContext);
    const [firstName, setFirstName] = useState(tenant.contact?.first_name || '');
    const [middleName, setMiddleName] = useState(tenant.contact?.middle_name || '');
    const [lastName, setLastName] = useState(tenant.contact?.last_name || '');
    const [email, setEmail] = useState(tenant.email || '');
    const [dateOfBirth, setDateOfBirth] = useState(tenant.date_of_birth ? tenant.date_of_birth.split('T')[0] : '');
    const [socialSecurityNumber, setSocialSecurityNumber] = useState(tenant.social_security_number || '');
    const [gender, setGender] = useState(tenant.gender || '');
    const [contactMethods, setContactMethods] = useState(() => 
        (tenant.contact_methods || []).map(m => ({ 
            ...m, 
            type: m.method_type || m.type,  // Map method_type to type for frontend
            tempId: Date.now() + Math.random() 
        }))
    );
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const contactMethodInputRefs = useRef({});

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

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (newPassword && newPassword !== confirmPassword) {
            setFormError('New passwords do not match.');
            return;
        }
        
        setIsSubmitting(true);
        setFormError('');
        try {
            // Update user account
            const userPayload = { 
                email
            };
            
            if (newPassword) {
                // Hash the new password
                const bcrypt = await import('bcryptjs');
                const salt = await bcrypt.genSalt(10);
                const passwordHash = await bcrypt.hash(newPassword, salt);
                userPayload.password_hash = passwordHash;
            }
            
            const { error: userError } = await updateWithAudit(
                'users',
                userPayload,
                'user_id',
                tenant.user_id,
                user.user_id
            );
                
            if (userError) {
                console.error('Error updating user:', userError);
                setFormError(userError.message || 'Failed to update user account.');
                return;
            }
            
            // Get tenant_id from tenant record
            const tenantId = tenant.tenant_id;
            if (!tenantId) {
                setFormError('Tenant record not found.');
                return;
            }
            
            // Update tenant record with tenant-specific fields using audit helper
            const { error: tenantUpdateError } = await updateWithAudit(
                'clients',
                {
                    date_of_birth: dateOfBirth || null,
                    social_security_number: socialSecurityNumber || null,
                    gender: gender || null
                },
                'client_id',
                tenantId,
                user.user_id
            );
            
            if (tenantUpdateError) {
                console.error('Error updating tenant:', tenantUpdateError);
                setFormError(tenantUpdateError.message || 'Failed to update tenant record.');
                return;
            }
            
            // Get contact_id for updating contact record
            let { data: contactData } = await supabase
                .from('contacts')
                .select('contact_id')
                .eq('contactable_id', tenant.user_id)
                .eq('contactable_type', 'client')
                .maybeSingle();
            
            if (contactData?.contact_id) {
                // Update contact record using audit helper
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
                    setFormError(contactError.message || 'Failed to update contact information.');
                    return;
                }
            } else {
                // Create contact record if it doesn't exist
                const { error: contactError } = await supabase
                    .from('contacts')
                    .insert([{
                        contactable_id: tenant.user_id,
                        contactable_type: 'client',
                        first_name: firstName,
                        middle_name: middleName,
                        last_name: lastName
                    }]);
                
                if (contactError) {
                    console.error('Error creating contact:', contactError);
                    setFormError(contactError.message || 'Failed to create contact record.');
                    return;
                }
                
                // Fetch the newly created contact_id
                const { data: newContactData } = await supabase
                    .from('contacts')
                    .select('contact_id')
                    .eq('contactable_id', tenant.user_id)
                    .eq('contactable_type', 'client')
                    .single();
                
                contactData = newContactData;
            }
            
            // Update contact methods (use contactData from above)
            if (contactData?.contact_id) {
                const validContactMethods = contactMethods.filter(m => m.type.toLowerCase() !== 'email' && m.type && m.value);
                
                // Get existing contact methods to compare
                const { data: existingMethods } = await supabase
                    .from('contact_methods')
                    .select('method_id, method_type, value')
                    .eq('contact_id', contactData.contact_id);
                
                // Create a map of existing methods
                const existingMethodsMap = new Map();
                if (existingMethods) {
                    existingMethods.forEach(m => {
                        const key = `${m.method_type}:${m.value}`;
                        existingMethodsMap.set(key, m.method_id);
                    });
                }
                
                // Determine which methods to delete
                const methodsToDelete = [];
                if (existingMethods) {
                    existingMethods.forEach(existing => {
                        const key = `${existing.method_type}:${existing.value}`;
                        const stillExists = validContactMethods.some(m => {
                            return `${m.type}:${m.value}` === key;
                        });
                        if (!stillExists) {
                            methodsToDelete.push(existing.method_id);
                        }
                    });
                }
                
                // Delete methods that are no longer in the form
                for (const methodId of methodsToDelete) {
                    await deleteWithAudit(
                        'contact_methods',
                        'method_id',
                        methodId,
                        user.user_id
                    );
                }
                
                // Insert only new contact methods
                const methodsToInsert = validContactMethods.filter(method => {
                    const key = `${method.type}:${method.value}`;
                    return !existingMethodsMap.has(key);
                });
                
                if (methodsToInsert.length > 0) {
                    const contactMethodsToInsert = methodsToInsert.map(method => ({
                        contact_id: contactData.contact_id,
                        method_type: method.type,
                        value: method.value
                    }));
                    
                    const { error: contactMethodsError } = await insertWithAudit(
                        'contact_methods',
                        contactMethodsToInsert,
                        user.user_id
                    );
                        
                    if (contactMethodsError) {
                        console.error('Error updating contact methods:', contactMethodsError);
                        setFormError(contactMethodsError.message || 'Failed to update contact methods.');
                        return;
                    }
                } else if (validContactMethods.length === 0 && existingMethods && existingMethods.length > 0) {
                    // Delete all existing contact methods if none are provided
                    for (const method of existingMethods) {
                        await deleteWithAudit(
                            'contact_methods',
                            'method_id',
                            method.method_id,
                            user.user_id
                        );
                    }
                }
            }
            
            onUpdateSuccess();
        } catch(err) {
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
                    <h2 className="text-2xl font-bold text-gray-800">Edit Tenant</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
                </div>
                
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto">
                    <form onSubmit={handleSubmit} className="p-6 space-y-4" id="edit-tenant-form">
                        <h4 className="font-medium text-gray-800 border-b pb-2">Tenant Information</h4>
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
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Email</label>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="off" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        </div>

                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 my-2">Additional Information</h4>
                            
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <div>
                                    <DateInput 
                                        label="Date of Birth"
                                        value={dateOfBirth} 
                                        onChange={e => setDateOfBirth(e.target.value)} 
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">SSN</label>
                                    <input 
                                        type="text" 
                                        value={socialSecurityNumber} 
                                        onChange={e => setSocialSecurityNumber(e.target.value)} 
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                        placeholder="XXX-XX-XXXX"
                                        maxLength="11"
                                        pattern="[0-9]{3}-[0-9]{2}-[0-9]{4}"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Gender</label>
                                    <select 
                                        value={gender} 
                                        onChange={e => setGender(e.target.value)} 
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select...</option>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                        <option value="Non-binary">Non-binary</option>
                                        <option value="Prefer not to say">Prefer not to say</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t">
                            <h4 className="text-md font-medium text-gray-800 my-2">Contact Methods</h4>
                            {contactMethods.filter(m => m.type.toLowerCase() !== 'email').map((method) => (
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
                            <p className="text-sm font-medium text-gray-700">Reset Password (Optional)</p>
                            <div className="grid grid-cols-1 gap-4 mt-2 sm:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">New Password</label>
                                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Confirm</label>
                                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                                </div>
                            </div>
                        </div>

                        {formError && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{formError}</div>)}
                    </form>
                </div>
                
                {/* Fixed Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" form="edit-tenant-form" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">{isSubmitting ? 'Saving...' : 'Save Changes'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const AssignUnitForm = ({ tenant, units, onAssignmentSuccess, onClose }) => {
    const { user } = useContext(AuthContext);
    const [selectedUnit, setSelectedUnit] = useState('');
    const [areaSearch, setAreaSearch] = useState('');
    const [addressSearch, setAddressSearch] = useState('');
    const [filteredUnits, setFilteredUnits] = useState([]);
    const [showUnitResults, setShowUnitResults] = useState(false);
    const [additionalTenants, setAdditionalTenants] = useState([]);
    const [allTenants, setAllTenants] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [currentAssignment, setCurrentAssignment] = useState(null);
    const [allAssignments, setAllAssignments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [editingAssignment, setEditingAssignment] = useState(null);
    const [startDate, setStartDate] = useState(''); // For editing existing lease assignments only
    const [endDate, setEndDate] = useState(''); // For editing existing lease assignments only
    const [newStartDate, setNewStartDate] = useState(''); // For new assignments
    const [newEndDate, setNewEndDate] = useState(''); // For new assignments
    const formErrorRef = useRef(null);

    useEffect(() => {
        if (formError && formErrorRef.current) {
            formErrorRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [formError]);

    // Fetch current assignment and all assignments for this tenant
    useEffect(() => {
        const fetchAssignments = async () => {
            try {
                // Get client_id for this user
                const { data: tenantRecord } = await supabase
                    .from('clients')
                    .select('client_id')
                    .eq('user_id', tenant.user_id)
                    .single();
                
                if (!tenantRecord?.client_id) {
                    setCurrentAssignment(null);
                    setAllAssignments([]);
                    return;
                }
                
                // Get client_units assignments (primary source of truth)
                // Note: Fetch unit_ids first, then fetch units separately because Supabase
                // doesn't recognize the foreign key relationship for joins
                const { data: clientUnitsData, error: clientUnitsError } = await supabase
                    .from('client_units')
                    .select(`
                        client_unit_id,
                        unit_id,
                        start_date,
                        end_date,
                        assigned_at,
                        vacated_at,
                        lease_id
                    `)
                    .eq('client_id', tenantRecord.client_id)
                    .is('is_archived', false);
                
                if (clientUnitsError) {
                    console.error('Error fetching client_units:', clientUnitsError);
                }
                
                // Fetch units separately
                const unitIds = [...new Set((clientUnitsData || []).map(cu => cu.unit_id).filter(Boolean))];
                let unitsData = [];
                if (unitIds.length > 0) {
                    const { data: unitsResult, error: unitsError } = await supabase
                        .from('units')
                        .select(`
                            unit_id,
                            unit_number,
                            property_id,
                            properties!inner(
                                property_id,
                                property_name
                            )
                        `)
                        .in('unit_id', unitIds);
                    
                    if (unitsError) {
                        console.error('Error fetching units:', unitsError);
                    } else {
                        unitsData = unitsResult || [];
                    }
                }
                
                // Join client_units with units data
                const clientUnitsWithUnits = (clientUnitsData || []).map(cu => {
                    const unit = unitsData.find(u => u.unit_id === cu.unit_id);
                    return {
                        ...cu,
                        units: unit
                    };
                });
                
                // Also get leases for reference
                const { data: allLeaseData } = await supabase
                    .from('lease_clients')
                    .select(`
                        lease_id,
                        leases!inner(
                            lease_id,
                            unit_id,
                            start_date,
                            end_date,
                            status,
                            monthly_rent_amount,
                            units!inner(
                                unit_id,
                                unit_number,
                                properties!inner(
                                    property_id,
                                    property_name
                                )
                            )
                        )
                    `)
                    .eq('client_id', tenantRecord.client_id);
                
                // Fetch addresses separately for all properties
                const allPropertyIds = [
                    ...new Set([
                        ...(clientUnitsWithUnits?.map(cu => cu.units?.properties?.property_id).filter(Boolean) || []),
                        ...(allLeaseData?.map(lt => lt.leases?.units?.properties?.property_id).filter(Boolean) || [])
                    ])
                ];
                const { data: addresses } = allPropertyIds.length > 0 ? await supabase
                    .from('addresses')
                    .select('*')
                    .eq('addressable_type', 'property')
                    .in('addressable_id', allPropertyIds) : { data: [] };
                
                // Find current active assignment from client_units
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const currentAssignmentData = clientUnitsWithUnits?.find(cu => {
                    // Use start_date/end_date if available
                    if (cu.start_date !== null || cu.end_date !== null) {
                        const startDate = cu.start_date ? new Date(cu.start_date) : null;
                        const endDate = cu.end_date ? new Date(cu.end_date) : null;
                        const isStarted = !startDate || startDate <= today;
                        const isNotEnded = !endDate || endDate >= today;
                        return isStarted && isNotEnded;
                    } else {
                        // Fallback to assigned_at/vacated_at for legacy data
                        const assignedAt = cu.assigned_at ? new Date(cu.assigned_at) : null;
                        const vacatedAt = cu.vacated_at ? new Date(cu.vacated_at) : null;
                        const isAssigned = !assignedAt || assignedAt <= now;
                        const isNotVacated = !vacatedAt || vacatedAt > now;
                        return isAssigned && isNotVacated;
                    }
                });
                
                // Format assignments for display (combine client_units with lease info if available)
                const formattedAssignments = (clientUnitsWithUnits || []).map(cu => {
                    const unit = cu.units;
                    const property = unit?.properties;
                    const propertyId = property?.property_id;
                    const address = addresses?.find(a => a.addressable_id === propertyId && a.addressable_type === 'property');
                    
                    // Find associated lease if exists
                    const associatedLease = allLeaseData?.find(lt => lt.lease_id === cu.lease_id)?.leases;
                    
                    // Format address
                    let unitAddress = 'No Address';
                    if (address) {
                        const addressParts = [
                            address.address_line_1,
                            address.address_line_2,
                            address.city,
                            address.state_province_region
                        ].filter(Boolean);
                        unitAddress = addressParts.join(', ');
                    } else if (property?.property_name) {
                        unitAddress = property.property_name;
                    }
                    
                    // Create assignment object compatible with existing UI
                    return {
                        client_unit_id: cu.client_unit_id,
                        unit_id: cu.unit_id,
                        unit_number: unit?.unit_number,
                        unit_address: unitAddress,
                        start_date: cu.start_date || associatedLease?.start_date || null,
                        end_date: cu.end_date || associatedLease?.end_date || null,
                        lease_id: cu.lease_id || associatedLease?.lease_id || null,
                        status: associatedLease?.status || 'active',
                        monthly_rent_amount: associatedLease?.monthly_rent_amount || null,
                        units: unit,
                        properties: property,
                        assigned_at: cu.assigned_at // Keep for sorting fallback
                    };
                });
                
                // Sort by start_date descending (nulls last), fallback to assigned_at
                const sortedAssignments = formattedAssignments.sort((a, b) => {
                    // Prefer start_date if available
                    const dateA = a.start_date ? new Date(a.start_date) : (a.assigned_at ? new Date(a.assigned_at) : new Date(0));
                    const dateB = b.start_date ? new Date(b.start_date) : (b.assigned_at ? new Date(b.assigned_at) : new Date(0));
                    return dateB - dateA;
                });
                
                setAllAssignments(sortedAssignments);
                
                // Set current assignment (most recent active one, or most recent if none active)
                if (currentAssignmentData) {
                    const current = formattedAssignments.find(a => a.client_unit_id === currentAssignmentData.client_unit_id);
                    setCurrentAssignment(current || sortedAssignments[0] || null);
                } else {
                    setCurrentAssignment(sortedAssignments[0] || null);
                }
                
                // Get all other tenants with contact information
                const [tenantsResult, contactsResult] = await Promise.all([
                    supabase.from('users').select('user_id').eq('role', 'client').neq('user_id', tenant.user_id),
                    supabase.from('contacts').select('*').eq('contactable_type', 'client')
                ]);
                
                if (tenantsResult.error) {
                    console.error('Error fetching tenants:', tenantsResult.error);
                    setAllTenants([]);
                } else if (contactsResult.error) {
                    console.error('Error fetching contacts:', contactsResult.error);
                    setAllTenants([]);
                } else {
                    // Join users with their contacts
                    const users = tenantsResult.data || [];
                    const contacts = contactsResult.data || [];
                    
                    const tenantsWithContacts = users.map(user => {
                        const contact = contacts.find(c => c.contactable_id === user.user_id);
                        return {
                            ...user,
                            first_name: contact?.first_name || '',
                            middle_name: contact?.middle_name || '',
                            last_name: contact?.last_name || ''
                        };
                    });
                    
                    setAllTenants(tenantsWithContacts);
                }
            } catch (err) {
                console.error('Error fetching assignments:', err);
            } finally {
                setIsLoading(false);
            }
        };
        
        fetchAssignments();
    }, [tenant.user_id, user]);
    
    // Filter units based on search terms
    useEffect(() => {
        if (!units || units.length === 0) {
            setFilteredUnits([]);
            return;
        }
        
        const areaLower = areaSearch.toLowerCase().trim();
        const addressLower = addressSearch.toLowerCase().trim();
        
        const filtered = units.filter(unit => {
            const address = unit.property_address;
            if (!address) return false;
            
            // Area search: state, county, city
            let matchesArea = true;
            if (areaLower) {
                const state = (address.state_province_region || '').toLowerCase();
                const city = (address.city || '').toLowerCase();
                // Note: county might not be in address, but we can search for it if it exists
                matchesArea = state.includes(areaLower) || city.includes(areaLower);
            }
            
            // Address/property name search
            let matchesAddress = true;
            if (addressLower) {
                const addressLine1 = (address.address_line_1 || '').toLowerCase();
                const addressLine2 = (address.address_line_2 || '').toLowerCase();
                const propertyName = (unit.property_name || '').toLowerCase();
                const unitNumber = (unit.unit_number || '').toLowerCase();
                matchesAddress = addressLine1.includes(addressLower) || 
                                addressLine2.includes(addressLower) || 
                                propertyName.includes(addressLower) ||
                                unitNumber.includes(addressLower);
            }
            
            return matchesArea && matchesAddress;
        });
        
        setFilteredUnits(filtered);
    }, [units, areaSearch, addressSearch]);

    const handleDelete = async () => {
        if (!currentAssignment) return;
        
        setIsDeleting(true);
        setFormError('');
        
        try {
            // Prefer tenant_id already on the list row (mapped from clients.client_id)
            let clientId = tenant.tenant_id || null;
            if (!clientId) {
                const { data: tenantRecord, error: clientLookupError } = await supabase
                    .from('clients')
                    .select('client_id')
                    .eq('user_id', tenant.user_id)
                    .maybeSingle();

                if (clientLookupError) {
                    setFormError(clientLookupError.message || 'Failed to look up tenant record.');
                    return;
                }
                clientId = tenantRecord?.client_id || null;
            }

            if (!clientId) {
                setFormError('Tenant record not found.');
                return;
            }

            // Assignments are stored in client_units (lease_id is optional)
            if (currentAssignment.client_unit_id) {
                const { error: clientUnitError } = await supabase
                    .from('client_units')
                    .delete()
                    .eq('client_unit_id', currentAssignment.client_unit_id);

                if (clientUnitError) {
                    setFormError(clientUnitError.message || 'Failed to delete assignment.');
                    return;
                }
            }

            if (currentAssignment.lease_id) {
                const { error: leaseTenantsError } = await supabase
                    .from('lease_clients')
                    .delete()
                    .eq('lease_id', currentAssignment.lease_id)
                    .eq('client_id', clientId);

                if (leaseTenantsError) {
                    setFormError(leaseTenantsError.message || 'Failed to remove tenant from lease.');
                    return;
                }

                const { data: remainingTenants, error: checkError } = await supabase
                    .from('lease_clients')
                    .select('client_id')
                    .eq('lease_id', currentAssignment.lease_id);

                if (checkError) {
                    console.error('Error checking remaining tenants:', checkError);
                } else if (!remainingTenants || remainingTenants.length === 0) {
                    const { error: leaseError } = await supabase
                        .from('leases')
                        .delete()
                        .eq('lease_id', currentAssignment.lease_id);

                    if (leaseError) {
                        console.error('Error deleting lease:', leaseError);
                    }
                }
            } else if (!currentAssignment.client_unit_id) {
                setFormError('Cannot delete assignment: missing client_unit_id and lease_id.');
                return;
            }

            const deletedId = currentAssignment.client_unit_id;
            const remaining = allAssignments.filter(
                (a) => a.client_unit_id !== deletedId
            );
            setAllAssignments(remaining);

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const nextCurrent = remaining.find((a) => {
                const start = a.start_date ? new Date(a.start_date) : null;
                const end = a.end_date ? new Date(a.end_date) : null;
                const isStarted = !start || start <= today;
                const isNotEnded = !end || end >= today;
                return isStarted && isNotEnded;
            }) || remaining[0] || null;
            setCurrentAssignment(nextCurrent);

            setShowDeleteConfirm(false);
            setFormError('');
        } catch (err) {
            setFormError('Could not connect to server.');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleEdit = (assignment) => {
        setEditingAssignment(assignment);
        setStartDate(formatDateForInput(assignment.start_date));
        setEndDate(assignment.end_date ? formatDateForInput(assignment.end_date) : '');
        setShowEditForm(true);
    };

    const handleAdditionalTenantToggle = (tenantId, checked) => {
        if (checked) {
            setAdditionalTenants(prev => [...prev, tenantId]);
        } else {
            setAdditionalTenants(prev => prev.filter(id => id !== tenantId));
        }
    };

    const handleEditSubmit = async (e) => {
        e.preventDefault();
        if (!editingAssignment) return;
        
        setIsSubmitting(true);
        setFormError('');
        
        try {
            // Check if this is a lease-based assignment or a direct client_units assignment
            if (editingAssignment.lease_id) {
                // Update the lease
                const { error: updateError } = await supabase
                    .from('leases')
                    .update({
                        start_date: startDate,
                        end_date: endDate || null
                    })
                    .eq('lease_id', editingAssignment.lease_id);
                
                if (updateError) {
                    setFormError(updateError.message || 'Failed to update lease.');
                    return;
                }
                
                // Also update client_units if it references this lease
                if (editingAssignment.client_unit_id) {
                    const { error: clientUnitError } = await supabase
                        .from('client_units')
                        .update({
                            start_date: startDate,
                            end_date: endDate || null
                        })
                        .eq('client_unit_id', editingAssignment.client_unit_id);
                    
                    if (clientUnitError) {
                        console.error('Error updating client_units:', clientUnitError);
                        // Don't fail the whole operation, just log it
                    }
                }
            } else if (editingAssignment.client_unit_id) {
                // Update client_units directly (no lease)
                const { error: updateError } = await supabase
                    .from('client_units')
                    .update({
                        start_date: startDate,
                        end_date: endDate || null
                    })
                    .eq('client_unit_id', editingAssignment.client_unit_id);
                
                if (updateError) {
                    setFormError(updateError.message || 'Failed to update assignment.');
                    return;
                }
            } else {
                setFormError('Cannot update assignment: missing lease_id or client_unit_id.');
                return;
            }
            
            // Refresh the assignment list by calling onAssignmentSuccess
            onAssignmentSuccess();
            
            // Close edit form
            setShowEditForm(false);
            setEditingAssignment(null);
            setStartDate('');
            setEndDate('');
        } catch (err) {
            setFormError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const checkForOverlaps = async (userId, startDate, endDate) => {
        try {
            // Get client_id from user_id
            const { data: tenantRecord } = await supabase
                .from('clients')
                .select('client_id')
                .eq('user_id', userId)
                .single();
            
            if (!tenantRecord?.client_id) {
                return []; // No tenant record, no overlaps
            }
            
            // Query for all leases for this tenant
            const { data, error } = await supabase
                .from('lease_clients')
                .select(`
                    lease_id,
                    leases!inner(
                        lease_id,
                        start_date,
                        end_date,
                        status,
                        units!inner(
                            unit_id,
                            unit_number,
                            properties!inner(
                                property_id
                            )
                        )
                    )
                `)
                .eq('client_id', tenantRecord.client_id);
            
            if (error) {
                console.error('Error checking for overlaps:', error);
                return [];
            }
            
            // Filter for overlapping leases in JavaScript
            const allLeases = data?.map(lt => lt.leases) || [];
            const startDateObj = new Date(startDate);
            const endDateObj = endDate ? new Date(endDate) : null;
            
            const overlappingLeases = allLeases.filter(lease => {
                if (!lease.start_date) return false;
                
                const leaseStart = new Date(lease.start_date);
                const leaseEnd = lease.end_date ? new Date(lease.end_date) : null;
                
                if (endDateObj) {
                    // Check for overlaps: existing lease starts before new lease ends AND existing lease ends after new lease starts
                    // Or if existing lease has no end date and starts before new lease ends
                    if (leaseEnd) {
                        return leaseStart <= endDateObj && leaseEnd >= startDateObj;
                    } else {
                        // Existing lease has no end date - it overlaps if it starts before new lease ends
                        return leaseStart <= endDateObj;
                    }
                } else {
                    // New lease has no end date - check if existing lease starts before or on the start date
                    // Or if existing lease overlaps with the start date
                    if (leaseEnd) {
                        return leaseStart <= startDateObj && leaseEnd >= startDateObj;
                    } else {
                        // Both have no end date - overlap if existing starts before or on new start
                        return leaseStart <= startDateObj;
                    }
                }
            });
            
            return overlappingLeases;
        } catch (err) {
            console.error('Error checking for overlaps:', err);
            return [];
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        
        try {
            // Get client_ids for all user_ids
            const allUserIds = [tenant.user_id, ...additionalTenants];
            const { data: tenantRecords } = await supabase
                .from('clients')
                .select('client_id, user_id')
                .in('user_id', allUserIds);
            
            if (!tenantRecords || tenantRecords.length === 0) {
                setFormError('Could not find tenant records for selected tenants.');
                setIsSubmitting(false);
                return;
            }
            
            // Create or update client_units entries for all tenants (direct assignment, no lease)
            const unitId = selectedUnit;
            if (unitId) {
                // Validate that the unit exists
                const { data: unitCheck } = await supabase
                    .from('units')
                    .select('unit_id')
                    .eq('unit_id', unitId)
                    .maybeSingle();
                
                if (!unitCheck) {
                    console.error(`Unit ${unitId} does not exist, skipping client_units creation`);
                } else {
                        for (const tr of tenantRecords) {
                            // Check if client_units entry already exists - fetch both application_id and lease_id
                            const { data: existingClientUnit } = await supabase
                                .from('client_units')
                                .select('client_unit_id, application_id, lease_id')
                                .eq('client_id', tr.client_id)
                                .eq('unit_id', unitId)
                                .is('is_archived', false)
                                .maybeSingle();
                            
                            if (!existingClientUnit) {
                                // Create new client_units entry (direct assignment, no lease)
                                // Check if application_id exists for this client-unit combination
                                let hasApplication = false;
                                let applicationId = null;
                                
                                const { data: appCheck } = await supabase
                                    .from('client_applications')
                                    .select('application_id')
                                    .eq('client_id', tr.client_id)
                                    .eq('unit_id', unitId)
                                    .eq('status', 'approved')
                                    .maybeSingle();
                                
                                if (appCheck) {
                                    hasApplication = true;
                                    applicationId = appCheck.application_id;
                                }
                                
                                const insertData = {
                                    client_id: tr.client_id,
                                    unit_id: unitId,
                                    assignment_type: hasApplication ? 'application' : 'direct',
                                    start_date: newStartDate || new Date().toISOString().split('T')[0], // Use provided start_date or default to today
                                    end_date: newEndDate || null
                                };
                                
                                if (applicationId) {
                                    insertData.application_id = applicationId;
                                }
                                
                                const { error: clientUnitError } = await supabase
                                    .from('client_units')
                                    .insert([insertData]);
                                
                                if (clientUnitError) {
                                    console.error('Error creating client_units entry:', clientUnitError);
                                    // Continue anyway
                                }
                            } else {
                                // Update existing entry - check if it has a lease
                                // If it has a lease, we don't want to overwrite it (lease takes precedence)
                                // Only update if it's a direct or application assignment
                                if (!existingClientUnit.lease_id) {
                                    // Check if application_id actually exists
                                    let hasApplication = false;
                                    if (existingClientUnit.application_id) {
                                        const { data: appCheck } = await supabase
                                            .from('client_applications')
                                            .select('application_id')
                                            .eq('application_id', existingClientUnit.application_id)
                                            .maybeSingle();
                                        hasApplication = !!appCheck;
                                    }
                                    
                                    // Keep existing assignment_type if it has an application, otherwise set to direct
                                    const updateData = {
                                        assignment_type: hasApplication ? 'application' : 'direct',
                                        start_date: newStartDate || undefined, // Update start_date if provided
                                        end_date: newEndDate || undefined // Update end_date if provided (null if empty string)
                                    };
                                    
                                    // Remove undefined values
                                    if (updateData.start_date === undefined) delete updateData.start_date;
                                    if (updateData.end_date === undefined) delete updateData.end_date;
                                    if (updateData.end_date === '') updateData.end_date = null;
                                    
                                    // Remove application_id if it doesn't exist
                                    if (!hasApplication && existingClientUnit.application_id) {
                                        updateData.application_id = null;
                                    }
                                    
                                    const { error: updateError } = await supabase
                                        .from('client_units')
                                        .update(updateData)
                                        .eq('client_unit_id', existingClientUnit.client_unit_id);
                                    
                                    if (updateError) {
                                        console.error('Error updating client_units entry:', updateError);
                                        // Continue anyway
                                    }
                                }
                                // If it has a lease_id, leave it alone (lease assignment takes precedence)
                            }
                        }
                }
            }
            
            // Clear the form for next assignment
            setSelectedUnit('');
            setAreaSearch('');
            setAddressSearch('');
            setAdditionalTenants([]);
            setNewStartDate('');
            setNewEndDate('');
            
            // Refresh the assignment list by calling onAssignmentSuccess
            onAssignmentSuccess();
        } catch (err) {
            setFormError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="text-gray-600">Loading current assignment...</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {formError && (
                <div
                    ref={formErrorRef}
                    role="alert"
                    className="sticky top-0 z-10 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md shadow-sm"
                >
                    {formError}
                </div>
            )}

            {/* Current Assignment Display */}
            {currentAssignment ? (
                <div className="bg-indigo-50 border border-indigo-200 rounded-md p-4">
                    <h3 className="text-sm font-medium text-indigo-800 mb-2">Current Assignment</h3>
                    <div className="flex items-center space-x-3">
                        <div className="flex-shrink-0">
                            <span className="inline-flex items-center px-2 py-1 rounded-full bg-indigo-100 text-indigo-800">
                                Active
                            </span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">
                                {currentAssignment.unit_address ? `${currentAssignment.unit_address} - ` : ''}Unit {currentAssignment.units?.unit_number || 'N/A'}
                            </p>
                            <p className="text-xs text-gray-600">
                                {formatDate(currentAssignment.start_date)} {currentAssignment.end_date ? `to ${formatDate(currentAssignment.end_date)}` : '(ongoing)'}
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
                    <h3 className="text-sm font-medium text-gray-800 mb-2">Current Assignment</h3>
                    <p className="text-sm text-gray-600">No unit currently assigned</p>
                </div>
            )}
            
            {/* All Assignments List */}
            {allAssignments.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
                    <h3 className="text-sm font-medium text-gray-800 mb-3">All Assignments</h3>
                    <div className="max-h-48 overflow-y-auto space-y-2">
                        {allAssignments.map((assignment, index) => {
                            const isActive = assignment.status?.toLowerCase() === 'active';
                            const unitNumber = assignment.units?.unit_number || assignment.unit_number || 'N/A';
                            const displayStatus = assignment.status 
                                ? assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1).toLowerCase()
                                : 'Unknown';
                            return (
                            <div key={assignment.client_unit_id || assignment.lease_id || index} className={`flex items-center justify-between p-2 rounded-md border ${
                                isActive 
                                    ? 'bg-green-50 border-green-200' 
                                    : 'bg-gray-100 border-gray-300'
                            }`}>
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                    <div className="flex-shrink-0">
                                        <span className={`inline-flex items-center px-2 py-1 rounded-full ${
                                            isActive 
                                                ? 'bg-green-100 text-green-800' 
                                                : 'bg-gray-100 text-gray-800'
                                        }`}>
                                            {displayStatus}
                                        </span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="finder-primary text-gray-900 truncate">
                                            {assignment.unit_address ? `${assignment.unit_address} - ` : ''}Unit {unitNumber}
                                        </p>
                                        <p className="finder-secondary text-gray-500">
                                            {formatDate(assignment.start_date)} {assignment.end_date ? `to ${formatDate(assignment.end_date)}` : '(ongoing)'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex space-x-1 flex-shrink-0">
                                    <button
                                        onClick={() => handleEdit(assignment)}
                                        className="p-1 text-blue-700 bg-blue-100 border border-blue-300 rounded-md hover:bg-blue-200"
                                        title="Edit assignment dates"
                                    >
                                        <Edit size={14} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            setCurrentAssignment(assignment);
                                            setShowDeleteConfirm(true);
                                        }}
                                        className="p-1 text-red-700 bg-red-100 border border-red-300 rounded-md hover:bg-red-200"
                                        title="Delete assignment record"
                                    >
                                        <Trash size={14} />
                                    </button>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                </div>
            )}
            
            <div className="bg-white border border-gray-200 rounded-md p-4">
                <h3 className="text-sm font-medium text-gray-800 mb-4">Add Assignment</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Search for Unit</label>
                            <div className="space-y-2">
                                <div>
                                    <input
                                        type="text"
                                        placeholder="Search by area (state, county, or city)..."
                                        value={areaSearch}
                                        onChange={e => {
                                            setAreaSearch(e.target.value);
                                            setShowUnitResults(true);
                                        }}
                                        onFocus={() => setShowUnitResults(true)}
                                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <input
                                        type="text"
                                        placeholder="Search by address or property name..."
                                        value={addressSearch}
                                        onChange={e => {
                                            setAddressSearch(e.target.value);
                                            setShowUnitResults(true);
                                        }}
                                        onFocus={() => setShowUnitResults(true)}
                                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                                {showUnitResults && (areaSearch || addressSearch) && (
                                    <div className="border border-gray-300 rounded-md bg-white max-h-60 overflow-y-auto overflow-x-hidden shadow-lg z-10">
                                        {filteredUnits.length === 0 ? (
                                            <div className="p-3 text-sm text-gray-500">No units found matching your search</div>
                                        ) : (
                                            filteredUnits.map(unit => (
                                                <button
                                                    key={unit.unit_id}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedUnit(unit.unit_id.toString());
                                                        setShowUnitResults(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-200 last:border-b-0 min-w-0 ${
                                                        selectedUnit === unit.unit_id.toString() ? 'bg-indigo-100' : ''
                                                    }`}
                                                >
                                                    <div className="finder-primary text-gray-900 truncate">{formatUnitAddress(unit)}</div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                                {selectedUnit && (
                                    <div className="mt-2 p-2 bg-indigo-50 border border-indigo-200 rounded-md">
                                        <span className="text-sm text-indigo-800">Selected: {formatUnitAddress(units.find(u => u.unit_id.toString() === selectedUnit))}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedUnit('');
                                                setAreaSearch('');
                                                setAddressSearch('');
                                            }}
                                            className="ml-2 text-sm text-indigo-600 hover:text-indigo-800"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                )}
                            </div>
                            {!selectedUnit && (
                                <p className="text-xs text-gray-500 mt-1">Use the search boxes above to find and select a unit</p>
                            )}
                        </div>
                        
                        {allTenants.filter(t => t.user_id && (t.first_name || t.last_name)).length > 0 && (
                            <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Additional Tenants (Optional)</label>
                                <p className="text-xs text-gray-500 mb-3">Select spouse, roommates, or other tenants to assign to the same unit with the same dates</p>
                                <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-md p-3 bg-gray-50">
                                    {allTenants.filter(t => t.user_id && (t.first_name || t.last_name)).map(additionalTenant => (
                                        <label key={additionalTenant.user_id} className="flex items-center space-x-2 mb-2">
                                            <input
                                                type="checkbox"
                                                checked={additionalTenants.includes(additionalTenant.user_id)}
                                                onChange={e => handleAdditionalTenantToggle(additionalTenant.user_id, e.target.checked)}
                                                className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                                            />
                                            <span className="text-sm text-gray-700">
                                                {additionalTenant.first_name} {additionalTenant.last_name}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                        
                        <div className="sm:col-span-2">
                            <DateInput
                                label="Start Date"
                                value={newStartDate}
                                onChange={e => setNewStartDate(e.target.value || null)}
                            />
                        </div>
                        
                        <div className="sm:col-span-2">
                            <DateInput
                                label="End Date (Optional)"
                                value={newEndDate}
                                onChange={e => setNewEndDate(e.target.value || null)}
                            />
                            <p className="mt-1 text-xs text-gray-500">Leave blank for ongoing assignment</p>
                        </div>
                        
                        <div className="sm:col-span-2 flex justify-end">
                            <button 
                                type="submit" 
                                disabled={isSubmitting} 
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {isSubmitting ? 'Assigning...' : 'Assign Unit'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            {/* Delete Confirmation Dialog */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50" onClick={(e) => e.stopPropagation()}>
                    <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Confirm Deletion</h3>
                        <p className="text-sm text-gray-600 mb-4">
                            Are you sure you want to permanently delete this assignment record? This action cannot be undone.
                        </p>
                        {formError && (
                            <div role="alert" className="mb-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                {formError}
                            </div>
                        )}
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => {
                                    setShowDeleteConfirm(false);
                                    setFormError('');
                                }}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={isDeleting}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 disabled:opacity-50"
                            >
                                {isDeleting ? 'Deleting...' : 'Delete Assignment'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Assignment Form */}
            {showEditForm && editingAssignment && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50" onClick={(e) => e.stopPropagation()}>
                    <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Edit Assignment</h3>
                        <form onSubmit={handleEditSubmit} className="space-y-4">
                            <div>
                                <DateInput 
                                    label="Start Date"
                                    value={startDate} 
                                    onChange={e => setStartDate(e.target.value)} 
                                    required 
                                />
                            </div>
                            <div>
                                <DateInput 
                                    label="End Date (Optional)"
                                    value={endDate} 
                                    onChange={e => setEndDate(e.target.value)} 
                                />
                            </div>
                            {formError && (
                                <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                    {formError}
                                </div>
                            )}
                            <div className="flex justify-end space-x-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowEditForm(false);
                                        setEditingAssignment(null);
                                        setStartDate('');
                                        setEndDate('');
                                    }}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Updating...' : 'Update Assignment'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

// Tenant Documents Modal Component — leases (notices, leases, etc.) + applications
const TenantDocumentsModal = ({ tenant, onClose }) => {
    const { user } = useContext(AuthContext);
    const [leases, setLeases] = useState([]);
    const [applications, setApplications] = useState([]);
    const [selectedLeaseId, setSelectedLeaseId] = useState(null);
    const [selectedApplicationId, setSelectedApplicationId] = useState(null);
    const [source, setSource] = useState('lease'); // 'lease' | 'application'
    const [isLoading, setIsLoading] = useState(true);
    
    useEffect(() => {
        const fetchTenantDocumentSources = async () => {
            const clientId = tenant?.client_id || tenant?.tenant_id || tenant?.clientRecord?.client_id;
            if (!clientId) {
                console.log('[TenantDocumentsModal] No client_id found for tenant:', tenant);
                setIsLoading(false);
                return;
            }
            
            setIsLoading(true);
            try {
                const [leasesResult, appsResult] = await Promise.all([
                    supabase
                        .from('lease_clients')
                        .select(`
                            lease_id,
                            leases!inner(
                                lease_id,
                                status,
                                start_date,
                                end_date,
                                monthly_rent_amount,
                                is_archived,
                                units(
                                    unit_id,
                                    unit_number,
                                    properties(
                                        property_id,
                                        property_name
                                    )
                                )
                            )
                        `)
                        .eq('client_id', clientId)
                        .eq('is_archived', false),
                    supabase
                        .from('client_applications')
                        .select(`
                            application_id,
                            unit_id,
                            status,
                            applied_at,
                            units(
                                unit_id,
                                unit_number,
                                properties(
                                    property_id,
                                    property_name
                                )
                            )
                        `)
                        .eq('client_id', clientId)
                        .eq('is_archived', false)
                        .order('applied_at', { ascending: false }),
                ]);

                if (leasesResult.error) {
                    console.error('[TenantDocumentsModal] Error fetching leases:', leasesResult.error);
                }
                if (appsResult.error) {
                    console.error('[TenantDocumentsModal] Error fetching applications:', appsResult.error);
                }

                const leaseRows = (leasesResult.data || [])
                    .map((lc) => lc.leases)
                    .filter((lease) => lease && !lease.is_archived);

                // Prefer active leases first, then newest start_date
                leaseRows.sort((a, b) => {
                    if (a.status === 'active' && b.status !== 'active') return -1;
                    if (b.status === 'active' && a.status !== 'active') return 1;
                    return String(b.start_date || '').localeCompare(String(a.start_date || ''));
                });

                const apps = appsResult.data || [];
                setLeases(leaseRows);
                setApplications(apps);

                if (leaseRows.length > 0) {
                    setSelectedLeaseId(leaseRows[0].lease_id);
                    setSource('lease');
                } else if (apps.length > 0) {
                    setSelectedApplicationId(apps[0].application_id);
                    setSource('application');
                }
            } catch (error) {
                console.error('[TenantDocumentsModal] Error loading document sources:', error);
                setLeases([]);
                setApplications([]);
            } finally {
                setIsLoading(false);
            }
        };
        
        fetchTenantDocumentSources();
    }, [tenant]);
    
    const formatUnitInfo = (unit) => {
        if (!unit) return 'N/A';
        const property = unit.properties || unit.property;
        return `Unit ${unit.unit_number || 'N/A'} - ${property?.property_name || 'N/A'}`;
    };

    const formatLeaseOption = (lease) => {
        const unit = Array.isArray(lease.units) ? lease.units[0] : lease.units;
        const unitLabel = formatUnitInfo(unit);
        const status = lease.status || 'unknown';
        const start = lease.start_date
            ? new Date(lease.start_date).toLocaleDateString()
            : 'N/A';
        return `${unitLabel} — ${status} (from ${start})`;
    };
    
    const handleBackdropClick = (e) => {
        e.stopPropagation();
    };

    const tenantUserId = tenant?.user_id || null;
    const hasLeases = leases.length > 0;
    const hasApplications = applications.length > 0;
    
    if (!tenant) return null;
    
    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            onClick={handleBackdropClick}
        >
            <div 
                className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Review Documents</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            {formatTenantName(tenant)}
                        </p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <X size={24} />
                    </button>
                </div>
                
                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {isLoading ? (
                        <div className="text-center py-8">Loading documents...</div>
                    ) : !hasLeases && !hasApplications ? (
                        <div className="text-center py-8 text-gray-500">
                            <p>No leases or rental applications found for this tenant.</p>
                        </div>
                    ) : (
                        <>
                            {(hasLeases && hasApplications) && (
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setSource('lease')}
                                        className={`px-3 py-1.5 text-sm rounded-md border ${
                                            source === 'lease'
                                                ? 'bg-indigo-600 text-white border-indigo-600'
                                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                        }`}
                                    >
                                        Lease Documents
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSource('application');
                                            if (!selectedApplicationId && applications[0]) {
                                                setSelectedApplicationId(applications[0].application_id);
                                            }
                                        }}
                                        className={`px-3 py-1.5 text-sm rounded-md border ${
                                            source === 'application'
                                                ? 'bg-indigo-600 text-white border-indigo-600'
                                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                        }`}
                                    >
                                        Application Documents
                                    </button>
                                </div>
                            )}

                            {source === 'lease' && hasLeases && (
                                <div>
                                    {leases.length > 1 && (
                                        <div className="mb-4">
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Select Lease
                                            </label>
                                            <select
                                                value={selectedLeaseId || ''}
                                                onChange={(e) => setSelectedLeaseId(parseInt(e.target.value, 10))}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                            >
                                                {leases.map((lease) => (
                                                    <option key={lease.lease_id} value={lease.lease_id}>
                                                        {formatLeaseOption(lease)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    {selectedLeaseId && (
                                        <div>
                                            <h3 className="text-lg font-semibold text-gray-800 mb-4">
                                                Lease Documents
                                                <span className="text-sm font-normal text-gray-500 ml-2">
                                                    (leases, rent increase notices, and related files)
                                                </span>
                                            </h3>
                                            <DocumentManagement
                                                leaseId={selectedLeaseId}
                                                userRole={user?.role || 'user'}
                                                userId={user?.user_id || null}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {source === 'application' && hasApplications && (
                                <div>
                                    {applications.length > 1 && (
                                        <div className="mb-4">
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Select Application
                                            </label>
                                            <select
                                                value={selectedApplicationId || ''}
                                                onChange={(e) => setSelectedApplicationId(parseInt(e.target.value, 10))}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                            >
                                                {applications.map((app) => (
                                                    <option key={app.application_id} value={app.application_id}>
                                                        {formatUnitInfo(app.units)} - {app.status} ({new Date(app.applied_at).toLocaleDateString()})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    {selectedApplicationId && (
                                        <div>
                                            <h3 className="text-lg font-semibold text-gray-800 mb-4">
                                                Application Documents
                                                {applications.length === 1 && (
                                                    <span className="text-sm font-normal text-gray-500 ml-2">
                                                        - {formatUnitInfo(applications[0].units)}
                                                    </span>
                                                )}
                                            </h3>
                                            <DocumentManagement
                                                tenantUserId={tenantUserId || user?.user_id || null}
                                                userRole={user?.role || 'user'}
                                                userId={user?.user_id || null}
                                                applicationId={selectedApplicationId}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
                
                {/* Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

