import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { UserPlus, Pencil, Trash2, X, PlusCircle, ArrowUpDown, Search, Users, Building } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card } from './ui';
import { useSortableData } from '../hooks';
import { useFormPersistence } from '../hooks/useFormPersistence';
import { useFinderLimit } from '../hooks/useFinderLimit';
import { insertWithAudit, updateWithAudit, deleteWithAudit } from '../lib/auditHelpers.js';
import ArchiveModal from './ArchiveModal';
import ContactMethodTypeInput from './ContactMethodTypeInput';

export default function UserManagement() {
    const { user } = useContext(AuthContext);
    const [users, setUsers] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [editingUser, setEditingUser] = useState(null);
    const [deletingUser, setDeletingUser] = useState(null);
    const [assigningLandlordsUser, setAssigningLandlordsUser] = useState(null);
    const [managingPropertiesForCompany, setManagingPropertiesForCompany] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    
    // Debounce search term to avoid excessive API calls
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300); // 300ms delay
        
        return () => clearTimeout(timer);
    }, [searchTerm]);
    
    // Filter users based on search term (client-side for small datasets)
    const filteredUsers = useMemo(() => {
        if (!users || !Array.isArray(users)) {
            return [];
        }
        if (!debouncedSearchTerm.trim()) {
            return users;
        }
        
        const searchLower = debouncedSearchTerm.toLowerCase();
        const result = users.filter(user => {
            // Search in basic user fields
            const nameMatch = [
                user.contact?.first_name,
                user.contact?.last_name,
                user.contact?.middle_name,
                user.email,
                user.role,
                user.company_name
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            // Search in contact methods
            const contactMatch = user.contact_methods && user.contact_methods.some(method => 
                method.value && method.value.toLowerCase().includes(searchLower)
            );
            
            return nameMatch || contactMatch;
        });
        return result;
    }, [users, debouncedSearchTerm]);
    
    const { items: sortedUsers, requestSort, sortConfig } = useSortableData(filteredUsers, { key: 'name', direction: 'ascending' });
    const { visibleCount: userVisibleCount, hasMore: hasMoreUsers, showMore: showMoreUsers } = useFinderLimit(
        sortedUsers.length,
        [debouncedSearchTerm, users.length]
    );
    const displayedUsers = sortedUsers.slice(0, userVisibleCount || sortedUsers.length);

    /**
     * Determines if a user is a global admin (has system-wide permissions)
     * @param {Object} u - User object to check
     * @returns {boolean} True if user is a global admin
     */
    const isGlobalAdminUser = (u) => {
        if (!u) return false;
        // Treat legacy 'admin' without company scope as global admin
        if (u.role === 'global_admin') return true;
        if (u.role === 'admin' && (!u.pmc_id || !u.company_name)) return true;
        return false;
    };

    /**
     * Fetches users and companies data from Supabase
     * Filters out tenant and landlord users as they are managed separately
     */
    const fetchData = useCallback(async () => {
        try {
            console.log('[UserManagement] Fetching users, user role:', user.role, 'pmc_id:', user.pmc_id);
            // Get users using direct Supabase calls (excluding archived)
            let usersQuery = supabase.from('users').select('*').eq('is_archived', false);
            
            // Apply role-based filtering
            if (user.role === 'company_admin' && user.pmc_id) {
                usersQuery = usersQuery.eq('pmc_id', user.pmc_id);
            }
            
            const { data: users, error: usersError } = await usersQuery;
            
            console.log('[UserManagement] Users query result:', {
                count: users?.length || 0,
                hasData: !!users,
                error: usersError,
                errorCode: usersError?.code,
                errorMessage: usersError?.message,
                errorDetails: usersError?.details,
                errorHint: usersError?.hint
            });
            
            if (usersError) {
                console.error('[UserManagement] Error fetching users:', usersError);
                setUsers([]);
                return;
            }
            
            // Get related data for all users
            const userIds = users.map(u => u.user_id);
            const pmcIds = [...new Set(users.map(u => u.pmc_id).filter(Boolean))];
            
            const [contactsResult, companiesResult] = await Promise.all([
                supabase.from('contacts').select('*').in('contactable_id', userIds).eq('contactable_type', 'user'),
                pmcIds.length > 0 ? supabase.from('pm_companies').select('*').in('pmc_id', pmcIds) : Promise.resolve({ data: [] })
            ]);
            
            if (contactsResult.error) {
                console.error('Error fetching contacts:', contactsResult.error);
            }
            
            if (companiesResult.error) {
                console.error('Error fetching companies:', companiesResult.error);
            }
            
            // Get contact methods for all contacts
            const contactIds = contactsResult.data?.map(c => c.contact_id) || [];
            let contactMethodsResult = { data: [] };
            
            if (contactIds.length > 0) {
                contactMethodsResult = await supabase
                    .from('contact_methods')
                    .select('*')
                    .in('contact_id', contactIds);
            }
            
            if (contactMethodsResult.error) {
                console.error('Error fetching contact methods:', contactMethodsResult.error);
            }
            
            // Get landlord and unit counts for managers
            const managerUserIds = users.filter(u => u.role === 'manager').map(u => u.user_id);
            let managerPropertyCounts = {};
            let managerUnitCounts = {};
            if (managerUserIds.length > 0) {
                // Get properties assigned to these managers
                const { data: propertiesData } = await supabase
                    .from('properties')
                    .select('property_id, manager_id, landlord_id')
                    .in('manager_id', managerUserIds)
                    .eq('is_archived', false);
                
                // Count properties per manager
                propertiesData?.forEach(property => {
                    if (property.manager_id) {
                        managerPropertyCounts[property.manager_id] = 
                            (managerPropertyCounts[property.manager_id] || 0) + 1;
                    }
                });
                
                if (propertiesData && propertiesData.length > 0) {
                    const propertyIds = propertiesData.map(p => p.property_id);
                    // Get unit counts
                    const { data: unitsData } = await supabase
                        .from('units')
                        .select('property_id')
                        .in('property_id', propertyIds);
                    
                    // Count units per property
                    const unitsPerProperty = {};
                    unitsData?.forEach(unit => {
                        unitsPerProperty[unit.property_id] = (unitsPerProperty[unit.property_id] || 0) + 1;
                    });
                    
                    // Count units per manager
                    propertiesData.forEach(property => {
                        if (property.manager_id) {
                            managerUnitCounts[property.manager_id] = 
                                (managerUnitCounts[property.manager_id] || 0) + 
                                (unitsPerProperty[property.property_id] || 0);
                        }
                    });
                }
            }

            // Combine all data
            const usersWithData = users.map(user => {
                const contact = contactsResult.data?.find(c => c.contactable_id === user.user_id && c.contactable_type === 'user');
                const company = companiesResult.data?.find(c => c.pmc_id === user.pmc_id);
                const contactMethods = contactMethodsResult.data?.filter(cm => cm.contact_id === contact?.contact_id) || [];
                
                return {
                    ...user,
                    contact,
                    company,
                    property_count: user.role === 'manager' ? (managerPropertyCounts[user.user_id] || 0) : undefined,
                    unit_count: user.role === 'manager' ? (managerUnitCounts[user.user_id] || 0) : undefined,
                    contact_methods: contactMethods.map(cm => ({
                        type: cm.method_type,
                        value: cm.value,
                        is_primary: cm.is_primary
                    }))
                };
            });
            
            // Filter out tenant, landlord, vendor, and client users as they are managed separately on their dedicated pages
            const nonTenantLandlordVendorClientUsers = usersWithData.filter(u => u.role !== 'tenant' && u.role !== 'landlord' && u.role !== 'vendor' && u.role !== 'client');
            setUsers(nonTenantLandlordVendorClientUsers);
            
            // Get companies using Supabase API
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
            setUsers([]);
            setCompanies([]);
        }
    }, [user]);

    useEffect(() => {
        if (user?.role?.includes('admin')) {
            fetchData();
        }
    }, [user, fetchData]);

    const handleSuccess = () => {
        setEditingUser(null);
        setDeletingUser(null);
        fetchData();
    };

    const formatUserName = (u) => {
        const first = u.contact?.first_name || '';
        const last = u.contact?.last_name || '';
        const middle = u.contact?.middle_name ? ` ${u.contact.middle_name.charAt(0)}.` : '';
        return `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
    };

    // Utility function for formatting user recap for hover tooltip
    const formatUserRecap = (u) => {
        const parts = [];
        
        // Name
        const first = u.contact?.first_name || '';
        const middle = u.contact?.middle_name || '';
        const last = u.contact?.last_name || '';
        if (first || middle || last) {
            const nameParts = [first, middle, last].filter(Boolean);
            if (nameParts.length > 0) {
                parts.push(`Name: ${nameParts.join(' ')}`);
            }
        }
        
        // Email
        if (u.email) {
            parts.push(`Email: ${u.email}`);
        }
        
        // Role
        if (u.role) {
            parts.push(`Role: ${u.role.replace('_', ' ')}`);
        }
        
        // Company
        if (u.company?.company_name) {
            parts.push(`Company: ${u.company.company_name}`);
        } else if (isGlobalAdminUser(u)) {
            parts.push(`Company: Global`);
        }
        
        // Property/Unit counts for managers
        if (u.role === 'manager') {
            if (u.property_count !== undefined || u.unit_count !== undefined) {
                const counts = [];
                if (u.property_count !== undefined) counts.push(`${u.property_count} ${u.property_count === 1 ? 'property' : 'properties'}`);
                if (u.unit_count !== undefined) counts.push(`${u.unit_count} ${u.unit_count === 1 ? 'unit' : 'units'}`);
                if (counts.length > 0) {
                    parts.push(`Management: ${counts.join(', ')}`);
                }
            }
        }
        
        // Contact Methods (excluding email)
        const contactMethods = (u.contact_methods || []).filter(m => 
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
    
    const getSortIndicator = (name) => {
        if (!sortConfig || sortConfig.key !== name) {
            return <ArrowUpDown size={14} className="ml-2 text-gray-400"/>;
        }
        return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
    };

    return (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <CreateUserForm companies={companies} onUserCreated={handleSuccess} />
            <Card
                title="User Search"
                className="lg:col-span-2 max-h-[calc(100vh-160px)]"
                contentClassName="flex flex-col h-full"
            >
                <div className="flex flex-col h-full">
                {/* Search Box */}
                <div className="mb-4 flex-shrink-0">
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search users by name, email, phone, role, or company..."
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
                    <div className="mt-2 text-sm text-gray-600">
                        {debouncedSearchTerm ? (
                            sortedUsers.length === 0 ? (
                                <span className="text-red-600">No users found matching "{debouncedSearchTerm}"</span>
                            ) : (
                                <span>Showing {sortedUsers.length} of {users.length} users</span>
                            )
                        ) : (
                            <span>Showing {users.length} of {users.length} users</span>
                        )}
                    </div>
                </div>
                <div className="flex-1 overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-auto h-full">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">Actions</th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('name')} className="flex items-center">Name {getSortIndicator('name')}</button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('contact')} className="flex items-center">Contact {getSortIndicator('contact')}</button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('role')} className="flex items-center">Role / Scope {getSortIndicator('role')}</button>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {(() => {

                                if (!sortedUsers) {
                                    return <tr><td colSpan="4">Error: sortedUsers is undefined</td></tr>;
                                }
                                if (!Array.isArray(sortedUsers)) {
                                    return <tr><td colSpan="4">Error: sortedUsers is not an array</td></tr>;
                                }
                                return displayedUsers.map(u => (
                                <tr key={u.user_id}>
                                    <td className="px-1.5 py-2 text-sm font-medium text-left whitespace-nowrap">
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
                                                <button onClick={() => setEditingUser(u)} className="text-indigo-600 hover:text-indigo-900" title="Edit User"><Pencil size={16}/></button>
                                                <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                    <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                        {formatUserRecap(u)}
                                                    </div>
                                                </div>
                                            </div>
                                            {(u.role === 'manager' || u.role === 'company_admin') && (
                                                <button 
                                                    onClick={() => {
                                                        if (u.role === 'manager') {
                                                            setAssigningLandlordsUser(u);
                                                        } else if (u.role === 'company_admin' && u.pmc_id) {
                                                            setManagingPropertiesForCompany({ pmc_id: u.pmc_id, company_name: u.company?.company_name || 'PM Company' });
                                                        }
                                                    }} 
                                                    className="text-blue-600 hover:text-blue-900" 
                                                    title="Manage Properties"
                                                >
                                                    <Building size={16}/>
                                                </button>
                                            )}
                                            <button 
                                                onClick={() => setDeletingUser(u)} 
                                                disabled={u.user_id === user.user_id || (isGlobalAdminUser(u) && users.filter(isGlobalAdminUser).length === 1)} 
                                                className="text-red-600 hover:text-red-900 disabled:text-gray-300 disabled:cursor-not-allowed"
                                                title={u.user_id === user.user_id ? "Cannot delete yourself" : (isGlobalAdminUser(u) && users.filter(isGlobalAdminUser).length === 1) ? "Cannot delete the last Global Admin" : "Delete User"}
                                            >
                                                <Trash2 size={16}/>
                                            </button>
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
                                            <span className="cursor-help">{formatUserName(u)}</span>
                                            <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                    {formatUserRecap(u)}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-1.5 py-2 text-sm whitespace-nowrap">
                                        <div className="space-y-1">
                                            {u.email && (
                                                <div className="font-medium text-gray-900">
                                                    <span className="font-medium">Email:</span> {u.email}
                                                </div>
                                            )}
                                            {u.contact_methods && u.contact_methods
                                                .filter(method => method.type && method.type.toLowerCase() !== 'email' && method.value)
                                                .sort((a, b) => a.type.localeCompare(b.type))
                                                .map((method, index) => {
                                                    return (
                                                    <div key={index} className="text-gray-500">
                                                        <span className="font-medium capitalize">{method.type}:</span> {method.value}
                                                    </div>
                                                    );
                                                })}
                                            {!u.email && (!u.contact_methods || u.contact_methods.filter(m => m.type && m.type.toLowerCase() !== 'email' && m.value).length === 0) && (
                                                <span className="text-gray-400">No contact methods</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-1.5 py-2 whitespace-nowrap">
                                        <div className="font-medium text-gray-900 capitalize">{u.role.replace('_', ' ')}</div>
                                        <div className="text-sm text-gray-500">{u.company?.company_name || (isGlobalAdminUser(u) ? 'Global' : 'No Company')}</div>
                                        {u.role === 'manager' && (u.property_count !== undefined || u.unit_count !== undefined) && (
                                            <div className="text-xs text-gray-400 mt-1">
                                                {u.property_count || 0} {u.property_count === 1 ? 'property' : 'properties'}, {u.unit_count || 0} {u.unit_count === 1 ? 'unit' : 'units'}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                                ));
                            })()}
                        </tbody>
                    </table>
                    </div>
                </div>
                {hasMoreUsers && (
                    <div className="pt-3 mt-4 border-t text-right flex-shrink-0">
                        <button
                            type="button"
                            onClick={showMoreUsers}
                            className="text-indigo-600 hover:text-indigo-800 underline text-sm font-medium"
                        >
                            more
                        </button>
                    </div>
                )}
                </div>
            </Card>
            {editingUser && <EditUserModal userToEdit={editingUser} companies={companies || []} users={users} isGlobalAdminUser={isGlobalAdminUser} onClose={() => setEditingUser(null)} onUpdateSuccess={handleSuccess} />}
            {assigningLandlordsUser && (
                <AssignPropertiesModal 
                    manager={assigningLandlordsUser} 
                    onClose={() => setAssigningLandlordsUser(null)} 
                    onAssignSuccess={handleSuccess} 
                />
            )}
            {managingPropertiesForCompany && (
                <AssignPropertiesModal 
                    pmCompany={managingPropertiesForCompany} 
                    onClose={() => setManagingPropertiesForCompany(null)} 
                    onAssignSuccess={handleSuccess} 
                />
            )}
            {deletingUser && (
                deletingUser.user_id === user.user_id || (isGlobalAdminUser(deletingUser) && users.filter(isGlobalAdminUser).length === 1) ? (
                    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50">
                        <div className="w-full max-w-md p-6 space-y-4 bg-white rounded-lg shadow-xl">
                            <h2 className="text-xl font-bold text-gray-900">Cannot Archive User</h2>
                            <p className="text-sm text-gray-600">
                                {deletingUser.user_id === user.user_id 
                                    ? "You cannot archive your own account."
                                    : "You cannot archive the last Global Admin."}
                            </p>
                            <div className="flex justify-end pt-4">
                                <button type="button" onClick={() => setDeletingUser(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Close</button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <ArchiveModal 
                        entity={deletingUser}
                        entityType="user"
                        entityName={`${deletingUser.first_name || ''} ${deletingUser.middle_name || ''} ${deletingUser.last_name || ''}`.trim() || deletingUser.email || 'User'}
                        idField="user_id"
                        onClose={() => setDeletingUser(null)}
                        onArchiveSuccess={handleSuccess}
                        showCascade={false}
                        requireReason={false}
                        isAdmin={user?.role === 'global_admin'}
                    />
                )
            )}
        </div>
    );
};

const CreateUserForm = ({ companies, onUserCreated }) => {
    const { user: loggedInUser } = useContext(AuthContext);
    const [firstName, setFirstName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [lastName, setLastName] = useState('');
    const [contactMethods, setContactMethods] = useState([]);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [role, setRole] = useState('admin');
    const [pmcId, setPmcId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const contactMethodInputRefs = useRef({});
    const formBodyRef = useRef(null);

    // Form persistence
    const { clearPersistedData } = useFormPersistence('add-user', {
        firstName, middleName, lastName, contactMethods, email, password, confirmPassword, role, pmcId
    }, (state) => {
        setFirstName(state.firstName || '');
        setMiddleName(state.middleName || '');
        setLastName(state.lastName || '');
        setContactMethods(state.contactMethods || []);
        setEmail(state.email || '');
        setPassword(state.password || '');
        setConfirmPassword(state.confirmPassword || '');
        setRole(state.role || 'admin');
        setPmcId(state.pmcId || '');
    });

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
        setContactMethods([]);
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setRole('admin');
        setPmcId('');
        setFormError('');
        clearPersistedData();
    }, [clearPersistedData]);

    const handleCreateUser = async (e) => {
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
            let finalRole = role;
            let finalPmcId = pmcId || null;
            
            // For Global Admins, convert 'admin' role based on company selection
            if (loggedInUser.role === 'global_admin' && role === 'admin') {
                if (pmcId) {
                    finalRole = 'company_admin';
                } else {
                    finalRole = 'global_admin';
                }
            }
            // For Company Admins, keep role as 'admin' and let backend handle the conversion
            // The backend will automatically set the correct company and convert to 'company_admin'

            // Hash password
            const bcrypt = await import('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password || 'temp_password_' + Math.random().toString(36).substring(7), salt);

            const userId = loggedInUser?.user_id;
            
            // Create user account
            const { data: userData, error: userError } = await insertWithAudit(
                'users',
                [{
                    email,
                    password_hash: passwordHash,
                    role: finalRole,
                    pmc_id: finalPmcId || null
                }],
                userId
            );
            
            const user = userData?.[0] || userData;
            if (userError || !user?.user_id) {
                setFormError(userError?.message || 'Failed to create user account.');
                return;
            }
            
            // Create contact record
            const { error: contactError } = await insertWithAudit(
                'contacts',
                [{
                    contactable_id: user.user_id,
                    contactable_type: 'user',
                    first_name: firstName,
                    middle_name: middleName,
                    last_name: lastName
                }],
                userId
            );
            
            if (contactError) {
                // Clean up user if contact creation fails
                await deleteWithAudit('users', 'user_id', user.user_id, userId);
                setFormError(contactError.message || 'Failed to create contact record.');
                return;
            }
            
            // Add contact methods if provided
            const validContactMethods = contactMethods.filter(m => m.type && m.value && m.type.toLowerCase() !== 'email');
            if (validContactMethods.length > 0) {
                // Get the contact_id for the user
                const { data: contactData } = await supabase
                    .from('contacts')
                    .select('contact_id')
                    .eq('contactable_id', user.user_id)
                    .eq('contactable_type', 'user')
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
            onUserCreated();
            // Scroll form body to top after state updates
            setTimeout(() => {
                if (formBodyRef.current) {
                    formBodyRef.current.scrollTop = 0;
                }
            }, 0);
        } catch {
            setFormError('Could not connect to the server.');
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
        <Card hideTitle className="lg:col-span-1 max-h-[calc(100vh-160px)]" contentClassName="h-full">
            <form onSubmit={handleCreateUser} className="flex flex-col h-full">
                <div className="flex items-start justify-between pb-4 mb-4 border-b">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Add User</h2>
                    </div>
                </div>
                <div ref={formBodyRef} className="flex-1 overflow-y-auto pr-1 space-y-4">
                 <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-1"><label className="block text-sm font-medium text-gray-700">First Name</label><input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                    <div className="sm:col-span-1"><label className="block text-sm font-medium text-gray-700">Middle</label><input type="text" value={middleName} onChange={(e) => setMiddleName(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                    <div className="sm:col-span-1"><label className="block text-sm font-medium text-gray-700">Last Name</label><input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700">Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
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
                <div><label className="block text-sm font-medium text-gray-700">Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Confirm Password</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                {loggedInUser.role === 'global_admin' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Scope</label>
                        <select 
                            value={pmcId} 
                            onChange={e => {
                                const newPmcId = e.target.value;
                                setPmcId(newPmcId);
                                // If Scope is Global, force Role to Admin
                                if (!newPmcId && (role === 'manager' || role === 'staff')) {
                                    setRole('admin');
                                }
                            }} 
                            className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm"
                        >
                            <option value="">Global</option>
                            {(() => {
                                if (!companies || !Array.isArray(companies)) {
                                    return <option>Error: companies is invalid</option>;
                                }
                                return companies.map(c => <option key={c.pmc_id} value={c.pmc_id}>{c.company_name}</option>);
                            })()}
                        </select>
                    </div>
                )}
                <div><label className="block text-sm font-medium text-gray-700">Role</label>
                    <select 
                        value={role} 
                        onChange={e => setRole(e.target.value)} 
                        className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm"
                    >
                        <option value="admin">Admin</option>
                        {/* Manager and Staff roles only available when Scope is a specific company (not Global) */}
                        {pmcId && (
                            <>
                                <option value="manager">Manager</option>
                                <option value="staff">Staff</option>
                            </>
                        )}
                    </select>
                </div>
                </div>
                <div className="pt-4 mt-4 border-t flex flex-col gap-3">
                    {formError && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{formError}</div>)}
                    <div className="flex justify-end gap-3 flex-wrap">
                        <button type="button" onClick={handleClear} className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">
                            Clear
                        </button>
                        <button type="submit" disabled={isSubmitting} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                            {isSubmitting ? 'Adding...' : 'Add User'}
                        </button>
                    </div>
                </div>
            </form>
        </Card>
    );
};
const EditUserModal = ({ userToEdit, companies, users, isGlobalAdminUser, onClose, onUpdateSuccess }) => {
    const { user: adminUser } = useContext(AuthContext);
    const [firstName, setFirstName] = useState(userToEdit.contact?.first_name || '');
    const [middleName, setMiddleName] = useState(userToEdit.contact?.middle_name || '');
    const [lastName, setLastName] = useState(userToEdit.contact?.last_name || '');
    const [email, setEmail] = useState(userToEdit.email || '');
    const [role, setRole] = useState(userToEdit.role.includes('admin') ? 'admin' : userToEdit.role);
    const [pmcId, setPmcId] = useState(userToEdit.pmc_id || '');
    const [contactMethods, setContactMethods] = useState(() => 
        (userToEdit.contact_methods || []).map(m => ({ ...m, tempId: Date.now() + Math.random() }))
    );
    
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [hasAttemptedDowngrade, setHasAttemptedDowngrade] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const contactMethodInputRefs = useRef({});

    // Security validation helpers
    const isEditingSelf = userToEdit.user_id === adminUser.user_id;
    const isCurrentlyGlobalAdmin = isGlobalAdminUser(userToEdit);
    const totalGlobalAdmins = users.filter(isGlobalAdminUser).length;
    const isLastGlobalAdmin = isCurrentlyGlobalAdmin && totalGlobalAdmins === 1;
    
    // Check if the current selection would create an invalid state
    const wouldBeGlobalAdmin = role === 'admin' && !pmcId;
    const wouldBeCompanyAdmin = role === 'admin' && pmcId;
    
    // Security validations
    const cannotDowngradeLastGlobalAdmin = isEditingSelf && isLastGlobalAdmin && wouldBeCompanyAdmin;
    const showLastGlobalAdminWarning = isEditingSelf && isLastGlobalAdmin && hasAttemptedDowngrade;
    const cannotUpgradeToGlobalAdmin = isEditingSelf && adminUser.role === 'company_admin' && wouldBeGlobalAdmin;

    // Auto-reset scope to Global when last Global Admin tries to downgrade
    useEffect(() => {
        if (cannotDowngradeLastGlobalAdmin && pmcId) {
            setPmcId('');
            // Don't set hasAttemptedDowngrade here - only set it when user actually tries to change
        }
    }, [cannotDowngradeLastGlobalAdmin, pmcId]);

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

    const handleScopeChange = (e) => {
        const newPmcId = e.target.value;
        setPmcId(newPmcId);
        
        // If Scope is changed to Global, force Role to Admin (Manager/Staff not allowed for Global)
        if (!newPmcId && (role === 'manager' || role === 'staff')) {
            setRole('admin');
        }
        
        // Set hasAttemptedDowngrade only when user actually tries to change to a company
        if (isEditingSelf && isLastGlobalAdmin && newPmcId) {
            setHasAttemptedDowngrade(true);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        
        // Security validations
        if (showLastGlobalAdminWarning && wouldBeCompanyAdmin) {
            setError('Cannot downgrade the last Global Admin. There must always be at least one Global Admin.');
            return;
        }
        
        if (cannotUpgradeToGlobalAdmin) {
            setError('Company Admins cannot promote themselves to Global Admin. Only Global Admins can create other Global Admins.');
            return;
        }
        
        if (newPassword && newPassword !== confirmPassword) {
            setError('New passwords do not match.');
            return;
        }
        
        setIsSubmitting(true);
        setError('');
        try {
            let finalRole = role;
            if (role === 'admin' && pmcId) {
                finalRole = 'company_admin';
            } else if (role === 'admin' && !pmcId) {
                finalRole = 'global_admin';
            }
            

            const payload = { 
                firstName, middleName, lastName, email,
                role: finalRole,
                pmc_id: pmcId || null,
                contact_methods: contactMethods.filter(m => m.type.toLowerCase() !== 'email' && m.type && m.value)
            };
            if (newPassword) {
                // Hash the new password
                const bcrypt = await import('bcryptjs');
                const salt = await bcrypt.genSalt(10);
                const passwordHash = await bcrypt.hash(newPassword, salt);
                payload.password_hash = passwordHash;
            }
            
            
            // Update user account using audit helper
            const { error: userError } = await updateWithAudit(
                'users',
                {
                    email: payload.email,
                    role: payload.role,
                    pmc_id: payload.pmc_id,
                    ...(payload.password_hash && { password_hash: payload.password_hash })
                },
                'user_id',
                userToEdit.user_id,
                adminUser.user_id
            );
            
            if (userError) {
                setError(userError.message || 'Failed to update user account.');
                return;
            }
            
            // Get contact_id for updating contact record
            const { data: existingContact } = await supabase
                .from('contacts')
                .select('contact_id')
                .eq('contactable_id', userToEdit.user_id)
                .eq('contactable_type', 'user')
                .maybeSingle();
            
            if (existingContact?.contact_id) {
                // Update contact record using audit helper
                const { error: contactError } = await updateWithAudit(
                    'contacts',
                    {
                        first_name: payload.firstName,
                        middle_name: payload.middleName,
                        last_name: payload.lastName
                    },
                    'contact_id',
                    existingContact.contact_id,
                    adminUser.user_id
                );
                
                if (contactError) {
                    setError(contactError.message || 'Failed to update contact record.');
                    return;
                }
                
                // Update contact methods
                const validContactMethods = payload.contact_methods || [];
                
                // Get existing contact methods to compare
                const { data: existingMethods } = await supabase
                    .from('contact_methods')
                    .select('method_id, method_type, value')
                    .eq('contact_id', existingContact.contact_id)
                    .neq('method_type', 'Email');
                
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
                        adminUser.user_id
                    );
                }
                
                // Insert only new contact methods
                const methodsToInsert = validContactMethods.filter(method => {
                    const key = `${method.type}:${method.value}`;
                    return !existingMethodsMap.has(key);
                });
                
                if (methodsToInsert.length > 0) {
                    const contactMethodsToInsert = methodsToInsert.map(method => ({
                        contact_id: existingContact.contact_id,
                        method_type: method.type,
                        value: method.value
                    }));
                    
                    const { error: contactMethodsError } = await insertWithAudit(
                        'contact_methods',
                        contactMethodsToInsert,
                        adminUser.user_id
                    );
                    
                    if (contactMethodsError) {
                        setError(contactMethodsError.message || 'Failed to update contact methods.');
                        return;
                    }
                } else if (validContactMethods.length === 0 && existingMethods && existingMethods.length > 0) {
                    // Delete all existing contact methods if none are provided
                    for (const method of existingMethods) {
                        await deleteWithAudit(
                            'contact_methods',
                            'method_id',
                            method.method_id,
                            adminUser.user_id
                        );
                    }
                }
            }
            
            onUpdateSuccess();
        } catch (error) {
            console.error('Error updating user:', error);
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
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div 
                className="w-full max-w-lg max-h-[90vh] bg-white rounded-lg shadow-xl flex flex-col" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                {/* Fixed Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 className="text-2xl font-bold text-gray-800">Edit User</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
                </div>
                
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto">
                    <form onSubmit={handleSubmit} className="p-6 space-y-4" id="edit-user-form">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                         <div><label className="block text-sm font-medium text-gray-700">First Name</label><input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                         <div><label className="block text-sm font-medium text-gray-700">Middle</label><input type="text" value={middleName} onChange={(e) => setMiddleName(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                         <div><label className="block text-sm font-medium text-gray-700">Last Name</label><input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                    </div>
                    <div><label className="block text-sm font-medium text-gray-700">Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                    {adminUser.role === 'global_admin' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Scope</label>
                            <select 
                                value={pmcId} 
                                onChange={handleScopeChange} 
                                className={`block w-full px-3 py-2 mt-1 bg-white border rounded-md shadow-sm ${
                                    cannotDowngradeLastGlobalAdmin ? 'border-red-300 bg-red-50' : 'border-gray-300'
                                }`}
                                disabled={cannotDowngradeLastGlobalAdmin}
                            >
                                <option value="">Global</option>
                                {companies.map(c => <option key={c.pmc_id} value={c.pmc_id}>{c.company_name}</option>)}
                            </select>
                            {showLastGlobalAdminWarning && (
                                <p className="mt-1 text-sm text-red-600">Cannot downgrade the last Global Admin</p>
                            )}
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Role</label>
                        <select 
                            value={role} 
                            onChange={(e) => setRole(e.target.value)} 
                            className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm"
                        >
                            <option value="admin">Admin</option>
                            {/* Manager and Staff roles only available when Scope is a specific company (not Global) */}
                            {pmcId && (
                                <>
                                    <option value="manager">Manager</option>
                                    <option value="staff">Staff</option>
                                </>
                            )}
                        </select>
                    </div>
                    {adminUser.role === 'company_admin' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Scope</label>
                            <select 
                                value={pmcId} 
                                onChange={handleScopeChange} 
                                className={`block w-full px-3 py-2 mt-1 bg-white border rounded-md shadow-sm ${
                                    cannotUpgradeToGlobalAdmin ? 'border-red-300 bg-red-50' : 'border-gray-300'
                                }`}
                                disabled={cannotUpgradeToGlobalAdmin}
                            >
                                {/* Company admins can only set scope to their own company, not Global */}
                                {companies.map(c => <option key={c.pmc_id} value={c.pmc_id}>{c.company_name}</option>)}
                            </select>
                            {cannotUpgradeToGlobalAdmin && (
                                <p className="mt-1 text-sm text-red-600">Company Admins cannot promote themselves to Global Admin</p>
                            )}
                        </div>
                    )}
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
                            <div><label className="block text-sm font-medium text-gray-700">New Password</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                            <div><label className="block text-sm font-medium text-gray-700">Confirm</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" /></div>
                        </div>
                    </div>
                        {error && (<div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">{error}</div>)}
                    </form>
                </div>
                
                {/* Fixed Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" form="edit-user-form" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">{isSubmitting ? 'Saving...' : 'Save Changes'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
};
const DeleteUserModal = ({ user, isSelf, isLastGlobalAdmin, onClose, onDeleteSuccess }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    const handleDelete = async () => {
        if (isSelf) {
            setError('You cannot delete your own account.');
            return;
        }
        if (isLastGlobalAdmin) {
            setError('You cannot delete the last Global Admin.');
            return;
        }
        setIsSubmitting(true);
        setError('');
        try {

            // Delete user and related records
            // First, get the contact_id to delete contact methods
            const { data: contactData } = await supabase
                .from('contacts')
                .select('contact_id')
                .eq('contactable_id', user.user_id)
                .eq('contactable_type', 'user')
                .single();
            
            if (contactData) {
                // Delete contact methods
                await supabase
                    .from('contact_methods')
                    .delete()
                    .eq('contact_id', contactData.contact_id);
                
                // Delete contact record
                await supabase
                    .from('contacts')
                    .delete()
                    .eq('contact_id', contactData.contact_id);
            }
            
            // Delete user account
            const { error: userError } = await supabase
                .from('users')
                .delete()
                .eq('user_id', user.user_id);
            
            if (userError) {
                setError(userError.message || 'Failed to delete user.');
                return;
            }
            
            onDeleteSuccess();
        } catch (error) {
            setError('Could not delete user: ' + error.message);
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
    
    const formatUserName = (u) => {
        const first = u.contact?.first_name || '';
        const last = u.contact?.last_name || '';
        const middle = u.contact?.middle_name ? ` ${u.contact.middle_name.charAt(0)}.` : '';
        return `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
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
                    Are you sure you want to permanently delete the user <span className="font-bold">{formatUserName(user)}</span>? This action cannot be undone.
                </p>
                {error && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{error}</div>)}
                <div className="flex justify-end gap-4 pt-4">
                    <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                    <button type="button" onClick={handleDelete} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700">{isSubmitting ? 'Deleting...' : 'Delete User'}</button>
                </div>
            </div>
        </div>
    );
};

const AssignPropertiesModal = ({ manager, pmCompany, onClose, onAssignSuccess }) => {
    const [properties, setProperties] = useState([]);
    const [landlords, setLandlords] = useState([]);
    const [assignedPropertyIds, setAssignedPropertyIds] = useState(new Set());
    const [selectedBulkLandlordId, setSelectedBulkLandlordId] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    // Determine PM company ID and manager ID
    const pmcId = manager?.pmc_id || pmCompany?.pmc_id;
    const managerUserId = manager?.user_id;

    // Fetch properties for the manager's PM company or PM company directly
    useEffect(() => {
        const fetchProperties = async () => {
            if (!pmcId) {
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            try {
                // Fetch all properties for the PM company
                const { data: propertiesData, error: propertiesError } = await supabase
                    .from('properties')
                    .select(`
                        property_id,
                        property_name,
                        landlord_id,
                        manager_id
                    `)
                    .eq('pmc_id', pmcId)
                    .eq('is_archived', false);

                if (propertiesError) {
                    console.error('Error fetching properties:', propertiesError);
                    setError('Failed to load properties.');
                    setIsLoading(false);
                    return;
                }

                // Get landlord IDs from properties (only landlords with properties)
                const landlordIds = [...new Set(propertiesData?.map(p => p.landlord_id).filter(Boolean) || [])];
                let landlordsData = [];
                if (landlordIds.length > 0) {
                    const { data: landlordsResult } = await supabase
                        .from('landlords')
                        .select('landlord_id')
                        .in('landlord_id', landlordIds);
                    
                    const landlordContactIds = landlordsResult?.map(l => l.landlord_id) || [];
                    const { data: contactsResult } = await supabase
                        .from('contacts')
                        .select('contactable_id, first_name, last_name, middle_name')
                        .in('contactable_id', landlordContactIds)
                        .eq('contactable_type', 'landlord');
                    
                    landlordsData = landlordContactIds.map(landlordId => {
                        const contact = contactsResult?.find(c => c.contactable_id === landlordId);
                        const firstName = contact?.first_name || '';
                        const lastName = contact?.last_name || '';
                        const middleName = contact?.middle_name || '';
                        const landlordName = `${lastName || ''}, ${firstName || ''}${middleName ? ` ${middleName.charAt(0)}.` : ''}`.trim() || 'Unnamed Landlord';
                        return {
                            landlord_id: landlordId,
                            first_name: firstName,
                            last_name: lastName,
                            middle_name: middleName,
                            landlord_name: landlordName
                        };
                    });
                }

                // Get addresses and unit counts for properties
                const propertyIds = propertiesData?.map(p => p.property_id) || [];
                const [addressesResult, unitsResult] = await Promise.all([
                    propertyIds.length > 0 ? supabase
                        .from('addresses')
                        .select('addressable_id, address_line_1, city, state_province_region')
                        .in('addressable_id', propertyIds)
                        .eq('addressable_type', 'property') : Promise.resolve({ data: [] }),
                    propertyIds.length > 0 ? supabase
                        .from('units')
                        .select('property_id')
                        .in('property_id', propertyIds) : Promise.resolve({ data: [] })
                ]);

                // Count units per property
                const unitsPerProperty = {};
                unitsResult.data?.forEach(unit => {
                    unitsPerProperty[unit.property_id] = (unitsPerProperty[unit.property_id] || 0) + 1;
                });

                // Combine property data
                const propertiesWithData = propertiesData.map(property => {
                    const address = addressesResult.data?.find(a => a.addressable_id === property.property_id);
                    const landlord = landlordsData.find(l => l.landlord_id === property.landlord_id);
                    const landlordName = landlord 
                        ? `${landlord.last_name || ''}, ${landlord.first_name || ''}${landlord.middle_name ? ` ${landlord.middle_name.charAt(0)}.` : ''}`.trim()
                        : 'No landlord';
                    
                    return {
                        ...property,
                        address_line_1: address?.address_line_1 || '',
                        city: address?.city || '',
                        state_province_region: address?.state_province_region || '',
                        unit_count: unitsPerProperty[property.property_id] || 0,
                        landlord_name: landlordName,
                        isAssignedToThisManager: managerUserId ? property.manager_id === managerUserId : false
                    };
                });

                setProperties(propertiesWithData || []);
                setLandlords(landlordsData);
                
                // Set initially assigned properties (only if manager is specified)
                if (managerUserId) {
                    const assigned = new Set(
                        propertiesWithData
                            .filter(p => p.manager_id === managerUserId)
                            .map(p => p.property_id)
                    );
                    setAssignedPropertyIds(assigned);
                } else {
                    setAssignedPropertyIds(new Set());
                }
            } catch (err) {
                console.error('Error fetching properties:', err);
                setError('Failed to load properties: ' + err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchProperties();
    }, [pmcId, managerUserId]);

    const filteredProperties = useMemo(() => {
        if (!searchTerm.trim()) return properties;
        
        const searchLower = searchTerm.toLowerCase();
        return properties.filter(property => {
            const nameMatch = property.property_name?.toLowerCase().includes(searchLower);
            const addressMatch = property.address_line_1?.toLowerCase().includes(searchLower) || 
                                 property.city?.toLowerCase().includes(searchLower);
            const landlordMatch = property.landlord_name?.toLowerCase().includes(searchLower);
            return nameMatch || addressMatch || landlordMatch;
        });
    }, [properties, searchTerm]);

    const handleToggleProperty = (propertyId) => {
        const newAssigned = new Set(assignedPropertyIds);
        if (newAssigned.has(propertyId)) {
            newAssigned.delete(propertyId);
        } else {
            newAssigned.add(propertyId);
        }
        setAssignedPropertyIds(newAssigned);
    };

    const handleBulkAssignAll = () => {
        if (!selectedBulkLandlordId) return;
        
        // Get all properties for the selected landlord
        const landlordProperties = properties.filter(p => p.landlord_id === parseInt(selectedBulkLandlordId));
        const newAssigned = new Set(assignedPropertyIds);
        
        // Add all properties of this landlord to assigned
        landlordProperties.forEach(p => newAssigned.add(p.property_id));
        setAssignedPropertyIds(newAssigned);
        
        // Clear the dropdown selection
        setSelectedBulkLandlordId('');
    };
    
    // Get properties for the selected landlord (for display)
    const selectedLandlordProperties = useMemo(() => {
        if (!selectedBulkLandlordId) return [];
        return properties.filter(p => p.landlord_id === parseInt(selectedBulkLandlordId));
    }, [selectedBulkLandlordId, properties]);

    const handleSave = async () => {
        setIsSubmitting(true);
        setError('');

        try {
            // Get current assignments
            const currentlyAssigned = properties
                .filter(p => p.manager_id === manager.user_id)
                .map(p => p.property_id);
            
            // Determine which properties to assign and unassign
            const toAssign = Array.from(assignedPropertyIds).filter(id => !currentlyAssigned.includes(id));
            const toUnassign = currentlyAssigned.filter(id => !assignedPropertyIds.has(id));

            // Unassign properties from this manager (set manager_id to null)
            if (toUnassign.length > 0) {
                const { error: unassignError } = await supabase
                    .from('properties')
                    .update({ manager_id: null })
                    .in('property_id', toUnassign);

                if (unassignError) {
                    setError('Failed to unassign properties: ' + unassignError.message);
                    setIsSubmitting(false);
                    return;
                }
            }

            // Assign properties to this manager
            if (toAssign.length > 0) {
                const { error: assignError } = await supabase
                    .from('properties')
                    .update({ manager_id: manager.user_id })
                    .in('property_id', toAssign);

                if (assignError) {
                    setError('Failed to assign properties: ' + assignError.message);
                    setIsSubmitting(false);
                    return;
                }
            }

            onAssignSuccess();
            onClose();
        } catch (err) {
            setError('Failed to save assignments: ' + err.message);
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

    const formatPropertyName = (property) => {
        if (property.property_name) return property.property_name;
        if (property.address_line_1) {
            return `${property.address_line_1}${property.city ? `, ${property.city}` : ''}`;
        }
        return 'Unnamed Property';
    };


    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            onClick={handleBackdropClick}
        >
            <div 
                className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                {/* Header */}
                <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-gray-900">
                        Manage Properties{manager ? ` for ${manager.contact?.first_name} ${manager.contact?.last_name}` : pmCompany ? ` for ${pmCompany.company_name}` : ''}
                    </h2>
                    <button 
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden flex flex-col p-6">
                    {/* Search Box */}
                    <div className="mb-4 flex-shrink-0">
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search className="h-5 w-5 text-gray-400" />
                            </div>
                            <input
                                type="text"
                                placeholder="Search properties by name, address, or landlord..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>
                        <div className="mt-2 text-sm text-gray-600">
                            {searchTerm ? (
                                <span>Showing {filteredProperties.length} of {properties.length} properties</span>
                            ) : (
                                <span>Total: {properties.length} properties</span>
                            )}
                        </div>
                    </div>

                    {/* Bulk Assignment by Landlord */}
                    {landlords.length > 0 && (
                        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md flex-shrink-0">
                            <div className="text-sm font-medium text-blue-900 mb-2">Bulk Assign by Landlord:</div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={selectedBulkLandlordId}
                                    onChange={(e) => setSelectedBulkLandlordId(e.target.value)}
                                    className="flex-1 px-3 py-2 border border-blue-300 rounded-md bg-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="">Select a landlord...</option>
                                    {landlords
                                        .filter(landlord => properties.some(p => p.landlord_id === landlord.landlord_id))
                                        .map(landlord => {
                                            const landlordPropertyCount = properties.filter(p => p.landlord_id === landlord.landlord_id).length;
                                            const displayName = landlord.landlord_name || `${landlord.last_name || ''}, ${landlord.first_name || ''}${landlord.middle_name ? ` ${landlord.middle_name.charAt(0)}.` : ''}`.trim() || 'Unnamed Landlord';
                                            return (
                                                <option key={landlord.landlord_id} value={landlord.landlord_id}>
                                                    {displayName} ({landlordPropertyCount} {landlordPropertyCount === 1 ? 'property' : 'properties'})
                                                </option>
                                            );
                                        })}
                                </select>
                                <button
                                    type="button"
                                    onClick={handleBulkAssignAll}
                                    disabled={!selectedBulkLandlordId}
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Assign All
                                </button>
                            </div>
                            {selectedBulkLandlordId && selectedLandlordProperties.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-blue-200">
                                    <div className="text-xs font-medium text-blue-900 mb-1">Properties to be assigned:</div>
                                    <div className="text-xs text-blue-700 space-y-1">
                                        {selectedLandlordProperties.map(property => (
                                            <div key={property.property_id}>
                                                • {formatPropertyName(property)}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Properties List */}
                    <div className="flex-1 overflow-auto border border-gray-200 rounded-md">
                        {isLoading ? (
                            <div className="p-8 text-center text-gray-500">Loading properties...</div>
                        ) : filteredProperties.length === 0 ? (
                            <div className="p-8 text-center text-gray-500">
                                {searchTerm ? 'No properties found matching your search.' : 'No properties found for this PM company.'}
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-200">
                                {filteredProperties.map(property => (
                                    <label
                                        key={property.property_id}
                                        className="flex items-center p-4 hover:bg-gray-50 cursor-pointer"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={assignedPropertyIds.has(property.property_id)}
                                            onChange={() => handleToggleProperty(property.property_id)}
                                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                        />
                                        <div className="ml-3 flex-1">
                                            <div className="font-medium text-gray-900">
                                                {formatPropertyName(property)}
                                            </div>
                                            {property.landlord_name && (
                                                <div className="text-sm text-gray-500">Owner: {property.landlord_name}</div>
                                            )}
                                            <div className="text-xs text-gray-500 mt-1">
                                                {property.unit_count || 0} {property.unit_count === 1 ? 'unit' : 'units'}
                                            </div>
                                            {managerUserId && property.manager_id && property.manager_id !== managerUserId && (
                                                <div className="text-xs text-orange-600 mt-1">
                                                    Currently assigned to another manager
                                                </div>
                                            )}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="mt-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                            {error}
                        </div>
                    )}
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
                        {managerUserId && (
                            <button 
                                type="button"
                                onClick={handleSave} 
                                disabled={isSubmitting || isLoading}
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? 'Saving...' : 'Save Assignments'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

