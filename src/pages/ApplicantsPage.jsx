import { useContext, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X, FileText, Search, PlusCircle, Pencil, Trash2, Trash, Home, Eye, RotateCcw, CheckCircle } from 'lucide-react';
import { convertFileToJSONSchema, extractFormValues } from '../utils/pdf-to-json-client.js';
import ApplyForUnitsModal from '../components/ApplyForUnitsModal.jsx';
import { AuthContext } from '../contexts';
import { supabase } from '../lib/supabase.js';
import { useSortableData } from '../hooks';
import { useFinderLimit } from '../hooks/useFinderLimit';
import { useFormPersistence } from '../hooks/useFormPersistence';
import { parseTemplateData } from '../utils/template-data.js';
import { mapImportedDataToTemplate, normalizeDates } from '../utils/application-data-mapper.js';
import { Card } from '../components/ui';
import DateInput from '../components/DateInput';
import SSNInput from '../components/SSNInput';
import { ApplicationFormBuilder } from '../components/ApplicationFormBuilder';
import DocumentManagement from '../components/DocumentManagement';
import { deleteWithAudit } from '../lib/auditHelpers.js';
import { stemmer } from 'stemmer';
import ArchiveModal from '../components/ArchiveModal';
import ContactMethodTypeInput from '../components/ContactMethodTypeInput';

// Utility function for sorting contact methods
const sortContactMethods = (contactMethods, userEmail) => {
    if (!contactMethods || contactMethods.length === 0) return [];
    
    return contactMethods.sort((a, b) => {
        // Primary email (login email) first
        if (a.value === userEmail && a.method_type === 'email') return -1;
        if (b.value === userEmail && b.method_type === 'email') return 1;
        
        // Additional emails (recognized by email format) sorted by label
        const aIsEmail = a.method_type === 'email' || a.value.includes('@');
        const bIsEmail = b.method_type === 'email' || b.value.includes('@');
        
        if (aIsEmail && !bIsEmail) return -1;
        if (!aIsEmail && bIsEmail) return 1;
        
        if (aIsEmail && bIsEmail) {
            return a.method_type.localeCompare(b.method_type);
        }
        
        // Phone numbers sorted by label
        if (a.method_type === 'phone' && b.method_type !== 'phone') return -1;
        if (a.method_type !== 'phone' && b.method_type === 'phone') return 1;
        
        if (a.method_type === 'phone' && b.method_type === 'phone') {
            return a.method_type.localeCompare(b.method_type);
        }
        
        // All other social media contact methods sorted by label
        return a.method_type.localeCompare(b.method_type);
    });
};

// Utility function for formatting applicant names
const formatApplicantName = (a) => {
    const first = a.contact?.first_name || '';
    const last = a.contact?.last_name || '';
    const middle = a.contact?.middle_name ? ` ${a.contact.middle_name.charAt(0)}.` : '';
    return `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
};

// Utility function for formatting applicant recap for hover tooltip
const formatApplicantRecap = (a) => {
    const parts = [];
    
    // Name
    const first = a.contact?.first_name || '';
    const middle = a.contact?.middle_name || '';
    const last = a.contact?.last_name || '';
    if (first || middle || last) {
        const nameParts = [first, middle, last].filter(Boolean);
        if (nameParts.length > 0) {
            parts.push(`Name: ${nameParts.join(' ')}`);
        }
    }
    
    // Email
    if (a.email) {
        parts.push(`Email: ${a.email}`);
    }
    
    // Date of Birth
    if (a.date_of_birth) {
        const dob = formatDate(a.date_of_birth);
        if (dob) {
            parts.push(`Date of Birth: ${dob}`);
        }
    }
    
    // SSN
    if (a.social_security_number) {
        parts.push(`SSN: ${a.social_security_number}`);
    }
    
    // Gender
    if (a.gender) {
        parts.push(`Gender: ${a.gender}`);
    }
    
    // Contact Methods (excluding email)
    const contactMethods = (a.contact_methods || []).filter(m => 
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

// This is the main component for the Applicants page
export default function ApplicantsPage() {
    const { user } = useContext(AuthContext);
    const [applicants, setApplicants] = useState([]);
    const [units, setUnits] = useState([]);
    const [editingApplicant, setEditingApplicant] = useState(null);
    const [deletingApplicant, setDeletingApplicant] = useState(null);
    const [applyingForUnits, setApplyingForUnits] = useState(null);
    const [applyingForUnitsWithApplication, setApplyingForUnitsWithApplication] = useState(null);
    const [reviewingApplicant, setReviewingApplicant] = useState(null);
    const [viewingApplicationDetail, setViewingApplicationDetail] = useState(false);
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
    
    // Filter applicants based on search term
    const filteredApplicants = useMemo(() => {
        if (!applicants || !Array.isArray(applicants)) {
            return [];
        }
        if (!debouncedSearchTerm.trim()) {
            return applicants;
        }
        
        const searchLower = debouncedSearchTerm.toLowerCase();
        return applicants.filter(applicant => {
            // Search in basic applicant fields
            const nameMatch = [
                applicant.contact?.first_name,
                applicant.contact?.last_name,
                applicant.contact?.middle_name,
                applicant.email,
                applicant.date_of_birth,
                applicant.social_security_number,
                applicant.gender
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            // Search in address fields
            const addressMatch = [
                applicant.address_line_1,
                applicant.city,
                applicant.state_province_region,
                applicant.unit_number
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            // Search in contact methods
            const contactMatch = applicant.contact_methods && applicant.contact_methods.some(method => 
                method.value && method.value.toLowerCase().includes(searchLower)
            );
            
            return nameMatch || addressMatch || contactMatch;
        });
    }, [applicants, debouncedSearchTerm]);
    const { items: sortedApplicants, requestSort, sortConfig } = useSortableData(filteredApplicants, { key: 'name', direction: 'ascending' });
    const { visibleCount: applicantVisibleCount, hasMore: hasMoreApplicants, showMore: showMoreApplicants } = useFinderLimit(
        sortedApplicants.length,
        [debouncedSearchTerm, applicants.length]
    );
    const displayedApplicants = sortedApplicants.slice(0, applicantVisibleCount || sortedApplicants.length);
    const fetchData = async () => {
        try {
            // Fetch users, contacts, clients, contact methods, applications, and client_units
            // Determine applicant vs tenant based on active unit assignments in client_units
            // Applicants = clients without active unit assignments
            // Tenants = clients with active unit assignments (start_date <= today AND (end_date IS NULL OR end_date >= today))
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
            const clientsQuery = supabase.from('clients').select('*');
            if (!showArchived) {
                clientsQuery.eq('is_archived', false);
            }
            
            const [usersResult, userContactsResult, clientsResult, contactMethodsResult, unitsResult, applicationsResult, addressesResult, clientUnitsResult] = await Promise.all([
                supabase.from('users').select('*').eq('role', 'client'),
                supabase.from('contacts').select('*').eq('contactable_type', 'client'),
                clientsQuery,
                supabase.from('contact_methods').select(`
                    contact_id,
                    method_type,
                    value,
                    contacts!inner(
                        contactable_id,
                        contactable_type
                    )
                `),
                supabase.from('units').select('*'),
                supabase.from('client_applications').select(`
                    application_id,
                    client_id,
                    unit_id,
                    status,
                    applied_at,
                    notes,
                    units!inner(
                        unit_id,
                        unit_number,
                        properties!inner(
                            property_id
                        )
                    )
                `),
                supabase.from('addresses').select('*').eq('addressable_type', 'property'),
                // Get all non-archived client_units assignments (active, future, or past but not ended)
                // This includes approved applicants who haven't started yet (future start_date)
                supabase.from('client_units').select('client_id, start_date, end_date, is_archived')
                    .eq('is_archived', false)
                    .or(`end_date.is.null,end_date.gte.${today}`)
            ]);
            
            if (usersResult.error) {
                setApplicants([]);
            } else if (userContactsResult.error) {
                setApplicants([]);
            } else if (clientsResult.error) {
                setApplicants([]);
            } else if (contactMethodsResult.error) {
                setApplicants([]);
            } else if (applicationsResult.error) {
                setApplicants([]);
            } else if (addressesResult.error) {
                setApplicants([]);
            } else {
                // Join users with their contacts, applicant data, contact methods, and application information
                const users = usersResult.data || [];
                const userContacts = userContactsResult.data || [];
                const clientRecords = clientsResult.data || [];
                const contactMethods = contactMethodsResult.data || [];
                const applications = applicationsResult.data || [];
                const addresses = addressesResult.data || [];
                
                // Handle client_units gracefully - if table doesn't exist, treat as empty
                let clientUnits = [];
                if (clientUnitsResult.error) {
                    if (clientUnitsResult.error.code === 'PGRST205') {
                        // Table doesn't exist - log but continue
                        console.warn('client_units table does not exist, treating all clients as applicants');
                    } else {
                        console.error('Error fetching client_units:', clientUnitsResult.error);
                    }
                } else {
                    clientUnits = clientUnitsResult.data || [];
                }
                
                // Get set of client_ids that have unit assignments (active, future, or past but not ended)
                // These are tenants (or approved tenants-to-be), not applicants
                // This includes clients with approved applications who have a start_date in the future
                const clientsWithAssignments = new Set(
                    clientUnits.map(cu => cu.client_id)
                );
                
                // Process applicants with user accounts
                // Applicants = clients without unit assignments in client_units
                // Tenants = clients with unit assignments (any start_date, as long as not archived and not ended)
                const usedClientIds = new Set();
                
                const applicantsWithUserAccounts = users
                    .map(user => {
                        const userContact = userContacts.find(c => c.contactable_id === user.user_id);
                        
                        // Try to find a client record that matches this user
                        const clientRecord = clientRecords.find(cr => cr.user_id === user.user_id);
                        
                        // If no client record found, skip this user
                        if (!clientRecord) {
                            return null;
                        }
                        
                        // Check if this client has a unit assignment (active, future, or past but not ended)
                        // If so, they're a tenant (or approved tenant-to-be), not an applicant
                        const hasAssignment = clientsWithAssignments.has(clientRecord.client_id);
                        
                        // Only show clients without assignments (applicants)
                        // Clients with approved applications and future start dates should appear as tenants
                        if (hasAssignment) {
                            return null;
                        }
                        
                        usedClientIds.add(clientRecord.client_id);
                        
                        return { user, userContact, clientRecord };
                    })
                    .filter(item => item !== null) // Remove users without client records or with active assignments
                    .map(({ user, userContact, clientRecord }) => {
                        const contact = userContact;
                        
                        // Map client record to applicant record structure for compatibility
                        // client_id maps to applicant_id in the applicants view
                        const finalApplicantRecord = {
                            applicant_id: clientRecord.client_id, // Map client_id to applicant_id
                            date_of_birth: clientRecord.date_of_birth,
                            social_security_number: clientRecord.social_security_number,
                            gender: clientRecord.gender,
                            status: clientRecord.status || 'active',
                            document_data: clientRecord.document_data || {},
                            user_id: clientRecord.user_id
                        };
                        
                        // Find contact methods for this user
                        const userContactMethods = contactMethods.filter(cm => 
                            cm.contacts && cm.contacts.contactable_id === user.user_id && cm.contacts.contactable_type === 'client'
                        );
                        
                        // Find applications for this applicant
                        // Note: applications from client_applications table have client_id, not applicant_id
                        // applicant_id in finalApplicantRecord is mapped from client_id
                        const userApplications = applications.filter(app => 
                            app.client_id === finalApplicantRecord?.applicant_id
                        );
                        
                    // Determine application status and get property info
                    let applicationStatus = 'None';
                    let address_line_1 = null;
                    let unit_number = null;
                    let application_date = null;
                    
                    if (userApplications.length > 0) {
                        // Get the most recent application
                        const latestApplication = userApplications.sort((a, b) => 
                            new Date(b.applied_at) - new Date(a.applied_at)
                        )[0];
                        
                        applicationStatus = latestApplication.status;
                        const unit = latestApplication.units;
                        if (unit && unit.properties) {
                            // Find address for this property
                            const propertyAddress = addresses.find(addr => 
                                addr.addressable_id === unit.properties.property_id && 
                                addr.addressable_type === 'property'
                            );
                            if (propertyAddress) {
                                address_line_1 = propertyAddress.address_line_1;
                            }
                            unit_number = unit.unit_number;
                        }
                        application_date = latestApplication.applied_at;
                    }
                    
                        return {
                            ...user,
                            contact: contact || null,
                            contact_methods: userContactMethods,
                            ...finalApplicantRecord,
                            address_line_1,
                            unit_number,
                            application_status: applicationStatus,
                            application_date,
                            applications: userApplications
                        };
                    });
                
                // All applicants have user accounts now, so we only need applicantsWithUserAccounts
                setApplicants(applicantsWithUserAccounts);
            }
            
            if (unitsResult.error) {
                setUnits([]);
            } else {
                setUnits(unitsResult.data || []);
            }
        } catch (error) {
            setApplicants([]);
            setUnits([]);
        }
    };

    useEffect(() => {
        if (user) fetchData();
    }, [user, showArchived]);

    const handleSuccess = () => {
        setEditingApplicant(null);
        setDeletingApplicant(null);
        setApplyingForUnits(null);
        setApplyingForUnitsWithApplication(null);
        fetchData();
    };

    const handleDataRefresh = () => {
        fetchData();
    };

    const handleRestore = async (clientId) => {
        try {
            const { error } = await supabase.rpc('restore_entity', {
                p_table_name: 'clients',
                p_entity_id: clientId,
                p_restored_by_user_id: user.user_id
            });
            
            if (error) {
                console.error('Error restoring applicant:', error);
                alert('Failed to restore applicant: ' + error.message);
            } else {
                fetchData();
            }
        } catch (err) {
            console.error('Error restoring applicant:', err);
            alert('Could not connect to the server.');
        }
    };

    const getSortIndicator = (key) => {
        if (sortConfig.key === key) {
            return sortConfig.direction === 'ascending' ? '↑' : '↓';
        }
        return '';
    };

    const getApplicationStatusColor = (status) => {
        switch (status?.toLowerCase()) {
            case 'approved': return 'text-green-600 bg-green-100';
            case 'pending': return 'text-yellow-600 bg-yellow-100';
            case 'rejected': return 'text-red-600 bg-red-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    if (!user) {
        return <div className="flex items-center justify-center min-h-screen">Please log in to access this page.</div>;
    }

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Applicants</h2>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <CreateApplicantForm onApplicantCreated={handleSuccess} />
                <Card
                    title="Applicant Search"
                    className="lg:col-span-2 max-h-[calc(100vh-160px)]"
                    contentClassName="flex flex-col h-full"
                >
                    <div className="flex flex-col h-full">
                    <div className="mb-4 flex-shrink-0">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    type="text"
                                    placeholder="Search applicants..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                                />
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
                                        <button onClick={() => requestSort('contact')} className="flex items-center">
                                            Contact {getSortIndicator('contact')}
                                        </button>
                                    </th>
                                    <th className="px-3 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('application_status')}>
                                            Application Status {getSortIndicator('application_status')}
                                        </button>
                                    </th>
                                    <th className="px-3 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('property')}>
                                            Property / Unit {getSortIndicator('property')}
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {displayedApplicants.map(a => (
                                    <tr key={a.user_id} className={a.is_archived ? 'opacity-60 italic' : ''}>
                                        <td className="px-3 py-2 text-sm font-medium text-left whitespace-nowrap">
                                            <div className="flex items-center space-x-4">
                                                {!a.is_archived && (
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
                                                            <button 
                                                                onClick={() => setEditingApplicant(a)} 
                                                                className="text-indigo-600 hover:text-indigo-900" 
                                                                title="Edit Applicant"
                                                            >
                                                                <Pencil size={16}/>
                                                            </button>
                                                            <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                                <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                                    {formatApplicantRecap(a)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button 
                                                            onClick={() => setApplyingForUnits(a)} 
                                                            className="text-gray-500 hover:text-indigo-600" 
                                                            title="Select Units"
                                                        >
                                                            <Home size={16}/>
                                                        </button>
                                                        <button 
                                                            onClick={() => setApplyingForUnitsWithApplication(a)} 
                                                            className="text-blue-600 hover:text-blue-900" 
                                                            title="Fill Application"
                                                        >
                                                            <FileText size={16}/>
                                                        </button>
                                                        <button 
                                                            onClick={() => setReviewingApplicant(a)} 
                                                            className="text-green-600 hover:text-green-900" 
                                                            title="Review Application"
                                                        >
                                                            <Eye size={16}/>
                                                        </button>
                                                    </>
                                                )}
                                                {a.is_archived && showArchived && (
                                                    <button onClick={() => handleRestore(a.applicant_id)} className="text-green-600 hover:text-green-900" title="Restore Applicant"><RotateCcw size={16}/></button>
                                                )}
                                                <button 
                                                    onClick={() => setDeletingApplicant(a)} 
                                                    className="text-red-600 hover:text-red-900" 
                                                    title="Archive Applicant"
                                                >
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
                                                {a.is_archived && (
                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 mr-2">Archived</span>
                                                )}
                                                <span className="cursor-help">{formatApplicantName(a)}</span>
                                                <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block pointer-events-none tooltip-content">
                                                    <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 max-w-xs shadow-lg whitespace-pre-line">
                                                        {formatApplicantRecap(a)}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            <div className="space-y-1">
                                                {a.email && (
                                                    <div className="text-sm text-gray-900">
                                                        <span className="font-medium">Email:</span> {a.email}
                                                    </div>
                                                )}
                                                {a.contact_methods && a.contact_methods.length > 0 && (
                                                    <div className="text-sm text-gray-500">
                                                        {sortContactMethods(a.contact_methods, a.email)
                                                            .filter(cm => cm.method_type && cm.method_type.toLowerCase() !== 'email')
                                                            .map(cm => `${cm.method_type}: ${cm.value}`)
                                                            .join(', ')}
                                                    </div>
                                                )}
                                                {!a.email && (!a.contact_methods || a.contact_methods.length === 0) && (
                                                    <span className="text-gray-400">No contact methods</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            {a.application_status === 'Future' ? (
                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                    Future - {a.application_date ? new Date(a.application_date).toLocaleDateString() : 'N/A'}
                                                </span>
                                            ) : (
                                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getApplicationStatusColor(a.application_status)}`}>
                                                    {a.application_status || 'None'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {(() => {
                                                // Format: "address, Unit number" -> split on comma, display on 2 lines max
                                                if (a.unit_number && a.address_line_1) {
                                                    return (
                                                        <div className="text-sm leading-tight">
                                                            <div className="line-clamp-1">{a.address_line_1}</div>
                                                            <div className="text-gray-600 line-clamp-1">Unit {a.unit_number}</div>
                                                        </div>
                                                    );
                                                } else if (a.unit_number) {
                                                    return <div className="text-sm text-gray-600 line-clamp-2">Unit {a.unit_number}</div>;
                                                } else if (a.address_line_1) {
                                                    // If address contains comma, split it
                                                    const parts = a.address_line_1.split(',').map(p => p.trim()).filter(Boolean);
                                                    if (parts.length > 1) {
                                                        return (
                                                            <div className="text-sm leading-tight">
                                                                <div className="line-clamp-1">{parts[0]}</div>
                                                                <div className="line-clamp-1">{parts.slice(1).join(', ')}</div>
                                                            </div>
                                                        );
                                                    }
                                                    return <div className="text-sm line-clamp-2">{a.address_line_1}</div>;
                                                } else {
                                                    return <div className="text-sm text-gray-500">None</div>;
                                                }
                                            })()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                    </div>
                    {hasMoreApplicants && (
                        <div className="pt-3 mt-4 border-t text-right flex-shrink-0">
                            <button
                                type="button"
                                onClick={showMoreApplicants}
                                className="text-indigo-600 hover:text-indigo-800 underline text-sm font-medium"
                            >
                                more
                            </button>
                        </div>
                    )}
                    </div>
                </Card>
            </div>

            {editingApplicant && (
                <EditApplicantModal 
                    applicant={editingApplicant} 
                    onClose={() => setEditingApplicant(null)} 
                    onUpdateSuccess={handleSuccess}
                />
            )}

            {deletingApplicant && (
                <ArchiveModal 
                    entity={deletingApplicant}
                    entityType="client"
                    entityName={formatApplicantName(deletingApplicant)}
                    idField="applicant_id"
                    onClose={() => setDeletingApplicant(null)}
                    onArchiveSuccess={handleSuccess}
                    showCascade={false}
                    requireReason={false}
                    isAdmin={user?.role === 'global_admin'}
                />
            )}

            {applyingForUnits && (() => {
                // Extract preselected units from applicant's applications
                const applicantApplications = applicants.find(a => a.applicant_id === applyingForUnits.applicant_id)?.applications || [];
                const preselectedUnitIds = applicantApplications
                    .filter(app => app.unit_id)
                    .map(app => app.unit_id);
                
                // Preselect units if available
                
                return (
                    <ApplyForUnitsModal 
                        applicant={applyingForUnits} 
                        onClose={() => setApplyingForUnits(null)} 
                        onApplySuccess={handleSuccess}
                        showFullApplication={false}
                        preselectedUnits={preselectedUnitIds.map(unitId => ({ unit_id: unitId }))}
                    />
                );
            })()}
            {applyingForUnitsWithApplication && (() => {
                // Extract preselected units from applicant's applications
                const applicantApplications = applicants.find(a => a.applicant_id === applyingForUnitsWithApplication.applicant_id)?.applications || [];
                const preselectedUnitIds = applicantApplications
                    .filter(app => app.unit_id)
                    .map(app => app.unit_id);
                
                return (
                    <ApplyForUnitsModal 
                        applicant={applyingForUnitsWithApplication} 
                        onClose={() => setApplyingForUnitsWithApplication(null)} 
                        onApplySuccess={handleSuccess}
                        showFullApplication={true}
                        preselectedUnits={preselectedUnitIds.map(unitId => ({ unit_id: unitId }))}
                    />
                );
            })()}

            {reviewingApplicant && !viewingApplicationDetail && (
                <ReviewApplicationModal 
                    applicant={reviewingApplicant} 
                    onClose={() => {
                        setReviewingApplicant(null);
                        setViewingApplicationDetail(false);
                    }} 
                    onReviewSuccess={handleSuccess}
                    onViewApplicationDetail={() => {
                        setViewingApplicationDetail(true);
                    }}
                />
            )}

            {reviewingApplicant && viewingApplicationDetail && (
                <ApplyForUnitsModal 
                    applicant={reviewingApplicant} 
                    onClose={() => {
                        setViewingApplicationDetail(false);
                    }} 
                    onApplySuccess={() => {}}
                    showFullApplication={true}
                    readOnly={true}
                    customTitle={`Review Application in Detail - ${formatApplicantName(reviewingApplicant)}`}
                />
            )}
        </div>
    );
}

// Helper function to extract core identifier from unit number
// Core identifier: any consecutive alphanumeric substring with digits that is 2+ characters
// The identifier is delimited by spaces, punctuation, or string boundaries
// Examples: "599" from "#599", "C20" from "Apt. C20", "A18" from "Unit A18"
const extractCoreIdentifier = (unitNumber) => {
    if (!unitNumber) return '';
    const str = unitNumber.toString();
    
    // Find all consecutive alphanumeric sequences (delimited by non-alphanumeric chars or boundaries)
    // This will match: "599", "C20", "A18", etc. as complete sequences
    const matches = str.match(/[A-Za-z0-9]{2,}/g) || [];
    
    // Find sequences that contain at least one digit
    // Prefer longer matches if multiple exist (e.g., "C20" over "C2" if both were somehow matched)
    const identifiersWithDigits = matches.filter(match => /\d/.test(match));
    
    if (identifiersWithDigits.length === 0) return '';
    
    // Return the longest identifier (to handle edge cases, though typically there's only one)
    // This ensures "C20" is preferred over "C2" if somehow both were extracted
    const identifier = identifiersWithDigits.reduce((longest, current) => 
        current.length > longest.length ? current : longest
    );
    
    return identifier.toLowerCase();
};

// Helper function to check if two unit numbers match based on core identifiers
const unitNumbersMatch = (unit1, unit2) => {
    if (!unit1 || !unit2) return false;
    
    const id1 = extractCoreIdentifier(unit1);
    const id2 = extractCoreIdentifier(unit2);
    
    // Match if both have core identifiers and they're the same
    if (id1 && id2) {
        return id1 === id2;
    }
    
    // Fallback: if no core identifier found, do a simple normalized comparison
    const normalized1 = unit1.toString().replace(/[#\s-]/g, '').toLowerCase();
    const normalized2 = unit2.toString().replace(/[#\s-]/g, '').toLowerCase();
    return normalized1 === normalized2;
};

// Create Applicant Form Component
const CreateApplicantForm = ({ onApplicantCreated }) => {
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
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const contactMethodInputRefs = useRef({});
    const formBodyRef = useRef(null);
    // Import application state
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ stage: '', progress: 0, message: '' });
    const [importedDocumentData, setImportedDocumentData] = useState(null);
    const [importedFile, setImportedFile] = useState(null);
    const [documentData, setDocumentData] = useState({});
    const [selectedUnit, setSelectedUnit] = useState(null);
    const [unitSearchTerm, setUnitSearchTerm] = useState('');
    const [availableUnits, setAvailableUnits] = useState([]);
    const [showUnitDropdown, setShowUnitDropdown] = useState(false);
    const fileInputRef = useRef(null);

    // Fetch available units for selection
    useEffect(() => {
        const fetchAvailableUnits = async () => {
            if (!user) return;
            
            try {
                const today = new Date().toISOString().split('T')[0];
                const [unitsResult, addressesResult, leasesResult, clientUnitsResult] = await Promise.allSettled([
                    supabase.from('units').select(`
                        unit_id,
                        unit_number,
                        square_footage,
                        property_id,
                        properties!inner(
                            property_id,
                            property_type
                        )
                    `),
                    supabase.from('addresses').select('*').eq('addressable_type', 'property'),
                    supabase.from('leases').select('unit_id').in('status', ['active', 'future']),
                    supabase.from('client_units').select('unit_id, start_date, end_date, is_archived')
                        .eq('is_archived', false)
                        .lte('start_date', today)
                        .or(`end_date.is.null,end_date.gte.${today}`)
                ]);

                // Handle units result
                if (unitsResult.status === 'rejected' || unitsResult.value.error) {
                    console.error('Error fetching units:', unitsResult.status === 'rejected' ? unitsResult.reason : unitsResult.value.error);
                    return;
                }

                const units = unitsResult.value.data || [];
                const addresses = addressesResult.status === 'fulfilled' && !addressesResult.value.error 
                    ? (addressesResult.value.data || []) 
                    : [];
                const leasedUnitIds = new Set(
                    (leasesResult.status === 'fulfilled' && !leasesResult.value.error && leasesResult.value.data)
                        ? leasesResult.value.data.map(l => l.unit_id)
                        : []
                );
                
                // Handle client_units result - if table doesn't exist, treat as empty (no assigned units)
                let assignedUnitIds = new Set();
                if (clientUnitsResult.status === 'fulfilled' && !clientUnitsResult.value.error) {
                    assignedUnitIds = new Set((clientUnitsResult.value.data || []).map(cu => cu.unit_id));
                } else {
                    // Table doesn't exist or query failed - log but continue without filtering by client_units
                    console.warn('Could not fetch client_units (table may not exist):', 
                        clientUnitsResult.status === 'rejected' 
                            ? clientUnitsResult.reason 
                            : clientUnitsResult.value?.error
                    );
                }

                // Create address map
                const addressMap = new Map();
                addresses.forEach(addr => {
                    if (addr.addressable_id) {
                        addressMap.set(addr.addressable_id, addr);
                    }
                });

                // Filter available units (not leased and not assigned)
                const available = units
                    .filter(unit => !leasedUnitIds.has(unit.unit_id) && !assignedUnitIds.has(unit.unit_id))
                    .map(unit => ({
                        ...unit,
                        address: addressMap.get(unit.property_id)
                    }));
                setAvailableUnits(available);
            } catch (error) {
                // Error fetching available units
            }
        };

        fetchAvailableUnits();
    }, [user]);

    // Fetch application templates for import
    useEffect(() => {
        const fetchTemplates = async () => {
            if (!user) return;
            
            try {
                let query = supabase
                    .from('templates')
                    .select(`
                        template_id,
                        template_name,
                        template_type,
                        template_level,
                        template_data,
                        template_data_raw,
                        is_default,
                        pmc_id,
                        landlord_id,
                        pm_companies(company_name)
                    `)
                    .eq('template_type', 'Application')
                    .order('is_default', { ascending: false })
                    .order('template_level', { ascending: true })
                    .order('template_name', { ascending: true });
                
                // Apply role-based filtering
                if (user?.role === 'global_admin') {
                    // Global admin sees all templates
                } else if (user?.role === 'company_admin' && user?.pmc_id) {
                    query = query.or(`template_level.eq.system,template_level.eq.company.and(pmc_id.eq.${user.pmc_id}),template_level.eq.company.and(applies_to_all_companies.eq.true)`);
                } else {
                    // Limited access for other roles - only system templates
                    query = query.eq('template_level', 'system');
                }
                
                const { data, error } = await query;
                
                if (error) {
                } else {
                    const templatesList = (data || []).map(template => ({
                        ...template,
                        parsed_template_data: parseTemplateData(template)
                    }));
                    setTemplates(templatesList);
                    
                    // Auto-select default template if only one exists
                    if (templatesList.length === 1 && templatesList[0].is_default) {
                        setSelectedTemplate(templatesList[0]);
                    } else {
                        const defaultTemplate = templatesList.find(t => t.is_default);
                        if (defaultTemplate) {
                            setSelectedTemplate(defaultTemplate);
                        } else if (templatesList.length > 0) {
                            setSelectedTemplate(templatesList[0]);
                        }
                    }
                }
            } catch (error) {
            }
        };

        fetchTemplates();
    }, [user]);

    // Close unit dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (showUnitDropdown && !event.target.closest('.unit-dropdown')) {
                setShowUnitDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showUnitDropdown]);

    // Log initial mount state
    useEffect(() => {
        // Component mounted
    }, []); // Only run on mount

    // Track documentData changes to see if it affects selectedUnit
    useEffect(() => {
        // documentData changed
    }, [documentData, selectedUnit]);

    // Form persistence
    const { clearPersistedData } = useFormPersistence('add-applicant', {
        firstName, middleName, lastName, email, password, confirmPassword, contactMethods, dateOfBirth, socialSecurityNumber, gender
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
    });

    const handleMethodChange = (tempId, field, value) => {
        setContactMethods(prevMethods => 
            prevMethods.map(m => m.tempId === tempId ? { ...m, [field]: value } : m)
        );
    };

    const addMethod = () => {
        const newTempId = Date.now();
        setContactMethods([...contactMethods, { method_type: '', value: '', tempId: newTempId }]);
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
        setFormError('');
        setImportedDocumentData(null);
        setImportedFile(null);
        setDocumentData({});
        setSelectedUnit(null);
        setUnitSearchTerm('');
        clearPersistedData();
    }, [clearPersistedData, selectedUnit]);

    const handleCreate = async (e) => {
        e.preventDefault();
        
        // Prevent double submission
        if (isSubmitting) {
            console.warn('[Add Applicant] Form submission already in progress, ignoring duplicate submit');
            return;
        }
        
        setIsSubmitting(true);
        setFormError('');
        
        // Validate passwords match if both are provided
        if (password || confirmPassword) {
            if (password !== confirmPassword) {
                setFormError('Passwords do not match.');
                setIsSubmitting(false);
                return;
            }
        }
        
        try {
            const payload = { 
                firstName, middleName, lastName, email, password,
                date_of_birth: dateOfBirth || null,
                social_security_number: socialSecurityNumber || null,
                gender: gender || null
            };
            
            // Check if user with this email already exists
            const { data: existingUser, error: checkError } = await supabase
                .from('users')
                .select('user_id, role')
                .eq('email', payload.email)
                .single();
            
            let userData;
            
            console.log('[Add Applicant] Checking for existing user:', {
                email: payload.email,
                existingUser: existingUser ? { user_id: existingUser.user_id, role: existingUser.role } : null
            });
            
            if (existingUser) {
                // User already exists - use existing user
                userData = existingUser;
                console.log('[Add Applicant] Using existing user:', { user_id: userData.user_id, role: userData.role });
                
                // Check if user already has a client record
                const { data: existingClient } = await supabase
                    .from('clients')
                    .select('client_id')
                    .eq('user_id', userData.user_id)
                    .single();
                
                if (existingClient) {
                    setFormError('An applicant with this email already exists.');
                    setIsSubmitting(false);
                    return;
                }
                
                // Update password if provided
                if (password) {
                    const bcrypt = await import('bcryptjs');
                    const salt = await bcrypt.genSalt(10);
                    const passwordHash = await bcrypt.hash(payload.password, salt);
                    
                    const { error: updateError } = await supabase
                        .from('users')
                        .update({ password_hash: passwordHash })
                        .eq('user_id', userData.user_id);
                    
                    if (updateError) {
                        // Continue anyway - password update is optional
                    }
                }
            } else {
                // User doesn't exist - create new user account
                let passwordHash = null;
                if (password) {
                    const bcrypt = await import('bcryptjs');
                    const salt = await bcrypt.genSalt(10);
                    passwordHash = await bcrypt.hash(payload.password, salt);
                } else {
                    // Generate a temporary password hash (user will need to reset password)
                    const bcrypt = await import('bcryptjs');
                    const salt = await bcrypt.genSalt(10);
                    const tempPassword = 'temp_password_' + Math.random().toString(36).substring(7);
                    passwordHash = await bcrypt.hash(tempPassword, salt);
                }
                
                // Create user account
                const { data: newUserData, error: userError } = await supabase
                    .from('users')
                    .insert([{
                        email: payload.email,
                        password_hash: passwordHash,
                        role: 'client'
                    }])
                    .select()
                    .single();
                
                if (userError) {
                    // Check if error is due to duplicate email (race condition)
                    if (userError.code === '23505' || userError.message.includes('duplicate key')) {
                        // Try to fetch the existing user
                        const { data: raceConditionUser } = await supabase
                            .from('users')
                            .select('user_id, role')
                            .eq('email', payload.email)
                            .single();
                        
                        if (raceConditionUser) {
                            userData = raceConditionUser;
                        } else {
                            setFormError('An account with this email already exists. Please use a different email.');
                            setIsSubmitting(false);
                            return;
                        }
                    } else {
                        setFormError(userError.message || 'Failed to create user account.');
                        setIsSubmitting(false);
                        return;
                    }
                } else {
                    userData = newUserData;
                    console.log('[Add Applicant] Created new user:', { user_id: userData.user_id, email: userData.email, role: userData.role });
                }
            }
            
            // Verify userData is set correctly
            if (!userData || !userData.user_id) {
                console.error('[Add Applicant] ERROR: userData is invalid:', userData);
                setFormError('Failed to create or retrieve user account.');
                setIsSubmitting(false);
                return;
            }
            
            console.log('[Add Applicant] Final userData before creating client:', {
                user_id: userData.user_id,
                email: userData.email,
                role: userData.role,
                admin_user_id: user?.user_id,
                is_admin: userData.user_id === user?.user_id
            });
            
            if (userData.user_id === user?.user_id) {
                console.error('[Add Applicant] ERROR: userData.user_id matches admin user_id! This should not happen.');
            }
            
            // Check if contact record already exists
            const { data: existingContact } = await supabase
                .from('contacts')
                .select('contact_id')
                .eq('contactable_id', userData.user_id)
                .eq('contactable_type', 'client')
                .single();
            
            if (!existingContact) {
                // Create contact record if it doesn't exist
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
                    // Only clean up if we created the user (not if it already existed)
                    if (!existingUser) {
                        // Get user from the component's context (user is already available at line 80)
                        await deleteWithAudit('users', 'user_id', userData.user_id, user?.user_id);
                    }
                    setFormError(contactError.message || 'Failed to create contact record.');
                    setIsSubmitting(false);
                    return;
                }
            } else {
                // Update existing contact record with new information
                const { error: updateContactError } = await supabase
                    .from('contacts')
                    .update({
                        first_name: payload.firstName,
                        middle_name: payload.middleName,
                        last_name: payload.lastName
                    })
                    .eq('contact_id', existingContact.contact_id);
                
                if (updateContactError) {
                    // Continue anyway - contact update is not critical
                }
            }
            
            // Create applicant record (client record) with imported document data if available
            const documentDataToSave = documentData && Object.keys(documentData).length > 0 ? documentData : (importedDocumentData && Object.keys(importedDocumentData).length > 0 ? importedDocumentData : {});
            
            const { data: applicantData, error: applicantError } = await supabase
                .from('clients')
                .insert([{
                    user_id: userData.user_id,
                    date_of_birth: payload.date_of_birth,
                    social_security_number: payload.social_security_number,
                    gender: payload.gender,
                    status: 'active',
                    document_data: documentDataToSave
                }])
                .select('client_id, user_id, date_of_birth, social_security_number, gender, status, document_data')
                .single();
            
            console.log('[Add Applicant] Created client record:', {
                client_id: applicantData?.client_id,
                user_id: applicantData?.user_id,
                userData_user_id: userData?.user_id,
                match: applicantData?.user_id === userData?.user_id
            });
            
            if (applicantError) {
                // Check if error is due to duplicate client record (user_id already has a client)
                if (applicantError.code === '23505' || applicantError.message.includes('duplicate key') || applicantError.message.includes('unique constraint')) {
                    setFormError('An applicant record for this user already exists.');
                    setIsSubmitting(false);
                    return;
                }
                
                // Only clean up if we created the user and contact (not if they already existed)
                if (!existingUser) {
                    // Note: deleteWithAudit doesn't support multiple .eq() calls, so we need to find the contact_id first
                    const { data: contactData } = await supabase
                        .from('contacts')
                        .select('contact_id')
                        .eq('contactable_id', userData.user_id)
                        .eq('contactable_type', 'client')
                        .maybeSingle();
                    if (contactData?.contact_id) {
                        await deleteWithAudit('contacts', 'contact_id', contactData.contact_id, user?.user_id);
                    }
                    await deleteWithAudit('users', 'user_id', userData.user_id, user?.user_id);
                }
                setFormError(applicantError.message || 'Failed to create applicant record.');
                setIsSubmitting(false);
                return;
            }
            
            // Add contact methods if provided (excluding email - it's in users table)
            const validContactMethods = contactMethods.filter(m => m.method_type && m.value && m.method_type.toLowerCase() !== 'email');
            
            // Deduplicate contact methods by method_type and value
            const uniqueContactMethods = validContactMethods.reduce((acc, method) => {
                const key = `${method.method_type.toLowerCase()}_${method.value.trim().toLowerCase()}`;
                if (!acc.seen.has(key)) {
                    acc.seen.add(key);
                    acc.methods.push(method);
                }
                return acc;
            }, { seen: new Set(), methods: [] }).methods;
            
            console.log('[Add Applicant] Contact methods processing:', {
                original_count: contactMethods.length,
                valid_count: validContactMethods.length,
                unique_count: uniqueContactMethods.length,
                methods: uniqueContactMethods.map(m => ({ type: m.method_type, value: m.value }))
            });
            
            if (uniqueContactMethods.length > 0) {
                // Get the contact_id for the user
                const { data: contactData } = await supabase
                    .from('contacts')
                    .select('contact_id')
                    .eq('contactable_id', userData.user_id)
                    .eq('contactable_type', 'client')
                    .single();
                
                if (contactData) {
                    // Check for existing contact methods and delete them first (in case of re-submission)
                    const { data: existingMethods } = await supabase
                        .from('contact_methods')
                        .select('method_id')
                        .eq('contact_id', contactData.contact_id);
                    
                    if (existingMethods && existingMethods.length > 0) {
                        console.log('[Add Applicant] Found existing contact methods, deleting before insert:', existingMethods.length);
                        await supabase
                            .from('contact_methods')
                            .delete()
                            .eq('contact_id', contactData.contact_id);
                    }
                    
                    const contactMethodsToInsert = uniqueContactMethods.map(method => ({
                        contact_id: contactData.contact_id,
                        method_type: method.method_type,
                        value: method.value
                    }));
                    
                    console.log('[Add Applicant] Inserting contact methods:', {
                        count: contactMethodsToInsert.length,
                        contact_id: contactData.contact_id,
                        methods: contactMethodsToInsert.map(m => ({ type: m.method_type, value: m.value })),
                        timestamp: new Date().toISOString()
                    });
                    
                    // Check for existing methods with same type and value before inserting
                    const existingMethodsCheck = await supabase
                        .from('contact_methods')
                        .select('method_id, method_type, value')
                        .eq('contact_id', contactData.contact_id);
                    
                    console.log('[Add Applicant] Existing contact methods before insert:', {
                        count: existingMethodsCheck.data?.length || 0,
                        methods: existingMethodsCheck.data?.map(m => ({ type: m.method_type, value: m.value })) || []
                    });
                    
                    // Insert one at a time to avoid any potential batch insert issues or triggers
                    let insertCount = 0;
                    for (let i = 0; i < contactMethodsToInsert.length; i++) {
                        const method = contactMethodsToInsert[i];
                        
                        // Check if this exact method already exists
                        const alreadyExists = existingMethodsCheck.data?.some(
                            existing => 
                                existing.method_type === method.method_type && 
                                existing.value === method.value
                        );
                        
                        if (alreadyExists) {
                            console.warn('[Add Applicant] Contact method already exists, skipping insert:', {
                                index: i,
                                method_type: method.method_type,
                                value: method.value
                            });
                            continue;
                        }
                        const { data: insertedData, error: insertError } = await supabase
                            .from('contact_methods')
                            .insert([method])
                            .select('method_id')
                            .single();
                        
                        if (insertError) {
                            // Check if it's a duplicate key error (unique constraint violation)
                            if (insertError.code === '23505' || insertError.message.includes('duplicate key') || insertError.message.includes('unique constraint')) {
                                console.warn('[Add Applicant] Contact method already exists, skipping:', {
                                    method_type: method.method_type,
                                    value: method.value,
                                    error: insertError.message
                                });
                            } else {
                                console.error('[Add Applicant] Error inserting contact method:', insertError, method);
                                setFormError(insertError.message || 'Failed to create contact methods.');
                                return;
                            }
                        } else {
                            insertCount++;
                            console.log('[Add Applicant] Contact method inserted:', {
                                method_id: insertedData?.method_id,
                                method_type: method.method_type,
                                value: method.value
                            });
                        }
                    }
                    
                    // Verify final count
                    const finalCheck = await supabase
                        .from('contact_methods')
                        .select('method_id, method_type, value')
                        .eq('contact_id', contactData.contact_id);
                    
                    console.log('[Add Applicant] Contact methods processing complete:', {
                        attempted: contactMethodsToInsert.length,
                        inserted: insertCount,
                        skipped: contactMethodsToInsert.length - insertCount,
                        final_count: finalCheck.data?.length || 0,
                        final_methods: finalCheck.data?.map(m => ({ type: m.method_type, value: m.value })) || []
                    });
                } else {
                    console.warn('[Add Applicant] No contact record found, cannot insert contact methods');
                }
            }
            
            // Create application for selected unit if one is selected
            if (selectedUnit && applicantData) {
                
                // Use the same documentDataToSave that was saved to clients.document_data
                // This ensures consistency between clients.document_data and client_applications.field_data
                const applicationFieldData = documentData && Object.keys(documentData).length > 0 
                    ? documentData 
                    : (importedDocumentData && Object.keys(importedDocumentData).length > 0 ? importedDocumentData : {});
                
                const { data: applicationData, error: applicationError } = await supabase
                    .from('client_applications')
                    .insert([{
                        client_id: applicantData.client_id,
                        unit_id: selectedUnit.unit_id,
                        status: 'pending',
                        applied_at: new Date().toISOString(),
                        field_data: applicationFieldData,
                        template_id: selectedTemplate?.template_id || null
                    }])
                    .select()
                    .single();
                
                if (applicationError) {
                    console.error('[UNIT_TRACKING] CreateApplicantForm: ERROR creating application:', {
                        error: applicationError,
                        attempted_unit_id: selectedUnit.unit_id,
                        client_id: applicantData.client_id
                    });
                    // Don't fail the whole operation - just log the error
                    // The applicant was created successfully, they can apply for units later
                } else {
                    // Save the imported file as a document if we have the file
                    if (importedFile) {
                        try {
                            // Use the applicant's user_id (from applicantData), not the admin's user_id
                            // The tenant_user_id should be the applicant's user_id from the clients table
                            // tenant_user_id references users(user_id), which is the same as clients.user_id
                            // IMPORTANT: We must use applicantData.user_id (the applicant's user) NOT user?.user_id (the admin)
                            // applicantData.user_id should always be set since we explicitly select it
                            if (!applicantData?.user_id) {
                                console.error('[Add Applicant] CRITICAL ERROR: applicantData.user_id is missing!', {
                                    applicantData,
                                    applicantData_keys: applicantData ? Object.keys(applicantData) : []
                                });
                                throw new Error('Cannot upload document: applicantData.user_id is missing from client record');
                            }
                            
                            const applicantUserId = applicantData.user_id; // Use applicantData.user_id directly - it should always be set
                            // Use admin's user_id for created_by_user_id (if needed by API)
                            const adminUserId = user?.user_id || null;
                            
                            console.log('[Add Applicant] Uploading document - checking user IDs:', {
                                applicantData_user_id: applicantData?.user_id,
                                userData_user_id: userData?.user_id,
                                admin_user_id: adminUserId,
                                final_tenant_user_id: applicantUserId,
                                applicant_client_id: applicantData?.client_id,
                                applicantData_keys: applicantData ? Object.keys(applicantData) : [],
                                userData_keys: userData ? Object.keys(userData) : [],
                                userData_user_id_type: typeof userData?.user_id,
                                applicantData_user_id_type: typeof applicantData?.user_id
                            });
                            
                            if (!applicantUserId) {
                                console.error('[Add Applicant] ERROR: No applicant user_id found! Cannot upload document.');
                                // Don't upload if we can't determine the correct user_id
                                throw new Error('Cannot upload document: applicant user_id not found');
                            } else if (applicantUserId === adminUserId) {
                                console.error('[Add Applicant] ERROR: applicantUserId equals adminUserId! This is wrong - skipping document upload.');
                                // Don't upload if tenant_user_id would be the admin instead of the applicant
                                throw new Error('Cannot upload document: applicantUserId matches admin user_id - this would create incorrect document association');
                            } else if (applicantUserId !== userData?.user_id) {
                                console.warn('[Add Applicant] WARNING: applicantUserId does not match userData.user_id!', {
                                    applicantUserId,
                                    userData_user_id: userData?.user_id
                                });
                                // This is a warning but we'll still proceed - applicantData.user_id should be authoritative
                            }
                            
                            // Convert file to base64 and await completion
                            const base64Data = await new Promise((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    resolve(reader.result);
                                };
                                reader.onerror = (error) => {
                                    reject(error);
                                };
                                reader.readAsDataURL(importedFile);
                            });
                            
                            // Upload via API and await completion
                            const uploadResponse = await fetch('/api/documents/upload', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    file: base64Data,
                                    file_name: importedFile.name,
                                    file_type: importedFile.type,
                                    mime_type: importedFile.type,
                                    document_type: 'rental_application',
                                    tenant_user_id: applicantUserId,
                                    user_id: adminUserId
                                })
                            });
                            
                            const uploadResult = await uploadResponse.json();
                            
                            if (!uploadResult.success) {
                                console.error('[Add Applicant] Document upload failed:', uploadResult.error);
                                // Log error but don't fail the whole operation - document upload is optional
                                // The document can be uploaded manually later via the Review Application modal
                            } else {
                                console.log('[Add Applicant] Document uploaded successfully:', uploadResult.document_id);
                            }
                        } catch (fileError) {
                            console.error('[Add Applicant] Error uploading document:', fileError);
                            // Log error but don't fail the whole operation - document upload is optional
                            // The document can be uploaded manually later via the Review Application modal
                        }
                    }
                }
            }
            
            resetForm();
            onApplicantCreated();
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

    const handleImportApplication = async (e) => {
        const file = e.target.files[0];
        if (!file || !selectedTemplate) {
            setFormError('Please select a template before importing.');
            return;
        }
        
        // Store the file for later upload
        setImportedFile(file);
        
        setIsImporting(true);
        setFormError('');
        setImportProgress({ stage: 'starting', progress: 0, message: 'Starting import...' });
        
        try {
            // Use extractFormValues to get actual field values, not schema
            const result = await extractFormValues(file, {
                onProgress: (stage, progress, message) => {
                    setImportProgress({ stage, progress, message });
                },
                template: selectedTemplate?.parsed_template_data || null
            });
            
            if (result.success) {
                const extractedData = result.data;
                const templateData = selectedTemplate?.parsed_template_data || parseTemplateData(selectedTemplate);
                
                setImportProgress({ stage: 'Mapping', progress: 70, message: 'Mapping to template...' });
                
                // Map imported data to template structure
                let mappedData = extractedData;
                if (templateData && Object.keys(templateData).length > 0) {
                    mappedData = mapImportedDataToTemplate(extractedData, templateData);
                }
                
                setImportProgress({ stage: 'Normalizing', progress: 85, message: 'Normalizing dates...' });
                
                // Normalize dates
                const normalizedData = normalizeDates(mappedData);
                
                // Store mapped and normalized document data
                setDocumentData(normalizedData);
                setImportedDocumentData(normalizedData);
                
                // Extract and fill form fields from imported data
                // Check both raw extracted data and mapped data for field values
                const data = extractedData;
                const normalizedMappedData = normalizedData;
                
                
                // Try to match unit from imported data
                if (data.General_Information) {
                    const genInfo = data.General_Information;
                    const propertyAddress = genInfo.Property_Address || genInfo.property_address || '';
                    const unitNumber = genInfo.Unit_Number || genInfo.unit_number || '';
                    
                    if (propertyAddress || unitNumber) {
                        // Try to find matching unit
                        const matchedUnit = availableUnits.find(unit => {
                            const unitNumMatch = unitNumber && unitNumbersMatch(unitNumber, unit.unit_number);
                            const addressMatch = propertyAddress && 
                                unit.address?.address_line_1?.toLowerCase().includes(propertyAddress.toLowerCase());
                            return unitNumMatch || addressMatch;
                        });
                        
                        if (matchedUnit) {
                            setSelectedUnit(matchedUnit);
                            setUnitSearchTerm(`${matchedUnit.unit_number} - ${matchedUnit.address?.address_line_1 || ''}`);
                        } else {
                            // Set search term even if no match found
                            setUnitSearchTerm(unitNumber ? `Unit ${unitNumber}` : propertyAddress);
                        }
                    }
                }
                
                // Helper to get applicant data from either Applicants array or other structures
                const getApplicantData = () => {
                    // First check if there's an Applicants array (from browser log structure)
                    if (data.Applicants && Array.isArray(data.Applicants) && data.Applicants.length > 0) {
                        return data.Applicants[0];
                    }
                    // Check mapped data for Applicants array
                    if (normalizedMappedData.Applicants && Array.isArray(normalizedMappedData.Applicants) && normalizedMappedData.Applicants.length > 0) {
                        return normalizedMappedData.Applicants[0];
                    }
                    // Check for Applicant_Information object
                    if (data.Applicant_Information) {
                        return data.Applicant_Information;
                    }
                    // Check mapped data for Applicant_Information
                    if (normalizedMappedData.Applicant_Information) {
                        return normalizedMappedData.Applicant_Information;
                    }
                    // Return the data itself as fallback
                    return data;
                };
                
                const applicantData = getApplicantData();
                
                // Helper function to extract string value from various formats
                const extractStringValue = (value) => {
                    if (value === null || value === undefined) return null;
                    
                    // Skip type definitions
                    if (typeof value === 'string') {
                        const trimmed = value.trim();
                        // Skip common type strings
                        if (trimmed === 'string' || trimmed === 'date' || trimmed === 'number' || 
                            trimmed === 'boolean' || trimmed === 'array' || trimmed === 'object' ||
                            trimmed === 'null' || trimmed === 'undefined' || trimmed === '') {
                            return null;
                        }
                        return trimmed;
                    }
                    if (typeof value === 'number') return String(value);
                    if (typeof value === 'boolean') return String(value);
                    if (Array.isArray(value)) {
                        // If it's an array, try to get the first string value
                        for (const item of value) {
                            if (typeof item === 'string' && item.trim() && 
                                item.trim() !== 'string' && item.trim() !== 'date') {
                                return item.trim();
                            }
                            if (typeof item === 'object' && item !== null) {
                                // Try common object properties, but skip 'type'
                                const extracted = extractStringValue(
                                    item.value || item.text || item.name || item.label || 
                                    (item.type && item.type !== 'string' && item.type !== 'date' ? item.type : null)
                                );
                                if (extracted) return extracted;
                            }
                        }
                        return null;
                    }
                    if (typeof value === 'object') {
                        // Skip objects that are just type definitions
                        const keys = Object.keys(value);
                        if (keys.length === 1 && keys[0] === 'type') {
                            return null;
                        }
                        
                        // If it's an object, try to extract a string value from common properties
                        // But skip 'type', 'required', 'description' fields
                        const skipKeys = ['type', 'required', 'description', 'enum', 'items', 'properties'];
                        for (const key of ['value', 'text', 'name', 'label']) {
                            if (value[key] !== undefined) {
                                const extracted = extractStringValue(value[key]);
                                if (extracted) return extracted;
                            }
                        }
                        
                        // Try to find any string property that's not a metadata field
                        for (const key of keys) {
                            if (!skipKeys.includes(key.toLowerCase()) && 
                                typeof value[key] === 'string' && 
                                value[key].trim() && 
                                value[key].trim() !== 'string' && 
                                value[key].trim() !== 'date') {
                                return value[key].trim();
                            }
                        }
                        
                        // If object has a single non-metadata property, use it
                        const nonMetadataKeys = keys.filter(k => !skipKeys.includes(k.toLowerCase()));
                        if (nonMetadataKeys.length === 1) {
                            const extracted = extractStringValue(value[nonMetadataKeys[0]]);
                            if (extracted) return extracted;
                        }
                        
                        return null;
                    }
                    return null;
                };
                
                // Helper function to recursively search for a value in nested structure
                const findValue = (obj, possibleKeys, depth = 0) => {
                    if (depth > 5 || !obj || typeof obj !== 'object') return null;
                    
                    // First try direct access
                    for (const key of possibleKeys) {
                        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
                            const value = extractStringValue(obj[key]);
                            if (value && value !== 'string' && value !== 'date') {
                                return value;
                            }
                        }
                    }
                    
                    // Then search in nested categories (case-insensitive)
                    for (const categoryKey in obj) {
                        if (typeof obj[categoryKey] === 'object' && obj[categoryKey] !== null && !Array.isArray(obj[categoryKey])) {
                            // Skip if this looks like a type definition object
                            const categoryKeys = Object.keys(obj[categoryKey]);
                            if (categoryKeys.length === 1 && categoryKeys[0] === 'type') {
                                continue;
                            }
                            
                            // Try exact key match first
                            for (const key of possibleKeys) {
                                if (obj[categoryKey][key] !== undefined && obj[categoryKey][key] !== null && obj[categoryKey][key] !== '') {
                                    const value = extractStringValue(obj[categoryKey][key]);
                                    if (value && value !== 'string' && value !== 'date') {
                                        return value;
                                    }
                                }
                            }
                            // Try case-insensitive match
                            for (const key of possibleKeys) {
                                const keyLower = key.toLowerCase().replace(/[_\s]/g, '');
                                for (const objKey in obj[categoryKey]) {
                                    // Skip metadata keys
                                    if (['type', 'required', 'description', 'enum', 'items', 'properties'].includes(objKey.toLowerCase())) {
                                        continue;
                                    }
                                    const objKeyLower = objKey.toLowerCase().replace(/[_\s]/g, '');
                                    if (objKeyLower === keyLower && obj[categoryKey][objKey] !== null && obj[categoryKey][objKey] !== '') {
                                        const value = extractStringValue(obj[categoryKey][objKey]);
                                        if (value && value !== 'string' && value !== 'date') {
                                            return value;
                                        }
                                    }
                                }
                            }
                            // Recursively search deeper
                            const deepValue = findValue(obj[categoryKey], possibleKeys, depth + 1);
                            if (deepValue) return deepValue;
                        }
                    }
                    
                    return null;
                };
                
                // Extract first name (try various field name variations)
                // Search in applicantData first, then fall back to full data structure
                const firstNameValue = findValue(applicantData, [
                    'first_name', 'firstName', 'First_Name', 'First Name', 'firstname',
                    'First_Name', 'Given_Name', 'Given Name', 'given_name', 'First',
                    'first', 'fname', 'FName'
                ]) || findValue(data, [
                    'first_name', 'firstName', 'First_Name', 'First Name', 'firstname',
                    'First_Name', 'Given_Name', 'Given Name', 'given_name', 'First',
                    'first', 'fname', 'FName'
                ]);
                if (firstNameValue) {
                    setFirstName(firstNameValue);
                }
                
                // Extract middle name/initial
                let middleNameValue = null;
                const middleNameKeys = ['Middle_Initial', 'Middle_Name', 'middle_initial', 'middle_name', 'Middle_Initial', 'Middle Name'];
                for (const key of middleNameKeys) {
                    if (applicantData[key] !== null && applicantData[key] !== undefined && String(applicantData[key]).trim() !== '' && String(applicantData[key]).trim() !== '[]') {
                        middleNameValue = String(applicantData[key]).trim();
                        break;
                    }
                }
                if (middleNameValue) {
                    setMiddleName(middleNameValue);
                } else {
                    setMiddleName('');
                }
                
                // Extract last name
                const lastNameValue = findValue(applicantData, [
                    'last_name', 'lastName', 'Last_Name', 'Last Name', 'lastname',
                    'Surname', 'surname', 'Family_Name', 'Family Name', 'family_name',
                    'Last', 'last', 'lname', 'LName'
                ]) || findValue(data, [
                    'last_name', 'lastName', 'Last_Name', 'Last Name', 'lastname',
                    'Surname', 'surname', 'Family_Name', 'Family Name', 'family_name',
                    'Last', 'last', 'lname', 'LName'
                ]);
                if (lastNameValue) {
                    setLastName(lastNameValue);
                }
                
                // Extract email - check multiple locations and variations
                let emailValue = findValue(applicantData, [
                    'email', 'Email', 'email_address', 'Email_Address', 'Email Address',
                    'e_mail', 'E_Mail', 'E-Mail', 'e-mail', 'Email_Address',
                    'emailAddress', 'EmailAddress', 'Email_Addr', 'Email Addr',
                    'Contact_Email', 'Contact Email', 'Applicant_Email', 'Applicant Email'
                ]) || findValue(data, [
                    'email', 'Email', 'email_address', 'Email_Address', 'Email Address',
                    'e_mail', 'E_Mail', 'E-Mail', 'e-mail', 'Email_Address',
                    'emailAddress', 'EmailAddress', 'Email_Addr', 'Email Addr',
                    'Contact_Email', 'Contact Email', 'Applicant_Email', 'Applicant Email'
                ]);
                
                // Also check if email might be in applicantData directly
                if (!emailValue && applicantData) {
                    for (const key in applicantData) {
                        const value = applicantData[key];
                        if (typeof value === 'string' && value.includes('@') && value.includes('.')) {
                            emailValue = value;
                            break;
                        }
                    }
                }
                
                if (emailValue) {
                    setEmail(emailValue);
                }
                
                // Extract date of birth
                const dobValue = findValue(applicantData, [
                    'date_of_birth', 'dateOfBirth', 'Date_of_Birth', 'Date of Birth',
                    'dob', 'DOB', 'D.O.B.', 'birth_date', 'Birth_Date', 'Birth Date',
                    'Date_of_Birth', 'birthdate', 'Birthdate'
                ]) || findValue(data, [
                    'date_of_birth', 'dateOfBirth', 'Date_of_Birth', 'Date of Birth',
                    'dob', 'DOB', 'D.O.B.', 'birth_date', 'Birth_Date', 'Birth Date',
                    'Date_of_Birth', 'birthdate', 'Birthdate'
                ]);
                if (dobValue) {
                    const dobStr = String(dobValue).trim();
                    if (dobStr && dobStr !== 'null' && dobStr !== 'undefined') {
                        let parsedDate = null;
                        
                        // Check if already in YYYY-MM-DD format
                        if (dobStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            // Validate the date
                            const date = new Date(dobStr);
                            if (!isNaN(date.getTime()) && date.toISOString().split('T')[0] === dobStr) {
                                parsedDate = dobStr;
                            }
                        } else {
                            // Try to extract date from string (MM/DD/YYYY or DD/MM/YYYY)
                            const dateMatch = dobStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
                            if (dateMatch) {
                                const [, part1, part2, year] = dateMatch;
                                const fullYear = year.length === 2 ? `20${year}` : year;
                                // Try MM/DD/YYYY first (US format)
                                let date = new Date(`${fullYear}-${part1.padStart(2, '0')}-${part2.padStart(2, '0')}`);
                                if (isNaN(date.getTime()) || date.getFullYear() != fullYear) {
                                    // Try DD/MM/YYYY (European format)
                                    date = new Date(`${fullYear}-${part2.padStart(2, '0')}-${part1.padStart(2, '0')}`);
                                }
                                if (!isNaN(date.getTime())) {
                                    parsedDate = date.toISOString().split('T')[0];
                                }
                            } else {
                                // Try to parse as date directly
                                const date = new Date(dobStr);
                                if (!isNaN(date.getTime())) {
                                    parsedDate = date.toISOString().split('T')[0];
                                }
                            }
                        }
                        
                        // Only set if we have a valid date
                        if (parsedDate) {
                            setDateOfBirth(parsedDate);
                        }
                    }
                }
                
                // Extract SSN
                const ssnValue = findValue(applicantData, [
                    'social_security_number', 'socialSecurityNumber', 'Social_Security_Number',
                    'Social Security Number', 'ssn', 'SSN', 'S.S.N.', 's_s_n',
                    'Social_Security', 'Social Security'
                ]) || findValue(data, [
                    'social_security_number', 'socialSecurityNumber', 'Social_Security_Number',
                    'Social Security Number', 'ssn', 'SSN', 'S.S.N.', 's_s_n',
                    'Social_Security', 'Social Security'
                ]);
                if (ssnValue) {
                    setSocialSecurityNumber(ssnValue);
                }
                
                // Extract gender
                const genderValue = findValue(applicantData, [
                    'gender', 'Gender', 'sex', 'Sex', 'Gender_Identity', 'Gender Identity'
                ]) || findValue(data, [
                    'gender', 'Gender', 'sex', 'Sex', 'Gender_Identity', 'Gender Identity'
                ]);
                if (genderValue) {
                    setGender(genderValue);
                }
                
                // Extract contact methods (phone, etc.)
                const extractedContactMethods = [];
                const phoneValue = findValue(applicantData, [
                    'phone', 'Phone', 'phone_number', 'Phone_Number', 'Phone Number',
                    'telephone', 'Telephone', 'tel', 'Tel', 'mobile', 'Mobile',
                    'cell', 'Cell', 'cell_phone', 'Cell_Phone', 'Cell Phone',
                    'Phone_Number', 'phoneNumber', 'PhoneNumber', 'Contact_Phone',
                    'Contact Phone', 'Primary_Phone', 'Primary Phone'
                ]) || findValue(data, [
                    'phone', 'Phone', 'phone_number', 'Phone_Number', 'Phone Number',
                    'telephone', 'Telephone', 'tel', 'Tel', 'mobile', 'Mobile',
                    'cell', 'Cell', 'cell_phone', 'Cell_Phone', 'Cell Phone',
                    'Phone_Number', 'phoneNumber', 'PhoneNumber', 'Contact_Phone',
                    'Contact Phone', 'Primary_Phone', 'Primary Phone'
                ]);
                if (phoneValue) {
                    extractedContactMethods.push({
                        method_type: 'Phone',
                        value: phoneValue,
                        tempId: Date.now()
                    });
                }
                
                // Also check for Contact_Methods array in nested structure
                for (const categoryKey in data) {
                    if (typeof data[categoryKey] === 'object' && data[categoryKey] !== null) {
                        const category = data[categoryKey];
                        if (category.Contact_Methods || category['Contact Methods'] || category.contact_methods) {
                            const methods = category.Contact_Methods || category['Contact Methods'] || category.contact_methods;
                            if (Array.isArray(methods)) {
                                methods.forEach((method, index) => {
                                    if (method) {
                                        const methodValue = extractStringValue(method.value || method.phone || method.Phone || method.number || method.Number);
                                        if (methodValue) {
                                            extractedContactMethods.push({
                                                method_type: extractStringValue(method.method_type || method.type || method.Type || 'Phone') || 'Phone',
                                                value: methodValue,
                                                tempId: Date.now() + index + 1000
                                            });
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
                
                if (extractedContactMethods.length > 0) {
                    setContactMethods(extractedContactMethods);
                }
                
                setFormError('');
                setImportProgress({ stage: 'complete', progress: 100, message: 'Application imported successfully! Form fields have been filled.' });
            } else {
                setFormError(result.error || 'Failed to import application. Please try again.');
                setImportProgress({ stage: 'error', progress: 0, message: '' });
            }
        } catch (error) {
            setFormError(error.message || 'Failed to import application. Please try again.');
            setImportProgress({ stage: 'error', progress: 0, message: '' });
        } finally {
            setIsImporting(false);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <Card hideTitle className="lg:col-span-1 max-h-[calc(100vh-160px)]" contentClassName="h-full">
            <form onSubmit={handleCreate} className="flex flex-col h-full" autoComplete="off">
                <div className="flex items-start justify-between pb-4 mb-4 border-b">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Add Applicant</h2>
                    </div>
                </div>
                <div ref={formBodyRef} className="flex-1 overflow-y-auto pr-1 space-y-4">
                    {/* Import Application Controls */}
                    <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
                    <div className="flex items-center gap-3 flex-wrap">
                            <div className="text-sm font-medium text-gray-700">Import Application:</div>
                            {templates.length > 0 && (
                                <div className="flex flex-col">
                                    <label className="block text-xs font-medium text-gray-600 mb-0.5">
                                        Choose Template
                                    </label>
                                    <select
                                        value={selectedTemplate?.template_id || ''}
                                        onChange={(e) => {
                                            const template = templates.find(t => t.template_id === parseInt(e.target.value));
                                            setSelectedTemplate(template);
                                        }}
                                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                    >
                                        {templates.map(template => (
                                            <option key={template.template_id} value={template.template_id}>
                                                {template.template_name}{template.is_default ? ' (Default)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isImporting || !selectedTemplate}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-300 rounded-md hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <FileText size={16} />
                                Import Application
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                className="hidden"
                                onChange={handleImportApplication}
                            />
                        </div>
                        {importedFile && (
                            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md flex items-center gap-2">
                                <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-green-900">
                                        Document ready: {importedFile.name}
                                    </div>
                                    <div className="text-xs text-green-700 mt-1">
                                        This document will be stored when you click "Add Applicant"
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setImportedFile(null)}
                                    className="text-green-600 hover:text-green-800"
                                    title="Remove document"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                    {isImporting && (
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
                            <div className="flex items-center gap-3">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-blue-900">{importProgress.message || 'Processing...'}</div>
                                    {importProgress.progress > 0 && (
                                        <div className="mt-2 w-full bg-blue-200 rounded-full h-2">
                                            <div 
                                                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                                style={{ width: `${importProgress.progress}%` }}
                                            ></div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
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
                
                {/* Unit Selection (Optional) */}
                <div className="pt-4 border-t">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Unit Selection <span className="text-gray-500 font-normal">(Optional)</span>
                    </label>
                    <div className="relative unit-dropdown">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                                type="text"
                                placeholder="Search for unit by number or address..."
                                value={unitSearchTerm}
                                onChange={(e) => {
                                    const searchValue = e.target.value;
                                    setUnitSearchTerm(searchValue);
                                    setShowUnitDropdown(true);
                                    
                                    // Auto-select unit if there's an exact core identifier match
                                    if (searchValue.trim()) {
                                        const exactMatch = availableUnits.find(unit => 
                                            unitNumbersMatch(searchValue, unit.unit_number)
                                        );
                                        
                                        if (exactMatch && (!selectedUnit || selectedUnit.unit_id !== exactMatch.unit_id)) {
                                            setSelectedUnit(exactMatch);
                                            setUnitSearchTerm(`${exactMatch.unit_number} - ${exactMatch.address?.address_line_1 || ''}`);
                                        }
                                    }
                                }}
                                onBlur={() => {
                                    // On blur, check for exact match if no unit is selected
                                    if (!selectedUnit && unitSearchTerm.trim()) {
                                        const exactMatch = availableUnits.find(unit => 
                                            unitNumbersMatch(unitSearchTerm, unit.unit_number)
                                        );
                                        
                                        if (exactMatch) {
                                            setSelectedUnit(exactMatch);
                                            setUnitSearchTerm(`${exactMatch.unit_number} - ${exactMatch.address?.address_line_1 || ''}`);
                                        }
                                    }
                                    // Delay closing dropdown to allow click events
                                    setTimeout(() => setShowUnitDropdown(false), 200);
                                }}
                                onFocus={() => setShowUnitDropdown(true)}
                                className="block w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            />
                            {selectedUnit && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedUnit(null);
                                        setUnitSearchTerm('');
                                    }}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                        {showUnitDropdown && unitSearchTerm && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto overflow-x-hidden">
                                {availableUnits
                                    .filter(unit => {
                                        // Check for core identifier match
                                        const searchCoreId = extractCoreIdentifier(unitSearchTerm);
                                        const unitCoreId = extractCoreIdentifier(unit.unit_number);
                                        const unitNumMatch = searchCoreId && unitCoreId && 
                                                             (unitCoreId.includes(searchCoreId) || 
                                                              searchCoreId.includes(unitCoreId) ||
                                                              unitNumbersMatch(unitSearchTerm, unit.unit_number));
                                        
                                        // Also check address and city
                                        const address = unit.address?.address_line_1?.toLowerCase() || '';
                                        const city = unit.address?.city?.toLowerCase() || '';
                                        const searchLower = unitSearchTerm.toLowerCase();
                                        return unitNumMatch || 
                                               address.includes(searchLower) || 
                                               city.includes(searchLower);
                                    })
                                    .slice(0, 10)
                                    .map(unit => (
                                        <div
                                            key={unit.unit_id}
                                            onClick={() => {
                                                setSelectedUnit(unit);
                                                setUnitSearchTerm(`${unit.unit_number} - ${unit.address?.address_line_1 || ''}`);
                                                setShowUnitDropdown(false);
                                            }}
                                            className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0 min-w-0"
                                        >
                                            <div className="font-medium truncate">Unit {unit.unit_number}</div>
                                            <div className="text-sm text-gray-600 truncate">
                                                {unit.address?.address_line_1 || ''}
                                                {unit.address?.city ? `, ${unit.address.city}` : ''}
                                                {unit.address?.state_province_region ? ` ${unit.address.state_province_region}` : ''}
                                            </div>
                                        </div>
                                    ))}
                                {availableUnits.filter(unit => {
                                    const searchCoreId = extractCoreIdentifier(unitSearchTerm);
                                    const unitCoreId = extractCoreIdentifier(unit.unit_number);
                                    const unitNumMatch = searchCoreId && unitCoreId && 
                                                         (unitCoreId.includes(searchCoreId) || 
                                                          searchCoreId.includes(unitCoreId) ||
                                                          unitNumbersMatch(unitSearchTerm, unit.unit_number));
                                    const address = unit.address?.address_line_1?.toLowerCase() || '';
                                    const city = unit.address?.city?.toLowerCase() || '';
                                    const searchLower = unitSearchTerm.toLowerCase();
                                    return unitNumMatch || address.includes(searchLower) || city.includes(searchLower);
                                }).length === 0 && (
                                    <div className="px-4 py-2 text-sm text-gray-500">No units found</div>
                                )}
                            </div>
                        )}
                    </div>
                    {selectedUnit && (
                        <div className="mt-2 p-2 bg-indigo-50 border border-indigo-200 rounded-md">
                            <div className="text-sm font-medium text-indigo-900">Selected: Unit {selectedUnit.unit_number}</div>
                            <div className="text-xs text-indigo-700">
                                {selectedUnit.address?.address_line_1 || ''}
                                {selectedUnit.address?.city ? `, ${selectedUnit.address.city}` : ''}
                            </div>
                        </div>
                    )}
                </div>
                
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 my-2">Contact Methods</h4>
                    {contactMethods.map((method) => (
                        <div key={method.tempId} className="flex gap-2 mb-2 items-center">
                            <ContactMethodTypeInput value={method.method_type || ''} onChange={value => handleMethodChange(method.tempId, 'method_type', value)} className="w-1/3 block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                            <input type="text" value={method.value} onChange={e => handleMethodChange(method.tempId, 'value', e.target.value)} placeholder="Value (e.g., 555-1234)" autoComplete="tel" name="contact-method-value" className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                            <button type="button" onClick={() => removeMethod(method.tempId)} className="p-2 text-red-500 hover:text-red-700"><Trash2 size={16}/></button>
                        </div>
                    ))}
                    <button type="button" onClick={addMethod} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 mt-2">
                        <PlusCircle size={16}/> Add Contact Method
                    </button>
                </div>
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 my-2">User Account (Optional)</h4>
                    <div><label className="block text-sm font-medium text-gray-700">Password <span className="text-gray-500 font-normal">(optional)</span></label><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/></div>
                    <div><label className="block text-sm font-medium text-gray-700">Confirm Password <span className="text-gray-500 font-normal">(optional)</span></label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/></div>
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
                        <button type="submit" disabled={isSubmitting} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50">{isSubmitting ? 'Adding...' : 'Add Applicant'}</button>
                    </div>
                </div>
            </form>
        </Card>
    );
};

// Edit Applicant Modal Component
const EditApplicantModal = ({ applicant, onClose, onUpdateSuccess }) => {
    const { user } = useContext(AuthContext);
    // const [activeTab, setActiveTab] = useState('basic'); // 'basic' or 'full' - removed Full Application tab
    const [firstName, setFirstName] = useState(applicant.contact?.first_name || '');
    const [middleName, setMiddleName] = useState(applicant.contact?.middle_name || '');
    const [lastName, setLastName] = useState(applicant.contact?.last_name || '');
    const [email, setEmail] = useState(applicant.email || '');
    const [dateOfBirth, setDateOfBirth] = useState(applicant.date_of_birth ? applicant.date_of_birth.split('T')[0] : '');
    const [socialSecurityNumber, setSocialSecurityNumber] = useState(applicant.social_security_number || '');
    const [gender, setGender] = useState(applicant.gender || '');
    const [contactMethods, setContactMethods] = useState(() => {
        const methods = applicant.contact_methods || [];
        // Filter out email methods (email is shown in separate field)
        return methods
            .filter(m => {
                const methodType = (m.method_type || m.type || '').toLowerCase();
                return methodType !== 'email' && !(m.value && m.value.includes('@') && !methodType);
            })
            .map((m, index) => {
                // Extract method_type and value, handling nested structures
                const methodType = m.method_type || m.type || '';
                let methodValue = m.value || '';
                
                // Handle case where value might be an object or improperly formatted
                if (typeof methodValue !== 'string') {
                    if (methodValue && typeof methodValue === 'object') {
                        // If value is an object, try to stringify it or use empty string
                        methodValue = '';
                    } else {
                        methodValue = String(methodValue || '');
                    }
                }
                
                return {
                    method_type: methodType,
                    value: methodValue,
                    tempId: `cm-${applicant.applicant_id || 'new'}-${index}-${Date.now()}`
                };
            });
    });
    const [documentData, setDocumentData] = useState(applicant.document_data || {});
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    const handleMethodChange = (tempId, field, value) => {
        setContactMethods(prevMethods => 
            prevMethods.map(method => 
                method.tempId === tempId ? { ...method, [field]: value } : method
            )
        );
    };

    const handleAddMethod = () => {
        setContactMethods(prev => [...prev, { 
            tempId: Date.now() + Math.random(), 
            method_type: '', 
            value: ''
        }]);
    };

    const handleRemoveMethod = (tempId) => {
        setContactMethods(prev => prev.filter(method => method.tempId !== tempId));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        
        // Validate passwords match if new password is provided
        if (newPassword && newPassword !== confirmPassword) {
            setFormError('New passwords do not match.');
            setIsSubmitting(false);
            return;
        }
        
        try {
            // Update user account if applicant has a user_id
            if (applicant.user_id) {
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
                
                const { error: userError } = await supabase
                    .from('users')
                    .update(userPayload)
                    .eq('user_id', applicant.user_id);
                    
                if (userError) {
                    setFormError(userError.message || 'Failed to update user account.');
                    return;
                }
                
                // Update contact record for user
                const { error: contactError } = await supabase
                    .from('contacts')
                    .update({
                        first_name: firstName,
                        middle_name: middleName,
                        last_name: lastName
                    })
                    .eq('contactable_id', applicant.user_id)
                    .eq('contactable_type', 'client');
                    
                if (contactError) {
                    setFormError(contactError.message || 'Failed to update contact information.');
                    return;
                }
                
                // Update contact methods for user
                const validContactMethods = contactMethods.filter(m => m.method_type.toLowerCase() !== 'email' && m.method_type && m.value);
                
                if (validContactMethods.length > 0) {
                    // Get the contact_id for the user
                    const { data: contactData } = await supabase
                        .from('contacts')
                        .select('contact_id')
                        .eq('contactable_id', applicant.user_id)
                        .eq('contactable_type', 'client')
                        .single();
                    
                    if (contactData) {
                        // Delete existing contact methods
                        await supabase
                            .from('contact_methods')
                            .delete()
                            .eq('contact_id', contactData.contact_id);
                        
                        // Insert new contact methods
                        const { error: contactMethodsError } = await supabase
                            .from('contact_methods')
                            .insert(validContactMethods.map(method => ({
                                contact_id: contactData.contact_id,
                                method_type: method.method_type,
                                value: method.value
                            })));
                        
                        if (contactMethodsError) {
                            setFormError(contactMethodsError.message || 'Failed to update contact methods.');
                            return;
                        }
                    }
                }
            } else {
                // No user account - update contact directly for client
                const { error: contactError } = await supabase
                    .from('contacts')
                    .update({
                        first_name: firstName,
                        middle_name: middleName,
                        last_name: lastName
                    })
                    .eq('contactable_id', applicant.applicant_id)
                    .eq('contactable_type', 'client');
                    
                if (contactError) {
                    setFormError(contactError.message || 'Failed to update contact information.');
                    return;
                }
                
                // Update contact methods for applicant (including email)
                let contactMethodsToUpdate = [...contactMethods];
                
                // Add email as a contact method if provided
                if (email) {
                    // Remove any existing email from contact methods
                    contactMethodsToUpdate = contactMethodsToUpdate.filter(m => 
                        m.method_type?.toLowerCase() !== 'email'
                    );
                    // Add email as contact method
                    contactMethodsToUpdate.push({
                        method_type: 'email',
                        value: email,
                        tempId: Date.now()
                    });
                }
                
                const validContactMethods = contactMethodsToUpdate.filter(m => m.method_type && m.value);
                
                if (validContactMethods.length > 0) {
                    const { data: contactData } = await supabase
                        .from('contacts')
                        .select('contact_id')
                        .eq('contactable_id', applicant.applicant_id)
                        .eq('contactable_type', 'client')
                        .single();
                    
                    if (contactData) {
                        // Delete existing contact methods
                        await supabase
                            .from('contact_methods')
                            .delete()
                            .eq('contact_id', contactData.contact_id);
                        
                        // Insert new contact methods
                        const { error: contactMethodsError } = await supabase
                            .from('contact_methods')
                            .insert(validContactMethods.map(method => ({
                                contact_id: contactData.contact_id,
                                method_type: method.method_type,
                                value: method.value
                            })));
                        
                        if (contactMethodsError) {
                            setFormError(contactMethodsError.message || 'Failed to update contact methods.');
                            return;
                        }
                    }
                }
            }
            
            // Update applicant record with applicant-specific fields and document_data
            const { error: applicantError } = await supabase
                .from('clients')
                .update({
                    date_of_birth: dateOfBirth || null,
                    social_security_number: socialSecurityNumber || null,
                    gender: gender || null,
                    document_data: documentData
                })
                .eq('client_id', applicant.applicant_id || applicant.client_id);
                
            if (applicantError) {
                setFormError(applicantError.message || 'Failed to update applicant information.');
                return;
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
                className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <div className="flex items-center justify-between p-6 border-b">
                    <h2 className="text-xl font-semibold text-gray-900">
                        {applicant.user_id ? `Edit Applicant - ${formatApplicantName(applicant)}` : 'Add Applicant'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={24} />
                    </button>
                </div>
                
                {/* Removed Full Application tab - functionality moved to ApplyForUnitsModal */}
                {/* <div className="border-b border-gray-200">
                    <nav className="flex space-x-8 px-6" aria-label="Tabs">
                        <button
                            type="button"
                            onClick={() => setActiveTab('basic')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${
                                activeTab === 'basic'
                                    ? 'border-indigo-500 text-indigo-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                        >
                            Basic Information
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('full')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${
                                activeTab === 'full'
                                    ? 'border-indigo-500 text-indigo-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                        >
                            Full Application
                        </button>
                    </nav>
                </div> */}
                
                <div className="flex-1 overflow-y-auto">
                    <form onSubmit={handleSubmit} className="p-6 space-y-6" id="edit-applicant-form">
                    {/* Full Application tab removed - code kept for reference */}
                    {/* {activeTab === 'basic' ? ( */}
                        <>
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
                    <div><label className="block text-sm font-medium text-gray-700">Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/></div>
                    
                    <h4 className="font-medium text-gray-800 border-b pb-2">Additional Information</h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                    
                    <h4 className="font-medium text-gray-800 border-b pb-2">Contact Methods</h4>
                    {contactMethods.map(method => (
                        <div key={method.tempId} className="flex items-center space-x-4">
                            <ContactMethodTypeInput
                                value={method.method_type || ''} 
                                onChange={value => handleMethodChange(method.tempId, 'method_type', value)}
                                className="w-1/3 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                            />
                            <input 
                                type="text" 
                                value={typeof method.value === 'string' ? method.value : (method.value ? String(method.value) : '')} 
                                onChange={e => handleMethodChange(method.tempId, 'value', e.target.value)}
                                placeholder="Contact value"
                                autoComplete="tel"
                                name="contact-method-value"
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                            />
                            <button 
                                type="button" 
                                onClick={() => handleRemoveMethod(method.tempId)}
                                className="text-red-600 hover:text-red-800"
                            >
                                <Trash size={16} />
                            </button>
                        </div>
                    ))}
                    <button type="button" onClick={handleAddMethod} className="flex items-center text-indigo-600 hover:text-indigo-800">
                        <PlusCircle size={16} className="mr-1" />
                        Add Contact Method
                    </button>
                    
                    {applicant.user_id && (
                        <>
                            <h4 className="font-medium text-gray-800 border-b pb-2">Change Password (Optional)</h4>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div><label className="block text-sm font-medium text-gray-700">New Password</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/></div>
                                <div><label className="block text-sm font-medium text-gray-700">Confirm New Password</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/></div>
                            </div>
                        </>
                    )}
                        </>
                    {/* Full Application tab code - kept for reference but not used */}
                    {/* ) : (
                        <>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h4 className="font-medium text-gray-800 border-b pb-2">Full Rental Application</h4>
                            </div>
                        </div>
                        <ApplicationFormBuilder
                            key={`app-form-${applicant.applicant_id}-${activeTab}`}
                            documentData={documentData}
                            onChange={setDocumentData}
                            templatePath="/templates/system_default_rental_application.json"
                        />
                        </>
                    )} */}

                    {formError && (
                        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                            {formError}
                        </div>
                    )}
                    </form>
                </div>
                
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" form="edit-applicant-form" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">{isSubmitting ? 'Saving...' : 'Save Changes'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
};


// Apply For Units Modal Component  
const ApplyForUnitsModalInline = ({ applicant, onClose, onApplySuccess }) => {
    const { user } = useContext(AuthContext);
    
    // State declarations
    const [units, setUnits] = useState([]);
    const [applications, setApplications] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedUnits, setSelectedUnits] = useState([]);
    const [unitNotes, setUnitNotes] = useState({});
    const [editingApplication, setEditingApplication] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [showFullApplication, setShowFullApplication] = useState(false);
    const [showTemplateSelection, setShowTemplateSelection] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [documentData, setDocumentData] = useState(() => {
        return applicant?.document_data || {};
    });
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ stage: '', progress: 0, message: '' });
    const [templates, setTemplates] = useState([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [customTitle, setCustomTitle] = useState(null);
    const [readOnly, setReadOnly] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(null);
    const fileInputRef = useRef(null);
    const fillApplicationFileInputRef = useRef(null);
    
    // Computed values - use useMemo to avoid recalculation and TDZ issues
    const selectedTemplateData = useMemo(() => {
        if (!selectedTemplate) {
            return null;
        }
        try {
            if (typeof parseTemplateData !== 'function') {
                return null;
            }
            const result = parseTemplateData(selectedTemplate);
            return result;
        } catch (error) {
            return null;
        }
    }, [selectedTemplate]);
    
    // Handle file import for Fill Application - wrapped in useCallback to avoid TDZ issues
    const handleFillApplicationFileImport = useCallback(async (file) => {
        if (!file || !selectedTemplate) {
            setFormError('Please select a template before importing.');
            return;
        }
        
        // Compute template data here to avoid TDZ issues
        let templateData = null;
        try {
            templateData = selectedTemplate ? parseTemplateData(selectedTemplate) : null;
        } catch (error) {
            setFormError('Error processing template. Please try again.');
            return;
        }
        
        setIsImporting(true);
        setFormError('');
        setImportProgress({ stage: 'starting', progress: 0, message: 'Starting import...' });
        
        try {
            // Use extractFormValues to get actual field values, not schema
            const result = await extractFormValues(file, {
                onProgress: (stage, progress, message) => {
                    setImportProgress({ stage, progress, message });
                },
                template: templateData
            });
            
            if (result.success) {
                
                // Dynamically map imported data structure to match template structure
                // Uses semantic matching to work with any template
                const mapImportedDataToTemplate = (importedData, templateDataForMapping) => {
                    if (!templateDataForMapping || Object.keys(templateDataForMapping).length === 0) {
                        return importedData; // No template, return as-is
                    }
                    
                    const mappedData = {};
                    const templateCategories = Object.keys(templateDataForMapping);
                    
                    // Normalize a string for comparison (remove numbers, underscores, case-insensitive)
                    const normalize = (str) => {
                        return str.toLowerCase()
                            .replace(/^\d+[_\-.]?/, '') // Remove leading numbers
                            .replace(/[_\-.\s]/g, '') // Remove separators
                            .trim();
                    };
                    
                    // Calculate similarity score between two strings
                    const similarity = (str1, str2) => {
                        const norm1 = normalize(str1);
                        const norm2 = normalize(str2);
                        if (norm1 === norm2) return 1.0;
                        
                        // Check if one contains the other
                        if (norm1.includes(norm2) || norm2.includes(norm1)) {
                            return 0.8;
                        }
                        
                        // Check for common keywords
                        const keywords1 = norm1.split(/(?=[A-Z])|[_\-.\s]/).filter(Boolean).map(k => k.toLowerCase());
                        const keywords2 = norm2.split(/(?=[A-Z])|[_\-.\s]/).filter(Boolean).map(k => k.toLowerCase());
                        
                        // Extract root words (stems) for each keyword
                        const stems1 = keywords1.map(k => stemmer(k));
                        const stems2 = keywords2.map(k => stemmer(k));
                        
                        // Check for exact keyword matches
                        const commonKeywords = keywords1.filter(k => keywords2.includes(k));
                        
                        // Check for root word matches (e.g., "employer", "employment", "employee" all stem to "employ")
                        const commonStems = stems1.filter((s, i) => stems2.includes(s));
                        
                        if (commonKeywords.length > 0) {
                            let score = 0.6 + (commonKeywords.length / Math.max(keywords1.length, keywords2.length)) * 0.2;
                            
                            // Boost score if we also have stem matches beyond exact keyword matches
                            if (commonStems.length > commonKeywords.length) {
                                const stemBonus = (commonStems.length - commonKeywords.length) / Math.max(keywords1.length, keywords2.length) * 0.15;
                                score = Math.min(0.95, score + stemBonus);
                            }
                            
                            return score;
                        }
                        
                        // If no exact keyword matches but we have stem matches, give a moderate score
                        if (commonStems.length > 0) {
                            return 0.5 + (commonStems.length / Math.max(keywords1.length, keywords2.length)) * 0.2;
                        }
                        
                        return 0.0;
                    };
                    
                    // Find best matching template category for an imported category
                    const findBestMatch = (importedCategory) => {
                        let bestMatch = null;
                        let bestScore = 0;
                        
                        for (const templateCategory of templateCategories) {
                            const score = similarity(importedCategory, templateCategory);
                            if (score > bestScore) {
                                bestScore = score;
                                bestMatch = templateCategory;
                            }
                        }
                        
                        // Only return match if similarity is reasonable
                        return bestScore > 0.5 ? bestMatch : null;
                    };
                    
                    // Find best matching field name within a category
                    const findBestFieldMatch = (importedField, templateFields) => {
                        let bestMatch = importedField; // Default to original name
                        let bestScore = 0;
                        
                        for (const templateField of templateFields) {
                            const score = similarity(importedField, templateField);
                            if (score > bestScore) {
                                bestScore = score;
                                bestMatch = templateField;
                            }
                        }
                        
                        return bestScore > 0.6 ? bestMatch : importedField;
                    };
                    
                    // Map each imported category to template structure
                    for (const [importedCategory, importedValue] of Object.entries(importedData)) {
                        const templateCategory = findBestMatch(importedCategory);
                        
                        if (templateCategory) {
                            // Found matching template category
                            if (!mappedData[templateCategory]) {
                                mappedData[templateCategory] = {};
                            }
                            
                            // Get template fields for this category
                            const templateFields = templateDataForMapping[templateCategory] && 
                                typeof templateDataForMapping[templateCategory] === 'object' &&
                                !Array.isArray(templateDataForMapping[templateCategory])
                                ? Object.keys(templateDataForMapping[templateCategory])
                                : [];
                            
                            // Map fields within this category
                            if (typeof importedValue === 'object' && importedValue !== null && !Array.isArray(importedValue)) {
                                for (const [fieldKey, fieldValue] of Object.entries(importedValue)) {
                                    const mappedFieldKey = findBestFieldMatch(fieldKey, templateFields);
                                    mappedData[templateCategory][mappedFieldKey] = fieldValue;
                                }
                            } else if (Array.isArray(importedValue)) {
                                // For arrays, try to find an array field in template
                                const arrayField = templateFields.find(f => 
                                    templateDataForMapping[templateCategory][f]?.type === 'array' ||
                                    templateDataForMapping[templateCategory][f]?.items
                                ) || templateFields[0] || importedCategory;
                                mappedData[templateCategory][arrayField] = importedValue;
                            } else {
                                // For primitive values, try to find matching field or use first field
                                const targetField = templateFields.length > 0 
                                    ? findBestFieldMatch(importedCategory, templateFields)
                                    : importedCategory;
                                mappedData[templateCategory][targetField] = importedValue;
                            }
                        } else {
                            // No matching template category found, keep original structure
                            mappedData[importedCategory] = importedValue;
                        }
                    }
                    
                    return mappedData;
                };
                
                // Normalize date strings to ISO (YYYY-MM-DD) where possible to avoid invalid Date errors
                const mappedData = mapImportedDataToTemplate(result.data, templateData);
                const normalizedData = normalizeDates(mappedData);
                
                // Use functional update to avoid closure issues
                setDocumentData(prev => {
                    
                    // Merge mapped imported data with existing documentData
                    const mergedData = {
                        ...(prev && Object.keys(prev).length > 0 ? prev : {}),
                        ...normalizedData
                    };
                    return mergedData;
                });
                
                
                setFormError('');
                setImportProgress({ stage: 'complete', progress: 100, message: 'Application imported successfully!' });
            } else {
                setFormError(result.error || 'Failed to import application. Please try again.');
                setImportProgress({ stage: 'error', progress: 0, message: '' });
            }
        } catch (error) {
            setFormError(error.message || 'Failed to import application. Please try again.');
            setImportProgress({ stage: 'error', progress: 0, message: '' });
        } finally {
            setIsImporting(false);
            // Reset file input
            if (fillApplicationFileInputRef.current) {
                fillApplicationFileInputRef.current.value = '';
            }
        }
    }, [selectedTemplate]);
    
    // Fetch application templates
    useEffect(() => {
        const fetchTemplates = async () => {
            if (!user) return;
            
            setLoadingTemplates(true);
            try {
                let query = supabase
                    .from('templates')
                    .select(`
                        template_id,
                        template_name,
                        template_type,
                        template_level,
                        template_data,
                        template_data_raw,
                        is_default,
                        pmc_id,
                        landlord_id,
                        pm_companies(company_name)
                    `)
                    .eq('template_type', 'Application')
                    .order('is_default', { ascending: false })
                    .order('template_level', { ascending: true })
                    .order('template_name', { ascending: true });
                
                // Apply role-based filtering
                if (user?.role === 'global_admin') {
                    // Global admin sees all templates
                } else if (user?.role === 'company_admin' && user?.pmc_id) {
                    query = query.or(`template_level.eq.system,template_level.eq.company.and(pmc_id.eq.${user.pmc_id}),template_level.eq.company.and(applies_to_all_companies.eq.true)`);
                } else {
                    // Limited access for other roles - only system templates
                    query = query.eq('template_level', 'system');
                }
                
                const { data, error } = await query;
                
                if (error) {
                } else {
                    const templatesList = (data || []).map(template => ({
                        ...template,
                        parsed_template_data: parseTemplateData(template)
                    }));
                    setTemplates(templatesList);
                    
                    // Auto-select default template if only one exists
                    if (templatesList.length === 1 && templatesList[0].is_default) {
                        setSelectedTemplate(templatesList[0]);
                    } else if (templatesList.length > 0) {
                        const defaultTemplate = templatesList.find(t => t.is_default);
                        if (defaultTemplate) {
                            setSelectedTemplate(defaultTemplate);
                        }
                    }
                }
            } catch (error) {
            } finally {
                setLoadingTemplates(false);
            }
        };
        
        fetchTemplates();
    }, [user]);
    
    // Load documentData from applicant when applicant changes
    useEffect(() => {
        if (applicant?.document_data) {
            setDocumentData(applicant.document_data);
        } else {
            setDocumentData({});
        }
    }, [applicant]);
    
    // Fetch units and applications when applicant is selected
    useEffect(() => {
        const fetchData = async () => {
            try {
                const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
                const [unitsResult, addressesResult, leasesResult, clientUnitsResult, applicationsResult] = await Promise.allSettled([
                    supabase.from('units').select(`
                        unit_id,
                        unit_number,
                        square_footage,
                        property_id,
                        properties!inner(
                            property_id,
                            property_type
                        )
                    `),
                    supabase.from('client_applications').select(`
                        application_id,
                        unit_id,
                        status,
                        applied_at,
                        notes,
                        units!inner(
                            unit_id,
                            unit_number,
                            square_footage,
                            property_id,
                            properties!inner(
                                property_id,
                                property_type
                            )
                        )
                    `).eq('client_id', applicant.applicant_id || applicant.client_id),
                    supabase.from('addresses').select('*').eq('addressable_type', 'property'),
                    supabase.from('leases').select('unit_id').in('status', ['active', 'future']),
                    supabase.from('client_units').select('unit_id, start_date, end_date, is_archived')
                        .eq('is_archived', false)
                        .lte('start_date', today)
                        .or(`end_date.is.null,end_date.gte.${today}`)
                ]);


                if (unitsResult.status === 'rejected' || (unitsResult.status === 'fulfilled' && unitsResult.value.error)) {
                    setFormError('Failed to load units.');
                } else {
                    const units = unitsResult.status === 'fulfilled' ? (unitsResult.value.data || []) : [];
                    const addresses = addressesResult.status === 'fulfilled' && !addressesResult.value.error 
                        ? (addressesResult.value.data || []) 
                        : [];
                    const leasedUnits = leasesResult.status === 'fulfilled' && !leasesResult.value.error 
                        ? (leasesResult.value.data || []) 
                        : [];
                    
                    // Handle client_units gracefully - if table doesn't exist, treat as empty
                    let clientUnits = [];
                    if (clientUnitsResult.status === 'fulfilled' && !clientUnitsResult.value.error) {
                        clientUnits = clientUnitsResult.value.data || [];
                    } else {
                        // Table doesn't exist or query failed - log but continue
                        console.warn('Could not fetch client_units (table may not exist):', 
                            clientUnitsResult.status === 'rejected' 
                                ? clientUnitsResult.reason 
                                : clientUnitsResult.value?.error
                        );
                    }
                    
                    // Get unit IDs that have active or future leases
                    const leasedUnitIds = new Set(leasedUnits.map(lease => lease.unit_id));
                    
                    // Get unit IDs that have active client_units assignments (tenants)
                    const assignedUnitIds = new Set(clientUnits.map(cu => cu.unit_id));
                    
                    // Get unit IDs that the current applicant has already applied for
                    const applications = applicationsResult.status === 'fulfilled' && !applicationsResult.value.error 
                        ? (applicationsResult.value.data || []) 
                        : [];
                    const appliedUnitIds = new Set(applications.map(app => app.unit_id));
                    
                    // Filter out units with active or future leases, active client_units assignments, AND units already applied for by this applicant
                    const availableUnits = units.filter(unit => {
                        const isLeased = leasedUnitIds.has(unit.unit_id);
                        const isAssigned = assignedUnitIds.has(unit.unit_id);
                        const isApplied = appliedUnitIds.has(unit.unit_id);
                        const isAvailable = !isLeased && !isAssigned && !isApplied;
                        
                        // Unit filtered out if leased, assigned, or already applied for
                        
                        return isAvailable;
                    });
                    
                    
                    // Join units with addresses
                    const unitsWithAddresses = availableUnits.map(unit => {
                        const address = addresses.find(addr => 
                            addr.addressable_id === unit.property_id && 
                            addr.addressable_type === 'property'
                        );
                        return {
                            ...unit,
                            address: address || null
                        };
                    });
                    
                    setUnits(unitsWithAddresses);
                }

                if (applicationsResult.error) {
                    // Don't show error if applicant_id is missing - just treat as no applications
                    if (applicationsResult.error.code !== 'PGRST116' && applicant?.applicant_id) {
                        setFormError('Failed to load existing applications.');
                    }
                }
                
                // Always set applications, even if there was an error (treat as empty)
                const applications = applicationsResult.data || [];
                const addresses = addressesResult.data || [];
                
                // Join applications with addresses
                const applicationsWithAddresses = applications.map(application => {
                        const address = addresses.find(addr => 
                            addr.addressable_id === application.units.property_id && 
                            addr.addressable_type === 'property'
                        );
                        return {
                            ...application,
                            units: {
                                ...application.units,
                                address: address || null
                            }
                        };
                    });
                    
                setApplications(applicationsWithAddresses);
                
                // Clear error if we successfully got an empty array (no applications is fine)
                if (!applicationsResult.error || applications.length === 0) {
                    setFormError('');
                }
            } catch (error) {
                setFormError('Could not connect to server.');
            }
        };

        if (applicant) {
            fetchData();
        }
    }, [applicant]);

    // Filter units based on search term
    const filteredUnits = useMemo(() => {
        if (!searchTerm.trim()) return units;
        
        const searchLower = searchTerm.toLowerCase();
        return units.filter(unit => {
            const address = unit.address;
            return (
                unit.unit_number?.toLowerCase().includes(searchLower) ||
                address?.address_line_1?.toLowerCase().includes(searchLower) ||
                address?.city?.toLowerCase().includes(searchLower) ||
                address?.state_province_region?.toLowerCase().includes(searchLower) ||
                unit.properties?.property_type?.toLowerCase().includes(searchLower)
            );
        });
    }, [units, searchTerm]);

    // Check if applicant has been rejected for any unit
    const hasRejections = applications.some(app => app.status === 'rejected');

    const handleUnitToggle = (unitId) => {
        setSelectedUnits(prev => {
            if (prev.includes(unitId)) {
                setUnitNotes(prevNotes => {
                    const newNotes = { ...prevNotes };
                    delete newNotes[unitId];
                    return newNotes;
                });
                return prev.filter(id => id !== unitId);
            } else {
                setUnitNotes(prevNotes => ({ ...prevNotes, [unitId]: '' }));
                return [...prev, unitId];
            }
        });
    };

    // Handle notes change for individual unit
    const handleNotesChange = (unitId, notes) => {
        setUnitNotes(prev => ({ ...prev, [unitId]: notes }));
    };

    // Handle editing an existing application
    const handleEditApplication = (application) => {
        setEditingApplication(application);
        setUnitNotes(prev => ({ ...prev, [application.unit_id]: application.notes || '' }));
    };

    // Handle updating an existing application
    const handleUpdateApplication = async () => {
        if (!editingApplication) return;
        
        setIsSubmitting(true);
        setFormError('');

        try {
            const { error } = await supabase
                .from('client_applications')
                .update({
                    notes: unitNotes[editingApplication.unit_id]?.trim() || null
                })
                .eq('application_id', editingApplication.application_id);

            if (error) {
                setFormError(error.message || 'Failed to update application.');
            } else {
                // Refresh applications with addresses
                const [updatedApplicationsResult, addressesResult] = await Promise.all([
                    supabase.from('client_applications').select(`
                        application_id,
                        unit_id,
                        status,
                        applied_at,
                        notes,
                        units!inner(
                            unit_id,
                            unit_number,
                            square_footage,
                            property_id,
                            properties!inner(
                                property_id,
                                property_type
                            )
                        )
                    `).eq('client_id', applicant.applicant_id || applicant.client_id),
                    supabase.from('addresses').select('*').eq('addressable_type', 'property')
                ]);
                
                const applications = updatedApplicationsResult.data || [];
                const addresses = addressesResult.data || [];
                
                // Join applications with addresses
                const applicationsWithAddresses = applications.map(application => {
                    const address = addresses.find(addr => 
                        addr.addressable_id === application.units.property_id && 
                        addr.addressable_type === 'property'
                    );
                    return {
                        ...application,
                        units: {
                            ...application.units,
                            address: address || null
                        }
                    };
                });
                
                setApplications(applicationsWithAddresses);
                setEditingApplication(null);
                setUnitNotes({});
            }
        } catch (err) {
            setFormError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle deleting an application
    const handleDeleteApplication = async (applicationId) => {
        setConfirmDelete(applicationId);
    };

    // Actually perform the deletion
    const performDelete = async () => {
        if (!confirmDelete) return;
        
        setIsSubmitting(true);
        setFormError('');

        try {
            const { error } = await supabase
                .from('client_applications')
                .delete()
                .eq('application_id', confirmDelete);

            if (error) {
                setFormError(error.message || 'Failed to delete application.');
            } else {
                // Refresh applications with addresses
                const [updatedApplicationsResult, addressesResult] = await Promise.all([
                    supabase.from('client_applications').select(`
                        application_id,
                        unit_id,
                        status,
                        applied_at,
                        notes,
                        units!inner(
                            unit_id,
                            unit_number,
                            square_footage,
                            property_id,
                            properties!inner(
                                property_id,
                                property_type
                            )
                        )
                    `).eq('client_id', applicant.applicant_id || applicant.client_id),
                    supabase.from('addresses').select('*').eq('addressable_type', 'property')
                ]);
                
                const applications = updatedApplicationsResult.data || [];
                const addresses = addressesResult.data || [];
                
                // Join applications with addresses
                const applicationsWithAddresses = applications.map(application => {
                    const address = addresses.find(addr => 
                        addr.addressable_id === application.units.property_id && 
                        addr.addressable_type === 'property'
                    );
                    return {
                        ...application,
                        units: {
                            ...application.units,
                            address: address || null
                        }
                    };
                });
                
                setApplications(applicationsWithAddresses);
            }
        } catch (err) {
            setFormError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
            setConfirmDelete(null);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');

        try {
            // For Fill Application mode, just save the document_data
            if (showFullApplication) {
                const { error: updateError } = await supabase
                    .from('clients')
                    .update({ document_data: documentData })
                    .eq('client_id', applicant.applicant_id || applicant.client_id);
                
                if (updateError) {
                    setFormError('Failed to save application data.');
                    setIsSubmitting(false);
                    return;
                }
                
                // If there are selected units, also create applications for them
                if (selectedUnits.length > 0) {
                    // Check for existing applications for selected units
                    const existingApplications = applications.filter(app => 
                        selectedUnits.includes(app.unit_id)
                    );

                    if (existingApplications.length > 0) {
                        setFormError('You have already applied for some of these units.');
                        setIsSubmitting(false);
                        return;
                    }

                    // Create applications for selected units with individual notes
                    const applicationsToCreate = selectedUnits.map(unitId => ({
                        client_id: applicant.applicant_id || applicant.client_id,
                        unit_id: unitId,
                        status: 'pending',
                        notes: unitNotes[unitId]?.trim() || null
                    }));

                    const { error: insertError } = await supabase
                        .from('client_applications')
                        .insert(applicationsToCreate);

                    if (insertError) {
                        setFormError(insertError.message || 'Failed to submit applications.');
                        setIsSubmitting(false);
                        return;
                    }
                }
                
                onApplySuccess();
                return;
            }

            // For Select Units mode, require units to be selected
            if (selectedUnits.length === 0) {
                setFormError('Please select at least one unit to apply for.');
                setIsSubmitting(false);
                return;
            }

            // Check for existing applications for selected units
            const existingApplications = applications.filter(app => 
                selectedUnits.includes(app.unit_id)
            );

            if (existingApplications.length > 0) {
                setFormError('You have already applied for some of these units.');
                setIsSubmitting(false);
                return;
            }

            // Create applications for selected units with individual notes
            const applicationsToCreate = selectedUnits.map(unitId => ({
                client_id: applicant.applicant_id || applicant.client_id,
                unit_id: unitId,
                status: 'pending',
                notes: unitNotes[unitId]?.trim() || null
            }));

            const { error } = await supabase
                .from('client_applications')
                .insert(applicationsToCreate);

            if (error) {
                setFormError(error.message || 'Failed to submit applications.');
            } else {
                onApplySuccess();
            }
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

    const getApplicationStatus = (unitId) => {
        const application = applications.find(app => app.unit_id === unitId);
        return application ? application.status : null;
    };

    const getApplicationDate = (unitId) => {
        const application = applications.find(app => app.unit_id === unitId);
        return application ? application.applied_at : null;
    };

    const formatUnitInfo = (unit) => {
        const address = unit.address;
        const addressStr = address ? `${address.address_line_1}, ${address.city}, ${address.state_province_region}` : 'Address not available';
        return `${unit.unit_number} - ${addressStr}`;
    };

    return (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div 
                className={`bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] ${showFullApplication ? 'flex flex-col' : 'overflow-y-auto'}`}
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
                    <h2 className="text-xl font-semibold text-gray-900">
                        {customTitle || (showFullApplication ? `Fill Application - ${formatApplicantName(applicant)}` : `Select Units - ${formatApplicantName(applicant)}`)}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={24} />
                    </button>
                </div>
                
                <div className={showFullApplication ? 'flex-1 overflow-hidden flex flex-col' : 'flex-1 overflow-y-auto flex flex-col p-6'}>
                    {/* Rejection Warning */}
                    {hasRejections && (
                        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                            <div className="flex">
                                <div className="flex-shrink-0">
                                    <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="ml-3">
                                    <h3 className="text-sm font-medium text-yellow-800">
                                        Previous Rejection Notice
                                    </h3>
                                    <div className="mt-2 text-sm text-yellow-700">
                                        <p>This applicant has been rejected for at least one unit in the past. Please review their application carefully before approving.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}


                    {/* Template Selection */}
                    {showFullApplication && showTemplateSelection && (
                        <div className="p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-medium text-gray-900">Select Application Template</h3>
                                {!readOnly && (
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isImporting || !selectedTemplate}
                                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-300 rounded-md hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <FileText size={16} />
                                        Import Application
                                    </button>
                                )}
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                className="hidden"
                                onChange={async (e) => {
                                    const file = e.target.files[0];
                                    if (!file || !selectedTemplate) {
                                        setFormError('Please select a template before importing.');
                                        return;
                                    }
                                    
                                    setIsImporting(true);
                                    setFormError('');
                                    setImportProgress({ stage: 'starting', progress: 0, message: 'Starting import...' });
                                    
                                    try {
                                        // Use extractFormValues to get actual field values, not schema
                                        const result = await extractFormValues(file, {
                                            onProgress: (stage, progress, message) => {
                                                setImportProgress({ stage, progress, message });
                                            },
                                            template: selectedTemplateData
                                        });
                                        
                                        if (result.success) {
                                            // Merge imported data with existing documentData
                                            const mergedData = {
                                                ...documentData,
                                                ...result.data
                                            };
                                            
                                            setDocumentData(mergedData);
                                            setFormError('');
                                            setImportProgress({ stage: 'complete', progress: 100, message: 'Application imported successfully!' });
                                            // Auto-close template selection and show form
                                            setShowTemplateSelection(false);
                                        } else {
                                            setFormError(result.error || 'Failed to import application. Please try again.');
                                            setImportProgress({ stage: 'error', progress: 0, message: '' });
                                        }
                                    } catch (error) {
                                        setFormError(error.message || 'Failed to import application. Please try again.');
                                        setImportProgress({ stage: 'error', progress: 0, message: '' });
                                    } finally {
                                        setIsImporting(false);
                                        // Reset file input
                                        if (fileInputRef.current) {
                                            fileInputRef.current.value = '';
                                        }
                                    }
                                }}
                            />
                            {isImporting && (
                                <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                                    <div className="flex items-center gap-3">
                                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-blue-900">{importProgress.message || 'Processing...'}</div>
                                            {importProgress.progress > 0 && (
                                                <div className="mt-2 w-full bg-blue-200 rounded-full h-2">
                                                    <div 
                                                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                                        style={{ width: `${importProgress.progress}%` }}
                                                    ></div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                            
                            {loadingTemplates ? (
                                <div className="text-center py-8 text-gray-500">
                                    Loading templates...
                                </div>
                            ) : templates.length === 0 ? (
                                <div className="text-center py-8">
                                    <div className="text-red-600 mb-2 font-medium">No templates available</div>
                                    <div className="text-sm text-gray-500 mb-4">No application templates found. Please contact your administrator.</div>
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        {templates.map((template) => (
                                            <label
                                                key={template.template_id}
                                                className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                                                    selectedTemplate?.template_id === template.template_id
                                                        ? 'border-indigo-500 bg-indigo-50'
                                                        : 'border-gray-200 hover:border-gray-300'
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="template"
                                                    value={template.template_id}
                                                    checked={selectedTemplate?.template_id === template.template_id}
                                                    onChange={() => setSelectedTemplate(template)}
                                                    className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                                                />
                                                <div className="ml-3 flex-1">
                                                    <div className="flex items-center justify-between">
                                                        <div className="text-sm font-medium text-gray-900">
                                                            {template.template_name}
                                                            {template.is_default && (
                                                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                                                                    Default
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-gray-500 capitalize">
                                                            {template.template_level}
                                                        </div>
                                                    </div>
                                                    {template.pm_companies?.company_name && (
                                                        <div className="text-xs text-gray-500 mt-1">
                                                            {template.pm_companies.company_name}
                                                        </div>
                                                    )}
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                    
                                    {formError && (
                                        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                            {formError}
                                        </div>
                                    )}
                                    
                                    <div className="flex justify-end gap-4 pt-4">
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (selectedTemplate) {
                                                    // Don't save template preference in read-only mode or if column doesn't exist
                                                    // The default_template_id column doesn't exist in the applicants table
                                                    setShowTemplateSelection(false);
                                                } else {
                                                    setFormError('Please select a template to continue.');
                                                }
                                            }}
                                            disabled={!selectedTemplate}
                                            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Continue
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Fill Application Form */}
                    {showFullApplication && !showTemplateSelection && selectedTemplate && (
                        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden px-6 pb-6">
                            <div className="flex-1 overflow-y-auto space-y-6 pr-2 pt-4">
                                {/* Template info banner */}
                                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm font-medium text-blue-800">Using template: </span>
                                            <span className="text-sm text-blue-700">{selectedTemplate.template_name}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {!readOnly && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (fillApplicationFileInputRef.current) {
                                                                fillApplicationFileInputRef.current.click();
                                                            }
                                                        }}
                                                        disabled={isImporting || !selectedTemplate}
                                                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-300 rounded-md hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <FileText size={14} />
                                                        Import Application
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowTemplateSelection(true)}
                                                        className="text-sm text-blue-600 hover:text-blue-800 underline"
                                                    >
                                                        Change Template
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {isImporting && (
                                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
                                        <div className="flex items-center gap-3">
                                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                                            <div className="flex-1">
                                                <div className="text-sm font-medium text-blue-900">{importProgress.message || 'Processing...'}</div>
                                                {importProgress.progress > 0 && (
                                                    <div className="mt-2 w-full bg-blue-200 rounded-full h-2">
                                                        <div 
                                                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                                            style={{ width: `${importProgress.progress}%` }}
                                                        ></div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                                <ApplicationFormBuilder
                                    key={`app-form-${applicant.applicant_id}-${selectedTemplate.template_id}-${JSON.stringify(documentData).substring(0, 50)}`}
                                    documentData={documentData}
                                    onChange={setDocumentData}
                                    templateData={selectedTemplateData}
                                    readOnly={readOnly}
                                />
                                
                                {selectedUnits.length > 0 && (
                                    <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                                        <h4 className="text-sm font-medium text-blue-800 mb-2">
                                            Selected Units ({selectedUnits.length})
                                        </h4>
                                        <div className="text-sm text-blue-700 space-y-1">
                                            {selectedUnits.map(unitId => {
                                                const unit = units.find(u => u.unit_id === unitId);
                                                return unit ? (
                                                    <div key={unitId}>
                                                        • {formatUnitInfo(unit)}
                                                    </div>
                                                ) : null;
                                            })}
                                        </div>
                                    </div>
                                )}

                                {formError && (
                                    <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                        {formError}
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end gap-4 pt-4 border-t bg-white flex-shrink-0 mt-auto">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className={`px-4 py-2 text-sm font-medium border border-transparent rounded-md shadow-sm ${
                                        readOnly 
                                            ? 'text-white bg-indigo-600 hover:bg-indigo-700' 
                                            : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'
                                    }`}
                                >
                                    {readOnly ? 'Done' : 'Cancel'}
                                </button>
                                {!readOnly && (
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                                    >
                                        {isSubmitting ? 'Saving...' : 'Save Changes'}
                                    </button>
                                )}
                            </div>
                        </form>
                    )}

                    {/* Select Units Mode - Combined View */}
                    {!showFullApplication && (
                        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                            <div className="flex-1 overflow-y-auto space-y-6 pr-2">
                                {/* Existing Selections Section */}
                                <div>
                                    <h3 className="text-lg font-medium text-gray-900 mb-4">
                                        Existing Selections ({applications.length})
                                    </h3>
                                    {applications.length === 0 ? (
                                        <div className="text-center py-6 text-gray-500 bg-gray-50 border border-gray-200 rounded-md">
                                            No existing applications found.
                                        </div>
                                    ) : (
                                        <div className="space-y-3 mb-6">
                                            {applications.map(application => (
                                                <div key={application.application_id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <div className="flex items-center space-x-3">
                                                                <div>
                                                                    <div className="text-sm font-medium text-gray-900">
                                                                        {formatUnitInfo(application.units)}
                                                                    </div>
                                                                    <div className="text-sm text-gray-500">
                                                                        {application.units.properties?.property_type} • {application.units.square_footage} sq ft
                                                                    </div>
                                                                </div>
                                                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                                                    application.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                                    application.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                                                    'bg-red-100 text-red-800'
                                                                }`}>
                                                                    {application.status ? (application.status.charAt(0).toUpperCase() + application.status.slice(1)) : 'Unknown'}
                                                                </span>
                                                            </div>
                                                            <div className="mt-2 text-xs text-gray-500">
                                                                Applied: {new Date(application.applied_at).toLocaleDateString()}
                                                            </div>
                                                            {application.notes && (
                                                                <div className="mt-2 text-sm text-gray-700 bg-white p-2 rounded border border-gray-200">
                                                                    <strong>Notes:</strong> {application.notes}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex space-x-2 ml-4">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleEditApplication(application)}
                                                                className="text-indigo-600 hover:text-indigo-900 p-1 rounded hover:bg-indigo-50"
                                                                title="Edit Application"
                                                            >
                                                                <Pencil size={16} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteApplication(application.application_id)}
                                                                className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50"
                                                                title="Delete Application"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Divider */}
                                <div className="border-t border-gray-200 my-6"></div>

                                {/* Available Units Section */}
                                <div>
                                    <h3 className="text-lg font-medium text-gray-900 mb-4">
                                        Available Units
                                    </h3>
                                    
                                    {/* Search */}
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Search Units
                                        </label>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                            <input
                                                type="text"
                                                placeholder="Search by unit number, address, or property type..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                                            />
                                        </div>
                                    </div>

                                    {/* Units List */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Select Units ({filteredUnits.length} available)
                                        </label>
                                        <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-md">
                                            {filteredUnits.length === 0 ? (
                                                <div className="p-4 text-center text-gray-500">
                                                    {searchTerm ? 'No units match your search.' : 'No units available.'}
                                                </div>
                                            ) : (
                                                <div className="divide-y divide-gray-200">
                                                    {filteredUnits.map(unit => {
                                                        const applicationStatus = getApplicationStatus(unit.unit_id);
                                                        const isSelected = selectedUnits.includes(unit.unit_id);
                                                        const isDisabled = applicationStatus !== null;

                                                        return (
                                                            <div key={unit.unit_id} className={`p-4 ${isDisabled ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                                                                <div className="flex items-start justify-between">
                                                                    <div className="flex items-start">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={isSelected}
                                                                            onChange={() => handleUnitToggle(unit.unit_id)}
                                                                            disabled={isDisabled}
                                                                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded disabled:opacity-50 mt-1"
                                                                        />
                                                                        <div className="ml-3 flex-1">
                                                                            <div className="text-sm font-medium text-gray-900">
                                                                                {formatUnitInfo(unit)}
                                                                            </div>
                                                                            <div className="text-sm text-gray-500">
                                                                                {unit.properties?.property_type} • {unit.square_footage} sq ft
                                                                            </div>
                                                                            {applicationStatus && (
                                                                                <div className="mt-1">
                                                                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                                                                        applicationStatus === 'approved' ? 'bg-green-100 text-green-800' :
                                                                                        applicationStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                                                                        'bg-red-100 text-red-800'
                                                                                    }`}>
                                                                                        {applicationStatus.charAt(0).toUpperCase() + applicationStatus.slice(1)}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                
                                                                {/* Individual Notes for Selected Units */}
                                                                {isSelected && (
                                                                    <div className="mt-3 ml-7">
                                                                        <label className="block text-xs font-medium text-gray-700 mb-1">
                                                                            Notes for this unit:
                                                                        </label>
                                                                        <textarea
                                                                            value={unitNotes[unit.unit_id] || ''}
                                                                            onChange={(e) => handleNotesChange(unit.unit_id, e.target.value)}
                                                                            rows={2}
                                                                            placeholder="Add notes specific to this unit..."
                                                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                                                                        />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Selected Units Summary */}
                                {selectedUnits.length > 0 && (
                                    <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                                        <h4 className="text-sm font-medium text-blue-800 mb-2">
                                            Selected Units ({selectedUnits.length})
                                        </h4>
                                        <div className="text-sm text-blue-700 space-y-1">
                                            {selectedUnits.map(unitId => {
                                                const unit = units.find(u => u.unit_id === unitId);
                                                const notes = unitNotes[unitId];
                                                return unit ? (
                                                    <div key={unitId} className="flex justify-between items-start">
                                                        <span>• {formatUnitInfo(unit)}</span>
                                                        {notes && (
                                                            <span className="text-blue-600 text-xs ml-2">
                                                                (with notes)
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : null;
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Error Message */}
                                {formError && (
                                    <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                        {formError}
                                    </div>
                                )}
                            </div>

                            {/* Edit Application Modal */}
                            {editingApplication && (
                                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50 p-4">
                                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
                                        <div className="flex items-center justify-between p-4 border-b">
                                            <h3 className="text-lg font-medium text-gray-900">
                                                Edit Application Notes
                                            </h3>
                                            <button
                                                onClick={() => setEditingApplication(null)}
                                                className="text-gray-400 hover:text-gray-600"
                                            >
                                                <X size={20} />
                                            </button>
                                        </div>
                                        <div className="p-4">
                                            <div className="mb-4">
                                                <div className="text-sm font-medium text-gray-900">
                                                    {formatUnitInfo(editingApplication.units)}
                                                </div>
                                                <div className="text-sm text-gray-500">
                                                    {editingApplication.units.properties?.property_type} • {editingApplication.units.square_footage} sq ft
                                                </div>
                                            </div>
                                            <div className="mb-4">
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    Application Notes
                                                </label>
                                                <textarea
                                                    value={unitNotes[editingApplication.unit_id] || ''}
                                                    onChange={(e) => handleNotesChange(editingApplication.unit_id, e.target.value)}
                                                    rows={3}
                                                    placeholder="Add notes for this application..."
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                                                />
                                            </div>
                                            {formError && (
                                                <div className="mb-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                                    {formError}
                                                </div>
                                            )}
                                            <div className="flex justify-end space-x-3">
                                                <button
                                                    onClick={() => setEditingApplication(null)}
                                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={handleUpdateApplication}
                                                    disabled={isSubmitting}
                                                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                                                >
                                                    {isSubmitting ? 'Updating...' : 'Update'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Fixed Footer */}
                            <div className="flex justify-end gap-4 pt-4 border-t bg-white flex-shrink-0 mt-auto">
                                <button 
                                    type="button" 
                                    onClick={onClose} 
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    disabled={isSubmitting || selectedUnits.length === 0}
                                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Submitting...' : 'Submit Application'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
            {/* File input for Fill Application - always rendered so ref is available */}
            <input
                ref={fillApplicationFileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) {
                        handleFillApplicationFileImport(file);
                    }
                }}
            />
        </div>
    );
};

// Review Application Modal Component
const ReviewApplicationModal = ({ applicant, onClose, onReviewSuccess, onViewApplicationDetail }) => {
    const { user } = useContext(AuthContext);
    const [applications, setApplications] = useState([]);
    const [selectedUnitId, setSelectedUnitId] = useState(null);
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isTenant, setIsTenant] = useState(false);
    const [showDenyWarning, setShowDenyWarning] = useState(false);
    const [showDateDialog, setShowDateDialog] = useState(false);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Fetch applications and check if applicant is already a tenant
    useEffect(() => {
        const fetchData = async () => {
            if (!applicant) return;
            
            setIsLoading(true);
            try {
                // Fetch applications for this applicant
                const clientId = applicant.applicant_id || applicant.client_id;
                
                // Fetch all applications for this client (with optional units join)
                const [applicationsResult, addressesResult] = await Promise.all([
                    supabase
                        .from('client_applications')
                        .select(`
                            application_id,
                            unit_id,
                            status,
                            applied_at,
                            notes,
                            units(
                                unit_id,
                                unit_number,
                                properties(
                                    property_id,
                                    property_type
                                )
                            )
                        `)
                        .eq('client_id', clientId)
                        .eq('is_archived', false),
                    supabase.from('addresses').select('*').eq('addressable_type', 'property')
                ]);

                const { data: applicationsData, error: applicationsError } = applicationsResult;
                const { data: addressesData } = addressesResult;

                if (applicationsError) {
                    console.error('[UNIT_TRACKING] ReviewApplicationModal: ERROR fetching applications:', applicationsError);
                    // Don't show error if applicant_id is missing - just treat as no applications
                    if (applicationsError.code !== 'PGRST116' && applicant?.applicant_id) {
                        setFormError('Failed to load applications.');
                    }
                }
                
                // Always process applications, even if there was an error (treat as empty)
                const apps = applicationsData || [];
                const addresses = addressesData || [];
                
                // Join applications with addresses
                const appsWithAddresses = apps.map(app => {
                        // Handle applications with units - add null checks
                        if (app.units && app.units.properties && app.units.properties.property_id) {
                            const address = addresses.find(addr => 
                                addr.addressable_id === app.units.properties.property_id && 
                                addr.addressable_type === 'property'
                            );
                            return {
                                ...app,
                                units: {
                                    ...app.units,
                                    address: address || null
                                }
                            };
                        } else if (app.units) {
                            // Application with unit but no properties - return unit without address
                            return {
                                ...app,
                                units: {
                                    ...app.units,
                                    address: null
                                }
                            };
                        } else {
                            // Application without unit - return as is
                            return {
                                ...app,
                                units: null
                            };
                        }
                    });
                    
                setApplications(appsWithAddresses);
                
                // Set selected unit to first pending application, or first approved if no pending
                const pendingApp = appsWithAddresses.find(a => a.status === 'pending');
                const approvedApp = appsWithAddresses.find(a => a.status === 'approved');
                if (pendingApp) {
                    setSelectedUnitId(pendingApp.unit_id);
                    setNotes(pendingApp.notes || '');
                } else if (approvedApp) {
                    setSelectedUnitId(approvedApp.unit_id);
                    setNotes(approvedApp.notes || '');
                } else if (appsWithAddresses.length > 0) {
                    setSelectedUnitId(appsWithAddresses[0].unit_id);
                    setNotes(appsWithAddresses[0].notes || '');
                }
                
                // Clear error if we successfully got an empty array (no applications is fine)
                if (!applicationsError || apps.length === 0) {
                    setFormError('');
                }

                // Check if applicant is already a tenant (has active unit assignment in client_units)
                const today = new Date().toISOString().split('T')[0];
                const { data: activeAssignments, error: clientUnitsError } = await supabase
                    .from('client_units')
                    .select('client_unit_id')
                    .eq('client_id', applicant.applicant_id)
                    .eq('is_archived', false)
                    .lte('start_date', today)
                    .or(`end_date.is.null,end_date.gte.${today}`);

                // Handle missing table gracefully - if table doesn't exist, assume not a tenant
                if (clientUnitsError) {
                    if (clientUnitsError.code === 'PGRST205') {
                        // Table doesn't exist - log but continue
                        console.warn('client_units table does not exist, treating applicant as not a tenant');
                    } else {
                        console.error('Error checking client_units:', clientUnitsError);
                    }
                } else if (activeAssignments && activeAssignments.length > 0) {
                    setIsTenant(true);
                }
            } catch (error) {
                setFormError('Could not connect to server.');
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [applicant]);

    const formatUnitInfo = (unit) => {
        if (!unit) return 'N/A';
        return `Unit ${unit.unit_number || 'N/A'}`;
    };

    const formatAddress = (unit) => {
        if (!unit || !unit.address) return 'Address not available';
        const addr = unit.address;
        const parts = [
            addr.address_line_1,
            addr.address_line_2,
            addr.city,
            addr.state_province_region,
            addr.postal_code
        ].filter(Boolean);
        return parts.join(', ') || 'Address not available';
    };

    const handleApprove = async () => {
        // If a unit is selected, show date dialog; otherwise proceed directly
        if (selectedUnitId) {
            // Set default start date to tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            setStartDate(tomorrow.toISOString().split('T')[0]);
            setEndDate('');
            setShowDateDialog(true);
        } else {
            // No unit selected, proceed with approval without dates
            await performApproval(null, null);
        }
    };

    const performApproval = async (startDateValue, endDateValue) => {
        setIsSubmitting(true);
        setFormError('');

        try {
            // If there are applications and a unit is selected, update application status
            let approvedApplicationId = null;
            if (selectedUnitId && applications.length > 0) {
                const selectedApplication = applications.find(a => a.unit_id === selectedUnitId);
                
                if (selectedApplication) {
                    approvedApplicationId = selectedApplication.application_id;
                    
                    // Update the selected unit to approved
                    const { error: approveError } = await supabase
                        .from('client_applications')
                        .update({
                            status: 'approved',
                            notes: notes.trim() || null
                        })
                        .eq('application_id', selectedApplication.application_id);

                    if (approveError) {
                        console.error('Error updating application:', approveError);
                        // Continue anyway - we can still approve the applicant
                    }

                    // Set all other units to 'dropped'
                    const otherApplicationIds = applications
                        .filter(a => a.unit_id !== selectedUnitId)
                        .map(a => a.application_id);

                    if (otherApplicationIds.length > 0) {
                        const { error: dropError } = await supabase
                            .from('client_applications')
                            .update({ status: 'dropped' })
                            .in('application_id', otherApplicationIds);

                        if (dropError) {
                            console.error('Error updating other applications:', dropError);
                            // Continue anyway - the approval succeeded
                        }
                    }
                }
            }
            // Note: Applications are optional - we can approve an applicant without applications

            // Get client_id for creating client_units entry
            // The applicant view maps client_id to applicant_id, so we use applicant_id as client_id
            const clientId = applicant.applicant_id || applicant.client_id;
            
            if (!clientId) {
                console.error('Cannot create client_units: missing client_id');
                setFormError('Cannot approve applicant: missing client information.');
                setIsSubmitting(false);
                return;
            }
            
            const verifiedClientId = clientId;

            // Create client_units entry for the approved unit (if unit was selected)
            if (verifiedClientId && selectedUnitId) {
                // Validate that the unit exists
                const { data: unitCheck } = await supabase
                    .from('units')
                    .select('unit_id')
                    .eq('unit_id', selectedUnitId)
                    .maybeSingle();
                
                if (!unitCheck) {
                    console.error(`Unit ${selectedUnitId} does not exist, skipping client_units creation`);
                } else {
                    // Check if client_units entry already exists - fetch both application_id and lease_id
                    const { data: existingClientUnit } = await supabase
                        .from('client_units')
                        .select('client_unit_id, application_id, lease_id')
                        .eq('client_id', verifiedClientId)
                        .eq('unit_id', selectedUnitId)
                        .is('is_archived', false)
                        .maybeSingle();

                    // Validate application_id if provided
                    let validApplicationId = null;
                    if (approvedApplicationId) {
                        const { data: appCheck } = await supabase
                            .from('client_applications')
                            .select('application_id')
                            .eq('application_id', approvedApplicationId)
                            .maybeSingle();
                        if (appCheck) {
                            validApplicationId = approvedApplicationId;
                        } else {
                            console.error(`Application ${approvedApplicationId} does not exist, not setting application_id`);
                        }
                    }

                    // Only proceed with client_units operations if table exists (no PGRST205 error)
                    if (checkError && checkError.code === 'PGRST205') {
                        // Table doesn't exist - skip all client_units operations
                        // Approval will still succeed, just without client_units entry
                    } else if (!existingClientUnit) {
                        // Create new client_units entry
                        // Use provided start_date or default to tomorrow
                        const assignmentType = validApplicationId ? 'application' : 'direct';
                        const { error: clientUnitError } = await supabase
                            .from('client_units')
                            .insert([{
                                client_id: verifiedClientId,
                                unit_id: selectedUnitId,
                                application_id: validApplicationId,
                                assignment_type: assignmentType,
                                start_date: startDateValue || (() => {
                                    const tomorrow = new Date();
                                    tomorrow.setDate(tomorrow.getDate() + 1);
                                    return tomorrow.toISOString().split('T')[0];
                                })(),
                                end_date: endDateValue || null
                            }]);

                        if (clientUnitError) {
                            if (clientUnitError.code === 'PGRST205') {
                                console.warn('client_units table does not exist, cannot create entry');
                            } else {
                                console.error('Error creating client_units entry:', clientUnitError);
                            }
                            // Continue anyway - the approval succeeded
                        }
                    } else if (validApplicationId) {
                        // Update existing entry to include application_id and dates
                        // Check if lease_id actually exists
                        let hasLease = false;
                        if (existingClientUnit.lease_id) {
                            const { data: leaseCheck } = await supabase
                                .from('leases')
                                .select('lease_id')
                                .eq('lease_id', existingClientUnit.lease_id)
                                .maybeSingle();
                            hasLease = !!leaseCheck;
                        }
                        
                        // Determine assignment_type based on what actually exists
                        const assignmentType = hasLease ? 'both' : 'application';
                        
                        const updateData = {
                            application_id: validApplicationId,
                            assignment_type: assignmentType
                        };
                        
                        // Update dates if provided
                        if (startDateValue) {
                            updateData.start_date = startDateValue;
                        }
                        if (endDateValue !== undefined) {
                            updateData.end_date = endDateValue || null;
                        }
                        
                        const { error: updateError } = await supabase
                            .from('client_units')
                            .update(updateData)
                            .eq('client_unit_id', existingClientUnit.client_unit_id);

                        if (updateError) {
                            if (updateError.code === 'PGRST205') {
                                console.warn('client_units table does not exist, cannot update entry');
                            } else {
                                console.error('Error updating client_units entry:', updateError);
                            }
                            // Continue anyway
                        }
                    }
                }
            }

            // Close modal and refresh data
            setShowDateDialog(false);
            onReviewSuccess();
            onClose();
        } catch (error) {
            console.error('Error approving application:', error);
            setFormError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeny = async () => {
        // Check if applicant is already a tenant
        if (isTenant) {
            setShowDenyWarning(true);
            return;
        }

        setIsSubmitting(true);
        setFormError('');

        try {
            // Update all applications to denied
            const applicationIds = applications.map(a => a.application_id);
            
            if (applicationIds.length > 0) {
                const { error: denyError } = await supabase
                    .from('client_applications')
                    .update({
                        status: 'denied',
                        notes: notes.trim() || null
                    })
                    .in('application_id', applicationIds);

                if (denyError) {
                    setFormError(denyError.message || 'Failed to deny application.');
                    setIsSubmitting(false);
                    return;
                }
            }

            onReviewSuccess();
        } catch (error) {
            console.error('Error denying application:', error);
            setFormError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBackdropClick = (e) => {
        // Prevent closing on backdrop click - only close via buttons
        e.stopPropagation();
    };

    if (!applicant) return null;

    // Find selected application by unit_id, or use first application if no unit selected
    const selectedApplication = selectedUnitId 
        ? applications.find(a => a.unit_id === selectedUnitId)
        : (applications.length > 0 ? applications[0] : null);

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            onClick={handleBackdropClick}
        >
            <div 
                className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-800">Review Application</h2>
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
                        <div className="text-center py-8">Loading...</div>
                    ) : (
                        <>
                            {/* Applicant Summary */}
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800 mb-3">Applicant Information</h3>
                                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                                    <div><strong>Name:</strong> {formatApplicantName(applicant)}</div>
                                    <div><strong>Email:</strong> {applicant.email}</div>
                                    {applicant.contact_methods && applicant.contact_methods.length > 0 && (
                                        <div>
                                            <strong>Contact:</strong> {
                                                sortContactMethods(applicant.contact_methods, applicant.email)
                                                    .filter(cm => cm.method_type && cm.method_type.toLowerCase() !== 'email')
                                                    .map(cm => `${cm.method_type}: ${cm.value}`)
                                                    .join(', ') || 'N/A'
                                            }
                                        </div>
                                    )}
                                    {applicant.date_of_birth && (
                                        <div><strong>Date of Birth:</strong> {formatDate(applicant.date_of_birth)}</div>
                                    )}
                                </div>
                            </div>

                            {/* Link to Review Application in Detail */}
                            <div>
                                <button
                                    onClick={() => {
                                        onViewApplicationDetail();
                                    }}
                                    className="text-indigo-600 hover:text-indigo-800 underline flex items-center gap-2"
                                >
                                    <FileText size={16} />
                                    Review Application in Detail
                                </button>
                            </div>

                            {/* Notes Field */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Notes
                                </label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={4}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="Add notes about this application..."
                                />
                            </div>

                            {/* Documents Section */}
                            {(() => {
                                // Show documents for the selected application, or first application if none selected
                                const appForDocuments = selectedApplication || (applications.length > 0 ? applications[0] : null);
                                
                                console.log('[ReviewApplicationModal] Documents Section: Checking for documents', {
                                    hasAppForDocuments: !!appForDocuments,
                                    application_id: appForDocuments?.application_id,
                                    applicant_user_id: applicant?.user_id,
                                    applicant_client_id: applicant?.client_id || applicant?.applicant_id,
                                    applications_count: applications.length,
                                    applications: applications.map(a => ({
                                        application_id: a.application_id,
                                        unit_id: a.unit_id,
                                        status: a.status
                                    }))
                                });
                                
                                if (appForDocuments && appForDocuments.application_id) {
                                    // Get tenant_user_id from the applicant's user_id
                                    const tenantUserId = applicant?.user_id || null;
                                    
                                    console.log('[ReviewApplicationModal] Documents Section: Rendering DocumentManagement', {
                                        tenantUserId,
                                        applicationId: appForDocuments.application_id,
                                        userRole: user?.role || 'user',
                                        userId: user?.user_id || null
                                    });
                                    
                                    return (
                                        <div className="border-t border-gray-200 pt-6">
                                            <DocumentManagement
                                                tenantUserId={tenantUserId}
                                                userRole={user?.role || 'user'}
                                                userId={user?.user_id || null}
                                                applicationId={appForDocuments.application_id}
                                            />
                                        </div>
                                    );
                                } else {
                                    console.log('[ReviewApplicationModal] Documents Section: No application found for documents', {
                                        appForDocuments: appForDocuments ? 'exists but no application_id' : 'null',
                                        applications_length: applications.length
                                    });
                                    return null;
                                }
                            })()}

                            {/* Unit Dropdown */}
                            {applications.length > 0 ? (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Select Unit {applications.length > 1 ? '(for approval)' : ''} (Optional)
                                    </label>
                                    <select
                                        value={selectedUnitId || ''}
                                        onChange={(e) => {
                                            const unitId = e.target.value ? parseInt(e.target.value) : null;
                                            setSelectedUnitId(unitId);
                                            const app = applications.find(a => a.unit_id === unitId);
                                            setNotes(app?.notes || '');
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    >
                                        <option value="">No unit selected (approve without application)</option>
                                        {applications.map(app => {
                                            if (!app.unit_id) {
                                                // Application without unit - show status only (not selectable as unit)
                                                return (
                                                    <option key={app.application_id} value="" disabled>
                                                        Application #{app.application_id} (Status: {app.status || 'N/A'}) - No Unit Assigned
                                                    </option>
                                                );
                                            }
                                            return (
                                                <option key={app.application_id} value={app.unit_id}>
                                                    {app.units ? formatUnitInfo(app.units) : 'Unit N/A'} - {app.units?.properties?.property_type || 'N/A'} 
                                                    {' '}(Status: {app.status || 'N/A'})
                                                    {app.units?.address ? ` - ${app.units.address.address_line_1}` : ''}
                                                </option>
                                            );
                                        })}
                                    </select>
                                    {selectedApplication && (
                                        <div className="mt-2 text-sm text-gray-600">
                                            Applied: {formatDate(selectedApplication.applied_at)}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-gray-500 p-3 bg-gray-50 rounded-md">
                                    <p className="font-medium mb-1">No applications found for this applicant.</p>
                                    <p className="text-sm">You can still approve this applicant without an application.</p>
                                </div>
                            )}

                            {/* Deny Warning */}
                            {showDenyWarning && (
                                <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">
                                    <p className="font-semibold mb-2">Cannot Deny Approved Applicant</p>
                                    <p>This applicant has already been approved and appears as a tenant. To deny this application, you must first delete the tenant on the Tenants page.</p>
                                    <button
                                        onClick={() => setShowDenyWarning(false)}
                                        className="mt-3 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                                    >
                                        Close
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Date Dialog */}
                {showDateDialog && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                        <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                            <h3 className="text-lg font-semibold text-gray-800 mb-4">Set Assignment Dates</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Start Date <span className="text-red-500">*</span>
                                    </label>
                                    <DateInput
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        End Date (Optional)
                                    </label>
                                    <DateInput
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    onClick={() => {
                                        setShowDateDialog(false);
                                        setIsSubmitting(false);
                                    }}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                                    disabled={isSubmitting}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        if (!startDate) {
                                            setFormError('Start date is required.');
                                            return;
                                        }
                                        performApproval(startDate, endDate || null);
                                    }}
                                    disabled={isSubmitting || !startDate}
                                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Approving...' : 'Approve'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex flex-col gap-3 p-6 border-t border-gray-200 bg-gray-50">
                    {/* Error Message in Footer */}
                    {formError && (
                        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                            {formError}
                        </div>
                    )}
                    <div className="flex justify-end gap-4">
                        <button 
                            onClick={() => {
                                setFormError('');
                                onClose();
                            }}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={async () => {
                                setFormError('');
                                setIsSubmitting(true);
                                try {
                                    // Save notes for the selected application
                                    if (selectedUnitId && applications.length > 0) {
                                        const selectedApplication = applications.find(a => a.unit_id === selectedUnitId);
                                        if (selectedApplication) {
                                            const { error: saveError } = await supabase
                                                .from('client_applications')
                                                .update({
                                                    notes: notes.trim() || null
                                                })
                                                .eq('application_id', selectedApplication.application_id);
                                            
                                            if (saveError) {
                                                setFormError('Failed to save notes: ' + saveError.message);
                                            } else {
                                                // Update local state
                                                setApplications(prev => prev.map(app => 
                                                    app.application_id === selectedApplication.application_id
                                                        ? { ...app, notes: notes.trim() || null }
                                                        : app
                                                ));
                                            }
                                        }
                                    }
                                } catch (error) {
                                    console.error('Error saving notes:', error);
                                    setFormError('Could not save notes.');
                                } finally {
                                    setIsSubmitting(false);
                                }
                            }}
                            disabled={isSubmitting || isLoading}
                            className="px-4 py-2 text-sm font-medium text-indigo-600 bg-white border border-indigo-300 rounded-md shadow-sm hover:bg-indigo-50 disabled:opacity-50"
                        >
                            {isSubmitting ? 'Saving...' : 'Save Notes'}
                        </button>
                        <button 
                            onClick={() => {
                                setFormError('');
                                handleDeny();
                            }}
                            disabled={isSubmitting || isLoading || applications.length === 0}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 disabled:opacity-50"
                        >
                            {isSubmitting ? 'Denying...' : 'Deny'}
                        </button>
                    <button 
                        onClick={() => {
                            setFormError('');
                            handleApprove();
                        }}
                        disabled={isSubmitting || isLoading}
                        className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 disabled:opacity-50"
                    >
                        {isSubmitting ? 'Approving...' : 'Approve'}
                    </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

