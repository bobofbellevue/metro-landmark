import React, { useState, useEffect, useContext } from 'react';
import { PlusCircle, X, Pencil, Trash2, CheckCircle, Clock, AlertCircle, Play, MessageSquare, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card, ConfirmationModal } from '../components/ui';
import ConversationReview from '../components/ConversationReview';
import { formatPlaceWithUnit } from '../utils/unit-display.js';

// This is the main component for the Maintenance page
export default function MaintenancePage() {
    const { user } = useContext(AuthContext);
    const [activeTab, setActiveTab] = useState('requests');
    const [requests, setRequests] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [vendors, setVendors] = useState([]);

    const fetchVendors = async () => {
        try {
            const { data: vendorsData, error: vendorsError } = await supabase
                .from('vendors')
                .select('vendor_id, company_name')
                .eq('is_archived', false)
                .order('company_name');
            
            if (vendorsError) {
                console.error('Error fetching vendors:', vendorsError);
                setVendors([]);
            } else {
                // Fetch contacts for vendor names
                const vendorIds = vendorsData?.map(v => v.vendor_id) || [];
                const { data: contacts } = vendorIds.length > 0 ? await supabase
                    .from('contacts')
                    .select('contactable_id, first_name, middle_name, last_name')
                    .eq('contactable_type', 'vendor')
                    .in('contactable_id', vendorIds) : { data: [] };
                
                const vendorsWithNames = (vendorsData || []).map(vendor => {
                    const contact = contacts?.find(c => c.contactable_id === vendor.vendor_id);
                    const name = contact 
                        ? `${contact.first_name || ''} ${contact.middle_name || ''} ${contact.last_name || ''}`.trim()
                        : '';
                    return {
                        ...vendor,
                        display_name: vendor.company_name || name || `Vendor #${vendor.vendor_id}`
                    };
                });
                setVendors(vendorsWithNames);
            }
        } catch (error) {
            console.error('Error fetching vendors:', error);
            setVendors([]);
        }
    };

    const fetchRequests = async () => {
        setIsLoading(true);
        try {
                const { data: requestsData, error } = await supabase
                .from('maintenance_requests')
                .select(`
                    *,
                    units(
                        unit_id,
                        unit_number,
                        properties(
                            property_id
                        )
                    ),
                    users:tenant_user_id(
                        user_id,
                        email
                    )
                `)
                .order('created_at', { ascending: false });
                
            if (error) {
                console.error('Error fetching maintenance requests:', error);
                setRequests([]);
            } else {
                // Fetch addresses for properties
                const propertyIds = [...new Set(requestsData?.map(r => r.units?.properties?.property_id).filter(Boolean) || [])];
                
                const { data: addresses } = propertyIds.length > 0 ? await supabase
                    .from('addresses')
                    .select('*')
                    .eq('addressable_type', 'property')
                    .in('addressable_id', propertyIds) : { data: [] };

                // Fetch tenant contacts
                const tenantUserIds = [...new Set(requestsData?.map(r => r.tenant_user_id).filter(Boolean) || [])];
                // Get client_ids from user_ids
                const { data: tenantsData } = tenantUserIds.length > 0 
                    ? await supabase.from('clients').select('client_id, user_id').in('user_id', tenantUserIds)
                    : { data: [] };
                const clientIds = tenantsData?.map(t => t.client_id).filter(Boolean) || [];
                
                // Try to find contacts by client_id first, then by user_id (contacts might be stored either way)
                const [contactsByClientId, contactsByUserId] = await Promise.all([
                    clientIds.length > 0 ? supabase
                        .from('contacts')
                        .select('contactable_id, first_name, middle_name, last_name')
                        .eq('contactable_type', 'client')
                        .in('contactable_id', clientIds) : { data: [] },
                    tenantUserIds.length > 0 ? supabase
                        .from('contacts')
                        .select('contactable_id, first_name, middle_name, last_name')
                        .eq('contactable_type', 'client')
                        .in('contactable_id', tenantUserIds) : { data: [] }
                ]);

                // Combine both contact results, prioritizing client_id matches
                const allContacts = [
                    ...(contactsByClientId.data || []),
                    ...(contactsByUserId.data || []).filter(c => 
                        !contactsByClientId.data?.some(cc => cc.contactable_id === c.contactable_id)
                    )
                ];

                // Create a map from contactable_id (could be client_id or user_id) to contact
                const contactMap = new Map();
                allContacts?.forEach(c => contactMap.set(c.contactable_id, c));
                // Create a map from user_id to client_id
                const userToClientMap = new Map();
                tenantsData?.forEach(t => userToClientMap.set(t.user_id, t.client_id));

                // Combine request data with addresses and tenant info
                const requestsWithData = (requestsData || []).map(request => {
                    const propertyId = request.units?.properties?.property_id;
                    const address = addresses?.find(a => a.addressable_id === propertyId) || {};
                    // Try to get contact by client_id first, then by user_id
                    const clientId = userToClientMap.get(request.tenant_user_id);
                    const contact = (clientId && contactMap.get(clientId)) || contactMap.get(request.tenant_user_id) || null;
                    
                    // Check if this is an unassigned request
                    const isUnassigned = !request.unit_id || !request.tenant_user_id;
                    
                    return {
                        ...request,
                        address_line_1: address.address_line_1 || '',
                        address_line_2: address.address_line_2 || '',
                        city: address.city || '',
                        state: address.state_province_region || '',
                        postal_code: address.postal_code || '',
                        unit_number: request.units?.unit_number || (isUnassigned ? '[Unassigned]' : ''),
                        tenant_first_name: contact?.first_name || (isUnassigned ? '[Unassigned]' : '') || '',
                        tenant_middle_name: contact?.middle_name || '',
                        tenant_last_name: contact?.last_name || '',
                        tenant_email: request.users?.email || '',
                        is_unassigned: isUnassigned
                    };
                });

                setRequests(requestsWithData);
            }
        } catch (error) {
            console.error('Error fetching maintenance requests:', error);
            setRequests([]);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        if (user) {
            fetchRequests();
            fetchVendors();
        }
    }, [user]);

    const handleSuccess = () => {
        setIsModalOpen(false);
        fetchRequests();
    };

    const columns = {
        'New': requests.filter(r => r.status === 'New'),
        'In Progress': requests.filter(r => r.status === 'In Progress'),
        'On Hold': requests.filter(r => r.status === 'On Hold'),
        'Completed': requests.filter(r => r.status === 'Completed'),
    };

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Maintenance</h2>
            <div className="border-b border-gray-200">
                <nav className="flex -mb-px space-x-8">
                    <button onClick={() => setActiveTab('requests')} className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'requests' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                        <Wrench size={16}/> Requests
                    </button>
                    {(user?.role === 'global_admin' || user?.role === 'company_admin') && (
                        <button onClick={() => setActiveTab('voice-calls')} className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'voice-calls' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                            <MessageSquare size={16}/> Conversations
                        </button>
                    )}
                </nav>
            </div>
            <div className="mt-6">
                {activeTab === 'requests' && (
                    <>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-2xl font-semibold text-gray-800">Maintenance Dashboard</h3>
                            <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">
                                <PlusCircle size={16} /> New Request
                            </button>
                        </div>
                        
                        {isLoading ? (
                            <p>Loading maintenance requests...</p>
                        ) : (
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                                {Object.entries(columns).map(([status, requestsInColumn]) => (
                                    <MaintenanceColumn key={status} status={status} requests={requestsInColumn} onUpdate={fetchRequests} vendors={vendors} />
                                ))}
                            </div>
                        )}
                        {isModalOpen && <CreateRequestModal onClose={() => setIsModalOpen(false)} onUpdateSuccess={handleSuccess} />}
                    </>
                )}
                {activeTab === 'voice-calls' && <ConversationReview />}
            </div>
        </div>
    );
}

// A component for each column in the Kanban board
const MaintenanceColumn = ({ status, requests, onUpdate, vendors }) => {
    const statusColors = {
        'New': 'bg-blue-100 border-blue-300',
        'In Progress': 'bg-yellow-100 border-yellow-300',
        'On Hold': 'bg-gray-100 border-gray-300',
        'Completed': 'bg-green-100 border-green-300',
    }
    return (
        <div className={`p-4 rounded-lg border ${statusColors[status] || 'bg-gray-100 border-gray-300'}`}>
            <h3 className="mb-4 text-lg font-semibold text-gray-700">{status} ({requests.length})</h3>
            <div className="space-y-4">
                {requests.map(request => (
                    <MaintenanceCard key={request.request_id} request={request} onUpdate={onUpdate} vendors={vendors} />
                ))}
                {requests.length === 0 && (
                    <div className="p-4 text-sm text-center text-gray-500 bg-white/50 rounded-lg">
                        No requests in this category.
                    </div>
                )}
            </div>
        </div>
    );
};

// A component for each individual request card
const MaintenanceCard = ({ request, onUpdate, vendors }) => {
    const { user } = useContext(AuthContext);
    const [isEditing, setIsEditing] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showNotesEditor, setShowNotesEditor] = useState(false);
    const [adminNotes, setAdminNotes] = useState(request.admin_notes || '');
    const [isSavingNotes, setIsSavingNotes] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const [assignedVendorId, setAssignedVendorId] = useState(request.assigned_vendor_id || '');
    const [isSavingVendor, setIsSavingVendor] = useState(false);
    const [statusError, setStatusError] = useState('');
    const [saveError, setSaveError] = useState('');
    const [notesError, setNotesError] = useState('');
    const [vendorError, setVendorError] = useState('');
    const [approvedVendors, setApprovedVendors] = useState([]);
    const [isLoadingVendors, setIsLoadingVendors] = useState(true);
    const isAdmin = user?.role === 'admin' || user?.role === 'pm_manager' || user?.role === 'company_admin' || user?.role === 'global_admin';
    
    // Fetch approved vendors for this property
    useEffect(() => {
        const fetchApprovedVendors = async () => {
            setIsLoadingVendors(true);
            const propertyId = request.units?.properties?.property_id;
            if (!propertyId) {
                // If no property, show empty list
                setApprovedVendors([]);
                setIsLoadingVendors(false);
                return;
            }
            
            if (vendors.length === 0) {
                setApprovedVendors([]);
                setIsLoadingVendors(false);
                return;
            }
            
            try {
                // Get approved vendors for this property
                const { data: approvals, error } = await supabase
                    .from('vendor_approvals')
                    .select('vendor_id')
                    .or(`approved_by_property_id.eq.${propertyId},approved_by_landlord_id.not.is.null,approved_by_pmc_id.not.is.null,approval_level.eq.global`);
                
                if (error) {
                    console.error('Error fetching vendor approvals:', error);
                    setApprovedVendors([]);
                    setIsLoadingVendors(false);
                    return;
                }
                
                const approvedVendorIds = (approvals || []).map(a => a.vendor_id);
                
                if (approvedVendorIds.length === 0) {
                    // No approved vendors - only show currently assigned vendor if any
                    if (assignedVendorId) {
                        const assignedVendor = vendors.find(v => v.vendor_id === assignedVendorId);
                        setApprovedVendors(assignedVendor ? [assignedVendor] : []);
                    } else {
                        setApprovedVendors([]);
                    }
                    setIsLoadingVendors(false);
                    return;
                }
                
                // Filter vendors to only show approved ones
                const filtered = vendors.filter(v => approvedVendorIds.includes(v.vendor_id));
                
                // Always include currently assigned vendor even if not approved (for display)
                if (assignedVendorId && !filtered.find(v => v.vendor_id === assignedVendorId)) {
                    const assignedVendor = vendors.find(v => v.vendor_id === assignedVendorId);
                    if (assignedVendor) {
                        filtered.push(assignedVendor);
                    }
                }
                
                setApprovedVendors(filtered);
            } catch (error) {
                console.error('Error fetching approved vendors:', error);
                setApprovedVendors([]); // Show empty list on error rather than all vendors
            } finally {
                setIsLoadingVendors(false);
            }
        };
        
        fetchApprovedVendors();
    }, [request.units?.properties?.property_id, vendors, assignedVendorId]);
    const [editForm, setEditForm] = useState({
        description: request.description,
        priority: request.priority,
        status: request.status
    });

    const priorityColors = {
        'Low': 'bg-green-100 text-green-800',
        'Medium': 'bg-yellow-100 text-yellow-800',
        'High': 'bg-orange-100 text-orange-800',
        'Urgent': 'bg-red-200 text-red-900 font-bold',
    };

    const formatAddress = () => {
        const parts = [
            request.address_line_1,
            request.city,
            request.state
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : 'Address not available';
    };

    const formatTenantName = () => {
        // First try to get from tenant_first_name, tenant_middle_name, tenant_last_name
        const parts = [
            request.tenant_first_name,
            request.tenant_middle_name,
            request.tenant_last_name
        ].filter(Boolean);
        
        if (parts.length > 0) {
            return parts.join(' ');
        }
        
        // Fallback: use email if available
        if (request.tenant_email) {
            return request.tenant_email;
        }
        
        // Fallback: try to extract from admin_notes if tenant name was stored there
        if (request.admin_notes) {
            const tenantMatch = request.admin_notes.match(/^Tenant:\s*(.+?)(?:\n|$)/i);
            if (tenantMatch && tenantMatch[1]) {
                return tenantMatch[1].trim();
            }
        }
        
        return 'Tenant not available';
    };

    const handleStatusChange = async (newStatus) => {
        setStatusError('');
        try {
            const { error } = await supabase
                .from('maintenance_requests')
                .update({ status: newStatus })
                .eq('request_id', request.request_id);
            
            if (error) {
                console.error('Error updating status:', error);
                setStatusError('Failed to update status. Please try again.');
            } else {
                onUpdate();
            }
        } catch (error) {
            console.error('Error updating status:', error);
            setStatusError('Failed to update status. Please try again.');
        }
    };

    const handleDeleteClick = () => {
        setDeleteError('');
        setShowDeleteModal(true);
    };

    const handleDeleteConfirm = async () => {
        setIsDeleting(true);
        setDeleteError('');
        try {
            const { error } = await supabase
                .from('maintenance_requests')
                .delete()
                .eq('request_id', request.request_id);
            
            if (error) {
                console.error('Error deleting request:', error);
                setDeleteError(error.message || 'Failed to delete request');
                setIsDeleting(false);
            } else {
                setShowDeleteModal(false);
                onUpdate();
            }
        } catch (error) {
            console.error('Error deleting request:', error);
            setDeleteError(error.message || 'Failed to delete request');
            setIsDeleting(false);
        }
    };

    const handleSave = async () => {
        setSaveError('');
        try {
            const { error } = await supabase
                .from('maintenance_requests')
                .update({
                    description: editForm.description,
                    priority: editForm.priority,
                    status: editForm.status
                })
                .eq('request_id', request.request_id);
            
            if (error) {
                console.error('Error updating request:', error);
                setSaveError('Failed to update request. Please try again.');
            } else {
                setIsEditing(false);
                setSaveError('');
                onUpdate();
            }
        } catch (error) {
            console.error('Error updating request:', error);
            setSaveError('Failed to update request. Please try again.');
        }
    };

    const handleSaveNotes = async () => {
        setIsSavingNotes(true);
        setNotesError('');
        try {
            const { error } = await supabase
                .from('maintenance_requests')
                .update({
                    admin_notes: adminNotes,
                    notes_updated_by: user.user_id,
                    notes_updated_at: new Date().toISOString()
                })
                .eq('request_id', request.request_id);
            
            if (error) {
                console.error('Error saving notes:', error);
                setNotesError('Failed to save notes. Please try again.');
            } else {
                setShowNotesEditor(false);
                setNotesError('');
                onUpdate();
            }
        } catch (error) {
            console.error('Error saving notes:', error);
            setNotesError('Failed to save notes. Please try again.');
        } finally {
            setIsSavingNotes(false);
        }
    };

    const handleVendorChange = async (vendorId) => {
        setIsSavingVendor(true);
        setVendorError('');
        try {
            const { error } = await supabase
                .from('maintenance_requests')
                .update({
                    assigned_vendor_id: vendorId || null
                })
                .eq('request_id', request.request_id);
            
            if (error) {
                console.error('Error assigning vendor:', error);
                setVendorError('Failed to assign vendor. Please try again.');
            } else {
                setAssignedVendorId(vendorId);
                setVendorError('');
                onUpdate();
            }
        } catch (error) {
            console.error('Error assigning vendor:', error);
            setVendorError('Failed to assign vendor. Please try again.');
        } finally {
            setIsSavingVendor(false);
        }
    };

    if (isEditing) {
        return (
            <Card className="bg-white">
                <div className="space-y-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                            value={editForm.description}
                            onChange={e => setEditForm({...editForm, description: e.target.value})}
                            rows="3"
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                        <select
                            value={editForm.priority}
                            onChange={e => setEditForm({...editForm, priority: e.target.value})}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                        >
                            <option>Low</option>
                            <option>Medium</option>
                            <option>High</option>
                            <option>Urgent</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                        <select
                            value={editForm.status}
                            onChange={e => setEditForm({...editForm, status: e.target.value})}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                        >
                            <option>New</option>
                            <option>In Progress</option>
                            <option>On Hold</option>
                            <option>Completed</option>
                        </select>
                    </div>
                    {saveError && (
                        <div className="p-2 text-xs text-red-700 bg-red-100 border border-red-400 rounded-md">
                            {saveError}
                        </div>
                    )}
                    <div className="flex gap-2 pt-2 border-t">
                        <button
                            onClick={handleSave}
                            className="flex-1 px-2 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700"
                        >
                            Save
                        </button>
                        <button
                            onClick={() => {
                                setIsEditing(false);
                                setSaveError('');
                            }}
                            className="flex-1 px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </Card>
        );
    }

    return (
        <Card title={formatPlaceWithUnit(formatAddress(), request)} className="bg-white hover:shadow-lg transition-shadow">
            <p className="mb-3 text-sm text-gray-500">
                Tenant: <span className="font-medium text-gray-700">{formatTenantName()}</span>
            </p>
            <p className="mb-4 text-sm text-gray-600">{request.description}</p>
            <div className="flex justify-between items-center text-xs text-gray-500 border-t pt-2 mb-3">
                <span>{new Date(request.created_at).toLocaleDateString()}</span>
                <span className={`px-2 py-1 rounded-full ${priorityColors[request.priority] || 'bg-gray-100 text-gray-800'}`}>
                    {request.priority}
                </span>
            </div>

            {/* Vendor Assignment Section */}
            {isAdmin && (
                <div className="mb-3 border-t pt-2">
                    <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-semibold text-gray-700">Assigned Vendor</h4>
                    </div>
                    <select
                        value={assignedVendorId}
                        onChange={(e) => handleVendorChange(e.target.value)}
                        disabled={isSavingVendor}
                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="">-- Select Vendor --</option>
                        {approvedVendors.map(vendor => (
                            <option key={vendor.vendor_id} value={vendor.vendor_id}>
                                {vendor.display_name}
                            </option>
                        ))}
                    </select>
                    {vendorError && (
                        <div className="mt-1 p-2 text-xs text-red-700 bg-red-100 border border-red-400 rounded-md">
                            {vendorError}
                        </div>
                    )}
                </div>
            )}

            {/* Admin Notes Section */}
            {isAdmin && (
                <div className="mb-3 border-t pt-2">
                    {!showNotesEditor ? (
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <h4 className="text-xs font-semibold text-gray-700">Admin Notes</h4>
                                <button
                                    onClick={() => setShowNotesEditor(true)}
                                    className="text-xs text-indigo-600 hover:text-indigo-800"
                                >
                                    {request.admin_notes ? 'Edit' : 'Add Notes'}
                                </button>
                            </div>
                            {request.admin_notes ? (
                                <p className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 p-2 rounded border">
                                    {request.admin_notes}
                                </p>
                            ) : (
                                <p className="text-xs text-gray-400 italic">No notes yet</p>
                            )}
                            {request.notes_updated_at && (
                                <p className="text-xs text-gray-400 mt-1">
                                    Updated {new Date(request.notes_updated_at).toLocaleString()}
                                </p>
                            )}
                        </div>
                    ) : (
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <h4 className="text-xs font-semibold text-gray-700">Admin Notes</h4>
                                <button
                                    onClick={() => {
                                        setShowNotesEditor(false);
                                        setAdminNotes(request.admin_notes || '');
                                    }}
                                    className="text-xs text-gray-600 hover:text-gray-800"
                                >
                                    Cancel
                                </button>
                            </div>
                            <textarea
                                value={adminNotes}
                                onChange={(e) => setAdminNotes(e.target.value)}
                                placeholder="Add notes about resolution, actions taken offline, or chatbot performance critique..."
                                className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                                rows="4"
                            />
                            {notesError && (
                                <div className="mb-2 p-2 text-xs text-red-700 bg-red-100 border border-red-400 rounded-md">
                                    {notesError}
                                </div>
                            )}
                            <button
                                onClick={handleSaveNotes}
                                disabled={isSavingNotes}
                                className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {isSavingNotes ? 'Saving...' : 'Save Notes'}
                            </button>
                        </div>
                    )}
                </div>
            )}
            
            {statusError && (
                <div className="mb-2 p-2 text-xs text-red-700 bg-red-100 border border-red-400 rounded-md">
                    {statusError}
                </div>
            )}
            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
                {/* Quick Status Buttons */}
                {request.status === 'New' && (
                    <button
                        onClick={() => handleStatusChange('In Progress')}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-yellow-700 bg-yellow-100 rounded hover:bg-yellow-200"
                        title="Mark as In Progress"
                    >
                        <Clock size={12} /> Start
                    </button>
                )}
                {request.status !== 'Completed' && (
                    <button
                        onClick={() => handleStatusChange('Completed')}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200"
                        title="Mark as Completed"
                    >
                        <CheckCircle size={12} /> Complete
                    </button>
                )}
                {request.status !== 'On Hold' && request.status !== 'Completed' && (
                    <button
                        onClick={() => handleStatusChange('On Hold')}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
                        title="Put On Hold"
                    >
                        <AlertCircle size={12} /> Hold
                    </button>
                )}
                {request.status === 'On Hold' && (
                    <button
                        onClick={() => handleStatusChange('New')}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200"
                        title="Resume Task"
                    >
                        <Play size={12} /> Resume
                    </button>
                )}
                
                {/* Edit Button */}
                <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200"
                    title="Edit Request"
                >
                    <Pencil size={12} /> Edit
                </button>
                
                {/* Delete Button */}
                <button
                    onClick={handleDeleteClick}
                    disabled={isDeleting}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200 disabled:opacity-50"
                    title="Delete Request"
                >
                    <Trash2 size={12} /> Delete
                </button>
            </div>

            {/* Delete Confirmation Modal */}
            <ConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => {
                    setShowDeleteModal(false);
                    setDeleteError('');
                }}
                onConfirm={handleDeleteConfirm}
                title="Delete Maintenance Request"
                message={`Are you sure you want to delete this maintenance request? This action cannot be undone.${deleteError ? `\n\nError: ${deleteError}` : ''}`}
                confirmText="Delete"
                cancelText="Cancel"
                isDestructive={true}
                isLoading={isDeleting}
            />
        </Card>
    );
};

const CreateRequestModal = ({ onClose, onUpdateSuccess }) => {
    const { user } = useContext(AuthContext);
    const [units, setUnits] = useState([]);
    const [tenants, setTenants] = useState([]);
    
    const [unitId, setUnitId] = useState('');
    const [tenantId, setTenantId] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('Medium');
    
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchDropdownData = async () => {
            try {
                const [unitsResult, usersResult, tenantsResult, contactsResult] = await Promise.all([
                    supabase.from('units').select('*'),
                    supabase.from('users').select('*').eq('role', 'client'),
                    supabase.from('clients').select('client_id, user_id'),
                    supabase.from('contacts').select('*').eq('contactable_type', 'client')
                ]);
                
                if (unitsResult.error) {
                    console.error('Error fetching units:', unitsResult.error);
                    setUnits([]);
                } else {
                    setUnits(unitsResult.data || []);
                }
                
                if (usersResult.error) {
                    console.error('Error fetching users:', usersResult.error);
                    setTenants([]);
                } else if (contactsResult.error) {
                    console.error('Error fetching contacts:', contactsResult.error);
                    setTenants([]);
                } else {
                    // Join users with their contacts
                    const users = usersResult.data || [];
                    const tenants = tenantsResult.data || [];
                    const contacts = contactsResult.data || [];
                    
                    const tenantsWithContacts = users.map(user => {
                        // Find tenant record for this user
                        const tenantRecord = tenants.find(t => t.user_id === user.user_id);
                        // Find contact using tenant_id
                        const contact = tenantRecord 
                            ? contacts.find(c => c.contactable_id === tenantRecord.tenant_id && c.contactable_type === 'tenant')
                            : null;
                        return {
                            ...user,
                            first_name: contact?.first_name || '',
                            middle_name: contact?.middle_name || '',
                            last_name: contact?.last_name || ''
                        };
                    });
                    
                    setTenants(tenantsWithContacts);
                }
            } catch (error) {
                console.error('Error fetching dropdown data:', error);
                setUnits([]);
                setTenants([]);
            }
        };
        fetchDropdownData();
    }, [user]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');
        try {
            const payload = { 
                unit_id: unitId,
                tenant_user_id: tenantId,
                description,
                priority,
                status: 'New'
            };
            const { data, error } = await supabase
                .from('maintenance_requests')
                .insert([payload])
                .select()
                .single();
            
            const result = error ? { success: false, message: error.message } : { success: true };
            if (result.success) {
                onUpdateSuccess();
            } else {
                setError(result.message || 'Failed to create request.');
            }
        } catch (err) {
            setError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBackdropClick = (e) => {
        // Prevent closing on backdrop click - only close via buttons
        e.stopPropagation();
    };

    return (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50" onClick={handleBackdropClick}>
            <div className="w-full max-w-lg p-6 bg-white rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-gray-800">New Maintenance Request</h2>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Property / Unit</label>
                        <select value={unitId} onChange={e => setUnitId(e.target.value)} required className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm">
                            <option value="">Select a Unit</option>
                            {units.map(u => <option key={u.unit_id} value={u.unit_id}>{formatPlaceWithUnit(u.address_line_1, u)}</option>)}
                        </select>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700">Tenant</label>
                        <select value={tenantId} onChange={e => setTenantId(e.target.value)} required className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm">
                            <option value="">Select a Tenant</option>
                            {tenants.map(t => <option key={t.user_id} value={t.user_id}>{t.first_name} {t.last_name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Description</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} required rows="4" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"></textarea>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700">Priority</label>
                        <select value={priority} onChange={e => setPriority(e.target.value)} required className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm">
                            <option>Low</option>
                            <option>Medium</option>
                            <option>High</option>
                            <option>Urgent</option>
                        </select>
                    </div>
                    {error && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{error}</div>)}
                    <div className="flex justify-end gap-4 pt-4 border-t">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">{isSubmitting ? 'Submitting...' : 'Submit Request'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

