import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react';
import { Pencil, Trash2, X, ArrowUpDown, PlusCircle, RotateCcw, AlertTriangle, Search, Users, Building2, FileText, Eye, Download, Loader2 } from 'lucide-react';
import TenantSelectionModal from '../components/TenantSelectionModal';
import UnitSelectionModal from '../components/UnitSelectionModal';
import DateInput from '../components/DateInput';
import CurrencyInput from '../components/CurrencyInput';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card } from '../components/ui';
import { useSortableData } from '../hooks';
import { useFinderLimit } from '../hooks/useFinderLimit';
import { useFormPersistence } from '../hooks/useFormPersistence';
import { ApplicationFormBuilder } from '../components/ApplicationFormBuilder';
import { parseTemplateData } from '../utils/template-data.js';
import DocumentManagement from '../components/DocumentManagement';
import ArchiveModal from '../components/ArchiveModal';
import { deleteWithAudit } from '../lib/auditHelpers.js';
import {
  addDaysToWorkflowDate,
  formatWorkflowDateForLocale,
  formatWorkflowDateMMDDYYYY,
  isCompleteWorkflowDate,
  firstOfNextMonth,
  parseWorkflowDateParts,
  todayWorkflowDate,
  toWorkflowDateString,
} from '../utils/workflow-date.js';
import { formatUnitPickerLabel } from '../utils/unit-display.js';
import {
  convertDateToOrdinalWord,
  describeLeaseTerm,
} from '../utils/date-ordinal.js';

// Utility functions
const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const formatted = formatWorkflowDateForLocale(
        toWorkflowDateString(dateString) || dateString,
        typeof navigator !== 'undefined' ? navigator.language : 'en-US'
    );
    return formatted || 'N/A';
};

const formatDateMMDDYYYY = (dateString) => {
    if (!dateString) return '';
    return formatWorkflowDateMMDDYYYY(dateString);
};

const formatFullName = (first_name, middle_name, last_name) => {
    if (!first_name || !last_name) return '';
    let name = first_name;
    if (middle_name) {
        const middleInitial = middle_name.charAt(0).toUpperCase();
        name += ` ${middleInitial}.`;
    }
    name += ` ${last_name}`;
    return name.trim();
};

const formatCurrency = (amount) => {
    if (!amount) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

const formatCurrencyForInput = (amount) => {
    if (!amount) return '';
    const num = parseFloat(amount);
    if (num % 1 === 0) {
        return num.toString(); // Return as integer if it's a whole number
    }
    return amount.toString(); // Keep decimals if they exist
};

const formatUnitAddress = (unit) => {
    if (!unit) return 'N/A';
    
    const address = unit.property_address;
    const propertyName = unit.properties?.property_name;
    
    if (!address) {
        if (propertyName) {
            return `Unit ${unit.unit_number} - ${propertyName}`;
        }
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

const formatUnitAddressMultiLine = (unit) => {
    if (!unit) return ['N/A'];
    
    const lines = [`Unit ${unit.unit_number}`];
    
    const address = unit.property_address;
    const propertyName = unit.properties?.property_name;
    
    if (address) {
        if (address.address_line_1) lines.push(address.address_line_1);
        if (address.address_line_2) lines.push(address.address_line_2);
        if (address.city || address.state_province_region) {
            const cityState = [address.city, address.state_province_region].filter(Boolean).join(', ');
            if (cityState) lines.push(cityState);
        }
    } else if (propertyName) {
        lines.push(propertyName);
    } else {
        lines.push('No Address');
    }
    
    return lines;
};

const formatTenantNames = (tenants) => {
    if (!tenants || tenants.length === 0) return 'N/A';
    return tenants.map(t => {
        const firstName = t.first_name || '';
        const lastName = t.last_name || '';
        const name = `${firstName} ${lastName}`.trim();
        return name || t.email || 'Unknown';
    }).filter(Boolean).join(', ');
};

const getLeaseStatusColor = (status) => {
    switch (status?.toLowerCase()) {
        case 'active': return 'text-green-600 bg-green-100';
        case 'expired': return 'text-red-600 bg-red-100';
        case 'terminated': return 'text-gray-600 bg-gray-100';
        default: return 'text-blue-600 bg-blue-100';
    }
};

const isLeaseNearExpiry = (endDate) => {
    if (!endDate) return false;
    const endIso = toWorkflowDateString(endDate);
    if (!isCompleteWorkflowDate(endIso)) return false;
    const [ey, em, ed] = endIso.split('-').map(Number);
    const end = new Date(ey, em - 1, ed);
    const now = new Date();
    const threeMonthsFromNow = new Date(
      now.getFullYear(),
      now.getMonth() + 3,
      now.getDate()
    );
    return end <= threeMonthsFromNow;
};

export default function LeasesPage() {
    const { user } = useContext(AuthContext);
    const [leases, setLeases] = useState([]);
    const [units, setUnits] = useState([]);
    const [tenants, setTenants] = useState([]);
    const [editingLease, setEditingLease] = useState(null);
    const [renewingLease, setRenewingLease] = useState(null);
    const [deletingLease, setDeletingLease] = useState(null);
    const [fillingLeaseFor, setFillingLeaseFor] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [generatingDocument, setGeneratingDocument] = useState(null);
    const [generatingTemplateId, setGeneratingTemplateId] = useState(null);
    const [availableTemplates, setAvailableTemplates] = useState([]);
    const [showTemplateSelect, setShowTemplateSelect] = useState(false);
    const [generationStatus, setGenerationStatus] = useState(null);
    
    // Debounce search term to avoid excessive filtering
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300);
        
        return () => clearTimeout(timer);
    }, [searchTerm]);
    
    const filteredLeases = useMemo(() => {
        if (!leases || !Array.isArray(leases)) {
            return [];
        }
        if (!debouncedSearchTerm.trim()) {
            return leases;
        }
        
        const searchLower = debouncedSearchTerm.toLowerCase();
        return leases.filter(lease => {
            const tenantMatch = lease.tenants && lease.tenants.some(tenant => 
                [tenant.first_name, tenant.last_name, tenant.email].some(field => 
                    field && field.toLowerCase().includes(searchLower)
                )
            );
            
            const unitMatch = lease.unit && [
                lease.unit.address_line_1,
                lease.unit.address_line_2,
                lease.unit.city,
                lease.unit.state_province_region,
                lease.unit.unit_number
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            const leaseMatch = [
                lease.status,
                lease.rent_amount?.toString(),
                lease.start_date,
                lease.end_date
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            return tenantMatch || unitMatch || leaseMatch;
        });
    }, [leases, debouncedSearchTerm]);
    const { items: sortedLeases, requestSort, sortConfig } = useSortableData(filteredLeases, { key: 'start_date', direction: 'descending' });
    const { visibleCount: leaseVisibleCount, hasMore: hasMoreLeases, showMore: showMoreLeases } = useFinderLimit(
        sortedLeases.length,
        [debouncedSearchTerm, leases.length]
    );
    const displayedLeases = sortedLeases.slice(0, leaseVisibleCount || sortedLeases.length);
    const fetchData = async () => {
        try {
            const leasesQuery = supabase.from('leases').select(`
                    *,
                    units!inner(
                        unit_id,
                        unit_number,
                        properties!inner(
                            property_id,
                            property_name
                        )
                    ),
                    lease_tenants:lease_clients!inner(
                        tenant_id:client_id,
                        tenants:clients!inner(
                            tenant_id:client_id,
                            user_id,
                            users!clients_user_id_fkey(
                                user_id,
                                email
                            )
                        )
                    ),
                    template:templates(
                        template_id,
                        template_name,
                        template_level
                    )
                `);
            if (!showArchived) {
                leasesQuery.eq('is_archived', false);
            }
            
            const [leasesResult, unitsResult, usersResult, tenantRecordsResult, addressesResult, contactsResult] = await Promise.all([
                leasesQuery,
                supabase.from('units').select(`
                    *,
                    properties!inner(
                        property_id,
                        property_name
                    )
                `),
                supabase.from('users').select('*').eq('role', 'client'),
                supabase.from('clients').select('client_id, user_id'),
                supabase.from('addresses').select('*').eq('addressable_type', 'property'),
                supabase.from('contacts').select('*').eq('contactable_type', 'client')
            ]);
            
            if (leasesResult.error) {
                console.error('Error fetching leases:', leasesResult.error);
                setLeases([]);
            } else {
                // Transform lease data to include tenants with contact information and unit with address
                const leasesWithData = (leasesResult.data || []).map(lease => {
                    // Find unit address
                    const unitAddress = (addressesResult.data || []).find(
                        addr => addr.addressable_id === lease.units.properties.property_id && addr.addressable_type === 'property'
                    );
                    
                    return {
                        ...lease,
                        unit: {
                            ...lease.units,
                            property_address: unitAddress,
                            properties: lease.units.properties // Ensure properties object is included
                        },
                        tenants: lease.lease_tenants?.map(lt => {
                            const user = lt.tenants?.users;
                            const userId = user?.user_id;
                            const contact = userId
                                ? (contactsResult.data || []).find(
                                    c => c.contactable_id === userId && c.contactable_type === 'client'
                                )
                                : null;
                            return {
                                ...user,
                                first_name: contact?.first_name || '',
                                middle_name: contact?.middle_name || '',
                                last_name: contact?.last_name || '',
                                email: user?.email || '' // Ensure email is included
                            };
                        }) || []
                    };
                });
                setLeases(leasesWithData);
            }
            
            if (unitsResult.error) {
                console.error('Error fetching units:', unitsResult.error);
                setUnits([]);
            } else {
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
            
            if (usersResult.error) {
                console.error('Error fetching users:', usersResult.error);
                setTenants([]);
            } else if (tenantRecordsResult.error) {
                console.error('Error fetching tenant records:', tenantRecordsResult.error);
                setTenants([]);
            } else {
                const tenantRecords = tenantRecordsResult.data || [];
                const usersData = usersResult.data || [];
                const tenantsWithContacts = usersData.map(user => {
                    const tenantRecord = tenantRecords.find(t => t.user_id === user.user_id);
                    const contact = (contactsResult.data || []).find(
                        c => c.contactable_id === user.user_id && c.contactable_type === 'client'
                    );
                    return {
                        ...user,
                        tenant_id: tenantRecord?.client_id,
                        first_name: contact?.first_name || '',
                        middle_name: contact?.middle_name || '',
                        last_name: contact?.last_name || '',
                        email: user?.email || ''
                    };
                });
                setTenants(tenantsWithContacts);
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            setLeases([]);
            setUnits([]);
            setTenants([]);
        }
    };

    useEffect(() => {
        if (user) fetchData();
    }, [user, showArchived]);

    useEffect(() => {
        const fetchTemplates = async () => {
            if (!user) return;
            try {
                const { data, error } = await supabase
                    .from('templates')
                    .select('template_id, template_name, is_default, template_level')
                    .eq('template_type', 'Lease')
                    .eq('is_archived', false)
                    .order('is_default', { ascending: false })
                    .order('template_level', { ascending: true });
                
                if (!error && data) {
                    setAvailableTemplates(data);
                }
            } catch (error) {
                console.error('Error fetching templates:', error);
            }
        };
        fetchTemplates();
    }, [user]);

    const handleSignLease = async (lease) => {
        // Check if lease has a generated lease document first
        const { data: documents } = await supabase
            .from('documents')
            .select('document_id, document_name, file_name, document_type, lease_id')
            .eq('lease_id', lease.lease_id)
            .ilike('document_type', '%lease%')
            .order('created_at', { ascending: false })
            .limit(1);
        
        if (!documents || documents.length === 0) {
            alert('Please generate a lease document first before signing.');
            return;
        }
        
        const document = documents[0];
        
        // During testing, send to logged-in user
        // In production, send to manager (if any) or landlord, and tenants
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const currentUserId = user?.user_id || null;
        
        if (!currentUserId) {
            alert('Unable to identify current user. Please try again.');
            return;
        }
        
        try {
            const response = await fetch('/api/documents/sign-lease', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lease_id: lease.lease_id,
                    document_id: document.document_id,
                    user_id: currentUserId // For testing, send to logged-in user
                })
            });
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to initiate lease signing');
            }
            
            alert('Signing links have been sent! Check your email and text messages.');
            fetchData(); // Refresh to show updated status
        } catch (error) {
            console.error('Error signing lease:', error);
            alert('Failed to initiate lease signing: ' + error.message);
        }
    };

    const handleGenerateDocument = async (lease, templateId = null) => {
        const leaseTemplateId = lease.template_id || null;
        const providedTemplateId = templateId || null;
        
        if (availableTemplates.length > 1 && !leaseTemplateId && !providedTemplateId) {
            setGeneratingDocument(lease);
            setShowTemplateSelect(true);
            return;
        }

        const selectedTemplateId = leaseTemplateId || providedTemplateId || availableTemplates.find(t => t.is_default)?.template_id || null;

        setGeneratingDocument(lease);
        setGeneratingTemplateId(selectedTemplateId);
        setGenerationStatus({ type: 'generating', message: 'Generating document...' });

        try {
            // Use user_id from AuthContext (integer from users table)
            // The uploaded_by_user_id field expects an integer user_id, not a UUID
            const userId = user?.user_id || null;

            const response = await fetch('/api/documents/generate/lease', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lease_id: lease.lease_id,
                    template_id: selectedTemplateId,
                    user_id: userId
                })
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to generate document');
            }

            setGenerationStatus({ 
                type: 'success', 
                message: 'Document generated successfully!',
                document_id: result.document_id
            });

            // Open the generated document
            try {
                const docResponse = await fetch(`/api/documents/${result.document_id}/download`);
                const docResult = await docResponse.json();
                
                if (docResult.success && docResult.url) {
                    window.open(docResult.url, '_blank');
                }
            } catch (openError) {
                console.error('Error opening document:', openError);
                // Don't fail the whole operation if opening fails
            }

            // Refresh data to show new document
            setTimeout(() => {
                fetchData();
                setGeneratingDocument(null);
                setGeneratingTemplateId(null);
                setGenerationStatus(null);
                setShowTemplateSelect(false);
            }, 2000);

        } catch (error) {
            console.error('Error generating document:', error);
            setGenerationStatus({ 
                type: 'error', 
                message: error.message || 'Failed to generate document'
            });
            setTimeout(() => {
                setGeneratingDocument(null);
                setGeneratingTemplateId(null);
                setGenerationStatus(null);
                setShowTemplateSelect(false);
            }, 3000);
        }
    };
    
    const handleSuccess = () => {
        setEditingLease(null);
        setRenewingLease(null);
        setDeletingLease(null);
        fetchData();
    };

    const handleRestore = async (leaseId) => {
        try {
            const { error } = await supabase.rpc('restore_entity', {
                p_table_name: 'leases',
                p_entity_id: leaseId,
                p_restored_by_user_id: user.user_id
            });
            
            if (error) {
                console.error('Error restoring lease:', error);
                alert('Failed to restore lease: ' + error.message);
            } else {
                fetchData();
            }
        } catch (err) {
            console.error('Error restoring lease:', err);
            alert('Could not connect to the server.');
        }
    };

    const getSortIndicator = (name) => {
        if (!sortConfig || sortConfig.key !== name) return <ArrowUpDown size={14} className="ml-2 text-gray-400"/>;
        return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
    };

    // Get eligible units (units with tenants who don't have active leases)
    const getEligibleUnits = () => {
        const activeLeaseUnitIds = leases
            .filter(lease => lease.status === 'active')
            .map(lease => lease.unit_id);
        
        return units.filter(unit => !activeLeaseUnitIds.includes(unit.unit_id));
    };

    return (
        <div className="finder-page">
            <h2 className="text-3xl font-bold text-gray-800">Leases</h2>
            <div className="finder-split">
                <CreateLeaseForm 
                    units={getEligibleUnits()} 
                    tenants={tenants}
                    onLeaseCreated={handleSuccess} 
                />
                <Card
                    title="Lease Search"
                    className="max-h-[calc(100vh-160px)] min-h-0 lg:max-h-none"
                    contentClassName="flex min-h-0 flex-col h-full"
                >
                    <div className="flex min-h-0 flex-col h-full">
                    {/* Search Box */}
                    <div className="mb-4 flex-shrink-0">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="relative flex-1">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Search className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Search leases by tenant name, address, status, or rent amount..."
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
                                sortedLeases.length === 0 ? (
                                    <span className="text-red-600">No leases found matching "{debouncedSearchTerm}"</span>
                                ) : (
                                    <span>Showing {sortedLeases.length} of {leases.length} leases</span>
                                )
                            ) : (
                                <span>Showing {leases.length} of {leases.length} leases</span>
                            )}
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-gray-200">
                        <div className="overflow-auto h-full min-h-0 max-w-full">
                        <table className="finder-list w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">Actions</th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('unit_address')} className="flex items-center">
                                            Unit {getSortIndicator('unit_address')}
                                        </button>
                                    </th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('tenant_names')} className="flex items-center">
                                            Tenants {getSortIndicator('tenant_names')}
                                        </button>
                                    </th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('start_date')} className="flex items-center">
                                            Start Date {getSortIndicator('start_date')}
                                        </button>
                                    </th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('end_date')} className="flex items-center">
                                            End Date {getSortIndicator('end_date')}
                                        </button>
                                    </th>
                                    <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                        <button onClick={() => requestSort('status')} className="flex items-center">
                                            Status {getSortIndicator('status')}
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {displayedLeases.map(lease => (
                                    <tr key={lease.lease_id} className={lease.is_archived ? 'opacity-60 italic' : ''}>
                                        <td className="px-1.5 py-2 text-left whitespace-nowrap">
                                            <div className="flex items-center space-x-4">
                                                {!lease.is_archived && (
                                                    <>
                                                        <button 
                                                            onClick={() => setEditingLease(lease)} 
                                                            className="text-indigo-600 hover:text-indigo-900" 
                                                            title="Edit Lease"
                                                        >
                                                            <Pencil size={16}/>
                                                        </button>
                                                        <button 
                                                            onClick={() => setFillingLeaseFor(lease)} 
                                                            className="text-blue-600 hover:text-blue-900" 
                                                            title="Fill Lease"
                                                        >
                                                            <FileText size={16}/>
                                                        </button>
                                                        <button 
                                                            onClick={() => handleGenerateDocument(lease)} 
                                                            className="text-purple-600 hover:text-purple-900" 
                                                            title="Generate Lease"
                                                            disabled={generatingDocument?.lease_id === lease.lease_id}
                                                        >
                                                            {generatingDocument?.lease_id === lease.lease_id ? (
                                                                <Loader2 size={16} className="animate-spin"/>
                                                            ) : (
                                                                <Download size={16}/>
                                                            )}
                                                        </button>
                                                        <button 
                                                            onClick={() => handleSignLease(lease)} 
                                                            className="text-blue-600 hover:text-blue-900" 
                                                            title="Sign Lease"
                                                        >
                                                            <FileText size={16}/>
                                                        </button>
                                                        <button 
                                                            onClick={() => setRenewingLease(lease)} 
                                                            className="text-green-600 hover:text-green-900" 
                                                            title="Renew Lease"
                                                        >
                                                            <RotateCcw size={16}/>
                                                        </button>
                                                    </>
                                                )}
                                                {lease.is_archived && showArchived && (
                                                    <button onClick={() => handleRestore(lease.lease_id)} className="text-green-600 hover:text-green-900" title="Restore Lease"><RotateCcw size={16}/></button>
                                                )}
                                                <button 
                                                    onClick={() => setDeletingLease(lease)} 
                                                    className="text-red-600 hover:text-red-900" 
                                                    title="Archive Lease"
                                                >
                                                    <Trash2 size={16}/>
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-1.5 py-2">
                                            <div className="space-y-1">
                                                {lease.is_archived && (
                                                    <span className="inline-flex items-center px-2 py-1 rounded-full finder-secondary bg-gray-100 text-gray-600 mr-2">Archived</span>
                                                )}
                                                {formatUnitAddressMultiLine(lease.unit).map((line, index) => (
                                                    <div key={index} className={`block ${index > 0 ? 'finder-secondary text-gray-500' : ''}`}>{line}</div>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">
                                            {formatTenantNames(lease.tenants)}
                                        </td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">
                                            {formatDate(lease.start_date)}
                                        </td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">
                                            {formatDate(lease.end_date)}
                                        </td>
                                        <td className="px-1.5 py-2 whitespace-nowrap">
                                            <span className={`inline-flex px-2 py-1 rounded-full ${getLeaseStatusColor(lease.status)}`}>
                                                {lease.status ? lease.status.charAt(0).toUpperCase() + lease.status.slice(1).toLowerCase() : 'N/A'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                    </div>
                    {hasMoreLeases && (
                        <div className="pt-3 mt-4 border-t text-right flex-shrink-0">
                            <button
                                type="button"
                                onClick={showMoreLeases}
                                className="text-indigo-600 hover:text-indigo-800 underline text-sm font-medium"
                            >
                                more
                            </button>
                        </div>
                    )}
                    </div>
                </Card>
            </div>
            {editingLease && (
                <EditLeaseModal 
                    lease={editingLease} 
                    units={units}
                    tenants={tenants}
                    onClose={() => setEditingLease(null)} 
                    onUpdateSuccess={handleSuccess} 
                />
            )}
            {fillingLeaseFor && (
                <FillLeaseModal 
                    lease={fillingLeaseFor} 
                    onClose={() => setFillingLeaseFor(null)} 
                    onSuccess={handleSuccess} 
                />
            )}
            {renewingLease && (
                <RenewLeaseModal 
                    lease={renewingLease} 
                    units={units}
                    tenants={tenants}
                    onClose={() => setRenewingLease(null)} 
                    onRenewSuccess={handleSuccess} 
                />
            )}
            {/* Template Selection Modal for Document Generation */}
            {showTemplateSelect && generatingDocument && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-gray-800">Select Template</h2>
                                <button
                                    onClick={() => {
                                        setShowTemplateSelect(false);
                                        setGeneratingDocument(null);
                                    }}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                            <p className="text-sm text-gray-600 mb-4">
                                Choose a template for generating the lease document:
                            </p>
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {availableTemplates.map(template => (
                                    <button
                                        key={template.template_id}
                                        onClick={() => {
                                            setShowTemplateSelect(false);
                                            handleGenerateDocument(generatingDocument, template.template_id);
                                        }}
                                        className="w-full text-left p-3 border border-gray-200 rounded-md hover:bg-gray-50 hover:border-indigo-300 transition-colors"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="finder-primary text-gray-900">{template.template_name}</div>
                                                <div className="finder-secondary text-gray-500 mt-1">
                                                    {template.template_level} {template.is_default && '(Default)'}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <div className="mt-4 flex justify-end">
                                <button
                                    onClick={() => {
                                        setShowTemplateSelect(false);
                                        setGeneratingDocument(null);
                                    }}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Generation Status Display */}
            {generationStatus && (
                <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border p-4 max-w-sm z-50">
                    <div className="flex items-start">
                        <div className="flex-shrink-0">
                            {generationStatus.type === 'generating' && (
                                <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                            )}
                            {generationStatus.type === 'success' && (
                                <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
                                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            )}
                            {generationStatus.type === 'error' && (
                                <AlertTriangle className="h-5 w-5 text-red-500" />
                            )}
                        </div>
                        <div className="ml-3 flex-1">
                            <p className={`text-sm font-medium ${
                                generationStatus.type === 'success' ? 'text-green-800' :
                                generationStatus.type === 'error' ? 'text-red-800' :
                                'text-blue-800'
                            }`}>
                                {generationStatus.message}
                            </p>
                            {generationStatus.document_id && (
                                <p className="text-xs text-gray-500 mt-1">
                                    Document ID: {generationStatus.document_id}
                                </p>
                            )}
                        </div>
                        <button
                            onClick={() => setGenerationStatus(null)}
                            className="ml-4 text-gray-400 hover:text-gray-600"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {deletingLease && (
                <ArchiveModal 
                    entity={deletingLease}
                    entityType="lease"
                    entityName={`Lease for ${formatUnitAddress(deletingLease.unit)}`}
                    idField="lease_id"
                    onClose={() => setDeletingLease(null)}
                    onArchiveSuccess={handleSuccess}
                    showCascade={false}
                    requireReason={false}
                    isAdmin={user?.role === 'global_admin'}
                />
            )}
        </div>
    );
}

// Application Selector Component for selecting approved applications
const ApplicationSelector = ({ applications, selectedApplicationIds, onSelectionChange }) => {
    const [expandedUnits, setExpandedUnits] = useState(new Set());
    
    // Group applications by unit
    const applicationsByUnit = useMemo(() => {
        const grouped = {};
        applications.forEach(app => {
            const unitId = app.unit_id;
            if (!grouped[unitId]) {
                grouped[unitId] = {
                    unit: app.unit,
                    applications: []
                };
            }
            grouped[unitId].applications.push(app);
        });
        return grouped;
    }, [applications]);
    
    const toggleUnit = (unitId) => {
        setExpandedUnits(prev => {
            const next = new Set(prev);
            if (next.has(unitId)) {
                next.delete(unitId);
            } else {
                next.add(unitId);
            }
            return next;
        });
    };
    
    const handleApplicationToggle = (applicationId) => {
        const newSelection = selectedApplicationIds.includes(applicationId)
            ? selectedApplicationIds.filter(id => id !== applicationId)
            : [...selectedApplicationIds, applicationId];
        onSelectionChange(newSelection);
    };
    
    const formatTenantName = (tenant) => {
        const first = tenant.first_name || '';
        const last = tenant.last_name || '';
        const middle = tenant.middle_name ? ` ${tenant.middle_name.charAt(0)}.` : '';
        const name = `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
        return name || tenant.email || 'Unknown';
    };
    
    const formatUnitAddress = (unit) => {
        if (!unit) return 'N/A';
        const address = unit.property_address;
        const addressParts = [
            address?.address_line_1,
            address?.city,
            address?.state_province_region
        ].filter(Boolean);
        const addressString = addressParts.length > 0 ? addressParts.join(', ') : 'No Address';
        return `Unit ${unit.unit_number} - ${addressString}`;
    };
    
    return (
        <div className="space-y-2 max-h-96 overflow-y-auto border border-gray-200 rounded-md p-3">
            {Object.entries(applicationsByUnit).map(([unitId, { unit, applications: unitApps }]) => {
                const isExpanded = expandedUnits.has(parseInt(unitId));
                const unitSelectedCount = unitApps.filter(app => selectedApplicationIds.includes(app.application_id)).length;
                
                return (
                    <div key={unitId} className="border border-gray-200 rounded-md">
                        <div
                            onClick={() => toggleUnit(parseInt(unitId))}
                            className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
                        >
                            <div className="flex-1">
                                <div className="font-medium text-gray-900">
                                    {formatUnitAddress(unit)}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {unitApps.length} approved application{unitApps.length !== 1 ? 's' : ''}
                                    {unitSelectedCount > 0 && (
                                        <span className="ml-2 text-indigo-600">
                                            ({unitSelectedCount} selected)
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="ml-2">
                                {isExpanded ? (
                                    <X size={20} className="text-gray-400" />
                                ) : (
                                    <Users size={20} className="text-gray-400" />
                                )}
                            </div>
                        </div>
                        
                        {isExpanded && (
                            <div className="border-t border-gray-200 p-3 space-y-2">
                                {unitApps.map(app => {
                                    const isSelected = selectedApplicationIds.includes(app.application_id);
                                    return (
                                        <label
                                            key={app.application_id}
                                            className={`flex items-center p-2 rounded border cursor-pointer ${
                                                isSelected
                                                    ? 'bg-indigo-50 border-indigo-200'
                                                    : 'bg-white border-gray-200 hover:bg-gray-50'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => handleApplicationToggle(app.application_id)}
                                                className="mr-3 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                            />
                                            <div className="flex-1">
                                                <div className="finder-primary text-gray-900">
                                                    {formatTenantName(app.tenant)}
                                                </div>
                                                <div className="finder-secondary text-gray-500">
                                                    {app.tenant.email}
                                                    {app.applied_at && (
                                                        <span className="ml-2">
                                                            Applied: {new Date(app.applied_at).toLocaleDateString()}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
            
            {selectedApplicationIds.length > 0 && (
                <div className="mt-3 p-2 bg-indigo-50 border border-indigo-200 rounded-md">
                    <div className="text-sm font-medium text-indigo-900">
                        {selectedApplicationIds.length} application{selectedApplicationIds.length !== 1 ? 's' : ''} selected
                    </div>
                    <div className="text-xs text-indigo-700 mt-1">
                        Form fields will be auto-filled from the selected applications
                    </div>
                </div>
            )}
        </div>
    );
};

const CreateLeaseForm = ({ units, tenants, onLeaseCreated }) => {
    console.log('[Add Lease] CreateLeaseForm component rendered');
    const { user } = useContext(AuthContext);
    const [formData, setFormData] = useState({
        unit_id: '',
        start_date: firstOfNextMonth(),
        end_date: '',
        monthly_rent_amount: '',
        status: 'active',
        date_of_agreement: todayWorkflowDate(),
        security_deposit_amount: '',
        pet_deposit_amount: '',
        dependent_names: '',
        pets: '',
        comment: '',
        other_fee_amount: '',
        tenant_ids: [],
        template_id: null
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [showTenantModal, setShowTenantModal] = useState(false);
    const [showUnitModal, setShowUnitModal] = useState(false);
    const formBodyRef = useRef(null);
    
    // Template selection - optional
    const [useTemplate, setUseTemplate] = useState(false);
    const [availableTemplates, setAvailableTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [previewingTemplate, setPreviewingTemplate] = useState(null);
    const [templateFields, setTemplateFields] = useState(new Set()); // Track which fields came from template
    
    // Application selection (for 'from_applications' method)
    const [leaseCreationMethod, setLeaseCreationMethod] = useState('manual');
    const [approvedApplications, setApprovedApplications] = useState([]);
    const [selectedApplicationIds, setSelectedApplicationIds] = useState([]);
    const [loadingApplications, setLoadingApplications] = useState(false);
    
    const [unitFromTenants, setUnitFromTenants] = useState(null); // Unit assigned to selected tenants
    const [isUnitDisabled, setIsUnitDisabled] = useState(false);
    const [unitError, setUnitError] = useState('');
    
    // Form persistence (excluding search terms and modal state)
    const { clearPersistedData } = useFormPersistence('add-lease', formData, (state) => {
        const tenants = state.tenant_ids || [];
        const start = state.start_date || '';
        const startParts = parseWorkflowDateParts(toWorkflowDateString(start));
        const now = new Date();
        const looksLikeYearStartDefault =
            !tenants.length &&
            !state.unit_id &&
            startParts &&
            startParts.month === 1 &&
            startParts.day === 1 &&
            startParts.year === now.getFullYear();
        setFormData({
            ...state,
            start_date: start && !looksLikeYearStartDefault ? start : firstOfNextMonth(),
            date_of_agreement: state.date_of_agreement || todayWorkflowDate(),
        });
    });

    // Fetch available lease templates
    useEffect(() => {
        const fetchTemplates = async () => {
            try {
                // Apply role-based filtering
                let data, error;
                
                if (user?.role === 'global_admin') {
                    // Global admin - get all templates
                    const result = await supabase
                        .from('templates')
                        .select('*')
                        .eq('template_type', 'Lease')
                        .eq('is_archived', false)
                        .order('template_level', { ascending: true })
                        .order('template_name', { ascending: true });
                    data = result.data;
                    error = result.error;
                } else if (user?.role === 'company_admin' && user?.pmc_id) {
                    const [systemTemplates, companyTemplates, allCompanyTemplates, landlordTemplates] = await Promise.all([
                        supabase.from('templates').select('*').eq('template_type', 'Lease').eq('template_level', 'system').eq('is_archived', false),
                        supabase.from('templates').select('*').eq('template_type', 'Lease').eq('template_level', 'company').eq('pmc_id', user.pmc_id).eq('is_archived', false),
                        supabase.from('templates').select('*').eq('template_type', 'Lease').eq('template_level', 'company').eq('applies_to_all_companies', true).eq('is_archived', false),
                        supabase.from('templates').select('*').eq('template_type', 'Lease').eq('template_level', 'landlord').eq('applies_to_all_landlords', true).eq('is_archived', false)
                    ]);
                    
                    const allTemplates = [
                        ...(systemTemplates.data || []),
                        ...(companyTemplates.data || []),
                        ...(allCompanyTemplates.data || []),
                        ...(landlordTemplates.data || [])
                    ];
                    
                    const uniqueTemplates = Array.from(
                        new Map(allTemplates.map(t => [t.template_id, t])).values()
                    );
                    
                    uniqueTemplates.sort((a, b) => {
                        const levelOrder = { system: 0, company: 1, landlord: 2 };
                        const levelDiff = (levelOrder[a.template_level] || 3) - (levelOrder[b.template_level] || 3);
                        if (levelDiff !== 0) return levelDiff;
                        return (a.template_name || '').localeCompare(b.template_name || '');
                    });
                    
                    data = uniqueTemplates;
                    error = systemTemplates.error || companyTemplates.error || allCompanyTemplates.error || landlordTemplates.error;
                } else if (user?.role === 'landlord' && user?.landlord_id) {
                    const [systemTemplates, allCompanyTemplates, allLandlordTemplates, landlordTemplates] = await Promise.all([
                        supabase.from('templates').select('*').eq('template_type', 'Lease').eq('template_level', 'system').eq('is_archived', false),
                        supabase.from('templates').select('*').eq('template_type', 'Lease').eq('template_level', 'company').eq('applies_to_all_companies', true).eq('is_archived', false),
                        supabase.from('templates').select('*').eq('template_type', 'Lease').eq('template_level', 'landlord').eq('applies_to_all_landlords', true).eq('is_archived', false),
                        supabase.from('templates').select('*').eq('template_type', 'Lease').eq('template_level', 'landlord').eq('landlord_id', user.landlord_id).eq('is_archived', false)
                    ]);
                    
                    const allTemplates = [
                        ...(systemTemplates.data || []),
                        ...(allCompanyTemplates.data || []),
                        ...(allLandlordTemplates.data || []),
                        ...(landlordTemplates.data || [])
                    ];
                    
                    const uniqueTemplates = Array.from(
                        new Map(allTemplates.map(t => [t.template_id, t])).values()
                    );
                    
                    uniqueTemplates.sort((a, b) => {
                        const levelOrder = { system: 0, company: 1, landlord: 2 };
                        const levelDiff = (levelOrder[a.template_level] || 3) - (levelOrder[b.template_level] || 3);
                        if (levelDiff !== 0) return levelDiff;
                        return (a.template_name || '').localeCompare(b.template_name || '');
                    });
                    
                    data = uniqueTemplates;
                    error = systemTemplates.error || allCompanyTemplates.error || allLandlordTemplates.error || landlordTemplates.error;
                } else {
                    const result = await supabase
                        .from('templates')
                        .select('*')
                        .eq('template_type', 'Lease')
                        .eq('template_level', 'system')
                        .eq('is_archived', false)
                        .order('template_name', { ascending: true });
                    data = result.data;
                    error = result.error;
                }
                
                if (error) {
                    console.error('Error fetching templates:', error);
                    setAvailableTemplates([]);
                } else {
                    setAvailableTemplates(data || []);
                }
            } catch (error) {
                console.error('Error fetching templates:', error);
                setAvailableTemplates([]);
            }
        };
        
        if (user) {
            fetchTemplates();
        }
    }, [user]);

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleUnitChange = (unitId) => {
        setUnitError('');
        setFormData(prev => ({ ...prev, unit_id: unitId || '' }));
        if (!unitId) {
            setUnitFromTenants(null);
            setIsUnitDisabled(false);
        }
    };

    const getSelectedUnit = () => {
        if (!formData.unit_id) return null;
        return (
            units.find((u) => String(u.unit_id) === String(formData.unit_id)) ||
            unitFromTenants ||
            null
        );
    };

    const handleTenantSelection = (tenantId, checked) => {
        if (checked) {
            setFormData(prev => ({
                ...prev,
                tenant_ids: [...prev.tenant_ids, tenantId]
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                tenant_ids: prev.tenant_ids.filter(id => id !== tenantId)
            }));
        }
    };
    
    const formatTenantName = (tenant) => {
        const first = tenant.first_name || '';
        const last = tenant.last_name || '';
        const middle = tenant.middle_name ? ` ${tenant.middle_name.charAt(0)}.` : '';
        const name = `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
        // If name is empty, fall back to email or "Unknown"
        return name || tenant.email || 'Unknown';
    };
    
    const getSelectedTenants = () => {
        return tenants.filter(tenant => formData.tenant_ids.includes(tenant.user_id));
    };

    // Pre-fill form from template
    const applyTemplateToForm = useCallback((template) => {
        if (!template || !template.template_data) return;
        
        const templateData = template.template_data;
        const updates = {};
        
        // Map template data fields to form fields
        // Template data structure may vary, so we'll check common field names
        if (templateData.monthly_rent_amount !== undefined) {
            updates.monthly_rent_amount = templateData.monthly_rent_amount;
        }
        if (templateData.security_deposit_amount !== undefined) {
            updates.security_deposit_amount = templateData.security_deposit_amount;
        }
        if (templateData.pet_deposit_amount !== undefined) {
            updates.pet_deposit_amount = templateData.pet_deposit_amount;
        }
        if (templateData.other_fee_amount !== undefined) {
            updates.other_fee_amount = templateData.other_fee_amount;
        }
        if (templateData.dependent_names !== undefined) {
            updates.dependent_names = templateData.dependent_names;
        }
        if (templateData.pets !== undefined) {
            updates.pets = templateData.pets;
        }
        if (templateData.comment !== undefined) {
            updates.comment = templateData.comment;
        }
        
        // Check nested structures (common in template schemas)
        if (templateData.lease_terms) {
            if (templateData.lease_terms.monthly_rent !== undefined) {
                updates.monthly_rent_amount = templateData.lease_terms.monthly_rent;
            }
            if (templateData.lease_terms.security_deposit !== undefined) {
                updates.security_deposit_amount = templateData.lease_terms.security_deposit;
            }
            if (templateData.lease_terms.pet_deposit !== undefined) {
                updates.pet_deposit_amount = templateData.lease_terms.pet_deposit;
            }
        }
        
        if (templateData.fees) {
            if (templateData.fees.security_deposit !== undefined) {
                updates.security_deposit_amount = templateData.fees.security_deposit;
            }
            if (templateData.fees.pet_deposit !== undefined) {
                updates.pet_deposit_amount = templateData.fees.pet_deposit;
            }
            if (templateData.fees.other_fee !== undefined) {
                updates.other_fee_amount = templateData.fees.other_fee;
            }
        }
        
        setFormData(prev => ({
            ...prev,
            ...updates,
            template_id: template.template_id
        }));
    }, []);

    const handleTemplateSelect = (template) => {
        setSelectedTemplate(template);
        setUseTemplate(true);
        applyTemplateToForm(template);
        setShowTemplateModal(false);
    };

    const handleTemplateDeselect = () => {
        setSelectedTemplate(null);
        setUseTemplate(false);
        setTemplateFields(new Set());
        setFormData(prev => ({
            ...prev,
            template_id: null
        }));
    };
    
    const handleUseTemplateToggle = (checked) => {
        setUseTemplate(checked);
        if (!checked) {
            handleTemplateDeselect();
        } else if (!selectedTemplate) {
            setShowTemplateModal(true);
        }
    };
    
    // Fetch approved applications grouped by unit
    const fetchApprovedApplications = useCallback(async () => {
        if (!supabase) {
            console.error('[CreateLeaseForm] ❌ Supabase client is not available!');
            setApprovedApplications([]);
            setLoadingApplications(false);
            return;
        }
        
        setLoadingApplications(true);
        try {
            // Query applications with clients and units (avoid nested users join to prevent ambiguity)
            let { data: applications, error } = await supabase
                .from('client_applications')
                .select(`
                    application_id,
                    client_id,
                    unit_id,
                    field_data,
                    applied_at,
                    status,
                    clients!inner(
                        client_id,
                        user_id
                    ),
                    units!inner(
                        unit_id,
                        unit_number,
                        properties!inner(
                            property_id,
                            property_name
                        )
                    )
                `)
                .eq('status', 'approved')
                .eq('is_archived', false)
                .order('applied_at', { ascending: false });
            
            // If we have applications, fetch users separately to avoid relationship ambiguity
            if (applications && applications.length > 0 && !error) {
                const userIds = [...new Set(applications.map(app => app.clients?.user_id).filter(Boolean))];
                
                const { data: users, error: usersError } = await supabase
                    .from('users')
                    .select('user_id, email')
                    .in('user_id', userIds.length > 0 ? userIds : [0]);
                
                // Map users to applications
                const userMap = new Map((users || []).map(u => [u.user_id, u]));
                applications.forEach(app => {
                    if (app.clients && app.clients.user_id) {
                        app.clients.users = userMap.get(app.clients.user_id) || null;
                    }
                });
                
                const filteredApplications = applications.filter(app => {
                    const hasClients = !!app.clients;
                    const hasUsers = !!app.clients?.users;
                    const hasUnits = !!app.units;
                    const hasProperties = !!app.units?.properties;
                    
                    return hasClients && hasUsers && hasUnits && hasProperties;
                });
                
                // Update applications to the filtered list
                applications = filteredApplications;
            }
            
            if (error) {
                console.error('[CreateLeaseForm] ❌ Error fetching approved applications:', error);
                setApprovedApplications([]);
            } else {
                // Filter out applications for units that already have active leases
                const unitIds = [...new Set((applications || []).map(app => app.unit_id))];
                
                if (unitIds.length > 0) {
                    const { data: activeLeases, error: leasesError } = await supabase
                        .from('leases')
                        .select('unit_id')
                        .in('unit_id', unitIds)
                        .in('status', ['active', 'pending']);
                    
                    if (activeLeases && activeLeases.length > 0) {
                        const unitsWithActiveLeases = new Set(activeLeases.map(l => l.unit_id));
                        applications = applications.filter(app => !unitsWithActiveLeases.has(app.unit_id));
                    }
                }
                
                // Group by unit and join with addresses
                const { data: addresses } = await supabase
                    .from('addresses')
                    .select('*')
                    .eq('addressable_type', 'property');
                
                // Get contacts for all clients
                const clientIds = [...new Set((applications || []).map(a => a.client_id))];
                const { data: contacts, error: contactsError } = await supabase
                    .from('contacts')
                    .select('*')
                    .eq('contactable_type', 'client')
                    .in('contactable_id', clientIds.length > 0 ? clientIds : [0]);
                
                const applicationsWithData = (applications || []).map(app => {
                    const unit = app.units;
                    const property = unit.properties;
                    const address = addresses?.find(a => a.addressable_id === property.property_id);
                    const user = app.clients?.users;
                    // Contact lookup should use client_id, not user_id
                    const contact = contacts?.find(c => c.contactable_id === app.client_id);
                    
                    // Extract name from field_data as fallback if contact doesn't have it
                    let firstName = contact?.first_name || '';
                    let middleName = contact?.middle_name || '';
                    let lastName = contact?.last_name || '';
                    
                    // If contact doesn't have name, try to extract from field_data
                    if ((!firstName && !lastName) && app.field_data) {
                        const fieldData = typeof app.field_data === 'string' 
                            ? JSON.parse(app.field_data) 
                            : app.field_data;
                        
                        // Try various field name variations
                        const findInFieldData = (keys) => {
                            for (const key of keys) {
                                const value = fieldData?.[key] || 
                                             fieldData?.Applicant_Information?.[key] ||
                                             fieldData?.personal_information?.[key];
                                if (value && String(value).trim()) {
                                    return String(value).trim();
                                }
                            }
                            return null;
                        };
                        
                        firstName = firstName || findInFieldData([
                            'First_Name', 'first_name', 'firstName', 'First Name',
                            'Given_Name', 'given_name', 'First', 'first'
                        ]) || '';
                        
                        middleName = middleName || findInFieldData([
                            'Middle_Initial', 'middle_initial', 'Middle_Name', 'middle_name',
                            'Middle Initial', 'Middle Name', 'middleInitial', 'middleName'
                        ]) || '';
                        
                        lastName = lastName || findInFieldData([
                            'Last_Name', 'last_name', 'lastName', 'Last Name',
                            'Surname', 'surname', 'Family_Name', 'family_name',
                            'Last', 'last'
                        ]) || '';
                    }
                    
                    return {
                        ...app,
                        unit: {
                            ...unit,
                            property_address: address,
                            properties: property
                        },
                        tenant: {
                            ...user,
                            client_id: app.client_id,
                            first_name: firstName,
                            middle_name: middleName,
                            last_name: lastName,
                            email: user?.email || ''
                        }
                    };
                });
                
                setApprovedApplications(applicationsWithData);
            }
        } catch (error) {
            console.error('[CreateLeaseForm] ❌ ERROR in fetchApprovedApplications:', error);
            setApprovedApplications([]);
        } finally {
            setLoadingApplications(false);
        }
    }, []);
    
    // Fetch applications when method changes to 'from_applications'
    useEffect(() => {
        if (leaseCreationMethod === 'from_applications') {
            fetchApprovedApplications();
        }
    }, [leaseCreationMethod, fetchApprovedApplications]);
    
    // Handle application selection and auto-fill form
    const handleApplicationSelection = useCallback((applicationIds) => {
        setSelectedApplicationIds(applicationIds);
        
        if (applicationIds.length === 0) {
            return;
        }
        
        // Get selected applications
        const selectedApps = approvedApplications.filter(app => applicationIds.includes(app.application_id));
        
        // Set tenant IDs from selected applications
        const tenantUserIds = selectedApps.map(app => app.tenant.user_id).filter(Boolean);
        setFormData(prev => ({
            ...prev,
            tenant_ids: tenantUserIds
        }));
        
        // If all applications are for the same unit, set that unit
        const unitIds = [...new Set(selectedApps.map(app => app.unit_id))];
        if (unitIds.length === 1 && units.length > 0) {
            const unit = units.find(u => u.unit_id === unitIds[0]);
            if (unit) {
                setFormData(prev => ({ ...prev, unit_id: unit.unit_id }));
            }
        }
        
        // Auto-fill form from application field_data
        // Try to extract common fields from the first application's field_data
        if (selectedApps.length > 0 && selectedApps[0].field_data) {
            const fieldData = selectedApps[0].field_data;
            const updates = {};
            
            // Try to extract lease-related fields from field_data
            // This depends on the structure of your application forms
            if (fieldData.monthly_rent || fieldData.monthly_rent_amount) {
                updates.monthly_rent_amount = fieldData.monthly_rent || fieldData.monthly_rent_amount;
            }
            if (fieldData.security_deposit || fieldData.security_deposit_amount) {
                updates.security_deposit_amount = fieldData.security_deposit || fieldData.security_deposit_amount;
            }
            if (fieldData.pet_deposit || fieldData.pet_deposit_amount) {
                updates.pet_deposit_amount = fieldData.pet_deposit || fieldData.pet_deposit_amount;
            }
            if (fieldData.pets) {
                updates.pets = fieldData.pets;
            }
            if (fieldData.dependents || fieldData.dependent_names) {
                updates.dependent_names = fieldData.dependents || fieldData.dependent_names;
            }
            
            // Check nested structures
            if (fieldData.lease_terms) {
                if (fieldData.lease_terms.monthly_rent) updates.monthly_rent_amount = fieldData.lease_terms.monthly_rent;
                if (fieldData.lease_terms.security_deposit) updates.security_deposit_amount = fieldData.lease_terms.security_deposit;
                if (fieldData.lease_terms.pet_deposit) updates.pet_deposit_amount = fieldData.lease_terms.pet_deposit;
            }
            
            if (Object.keys(updates).length > 0) {
                setFormData(prev => ({ ...prev, ...updates }));
            }
        }
    }, [approvedApplications, units]);

    const resetForm = useCallback(() => {
        setFormData({
            unit_id: '',
            start_date: '',
            end_date: '',
            monthly_rent_amount: '',
            status: 'active',
            date_of_agreement: '',
            security_deposit_amount: '',
            pet_deposit_amount: '',
            dependent_names: '',
            pets: '',
            comment: '',
            other_fee_amount: '',
            tenant_ids: [],
            template_id: null
        });
        setUnitFromTenants(null);
        setIsUnitDisabled(false);
        setUnitError('');
        setSelectedTemplate(null);
        setUseTemplate(false);
        setTemplateFields(new Set());
        setFormError('');
        setLeaseCreationMethod('manual');
        setSelectedTemplate(null);
        setSelectedApplicationIds([]);
        setApprovedApplications([]);
        clearPersistedData();
    }, [clearPersistedData]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        setUnitError('');
        
        if (formData.tenant_ids.length === 0) {
            setFormError('Please select at least one tenant.');
            setIsSubmitting(false);
            return;
        }

        if (!formData.unit_id) {
            setUnitError('Please select a unit.');
            setFormError('Please select a unit.');
            setIsSubmitting(false);
            return;
        }

        try {
            const { tenant_ids, ...leaseData } = formData;
            
            if (leaseData.end_date === '') {
                leaseData.end_date = null;
            }
            
            // Convert empty strings to null for numeric fields to avoid database errors
            const numericFields = ['monthly_rent_amount', 'security_deposit_amount', 'pet_deposit_amount', 'other_fee_amount'];
            numericFields.forEach(field => {
                if (leaseData[field] === '' || leaseData[field] === null || leaseData[field] === undefined) {
                    leaseData[field] = null;
                } else {
                    // Convert to number if it's a string
                    const numValue = typeof leaseData[field] === 'string' ? parseFloat(leaseData[field]) : leaseData[field];
                    leaseData[field] = isNaN(numValue) ? null : numValue;
                }
            });
            
            // Include template_id if it exists (template_id column should exist via migration)
            // Only include if it's not null/undefined
            if (!leaseData.template_id) {
                delete leaseData.template_id;
            }
            
            const { data: leaseResult, error: leaseError } = await supabase
                .from('leases')
                .insert([leaseData])
                .select()
                .single();
            
            if (leaseError) {
                setFormError(leaseError.message || 'Failed to create lease.');
                return;
            }

            // Get client_ids for all user_ids
            const { data: tenantRecords } = await supabase
                .from('clients')
                .select('client_id, user_id')
                .in('user_id', tenant_ids);
            
            if (!tenantRecords || tenantRecords.length === 0) {
                setFormError('Could not find tenant records for selected tenants.');
                return;
            }
            
            const leaseTenantInserts = tenantRecords.map(tr => ({
                lease_id: leaseResult.lease_id,
                client_id: tr.client_id
            }));

            const { error: tenantError } = await supabase
                .from('lease_clients')
                .insert(leaseTenantInserts);
            
            if (tenantError) {
                setFormError(tenantError.message || 'Failed to create lease-tenant relationships.');
                return;
            }
            
            const unitId = leaseResult.unit_id;
            if (unitId) {
                const { data: unitCheck } = await supabase
                    .from('units')
                    .select('unit_id')
                    .eq('unit_id', unitId)
                    .maybeSingle();
                
                if (!unitCheck) {
                    console.error(`Unit ${unitId} does not exist, skipping client_units creation`);
                } else {
                    const { data: leaseCheck } = await supabase
                        .from('leases')
                        .select('lease_id')
                        .eq('lease_id', leaseResult.lease_id)
                        .maybeSingle();
                    
                    if (!leaseCheck) {
                        console.error(`Lease ${leaseResult.lease_id} does not exist, skipping client_units creation`);
                    } else {
                        for (const tr of tenantRecords) {
                            const { data: existingClientUnit } = await supabase
                                .from('client_units')
                                .select('client_unit_id, application_id, lease_id')
                                .eq('client_id', tr.client_id)
                                .eq('unit_id', unitId)
                                .is('is_archived', false)
                                .maybeSingle();
                            
                            if (!existingClientUnit) {
                                const { error: clientUnitError } = await supabase
                                    .from('client_units')
                                    .insert([{
                                        client_id: tr.client_id,
                                        unit_id: unitId,
                                        lease_id: leaseResult.lease_id,
                                        assignment_type: 'lease'
                                    }]);
                                
                                if (clientUnitError) {
                                    console.error('Error creating client_units entry:', clientUnitError);
                                    // Continue anyway - lease was created successfully
                                }
                            } else {
                                let hasApplication = false;
                                if (existingClientUnit.application_id) {
                                    const { data: appCheck } = await supabase
                                        .from('client_applications')
                                        .select('application_id')
                                        .eq('application_id', existingClientUnit.application_id)
                                        .maybeSingle();
                                    hasApplication = !!appCheck;
                                }
                                
                                // Determine assignment_type based on what actually exists
                                const assignmentType = hasApplication ? 'both' : 'lease';
                                
                                const { error: updateError } = await supabase
                                    .from('client_units')
                                    .update({
                                        lease_id: leaseResult.lease_id,
                                        assignment_type: assignmentType
                                    })
                                    .eq('client_unit_id', existingClientUnit.client_unit_id);
                                
                                if (updateError) {
                                    console.error('Error updating client_units entry:', updateError);
                                    // Continue anyway
                                }
                            }
                        }
                    }
                }
            }

            resetForm();
            onLeaseCreated();
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

    // Fetch unit assignments for selected tenants and auto-populate unit field
    useEffect(() => {
        console.log('[Add Lease] ===== useEffect triggered =====');
        console.log('[Add Lease] formData.tenant_ids:', formData.tenant_ids);
        console.log('[Add Lease] formData.tenant_ids.length:', formData.tenant_ids?.length);
        console.log('[Add Lease] units prop length:', units?.length);
        console.log('[Add Lease] units prop:', units);
        
        const fetchTenantUnits = async () => {
            console.log('[Add Lease] fetchTenantUnits async function called');
            console.log('[Add Lease] tenant_ids:', formData.tenant_ids);
            
            if (formData.tenant_ids.length === 0) {
                console.log('[Add Lease] No tenants selected, clearing unit');
                setUnitFromTenants(null);
                setIsUnitDisabled(false);
                return;
            }

            try {
                // Get client_ids for selected tenants
                const userIds = formData.tenant_ids.filter(Boolean);
                console.log('[Add Lease] Filtered userIds:', userIds);
                
                if (userIds.length === 0) {
                    console.log('[Add Lease] No valid userIds, clearing unit');
                    setUnitFromTenants(null);
                    setIsUnitDisabled(false);
                    return;
                }

                const { data: clientRecords, error: clientError } = await supabase
                    .from('clients')
                    .select('client_id, user_id')
                    .in('user_id', userIds);

                console.log('[Add Lease] Client records query result:', { data: clientRecords, error: clientError });

                if (!clientRecords || clientRecords.length === 0) {
                    console.log('[Add Lease] No client records found, clearing unit');
                    setUnitFromTenants(null);
                    setIsUnitDisabled(false);
                    return;
                }

                const clientIds = clientRecords.map(cr => cr.client_id);
                console.log('[Add Lease] Client IDs:', clientIds);

                // Fetch client_units for these clients (including start_date and end_date)
                const today = todayWorkflowDate();
                const { data: clientUnits, error: unitsError } = await supabase
                    .from('client_units')
                    .select('client_id, unit_id, start_date, end_date')
                    .in('client_id', clientIds)
                    .eq('is_archived', false)
                    .or(`end_date.is.null,end_date.gte.${today}`);

                console.log('[Add Lease] Client units query result:', { 
                    data: clientUnits, 
                    error: unitsError,
                    today,
                    query: `end_date.is.null,end_date.gte.${today}`
                });

                if (!clientUnits || clientUnits.length === 0) {
                    console.log('[Add Lease] No client units found, clearing unit');
                    setUnitFromTenants(null);
                    setIsUnitDisabled(false);
                    return;
                }

                // Build a map of client_id to unit_id(s)
                const userIdToClientId = new Map(
                    clientRecords.map(cr => [cr.user_id, cr.client_id])
                );
                const selectedClientIds = formData.tenant_ids
                    .map(userId => userIdToClientId.get(userId))
                    .filter(Boolean);
                
                console.log('[Add Lease] Selected client IDs:', selectedClientIds);
                console.log('[Add Lease] User ID to Client ID map:', Array.from(userIdToClientId.entries()));
                
                // Group client_units by client_id to check if each client has exactly one unit
                // Also track start_date and end_date for date population
                const clientToUnits = new Map();
                const clientToDates = new Map(); // Map<client_id, {start_date, end_date}>
                clientUnits.forEach(cu => {
                    if (selectedClientIds.includes(cu.client_id) && cu.unit_id) {
                        if (!clientToUnits.has(cu.client_id)) {
                            clientToUnits.set(cu.client_id, []);
                            clientToDates.set(cu.client_id, {
                                start_date: cu.start_date,
                                end_date: cu.end_date
                            });
                        }
                        clientToUnits.get(cu.client_id).push(cu.unit_id);
                    }
                });

                console.log('[Add Lease] Client to units map:', Array.from(clientToUnits.entries()));

                // Check if all selected tenants have exactly one unit assigned
                let allHaveOneUnit = true;
                const unitIdsForSelectedTenants = [];
                
                for (const clientId of selectedClientIds) {
                    const unitsForClient = clientToUnits.get(clientId) || [];
                    console.log(`[Add Lease] Client ${clientId} has ${unitsForClient.length} unit(s):`, unitsForClient);
                    if (unitsForClient.length !== 1) {
                        allHaveOneUnit = false;
                        break;
                    }
                    unitIdsForSelectedTenants.push(unitsForClient[0]);
                }

                console.log('[Add Lease] All have one unit?', allHaveOneUnit);
                console.log('[Add Lease] Unit IDs for selected tenants:', unitIdsForSelectedTenants);

                // Check if all tenants have the same unit
                const uniqueUnitIds = [...new Set(unitIdsForSelectedTenants)];
                const allHaveSameUnit = uniqueUnitIds.length === 1 && allHaveOneUnit;

                console.log('[Add Lease] Unique unit IDs:', uniqueUnitIds);
                console.log('[Add Lease] All have same unit?', allHaveSameUnit);
                console.log('[Add Lease] Available units in props:', units?.length || 0);

                // If all selected tenants have the same unit assigned
                if (allHaveSameUnit && selectedClientIds.length > 0) {
                    const unitId = uniqueUnitIds[0];
                    console.log('[Add Lease] Looking for unit with ID:', unitId);
                    const unit = units.find(u => u.unit_id === unitId);
                    console.log('[Add Lease] Found unit:', unit);
                    
                    if (unit) {
                        console.log('[Add Lease] Setting unit from tenants:', formatUnitAddress(unit));
                        setUnitFromTenants(unit);
                        setIsUnitDisabled(true);
                        
                        // Get dates from the first tenant's assignment (they should all have the same dates)
                        const firstClientId = selectedClientIds[0];
                        const dates = clientToDates.get(firstClientId);
                        const formatDateForInput = (dateString) => {
                            return toWorkflowDateString(dateString);
                        };
                        
                        setFormData(prev => ({ 
                            ...prev, 
                            unit_id: unit.unit_id,
                            start_date: dates?.start_date ? formatDateForInput(dates.start_date) : prev.start_date,
                            end_date: dates?.end_date ? formatDateForInput(dates.end_date) : prev.end_date
                        }));
                        setUnitError('');
                    } else {
                        console.log('[Add Lease] Unit not found in units array, clearing');
                        setUnitFromTenants(null);
                        setIsUnitDisabled(false);
                    }
                } else {
                    console.log('[Add Lease] Conditions not met for auto-population:', {
                        allHaveSameUnit,
                        selectedClientIdsLength: selectedClientIds.length
                    });
                    // Tenants have different units, no units, or multiple units - allow manual selection
                    setUnitFromTenants(null);
                    setIsUnitDisabled(false);
                }
            } catch (error) {
                console.error('[Add Lease] Error fetching tenant units:', error);
                setUnitFromTenants(null);
                setIsUnitDisabled(false);
            }
        };

        fetchTenantUnits();
    }, [formData.tenant_ids, units]);

    return (
        <Card hideTitle className="max-h-[calc(100vh-160px)] min-h-0 lg:max-h-none" contentClassName="flex min-h-0 flex-col h-full">
            <form onSubmit={handleCreate} className="flex min-h-0 flex-col h-full">
                <div className="flex items-start justify-between pb-4 mb-4 border-b">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Add Lease</h2>
                    </div>
                </div>
                <div ref={formBodyRef} className="flex-1 overflow-y-auto pr-1 space-y-4">
                {/* Select Tenants */}
                <div>
                    <label className="block text-sm font-medium text-gray-700">Select Tenants</label>
                    <div className="mt-2">
                        {formData.tenant_ids.length > 0 ? (
                            <div className="border border-gray-300 rounded-md p-3 bg-gray-50">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-gray-700">
                                        {formData.tenant_ids.length} tenant{formData.tenant_ids.length !== 1 ? 's' : ''} selected
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowTenantModal(true)}
                                        className="text-sm text-indigo-600 hover:text-indigo-800"
                                    >
                                        Change Selection
                                    </button>
                                </div>
                                <div className="space-y-1">
                                    {getSelectedTenants().map(tenant => (
                                        <div key={tenant.user_id} className="flex items-center justify-between gap-2 text-sm">
                                            <span className="text-gray-700 whitespace-normal break-words min-w-0">{formatTenantName(tenant)}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleTenantSelection(tenant.user_id, false)}
                                                className="text-red-600 hover:text-red-800 flex-shrink-0"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setShowTenantModal(true)}
                                className="w-full border-2 border-dashed border-gray-300 rounded-md p-4 text-center hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                            >
                                <Users className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                                <span className="text-sm text-gray-600">Click to select tenants</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Unit Selection */}
                <div>
                    <label className="block text-sm font-medium text-gray-700">
                        Select Unit
                        {isUnitDisabled && unitFromTenants && (
                            <span className="ml-2 text-xs text-gray-500 font-normal">
                                (Auto-filled from selected tenants)
                            </span>
                        )}
                    </label>
                    <div className="mt-2">
                        {formData.unit_id ? (
                            <div className={`border rounded-md p-3 ${isUnitDisabled ? 'border-gray-200 bg-gray-50' : 'border-gray-300 bg-gray-50'}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-gray-700">
                                        1 unit selected
                                    </span>
                                    {!isUnitDisabled && (
                                        <button
                                            type="button"
                                            onClick={() => setShowUnitModal(true)}
                                            className="text-sm text-indigo-600 hover:text-indigo-800"
                                        >
                                            Change Selection
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-start justify-between gap-3 text-sm">
                                    <div className="min-w-0 space-y-0.5">
                                        {getSelectedUnit() ? (
                                            <div className="finder-primary text-gray-900 whitespace-normal break-words">
                                                {formatUnitPickerLabel(getSelectedUnit())}
                                            </div>
                                        ) : (
                                            <div className="finder-primary text-gray-900">Unit ID {formData.unit_id}</div>
                                        )}
                                    </div>
                                    {!isUnitDisabled && (
                                        <button
                                            type="button"
                                            onClick={() => handleUnitChange(null)}
                                            className="text-red-600 hover:text-red-800 flex-shrink-0"
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => !isUnitDisabled && setShowUnitModal(true)}
                                disabled={isUnitDisabled}
                                className={`w-full border-2 border-dashed rounded-md p-4 text-center transition-colors ${
                                    isUnitDisabled
                                        ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                                        : unitError
                                          ? 'border-red-300 hover:border-red-400 hover:bg-red-50'
                                          : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                                }`}
                            >
                                <Building2 className={`mx-auto h-8 w-8 mb-2 ${unitError ? 'text-red-400' : 'text-gray-400'}`} />
                                <span className={`text-sm ${unitError ? 'text-red-600' : 'text-gray-600'}`}>
                                    Click to select unit
                                </span>
                            </button>
                        )}
                        {unitError && (
                            <p className="mt-1 text-sm text-red-600">{unitError}</p>
                        )}
                    </div>
                </div>

                {/* Template Selection - Optional */}
                {availableTemplates.length > 0 && (
                    <div className="border-b pb-4 mb-4">
                        <label className="flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={useTemplate}
                                onChange={(e) => handleUseTemplateToggle(e.target.checked)}
                                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                            />
                            <span className="ml-2 text-sm font-medium text-gray-700">Use Template</span>
                        </label>
                        <p className="ml-6 text-xs text-gray-500 mt-1">
                            Optional: Pre-fill lease form with template data. You can still create leases without templates.
                        </p>
                        
                        {/* Template Selection UI (when Use Template is checked) */}
                        {useTemplate && (
                            <div className="mt-3 ml-6">
                                {selectedTemplate ? (
                                    <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-md">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center">
                                                <FileText size={16} className="text-indigo-600 mr-2" />
                                                <div>
                                                    <div className="text-sm font-medium text-indigo-900">
                                                        {selectedTemplate.template_name}
                                                    </div>
                                                    <div className="text-xs text-indigo-700">
                                                        {selectedTemplate.template_level === 'system' ? 'System' : 
                                                         selectedTemplate.template_level === 'company' ? 'Company' : 'Landlord'} Template
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setPreviewingTemplate(selectedTemplate)}
                                                    className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center"
                                                >
                                                    <Eye size={14} className="mr-1" />
                                                    Preview
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleTemplateDeselect}
                                                    className="text-sm text-red-600 hover:text-red-800"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setShowTemplateModal(true)}
                                        className="w-full border-2 border-dashed border-gray-300 rounded-md p-3 text-center hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                                    >
                                        <FileText className="mx-auto h-6 w-6 text-gray-400 mb-1" />
                                        <span className="text-sm text-gray-600">Select a lease template</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DateInput
                        label="Start Date"
                        value={formData.start_date}
                        onChange={e => handleInputChange('start_date', e.target.value)}
                        required
                    />
                    <DateInput
                        label="End Date"
                        value={formData.end_date}
                        onChange={e => handleInputChange('end_date', e.target.value)}
                    />
                </div>

                <div>
                    <div className="flex items-center gap-2">
                        <label className="block text-sm font-medium text-gray-700">Monthly Rent Amount</label>
                        {templateFields.has('monthly_rent_amount') && (
                            <span className="text-xs text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded" title="From template">
                                Template
                            </span>
                        )}
                    </div>
                    <CurrencyInput
                        value={formData.monthly_rent_amount}
                        onChange={(value) => handleInputChange('monthly_rent_amount', value)}
                        required
                    />
                </div>

                <DateInput
                    label="Date of Agreement"
                    value={formData.date_of_agreement}
                    onChange={e => handleInputChange('date_of_agreement', e.target.value)}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <div className="flex items-center gap-2">
                            <label className="block text-sm font-medium text-gray-700">Security Deposit</label>
                            {templateFields.has('security_deposit_amount') && (
                                <span className="text-xs text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded" title="From template">
                                    Template
                                </span>
                            )}
                        </div>
                        <input 
                            type="number" 
                            step="1" 
                            value={formData.security_deposit_amount} 
                            onChange={e => handleInputChange('security_deposit_amount', e.target.value)} 
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <label className="block text-sm font-medium text-gray-700">Pet Deposit</label>
                            {templateFields.has('pet_deposit_amount') && (
                                <span className="text-xs text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded" title="From template">
                                    Template
                                </span>
                            )}
                        </div>
                        <input 
                            type="number" 
                            step="1" 
                            value={formData.pet_deposit_amount} 
                            onChange={e => handleInputChange('pet_deposit_amount', e.target.value)} 
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>
                </div>

                <div>
                    <div className="flex items-center gap-2">
                        <label className="block text-sm font-medium text-gray-700">Dependent Names</label>
                        {templateFields.has('dependent_names') && (
                            <span className="text-xs text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded" title="From template">
                                Template
                            </span>
                        )}
                    </div>
                    <textarea 
                        value={formData.dependent_names} 
                        onChange={e => handleInputChange('dependent_names', e.target.value)} 
                        rows={2}
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        placeholder="List dependent names..."
                    />
                </div>

                <div>
                    <div className="flex items-center gap-2">
                        <label className="block text-sm font-medium text-gray-700">Pets</label>
                        {templateFields.has('pets') && (
                            <span className="text-xs text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded" title="From template">
                                Template
                            </span>
                        )}
                    </div>
                    <textarea 
                        value={formData.pets} 
                        onChange={e => handleInputChange('pets', e.target.value)} 
                        rows={2}
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        placeholder="Pet information (count, breeds, size, etc.)..."
                    />
                </div>

                <div>
                    <div className="flex items-center gap-2">
                        <label className="block text-sm font-medium text-gray-700">Other Fee Amount</label>
                        {templateFields.has('other_fee_amount') && (
                            <span className="text-xs text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded" title="From template">
                                Template
                            </span>
                        )}
                    </div>
                    <input 
                        type="number" 
                        step="1" 
                        value={formData.other_fee_amount} 
                        onChange={e => handleInputChange('other_fee_amount', e.target.value)} 
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                    />
                </div>

                <div>
                    <div className="flex items-center gap-2">
                        <label className="block text-sm font-medium text-gray-700">Comment</label>
                        {templateFields.has('comment') && (
                            <span className="text-xs text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded" title="From template">
                                Template
                            </span>
                        )}
                    </div>
                    <textarea 
                        value={formData.comment} 
                        onChange={e => handleInputChange('comment', e.target.value)} 
                        rows={3}
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        placeholder="Additional comments..."
                    />
                </div>
                </div>
                <div className="pt-4 mt-4 border-t flex flex-col gap-3">
                    {formError && (
                        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
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
                            {isSubmitting ? 'Adding...' : 'Add Lease'}
                        </button>
                    </div>
                </div>
            </form>
            
            <TenantSelectionModal
                isOpen={showTenantModal}
                onClose={() => setShowTenantModal(false)}
                tenants={tenants}
                selectedTenantIds={formData.tenant_ids}
                onTenantSelection={handleTenantSelection}
                title="Select Tenants for Lease"
            />

            <UnitSelectionModal
                isOpen={showUnitModal}
                onClose={() => setShowUnitModal(false)}
                units={units}
                selectedUnitId={formData.unit_id || null}
                onUnitSelect={handleUnitChange}
                title="Select Unit for Lease"
                emptyMessage="No eligible units found."
            />
            
            {/* Template Selection Modal */}
            {showTemplateModal && (
                <LeaseTemplateSelectorModal
                    templates={availableTemplates}
                    onSelect={handleTemplateSelect}
                    onClose={() => setShowTemplateModal(false)}
                />
            )}
            
            {/* Template Preview Modal */}
            {previewingTemplate && (
                <LeaseTemplatePreviewModal
                    template={previewingTemplate}
                    onClose={() => setPreviewingTemplate(null)}
                />
            )}
        </Card>
    );
};

const EditLeaseModal = ({ lease, units, tenants, onClose, onUpdateSuccess }) => {
    const { user } = useContext(AuthContext);
    const [formData, setFormData] = useState({
        unit_id: lease.unit_id || '',
        start_date: lease.start_date || '',
        end_date: lease.end_date || '',
        monthly_rent_amount: lease.monthly_rent_amount || '',
        status: lease.status || 'active',
        date_of_agreement: lease.date_of_agreement || '',
        security_deposit_amount: lease.security_deposit_amount || '',
        pet_deposit_amount: lease.pet_deposit_amount || '',
        dependent_names: lease.dependent_names || '',
        pets: lease.pets || '',
        comment: lease.comment || '',
        other_fee_amount: lease.other_fee_amount || '',
        tenant_ids: lease.tenants?.map(t => t.user_id) || []
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [showTenantModal, setShowTenantModal] = useState(false);
    const [formError, setFormError] = useState('');
    const [unitError, setUnitError] = useState('');
    const [showUnitModal, setShowUnitModal] = useState(false);

    useEffect(() => {
        const formatDateForInput = (dateString) => {
            return toWorkflowDateString(dateString);
        };

        setFormData(prev => ({
            ...prev,
            start_date: formatDateForInput(lease.start_date),
            end_date: formatDateForInput(lease.end_date),
            date_of_agreement: formatDateForInput(lease.date_of_agreement),
            monthly_rent_amount: formatCurrencyForInput(lease.monthly_rent_amount),
            security_deposit_amount: formatCurrencyForInput(lease.security_deposit_amount),
            pet_deposit_amount: formatCurrencyForInput(lease.pet_deposit_amount),
            other_fee_amount: formatCurrencyForInput(lease.other_fee_amount)
        }));
    }, [lease]);

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleUnitChange = (unitId) => {
        setUnitError('');
        setFormData(prev => ({ ...prev, unit_id: unitId || '' }));
    };

    const getSelectedUnit = () => {
        if (!formData.unit_id) return null;
        return (
            units.find((u) => String(u.unit_id) === String(formData.unit_id)) ||
            lease.unit ||
            null
        );
    };

    const handleTenantSelection = (tenantId, checked) => {
        if (checked) {
            setFormData(prev => ({
                ...prev,
                tenant_ids: [...prev.tenant_ids, tenantId]
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                tenant_ids: prev.tenant_ids.filter(id => id !== tenantId)
            }));
        }
    };
    
    const formatTenantName = (tenant) => {
        const first = tenant.first_name || '';
        const last = tenant.last_name || '';
        const middle = tenant.middle_name ? ` ${tenant.middle_name.charAt(0)}.` : '';
        const name = `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
        // If name is empty, fall back to email or "Unknown"
        return name || tenant.email || 'Unknown';
    };
    
    const getSelectedTenants = () => {
        return tenants.filter(tenant => formData.tenant_ids.includes(tenant.user_id));
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        setUnitError('');
        
        if (formData.tenant_ids.length === 0) {
            setFormError('Please select at least one tenant.');
            setIsSubmitting(false);
            return;
        }

        if (!formData.unit_id) {
            setUnitError('Please select a unit.');
            setFormError('Please select a unit.');
            setIsSubmitting(false);
            return;
        }

        try {
            const { tenant_ids, ...leaseData } = formData;
            
            if (leaseData.end_date === '') {
                leaseData.end_date = null;
            }
            
            // Convert empty strings to null for numeric fields to avoid database errors
            const numericFields = ['monthly_rent_amount', 'security_deposit_amount', 'pet_deposit_amount', 'other_fee_amount'];
            numericFields.forEach(field => {
                if (leaseData[field] === '' || leaseData[field] === null || leaseData[field] === undefined) {
                    leaseData[field] = null;
                } else {
                    // Convert to number if it's a string
                    const numValue = typeof leaseData[field] === 'string' ? parseFloat(leaseData[field]) : leaseData[field];
                    leaseData[field] = isNaN(numValue) ? null : numValue;
                }
            });
            
            const { error: leaseError } = await supabase
                .from('leases')
                .update(leaseData)
                .eq('lease_id', lease.lease_id);
                
            if (leaseError) {
                console.error('Error updating lease:', leaseError);
                setFormError('Failed to update lease: ' + leaseError.message);
                setIsSubmitting(false);
                return;
            }

            const { error: deleteError } = await supabase
                .from('lease_clients')
                .delete()
                .eq('lease_id', lease.lease_id);

            if (deleteError) {
                console.error('Error deleting existing lease-tenant relationships:', deleteError);
                setFormError('Failed to update tenant relationships: ' + deleteError.message);
                setIsSubmitting(false);
                return;
            }

            // Get client_ids for all user_ids
            const { data: tenantRecords } = await supabase
                .from('clients')
                .select('client_id, user_id')
                .in('user_id', tenant_ids);
            
            if (!tenantRecords || tenantRecords.length === 0) {
                setFormError('Could not find tenant records for selected tenants.');
                setIsSubmitting(false);
                return;
            }
            
            // Then, create new relationships (using client_id)
            const leaseTenantInserts = tenantRecords.map(tr => ({
                lease_id: lease.lease_id,
                client_id: tr.client_id
            }));

            const { error: tenantError } = await supabase
                .from('lease_clients')
                .insert(leaseTenantInserts);

            if (tenantError) {
                console.error('Error creating lease-tenant relationships:', tenantError);
                setFormError('Failed to update tenant relationships: ' + tenantError.message);
                setIsSubmitting(false);
                return;
            }

            onUpdateSuccess();
        } catch(err) {
            console.error('Error updating lease:', err);
            setFormError('Failed to update lease. Please try again.');
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
                className="w-full max-w-2xl bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <div className="flex items-center justify-between p-6 border-b">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Edit Lease</h2>
                        {lease.template && (
                            <div className="mt-1 flex items-center gap-2 text-sm text-gray-600">
                                <FileText size={14} className="text-indigo-600" />
                                <span>Template: {lease.template.template_name}</span>
                                <span className="text-xs text-gray-500">
                                    ({lease.template.template_level === 'system' ? 'System' : 
                                      lease.template.template_level === 'company' ? 'Company' : 'Landlord'})
                                </span>
                            </div>
                        )}
                    </div>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                    <form onSubmit={handleCreate} className="p-6 space-y-4" id="edit-lease-form">
                    {formError && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                            <p className="text-sm text-red-800">{formError}</p>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Select Unit</label>
                        <div className="mt-2">
                            {formData.unit_id ? (
                                <div className="border border-gray-300 rounded-md p-3 bg-gray-50">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-gray-700">
                                            1 unit selected
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setShowUnitModal(true)}
                                            className="text-sm text-indigo-600 hover:text-indigo-800"
                                        >
                                            Change Selection
                                        </button>
                                    </div>
                                    <div className="flex items-start justify-between gap-3 text-sm">
                                        <div className="min-w-0 space-y-0.5">
                                            {getSelectedUnit() ? (
                                                <div className="finder-primary text-gray-900 whitespace-normal break-words">
                                                    {formatUnitPickerLabel(getSelectedUnit())}
                                                </div>
                                            ) : (
                                                <div className="finder-primary text-gray-900">Unit ID {formData.unit_id}</div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleUnitChange(null)}
                                            className="text-red-600 hover:text-red-800 flex-shrink-0"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setShowUnitModal(true)}
                                    className={`w-full border-2 border-dashed rounded-md p-4 text-center transition-colors ${
                                        unitError
                                          ? 'border-red-300 hover:border-red-400 hover:bg-red-50'
                                          : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                                    }`}
                                >
                                    <Building2 className={`mx-auto h-8 w-8 mb-2 ${unitError ? 'text-red-400' : 'text-gray-400'}`} />
                                    <span className={`text-sm ${unitError ? 'text-red-600' : 'text-gray-600'}`}>
                                        Click to select unit
                                    </span>
                                </button>
                            )}
                            {unitError && (
                                <p className="mt-1 text-sm text-red-600">{unitError}</p>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Tenants</label>
                        <div className="mt-2">
                            {formData.tenant_ids.length > 0 ? (
                                <div className="border border-gray-300 rounded-md p-3 bg-gray-50">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-gray-700">
                                            {formData.tenant_ids.length} tenant{formData.tenant_ids.length !== 1 ? 's' : ''} selected
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setShowTenantModal(true)}
                                            className="text-sm text-indigo-600 hover:text-indigo-800"
                                        >
                                            Change Selection
                                        </button>
                                    </div>
                                    <div className="space-y-1">
                                        {getSelectedTenants().map(tenant => (
                                            <div key={tenant.user_id} className="flex items-center justify-between text-sm">
                                                <span className="text-gray-700">{formatTenantName(tenant)}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleTenantSelection(tenant.user_id, false)}
                                                    className="text-red-600 hover:text-red-800"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setShowTenantModal(true)}
                                    className="w-full border-2 border-dashed border-gray-300 rounded-md p-4 text-center hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                                >
                                    <Users className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                                    <span className="text-sm text-gray-600">Click to select tenants</span>
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <DateInput
                            label="Start Date"
                            value={formData.start_date}
                            onChange={e => handleInputChange('start_date', e.target.value)}
                            required
                        />
                        <DateInput
                            label="End Date"
                            value={formData.end_date}
                            onChange={e => handleInputChange('end_date', e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Monthly Rent Amount</label>
                            <input 
                                type="number" 
                                step="1" 
                                value={formData.monthly_rent_amount} 
                                onChange={e => handleInputChange('monthly_rent_amount', e.target.value)} 
                                required 
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Status</label>
                            <select 
                                value={formData.status} 
                                onChange={e => handleInputChange('status', e.target.value)} 
                                className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm"
                            >
                                <option value="active">Active</option>
                                <option value="expired">Expired</option>
                                <option value="terminated">Terminated</option>
                            </select>
                        </div>
                    </div>

                    <DateInput
                        label="Date of Agreement"
                        value={formData.date_of_agreement}
                        onChange={e => handleInputChange('date_of_agreement', e.target.value)}
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Security Deposit</label>
                            <input 
                                type="number" 
                                step="1" 
                                value={formData.security_deposit_amount} 
                                onChange={e => handleInputChange('security_deposit_amount', e.target.value)} 
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Pet Deposit</label>
                            <input 
                                type="number" 
                                step="1" 
                                value={formData.pet_deposit_amount} 
                                onChange={e => handleInputChange('pet_deposit_amount', e.target.value)} 
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Dependent Names</label>
                        <textarea 
                            value={formData.dependent_names} 
                            onChange={e => handleInputChange('dependent_names', e.target.value)} 
                            rows={2}
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Pets</label>
                        <textarea 
                            value={formData.pets} 
                            onChange={e => handleInputChange('pets', e.target.value)} 
                            rows={2}
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Other Fee Amount</label>
                        <input 
                            type="number" 
                            step="1" 
                            value={formData.other_fee_amount} 
                            onChange={e => handleInputChange('other_fee_amount', e.target.value)} 
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Comment</label>
                        <textarea 
                            value={formData.comment} 
                            onChange={e => handleInputChange('comment', e.target.value)} 
                            rows={3}
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>
                    </form>
                    
                    {/* Documents Section */}
                    <div className="border-t border-gray-200 pt-6 px-6 pb-6">
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-gray-800">Documents</h3>
                            <button
                                type="button"
                                onClick={() => {
                                    setGeneratingDocument(lease);
                                    setShowTemplateSelect(true);
                                }}
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
                            >
                                <FileText className="w-4 h-4 inline mr-1" />
                                Generate Lease
                            </button>
                        </div>
                        <DocumentManagement
                            leaseId={lease.lease_id}
                            userRole={user?.role || 'user'}
                            userId={user?.user_id || null}
                        />
                    </div>
                </div>
                
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" form="edit-lease-form" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">{isSubmitting ? 'Saving...' : 'Save Changes'}</button>
                    </div>
                </div>
                
                <TenantSelectionModal
                    isOpen={showTenantModal}
                    onClose={() => setShowTenantModal(false)}
                    tenants={tenants}
                    selectedTenantIds={formData.tenant_ids}
                    onTenantSelection={handleTenantSelection}
                    title="Select Tenants for Lease"
                />

                <UnitSelectionModal
                    isOpen={showUnitModal}
                    onClose={() => setShowUnitModal(false)}
                    units={units}
                    selectedUnitId={formData.unit_id || null}
                    onUnitSelect={handleUnitChange}
                    title="Select Unit for Lease"
                    emptyMessage="No units found."
                />
            </div>
        </div>
    );
};

const RenewLeaseModal = ({ lease, units, tenants, onClose, onRenewSuccess }) => {
    const { user } = useContext(AuthContext);
    const [formData, setFormData] = useState({
        unit_id: lease.unit_id || '',
        start_date: '',
        end_date: '',
        monthly_rent_amount: lease.monthly_rent_amount || '',
        status: 'active',
        date_of_agreement: '',
        security_deposit_amount: lease.security_deposit_amount || '',
        pet_deposit_amount: lease.pet_deposit_amount || '',
        dependent_names: lease.dependent_names || '',
        pets: lease.pets || '',
        comment: '',
        other_fee_amount: lease.other_fee_amount || '',
        tenant_ids: lease.tenants?.map(t => t.user_id) || []
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [showWarning, setShowWarning] = useState(false);
    const [showTenantModal, setShowTenantModal] = useState(false);
    const [formError, setFormError] = useState('');
    const [shouldSignLease, setShouldSignLease] = useState(false);

    useEffect(() => {
        // Set start date to day after current lease ends (timezone-safe)
        const originalEnd = toWorkflowDateString(lease.end_date);
        if (isCompleteWorkflowDate(originalEnd)) {
            setFormData(prev => ({
                ...prev,
                start_date: addDaysToWorkflowDate(originalEnd, 1)
            }));
        }
        
        // Format currency values to remove .00
        setFormData(prev => ({
            ...prev,
            monthly_rent_amount: formatCurrencyForInput(lease.monthly_rent_amount),
            security_deposit_amount: formatCurrencyForInput(lease.security_deposit_amount),
            pet_deposit_amount: formatCurrencyForInput(lease.pet_deposit_amount),
            other_fee_amount: formatCurrencyForInput(lease.other_fee_amount)
        }));
        
        // Check if we should show warning
        if (lease.end_date && isLeaseNearExpiry(lease.end_date)) {
            setShowWarning(true);
        }
    }, [lease]);

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleTenantSelection = (tenantId, checked) => {
        if (checked) {
            setFormData(prev => ({
                ...prev,
                tenant_ids: [...prev.tenant_ids, tenantId]
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                tenant_ids: prev.tenant_ids.filter(id => id !== tenantId)
            }));
        }
    };
    
    const formatTenantName = (tenant) => {
        const first = tenant.first_name || '';
        const last = tenant.last_name || '';
        const middle = tenant.middle_name ? ` ${tenant.middle_name.charAt(0)}.` : '';
        const name = `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
        // If name is empty, fall back to email or "Unknown"
        return name || tenant.email || 'Unknown';
    };
    
    const getSelectedTenants = () => {
        return tenants.filter(tenant => formData.tenant_ids.includes(tenant.user_id));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        
        if (formData.tenant_ids.length === 0) {
            setFormError('Please select at least one tenant.');
            setIsSubmitting(false);
            return;
        }

        try {
            // Helper to convert empty string to null for numeric fields
            const toNumeric = (value) => {
                if (value === '' || value === null || value === undefined) return null;
                const numValue = typeof value === 'string' ? parseFloat(value) : value;
                return isNaN(numValue) ? null : numValue;
            };
            
            // Create a new lease
            const { data: leaseData, error: leaseError } = await supabase
                .from('leases')
                .insert([{
                    unit_id: formData.unit_id,
                    start_date: formData.start_date,
                    end_date: formData.end_date || null,
                    monthly_rent_amount: toNumeric(formData.monthly_rent_amount) || 0,
                    status: 'active',
                    date_of_agreement: formData.date_of_agreement || todayWorkflowDate(),
                    security_deposit_amount: toNumeric(formData.security_deposit_amount),
                    pet_deposit_amount: toNumeric(formData.pet_deposit_amount),
                    dependent_names: formData.dependent_names || null,
                    pets: formData.pets || null,
                    comment: formData.comment || null,
                    other_fee_amount: toNumeric(formData.other_fee_amount)
                }])
                .select()
                .single();
            
            if (leaseError) {
                setFormError('Failed to create lease: ' + leaseError.message);
                setIsSubmitting(false);
                return;
            }
            
            // Get client_ids for all user_ids
            const { data: tenantRecords } = await supabase
                .from('clients')
                .select('client_id, user_id')
                .in('user_id', formData.tenant_ids);
            
            if (!tenantRecords || tenantRecords.length === 0) {
                setFormError('Could not find tenant records for selected tenants.');
                setIsSubmitting(false);
                return;
            }

            // Create lease_clients entries for all selected tenants (using client_id)
            const leaseTenantEntries = tenantRecords.map(tr => ({
                lease_id: leaseData.lease_id,
                client_id: tr.client_id
            }));
            
            const { error: leaseTenantsError } = await supabase
                .from('lease_clients')
                .insert(leaseTenantEntries);
            
            if (leaseTenantsError) {
                // Clean up the lease if tenant assignment fails
                await deleteWithAudit('leases', 'lease_id', leaseData.lease_id, user?.user_id);
                setFormError('Failed to assign tenants to lease: ' + leaseTenantsError.message);
                setIsSubmitting(false);
                return;
            }
            
            // If signing is requested, initiate the signing process
            if (shouldSignLease) {
                // First, generate the lease document if it doesn't exist
                const { data: existingDocs } = await supabase
                    .from('documents')
                    .select('document_id')
                    .eq('lease_id', leaseData.lease_id)
                    .eq('document_type', 'lease_document')
                    .limit(1);
                
                let documentId = existingDocs?.[0]?.document_id;
                
                // If no document exists, generate one
                if (!documentId) {
                    const userId = user?.user_id || null;
                    const templateId = lease.template_id || null;
                    
                    const genResponse = await fetch('/api/documents/generate/lease', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            lease_id: leaseData.lease_id,
                            template_id: templateId,
                            user_id: userId
                        })
                    });
                    
                    const genResult = await genResponse.json();
                    if (genResult.success) {
                        documentId = genResult.document_id;
                    }
                }
                
                // Initiate signing if we have a document
                if (documentId) {
                    const userId = user?.user_id || null;
                    await fetch('/api/documents/sign-lease', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            lease_id: leaseData.lease_id,
                            document_id: documentId,
                            user_id: userId
                        })
                    });
                }
            }
            
            onRenewSuccess();
        } catch(err) {
            console.error('Error renewing lease:', err);
            setFormError('Failed to renew lease. Please try again.');
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
                className="w-full max-w-2xl bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
                    <h2 className="text-xl font-bold text-gray-800">Renew Lease</h2>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                    {showWarning && (
                        <div className="m-6 mb-0 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                            <div className="flex">
                                <AlertTriangle className="h-5 w-5 text-yellow-400" />
                                <div className="ml-3">
                                    <h3 className="text-sm font-medium text-yellow-800">Warning</h3>
                                    <p className="text-sm text-yellow-700 mt-1">
                                        This lease has more than three months remaining until the end date. 
                                        Are you sure you want to renew it now?
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="p-6 space-y-4" id="renew-lease-form">
                    {formError && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                            <p className="text-sm text-red-800">{formError}</p>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Unit</label>
                        <select 
                            value={formData.unit_id} 
                            onChange={e => handleInputChange('unit_id', e.target.value)} 
                            required 
                            className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm"
                        >
                            <option value="">Select a Unit</option>
                            {units.map(unit => (
                                <option key={unit.unit_id} value={unit.unit_id}>
                                    {formatUnitAddress(unit)}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Tenants</label>
                        <div className="mt-2">
                            {formData.tenant_ids.length > 0 ? (
                                <div className="border border-gray-300 rounded-md p-3 bg-gray-50">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-gray-700">
                                            {formData.tenant_ids.length} tenant{formData.tenant_ids.length !== 1 ? 's' : ''} selected
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setShowTenantModal(true)}
                                            className="text-sm text-indigo-600 hover:text-indigo-800"
                                        >
                                            Change Selection
                                        </button>
                                    </div>
                                    <div className="space-y-1">
                                        {getSelectedTenants().map(tenant => (
                                            <div key={tenant.user_id} className="flex items-center justify-between text-sm">
                                                <span className="text-gray-700">{formatTenantName(tenant)}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleTenantSelection(tenant.user_id, false)}
                                                    className="text-red-600 hover:text-red-800"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setShowTenantModal(true)}
                                    className="w-full border-2 border-dashed border-gray-300 rounded-md p-4 text-center hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                                >
                                    <Users className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                                    <span className="text-sm text-gray-600">Click to select tenants</span>
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <DateInput
                            label="Start Date"
                            value={formData.start_date}
                            onChange={e => handleInputChange('start_date', e.target.value)}
                            required
                        />
                        <DateInput
                            label="End Date"
                            value={formData.end_date}
                            onChange={e => handleInputChange('end_date', e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Monthly Rent Amount</label>
                        <input 
                            type="number" 
                            step="1" 
                            value={formData.monthly_rent_amount} 
                            onChange={e => handleInputChange('monthly_rent_amount', e.target.value)} 
                            required 
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>

                    <DateInput
                        label="Date of Agreement"
                        value={formData.date_of_agreement}
                        onChange={e => handleInputChange('date_of_agreement', e.target.value)}
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Security Deposit</label>
                            <input 
                                type="number" 
                                step="1" 
                                value={formData.security_deposit_amount} 
                                onChange={e => handleInputChange('security_deposit_amount', e.target.value)} 
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Pet Deposit</label>
                            <input 
                                type="number" 
                                step="1" 
                                value={formData.pet_deposit_amount} 
                                onChange={e => handleInputChange('pet_deposit_amount', e.target.value)} 
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Dependent Names</label>
                        <textarea 
                            value={formData.dependent_names} 
                            onChange={e => handleInputChange('dependent_names', e.target.value)} 
                            rows={2}
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Pets</label>
                        <textarea 
                            value={formData.pets} 
                            onChange={e => handleInputChange('pets', e.target.value)} 
                            rows={2}
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Other Fee Amount</label>
                        <input 
                            type="number" 
                            step="1" 
                            value={formData.other_fee_amount} 
                            onChange={e => handleInputChange('other_fee_amount', e.target.value)} 
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Comment</label>
                        <textarea 
                            value={formData.comment} 
                            onChange={e => handleInputChange('comment', e.target.value)} 
                            rows={3}
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>

                    {/* Signing Option */}
                    <div className="border-t border-gray-200 pt-4">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={shouldSignLease}
                                onChange={(e) => setShouldSignLease(e.target.checked)}
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm text-gray-700">
                                Send lease document for signing after renewal
                            </span>
                        </label>
                        {shouldSignLease && (
                            <p className="mt-2 text-xs text-gray-500">
                                Signing links will be sent via email and text to all parties.
                            </p>
                        )}
                    </div>
                    </form>
                </div>
                
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" form="renew-lease-form" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700">{isSubmitting ? 'Renewing...' : 'Renew Lease'}</button>
                    </div>
                </div>
                
                {showTenantModal && (
                    <TenantSelectionModal
                        isOpen={showTenantModal}
                        onClose={() => setShowTenantModal(false)}
                        tenants={tenants}
                        selectedTenantIds={formData.tenant_ids}
                        onTenantSelection={handleTenantSelection}
                        title="Select Tenants for Renewal"
                    />
                )}
            </div>
        </div>
    );
};

// Helper function to recursively make all fields optional in template data
const makeAllFieldsOptional = (templateData) => {
    if (!templateData || typeof templateData !== 'object') {
        return templateData;
    }
    
    if (Array.isArray(templateData)) {
        return templateData.map(item => makeAllFieldsOptional(item));
    }
    
    const result = {};
    for (const [key, value] of Object.entries(templateData)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            // Check if this is a field definition (has 'type' property or is a field definition object)
            if ('type' in value || 'properties' in value || 'items' in value || 'description' in value) {
                // It's a field definition - set required to false
                result[key] = {
                    ...value,
                    required: false
                };
                // Recursively process nested properties
                if (value.properties) {
                    result[key].properties = makeAllFieldsOptional(value.properties);
                }
                if (value.items) {
                    result[key].items = makeAllFieldsOptional(value.items);
                }
            } else {
                // It's a nested object/category - recursively process it
                result[key] = makeAllFieldsOptional(value);
            }
        } else {
            // Primitive value - keep as is
            result[key] = value;
        }
    }
    return result;
};

const FillLeaseModal = ({ lease, onClose, onSuccess }) => {
    const { user } = useContext(AuthContext);
    const [isLoading, setIsLoading] = useState(true);
    const [formError, setFormError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [documentData, setDocumentData] = useState({});
    const [isMappingFields, setIsMappingFields] = useState(false);
    
    // Store comprehensive data for mapping
    const [mappingData, setMappingData] = useState(null);
    
    // Template selection state
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [showTemplateSelection, setShowTemplateSelection] = useState(true);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    
    const selectedTemplateData = useMemo(() => {
        if (!selectedTemplate) return {};
        const parsed = selectedTemplate.parsed_template_data || parseTemplateData(selectedTemplate);
        // Make all fields optional
        return makeAllFieldsOptional(parsed);
    }, [selectedTemplate]);
    
    // Fallback: String-based field matching (original implementation)
    const mapLeaseFieldsToStringMatching = useCallback((mappingData, templateData) => {
        if (!mappingData || !templateData) {
            return {};
        }
        
        const { lease: leaseData, property, landlord, application, tenants } = mappingData;
        const mapped = {};
        
        // Helper function to find matching field in template by name variations
        const findTemplateField = (fieldNameVariations) => {
            if (!templateData || typeof templateData !== 'object') {
                return null;
            }
            
            // Recursively search through template structure
            const search = (obj, path = '') => {
                for (const [key, value] of Object.entries(obj)) {
                    const currentPath = path ? `${path}.${key}` : key;
                    const keyLower = key.toLowerCase().replace(/[_\s]/g, '');
                    
                    // Check if this key matches any variation
                    for (const variation of fieldNameVariations) {
                        const variationLower = variation.toLowerCase().replace(/[_\s]/g, '');
                        if (keyLower === variationLower || keyLower.includes(variationLower) || variationLower.includes(keyLower)) {
                            return { path: currentPath, value };
                        }
                    }
                    
                    // Recursively search nested objects
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        const found = search(value, currentPath);
                        if (found) return found;
                    }
                }
                return null;
            };
            
            return search(templateData);
        };
        
        // Helper function to safely set nested property, ensuring parent paths are objects
        const setNestedProperty = (obj, path, value) => {
            const keys = path.split('.');
            let current = obj;
            
            // Navigate/create the path, ensuring all intermediate values are objects
            for (let i = 0; i < keys.length - 1; i++) {
                const key = keys[i];
                
                // If the key doesn't exist, create an object
                if (!current[key]) {
                    current[key] = {};
                } 
                // If the key exists but is a primitive (number, string, etc.), we need to preserve it
                // by moving it to a temporary location or converting the structure
                else if (typeof current[key] !== 'object' || Array.isArray(current[key])) {
                    // Save the existing value with a special key, then create object
                    const existingValue = current[key];
                    current[key] = {
                        _previousValue: existingValue
                    };
                }
                
                current = current[key];
            }
            
            // Set the final value
            const finalKey = keys[keys.length - 1];
            current[finalKey] = value;
        };
        
        // Map date_of_agreement to various template field names
        if (leaseData.date_of_agreement) {
            const field = findTemplateField([
                'Agreement Date', 'Agreement_Date', 'agreement_date', 'agreementDate',
                'Date of Agreement', 'Date_of_Agreement', 'date_of_agreement',
                'Lease Date', 'Lease_Date', 'lease_date', 'leaseDate',
                'Contract Date', 'Contract_Date', 'contract_date', 'contractDate'
            ]);
            if (field) {
                // Format date as MM-DD-YYYY
                const formattedDate = formatDateMMDDYYYY(leaseData.date_of_agreement);
                setNestedProperty(mapped, field.path, formattedDate);
            }
        }
        
        // Map start_date
        if (leaseData.start_date) {
            const field = findTemplateField([
                'Start Date', 'Start_Date', 'start_date', 'startDate',
                'Lease Start', 'Lease_Start', 'lease_start', 'leaseStart',
                'Commencement Date', 'Commencement_Date', 'commencement_date', 'commencementDate',
                'Move In Date', 'Move_In_Date', 'move_in_date', 'moveInDate'
            ]);
            if (field) {
                setNestedProperty(mapped, field.path, leaseData.start_date);
            }
        }
        
        // Map end_date
        if (leaseData.end_date) {
            const field = findTemplateField([
                'End Date', 'End_Date', 'end_date', 'endDate',
                'Lease End', 'Lease_End', 'lease_end', 'leaseEnd',
                'Termination Date', 'Termination_Date', 'termination_date', 'terminationDate',
                'Expiration Date', 'Expiration_Date', 'expiration_date', 'expirationDate'
            ]);
            if (field) {
                setNestedProperty(mapped, field.path, leaseData.end_date);
            }
        }
        
        // Map monthly_rent_amount
        if (leaseData.monthly_rent_amount) {
            const field = findTemplateField([
                'Monthly Rent', 'Monthly_Rent', 'monthly_rent', 'monthlyRent',
                'Rent Amount', 'Rent_Amount', 'rent_amount', 'rentAmount',
                'Rent', 'rent', 'Monthly Payment', 'Monthly_Payment', 'monthly_payment', 'monthlyPayment'
            ]);
            if (field) {
                setNestedProperty(mapped, field.path, leaseData.monthly_rent_amount);
            }
        }
        
        // Map security_deposit_amount
        if (leaseData.security_deposit_amount) {
            const field = findTemplateField([
                'Security Deposit', 'Security_Deposit', 'security_deposit', 'securityDeposit',
                'Deposit', 'deposit', 'Security', 'security'
            ]);
            if (field) {
                setNestedProperty(mapped, field.path, leaseData.security_deposit_amount);
            }
        }
        
        // Map pet_deposit_amount
        if (leaseData.pet_deposit_amount) {
            const field = findTemplateField([
                'Pet Deposit', 'Pet_Deposit', 'pet_deposit', 'petDeposit',
                'Pet Fee', 'Pet_Fee', 'pet_fee', 'petFee'
            ]);
            if (field) {
                setNestedProperty(mapped, field.path, leaseData.pet_deposit_amount);
            }
        }
        
        // Map Lessor/Landlord
        if (landlord) {
            let landlordName = '';
            if (landlord.contacts?.first_name && landlord.contacts?.last_name) {
                // Format with period after middle initial
                landlordName = formatFullName(landlord.contacts.first_name, landlord.contacts.middle_name, landlord.contacts.last_name);
            }
            if (!landlordName && landlord.landlord_name) {
                landlordName = landlord.landlord_name;
            }
            if (landlordName) {
                const field = findTemplateField([
                    'Lessor', 'lessor', 'Landlord', 'landlord', 'Owner', 'owner',
                    'Lessor Name', 'Lessor_Name', 'lessor_name', 'lessorName',
                    'Landlord Name', 'Landlord_Name', 'landlord_name', 'landlordName',
                    'Property Owner', 'Property_Owner', 'property_owner', 'propertyOwner'
                ]);
                if (field) {
                    setNestedProperty(mapped, field.path, landlordName);
                }
            }
        }
        
        // Map Tenant(s)
        if (tenants && tenants.length > 0) {
            const tenantNames = tenants.map(t => {
                const firstName = t.first_name || '';
                const middleName = t.middle_name ? ` ${t.middle_name.charAt(0)}.` : '';
                const lastName = t.last_name || '';
                return `${firstName}${middleName} ${lastName}`.trim() || t.email || 'Unknown';
            }).join(', ');
            
            if (tenantNames) {
                const field = findTemplateField([
                    'Tenant', 'tenant', 'Tenants', 'tenants',
                    'Tenant Name', 'Tenant_Name', 'tenant_name', 'tenantName',
                    'Lessee', 'lessee', 'Lessee Name', 'Lessee_Name', 'lessee_name', 'lesseeName',
                    'Resident', 'resident', 'Residents', 'residents'
                ]);
                if (field) {
                    setNestedProperty(mapped, field.path, tenantNames);
                }
            }
        }
        
        // Map Property Known As / Address
        if (property && property.address) {
            const addressParts = [
                property.address.address_line_1,
                property.address.city,
                property.address.state_province_region,
                property.address.postal_code
            ].filter(Boolean);
            const fullAddress = addressParts.join(', ');
            
            if (fullAddress) {
                const field = findTemplateField([
                    'Property Known As', 'Property_Known_As', 'property_known_as', 'propertyKnownAs',
                    'Property Address', 'Property_Address', 'property_address', 'propertyAddress',
                    'Address', 'address', 'Premises', 'premises',
                    'Property Location', 'Property_Location', 'property_location', 'propertyLocation',
                    'Rental Property Address', 'Rental_Property_Address', 'rental_property_address'
                ]);
                if (field) {
                    setNestedProperty(mapped, field.path, fullAddress);
                }
            }
        }
        
        // Map County
        if (property && property.county_of_jurisdiction) {
            const field = findTemplateField([
                'County', 'county', 'County of Jurisdiction', 'County_of_Jurisdiction',
                'county_of_jurisdiction', 'countyOfJurisdiction',
                'Jurisdiction County', 'Jurisdiction_County', 'jurisdiction_county'
            ]);
            if (field) {
                setNestedProperty(mapped, field.path, property.county_of_jurisdiction);
            }
        }
        
        // Map Lease Term (inferred from start/end dates)
        if (leaseData.start_date) {
            const leaseTerm = describeLeaseTerm(
                toWorkflowDateString(leaseData.start_date),
                toWorkflowDateString(leaseData.end_date) || null
            );
            
            if (leaseTerm) {
                const field = findTemplateField([
                    'Lease Term', 'Lease_Term', 'lease_term', 'leaseTerm',
                    'Term', 'term', 'Lease Duration', 'Lease_Duration', 'lease_duration',
                    'Rental Period', 'Rental_Period', 'rental_period', 'rentalPeriod',
                    'Tenancy Term', 'Tenancy_Term', 'tenancy_term', 'tenancyTerm'
                ]);
                if (field) {
                    setNestedProperty(mapped, field.path, leaseTerm);
                }
            }
        }
        
        // Map Rent Due Date (convert to ordinal word like "first", "fifteenth", "last")
        if (leaseData.start_date) {
            // Use the start date to determine rent due date (typically the same day of month)
            const rentDueDate = convertDateToOrdinalWord(leaseData.start_date);
            
            const field = findTemplateField([
                'Rent Due Date', 'Rent_Due_Date', 'rent_due_date', 'rentDueDate',
                'Due Date', 'Due_Date', 'due_date', 'dueDate',
                'Rent Payment Date', 'Rent_Payment_Date', 'rent_payment_date',
                'Payment Due Date', 'Payment_Due_Date', 'payment_due_date'
            ]);
            if (field) {
                setNestedProperty(mapped, field.path, rentDueDate);
            }
        }
        
        // Map Pets Allowed (from lease.pets or application)
        let petsAllowed = null;
        if (leaseData.pets) {
            // Check if pets field contains "yes", "allowed", etc.
            const petsStr = String(leaseData.pets).toLowerCase();
            petsAllowed = !petsStr.includes('no') && (petsStr.includes('yes') || petsStr.includes('allowed') || leaseData.pets);
        } else if (application && application.field_data) {
            const fieldData = typeof application.field_data === 'string' 
                ? JSON.parse(application.field_data) 
                : application.field_data;
            const petsValue = fieldData?.has_pets || fieldData?.pets_allowed || fieldData?.Applicant_Information?.has_pets;
            petsAllowed = petsValue;
        }
        
        if (petsAllowed !== null) {
            const field = findTemplateField([
                'Pets Allowed', 'Pets_Allowed', 'pets_allowed', 'petsAllowed',
                'Pet Policy', 'Pet_Policy', 'pet_policy', 'petPolicy',
                'Allow Pets', 'Allow_Pets', 'allow_pets', 'allowPets',
                'Pets', 'pets'
            ]);
            if (field) {
                setNestedProperty(mapped, field.path, petsAllowed);
            }
        }
        
        return mapped;
    }, []);
    
    // Map comprehensive data to template fields using LLM
    const mapLeaseFieldsToTemplate = useCallback(async (mappingData, templateData) => {
        if (!mappingData || !templateData) {
            return {};
        }
        
        try {
            // Call LLM-based mapping API
            const response = await fetch('/api/leases/map-fields', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    mappingData: mappingData,
                    templateData: templateData
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `API error: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.mappedFields) {
                return result.mappedFields;
            } else {
                throw new Error(result.error || 'LLM mapping returned no fields');
            }
        } catch (error) {
            console.error('[FillLeaseModal] ❌ LLM mapping failed, falling back to string matching:', error);
            // Fall back to string-based matching if LLM fails
            return mapLeaseFieldsToStringMatching(mappingData, templateData);
        }
    }, [mapLeaseFieldsToStringMatching]);
    
    // Initialize documentData with mapped lease fields when template is selected
    useEffect(() => {
        if (selectedTemplate && mappingData && Object.keys(selectedTemplateData).length > 0) {
            setIsMappingFields(true);
            
            // Call async mapping function
            mapLeaseFieldsToTemplate(mappingData, selectedTemplateData)
                .then(mappedFields => {
                    if (mappedFields && Object.keys(mappedFields).length > 0) {
                        setDocumentData(prev => ({
                            ...prev,
                            ...mappedFields
                        }));
                    }
                })
                .catch(error => {
                    console.error('[FillLeaseModal] Error in field mapping:', error);
                    setFormError('Failed to map fields. Please try again.');
                })
                .finally(() => {
                    setIsMappingFields(false);
                });
        }
    }, [selectedTemplate, mappingData, selectedTemplateData, mapLeaseFieldsToTemplate]);
    
    // Fetch comprehensive data for field mapping (lease, property, landlord, application, tenant)
    useEffect(() => {
        const fetchMappingData = async () => {
            setIsLoading(true);
            try {
                // Fetch lease with all related data
                const { data: leaseData, error: leaseError } = await supabase
                    .from('leases')
                    .select(`
                        *,
                        units!inner(
                            unit_id,
                            unit_number,
                            properties!inner(
                                property_id,
                                property_name,
                                property_type,
                                landlord_id,
                                city_of_jurisdiction,
                                county_of_jurisdiction
                            )
                        )
                    `)
                    .eq('lease_id', lease.lease_id)
                    .single();
                
                if (leaseError) {
                    console.error('[FillLeaseModal] Error fetching lease:', leaseError);
                    setFormError('Could not load lease information.');
                    setIsLoading(false);
                    return;
                }
                
                const unit = leaseData.units;
                const property = unit.properties;
                
                // Fetch property address
                const { data: addressData } = await supabase
                    .from('addresses')
                    .select('*')
                    .eq('addressable_id', property.property_id)
                    .eq('addressable_type', 'property')
                    .single();
                
                // Fetch landlord if property has one
                let landlordData = null;
                if (property.landlord_id) {
                    // First, fetch the landlord without contacts
                    const { data: landlord, error: landlordError } = await supabase
                        .from('landlords')
                        .select('*')
                        .eq('landlord_id', property.landlord_id)
                        .single();
                    
                    if (landlordError) {
                        console.error('[FillLeaseModal] Error fetching landlord:', {
                            code: landlordError.code,
                            message: landlordError.message,
                            details: landlordError.details,
                            hint: landlordError.hint
                        });
                    } else if (landlord) {
                        // Now fetch contacts separately
                        const { data: contacts, error: contactsError } = await supabase
                            .from('contacts')
                            .select('first_name, last_name, middle_name')
                            .eq('contactable_id', landlord.landlord_id)
                            .eq('contactable_type', 'landlord')
                            .limit(1);
                        
                        if (contactsError) {
                            console.warn('[FillLeaseModal] Error fetching contacts:', {
                                code: contactsError.code,
                                message: contactsError.message,
                                details: contactsError.details,
                                hint: contactsError.hint
                            });
                        }
                        
                        // Combine landlord with contacts
                        landlordData = {
                            ...landlord,
                            contacts: contacts && contacts.length > 0 ? contacts[0] : null
                        };
                        
                        // Calculate formatted_name for easier mapping
                        // Priority: first_name + last_name > landlord_name > empty string
                        const contact = contacts && contacts.length > 0 ? contacts[0] : null;
                        let formattedName = '';
                        if (contact?.first_name && contact?.last_name) {
                            // Format with period after middle initial
                            formattedName = formatFullName(contact.first_name, contact.middle_name, contact.last_name);
                        } else if (landlord.landlord_name) {
                            formattedName = landlord.landlord_name;
                        }
                        
                        landlordData.formatted_name = formattedName;
                    }
                }
                
                // Fetch rental application if exists (for this unit and tenant)
                let applicationData = null;
                if (lease.tenants && lease.tenants.length > 0 && unit.unit_id) {
                    const tenantClientIds = lease.tenants.map(t => {
                        // Find client_id from user_id
                        return t.user_id; // We'll need to get client_id from this
                    });
                    
                    // Get client_ids for tenant user_ids
                    const { data: clients } = await supabase
                        .from('clients')
                        .select('client_id, user_id')
                        .in('user_id', tenantClientIds);
                    
                    if (clients && clients.length > 0) {
                        const clientIds = clients.map(c => c.client_id);
                        const { data: applications } = await supabase
                            .from('client_applications')
                            .select('*, field_data')
                            .eq('unit_id', unit.unit_id)
                            .in('client_id', clientIds)
                            .eq('status', 'approved')
                            .order('applied_at', { ascending: false })
                            .limit(1);
                        
                        if (applications && applications.length > 0) {
                            applicationData = applications[0];
                        }
                    }
                }
                
                // Compile all mapping data
                const comprehensiveData = {
                    lease: leaseData,
                    unit: unit,
                    property: {
                        ...property,
                        address: addressData
                    },
                    landlord: landlordData,
                    application: applicationData,
                    tenants: lease.tenants || []
                };
                setMappingData(comprehensiveData);
                setDocumentData({});
            } catch (err) {
                console.error('[FillLeaseModal] Error fetching mapping data:', err);
                setFormError('Could not load lease information.');
            } finally {
                setIsLoading(false);
            }
        };
        
        fetchMappingData();
    }, [lease]);
    
    // Fetch available lease templates
    useEffect(() => {
        const fetchTemplates = async () => {
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
                    .eq('template_type', 'Lease')
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
                    console.error('Error fetching templates:', error);
                    setFormError('Failed to load lease templates.');
                    setTemplates([]);
                } else {
                    const templatesWithParsedData = (data || []).map(template => ({
                        ...template,
                        parsed_template_data: parseTemplateData(template)
                    }));
                    setTemplates(templatesWithParsedData);
                }
            } catch (err) {
                console.error('Error fetching templates:', err);
                setFormError('Failed to load lease templates.');
            } finally {
                setLoadingTemplates(false);
            }
        };
        
        fetchTemplates();
    }, [user]);
    
    // Auto-select template: first check lease.template_id, then default template
    useEffect(() => {
        if (templates.length > 0 && !selectedTemplate) {
            // First, try to use template from lease (set by Add Lease or last Fill Lease)
            // Check both lease.template_id (direct column) and lease.template?.template_id (joined relation)
            let templateToUse = null;
            const leaseTemplateId = lease?.template_id || lease?.template?.template_id;
            
            if (leaseTemplateId) {
                templateToUse = templates.find(t => t.template_id === leaseTemplateId);
            }
            
            // If no template from lease, try default template
            if (!templateToUse) {
                templateToUse = templates.find(t => {
                    const isDefaultFlag = t.is_default === true;
                    const hasDefaultInName = t.template_name?.toLowerCase().includes('default');
                    const hasDefaultTag = t.template_data && typeof t.template_data === 'object' && t.template_data.tags?.includes('Default');
                    
                    return isDefaultFlag || hasDefaultInName || hasDefaultTag;
                });
            }
            
            if (templateToUse) {
                setSelectedTemplate(templateToUse);
                setShowTemplateSelection(false);
            }
        }
    }, [templates, selectedTemplate, lease?.template_id, lease?.template?.template_id]);
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        
        try {
            // Save document_data and template_id to the lease
            // This allows Fill Lease to remember the template for next time
            let updatePayload = { 
                document_data: documentData 
            };
            
            // Save template_id if a template is selected
            if (selectedTemplate?.template_id) {
                updatePayload.template_id = selectedTemplate.template_id;
            }
            
            const { error: updateError } = await supabase
                .from('leases')
                .update(updatePayload)
                .eq('lease_id', lease.lease_id);
            
            if (updateError) {
                // Log technical details for IT/developers
                if (updateError.code === 'PGRST204' && updateError.message?.includes('document_data')) {
                    console.error('Error: document_data column does not exist in leases table. Please run migration 006_add_document_data_to_leases.sql', updateError);
                } else {
                    console.error('Error updating lease data:', updateError);
                }
                // Show user-friendly error message
                setFormError('Unable to save changes. Please contact support if this issue persists.');
                setIsSubmitting(false);
                return;
            }
            
            // Success - close modal and notify parent
            if (onSuccess) {
                onSuccess();
            }
            if (onClose) {
                onClose();
            }
        } catch (err) {
            console.error('Error saving lease data:', err);
            setFormError('Could not connect to server.');
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
    
    const formatLeaseName = (lease) => {
        const unitInfo = lease.unit ? formatUnitAddress(lease.unit) : 'Unknown Unit';
        const tenantNames = lease.tenants && lease.tenants.length > 0 
            ? formatTenantNames(lease.tenants) 
            : 'No Tenants';
        return `${unitInfo} - ${tenantNames}`;
    };
    
    if (isLoading) {
        return (
            <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50" onClick={handleBackdropClick}>
                <div className="w-full max-w-4xl p-6 bg-white rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
                    <div className="text-center py-8">
                        <div className="text-gray-600">Loading lease information...</div>
                    </div>
                </div>
            </div>
        );
    }
    
    return (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div 
                className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
                    <h2 className="text-xl font-semibold text-gray-900">
                        Fill Lease - {formatLeaseName(lease)}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="flex-1 overflow-hidden flex flex-col">
                    {/* Template Selection */}
                    {showTemplateSelection && (
                        <div className="p-6">
                            <h3 className="text-lg font-medium text-gray-900 mb-4">Select Lease Template</h3>
                            
                            {loadingTemplates ? (
                                <div className="text-center py-8 text-gray-500">
                                    Loading templates...
                                </div>
                            ) : templates.length === 0 ? (
                                <div className="text-center py-8">
                                    <div className="text-red-600 mb-2 font-medium">No templates available</div>
                                    <div className="text-sm text-gray-500 mb-4">No lease templates found. Please contact your administrator.</div>
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
                                                        <div className="finder-primary text-gray-900">
                                                            {template.template_name}
                                                            {template.is_default && (
                                                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded finder-secondary bg-indigo-100 text-indigo-800">
                                                                    Default
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="finder-secondary text-gray-500 capitalize">
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
                                            onClick={() => {
                                                if (selectedTemplate) {
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
                    
                    {/* Fill Lease Form */}
                    {!showTemplateSelection && selectedTemplate && (
                        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                            <div className="flex-1 overflow-y-auto space-y-6 px-6 pt-4 pb-6">
                                {/* Template info banner */}
                                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm font-medium text-blue-800">Using template: </span>
                                            <span className="text-sm text-blue-700">{selectedTemplate.template_name}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowTemplateSelection(true)}
                                            className="text-sm text-blue-600 hover:text-blue-800 underline"
                                        >
                                            Change Template
                                        </button>
                                    </div>
                                </div>
                                
                                {/* Field Mapping Progress Indicator */}
                                {isMappingFields && (
                                    <div className="bg-indigo-50 border border-indigo-200 rounded-md p-4">
                                        <div className="flex items-center space-x-3">
                                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
                                            <div>
                                                <div className="text-sm font-medium text-indigo-900">
                                                    Mapping fields...
                                                </div>
                                                <div className="text-xs text-indigo-700 mt-1">
                                                    This may take a few seconds. Analyzing lease data and template structure.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                                <ApplicationFormBuilder
                                    key={`lease-form-${lease.lease_id}-${selectedTemplate.template_id}`}
                                    documentData={documentData}
                                    onChange={setDocumentData}
                                    templateData={selectedTemplateData}
                                    readOnly={false}
                                />
                                
                                {formError && (
                                    <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                        {formError}
                                    </div>
                                )}
                            </div>
                            
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
                                        disabled={isSubmitting}
                                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                                    >
                                        {isSubmitting ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

// Template Selector Modal
const LeaseTemplateSelectorModal = ({ templates, onSelect, onClose }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [previewingTemplate, setPreviewingTemplate] = useState(null);

    const filteredTemplates = useMemo(() => {
        if (!searchTerm.trim()) return templates;
        const searchLower = searchTerm.toLowerCase();
        return templates.filter(t => 
            t.template_name?.toLowerCase().includes(searchLower) ||
            t.template_level?.toLowerCase().includes(searchLower)
        );
    }, [templates, searchTerm]);

    const getLevelBadge = (level) => {
        const colors = {
            system: 'bg-blue-100 text-blue-800',
            company: 'bg-green-100 text-green-800',
            landlord: 'bg-purple-100 text-purple-800'
        };
        return colors[level] || 'bg-gray-100 text-gray-800';
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
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
                <div 
                    className="w-full max-w-2xl bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col" 
                    onMouseDown={handleModalMouseDown}
                    onMouseMove={handleModalMouseMove}
                    onMouseUp={handleModalMouseUp}
                >
                    <div className="flex items-center justify-between p-6 border-b">
                        <h2 className="text-xl font-bold text-gray-800">Select Lease Template</h2>
                        <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="mb-4">
                            <input
                                type="text"
                                placeholder="Search templates..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        
                        {filteredTemplates.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                {searchTerm ? 'No templates found.' : 'No templates available.'}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {filteredTemplates.map(template => (
                                    <div
                                        key={template.template_id}
                                        className="border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <h3 className="font-medium text-gray-900">{template.template_name}</h3>
                                                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getLevelBadge(template.template_level)}`}>
                                                        {template.template_level}
                                                    </span>
                                                    {template.is_default && (
                                                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                                                            Default
                                                        </span>
                                                    )}
                                                </div>
                                                {template.template_data && (
                                                    <p className="text-sm text-gray-600 mb-3">
                                                        This template will pre-fill lease terms, fees, and standard clauses.
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 mt-3">
                                            <button
                                                type="button"
                                                onClick={() => setPreviewingTemplate(template)}
                                                className="px-3 py-1.5 text-sm text-indigo-600 hover:text-indigo-800 border border-indigo-300 rounded-md hover:bg-indigo-50 flex items-center"
                                            >
                                                <Eye size={14} className="mr-1" />
                                                Preview
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onSelect(template)}
                                                className="px-3 py-1.5 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
                                            >
                                                Use Template
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    <div className="p-6 border-t border-gray-200 bg-gray-50">
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            {previewingTemplate && (
                <LeaseTemplatePreviewModal
                    template={previewingTemplate}
                    onClose={() => setPreviewingTemplate(null)}
                />
            )}
        </>
    );
};

// Template Preview Modal
const LeaseTemplatePreviewModal = ({ template, onClose }) => {
    const [isDragging, setIsDragging] = useState(false);
    const templateDataForPreview = useMemo(() => {
        if (!template) return {};
        return template.parsed_template_data || parseTemplateData(template);
    }, [template]);

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

    const renderTemplateData = (data, depth = 0) => {
        if (data === null || data === undefined) {
            return <span className="text-gray-400 italic">null</span>;
        }
        
        if (typeof data !== 'object') {
            return <span className="text-gray-600">{String(data)}</span>;
        }

        if (Array.isArray(data)) {
            if (data.length === 0) {
                return <span className="text-gray-400 italic">[]</span>;
            }
            return (
                <ul className="space-y-1 ml-4" style={{ marginLeft: `${depth * 16}px` }}>
                    {data.map((item, idx) => (
                        <li key={idx} className="text-sm">
                            {renderTemplateData(item, depth + 1)}
                        </li>
                    ))}
                </ul>
            );
        }

        const entries = Object.entries(data);
        if (entries.length === 0) {
            return <span className="text-gray-400 italic">{'{}'}</span>;
        }

        return (
            <div className="space-y-2" style={{ marginLeft: depth > 0 ? `${depth * 16}px` : '0' }}>
                {entries.map(([key, value]) => (
                    <div key={key} className={depth > 0 ? 'border-l-2 border-gray-200 pl-4' : ''}>
                        <div className="font-medium text-gray-900 capitalize text-sm">
                            {key.replace(/_/g, ' ')}:
                        </div>
                        <div className="text-sm text-gray-600 ml-4">
                            {renderTemplateData(value, depth + 1)}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div 
                className="w-full max-w-3xl bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <div className="flex items-center justify-between p-6 border-b">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">{template.template_name}</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            {template.template_level === 'system' ? 'System' : 
                             template.template_level === 'company' ? 'Company' : 'Landlord'} Template
                        </p>
                    </div>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6">
                    {templateDataForPreview && Object.keys(templateDataForPreview).length > 0 ? (
                        <div className="bg-gray-50 rounded-lg p-4">
                            <h3 className="font-medium text-gray-900 mb-3">Template Structure:</h3>
                            <div className="text-sm">
                                {renderTemplateData(templateDataForPreview)}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            No template data available.
                        </div>
                    )}
                </div>
                
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};