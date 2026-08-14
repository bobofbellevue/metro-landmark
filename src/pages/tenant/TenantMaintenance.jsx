import React, { useState, useEffect, useContext, useCallback } from 'react';
import { PlusCircle, X, Wrench, Clock, CheckCircle, AlertCircle, Phone } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';
import MaintenanceChatBot from '../../components/MaintenanceChatBot';
import { phones } from '../../config/phones.js';

export default function TenantMaintenance() {
  const { user } = useContext(AuthContext);
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchRequests = useCallback(async () => {
    if (!user?.user_id) return;
    
    setIsLoading(true);
    try {
      const userId = user.user_id;

      // Fetch maintenance requests for this tenant
      const { data: requestsData, error } = await supabase
        .from('maintenance_requests')
        .select(`
          request_id,
          description,
          status,
          priority,
          created_at,
          completed_at,
          units!inner(
            unit_id,
            unit_number,
            properties!inner(
              property_id
            )
          )
        `)
        .eq('tenant_user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching maintenance requests:', error);
        setRequests([]);
      } else {
        // Fetch addresses for properties
        const propertyIds = [...new Set(requestsData?.map(r => r.units?.properties?.property_id).filter(Boolean) || [])];
        
        let addresses = [];
        if (propertyIds.length > 0) {
          const { data: addressesData, error: addressesError } = await supabase
            .from('addresses')
            .select('*')
            .eq('addressable_type', 'property')
            .in('addressable_id', propertyIds);
          
          if (addressesError) {
            console.error('Error fetching addresses:', addressesError);
          } else {
            addresses = addressesData || [];
          }
        }

        // Combine request data with addresses
        const requestsWithAddresses = (requestsData || []).map(request => {
          const address = addresses.find(a => a.addressable_id === request.units?.properties?.property_id) || {};
          
          return {
            ...request,
            address_line_1: address.address_line_1,
            address_line_2: address.address_line_2,
            city: address.city,
            state: address.state_province_region,
            postal_code: address.postal_code,
            unit_number: request.units.unit_number,
          };
        });

        setRequests(requestsWithAddresses);
      }
    } catch (error) {
      console.error('Error fetching maintenance requests:', error);
      setRequests([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.user_id]);

  useEffect(() => {
    if (user?.user_id) {
      fetchRequests();
      
      // Set up realtime subscription for maintenance requests
      const channel = supabase
        .channel(`maintenance_requests:${user.user_id}`)
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
            schema: 'public',
            table: 'maintenance_requests',
            filter: `tenant_user_id=eq.${user.user_id}`
          },
          (payload) => {
            console.log('[TenantMaintenance] Realtime change detected:', {
              event: payload.eventType,
              new: payload.new,
              old: payload.old,
              table: payload.table
            });
            // Refetch requests when any change occurs
            fetchRequests();
          }
        )
        .subscribe((status) => {
          console.log('[TenantMaintenance] Realtime subscription status:', status);
          if (status === 'SUBSCRIBED') {
            console.log('[TenantMaintenance] Successfully subscribed to maintenance_requests changes');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('[TenantMaintenance] Realtime subscription error - channel error');
          } else if (status === 'TIMED_OUT') {
            console.error('[TenantMaintenance] Realtime subscription error - timed out');
          } else if (status === 'CLOSED') {
            console.log('[TenantMaintenance] Realtime subscription closed');
          }
        });

      // Fallback: Poll for updates every 30 seconds if Realtime isn't working
      // This ensures new requests appear even if Realtime subscription fails
      const pollInterval = setInterval(() => {
        console.log('[TenantMaintenance] Polling for maintenance request updates...');
        fetchRequests();
      }, 30000); // Poll every 30 seconds

      return () => {
        console.log('[TenantMaintenance] Cleaning up realtime subscription and polling');
        clearInterval(pollInterval);
        supabase.removeChannel(channel);
      };
    }
  }, [user?.user_id, fetchRequests]);

  const handleSuccess = () => {
    setIsModalOpen(false);
    fetchRequests();
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatAddress = (request) => {
    const parts = [
      request.address_line_1,
      request.address_line_2,
      request.city,
      request.state,
      request.postal_code
    ].filter(Boolean);
    return parts.join(', ') || 'Address not available';
  };

  const statusConfig = {
    'New': { icon: <Clock className="w-5 h-5" />, color: 'bg-blue-100 text-blue-800' },
    'In Progress': { icon: <Wrench className="w-5 h-5" />, color: 'bg-yellow-100 text-yellow-800' },
    'On Hold': { icon: <AlertCircle className="w-5 h-5" />, color: 'bg-gray-100 text-gray-800' },
    'Completed': { icon: <CheckCircle className="w-5 h-5" />, color: 'bg-green-100 text-green-800' },
  };

  const priorityColors = {
    'Low': 'bg-green-100 text-green-800',
    'Medium': 'bg-yellow-100 text-yellow-800',
    'High': 'bg-orange-100 text-orange-800',
    'Urgent': 'bg-red-200 text-red-900 font-bold',
  };

  // Get unit ID from active lease
  const [unitId, setUnitId] = useState(null);

  useEffect(() => {
    const fetchUnitId = async () => {
      if (user?.user_id) {
        // Get client_id from user_id
        const { data: clientRecord, error: clientError } = await supabase
          .from('clients')
          .select('client_id')
          .eq('user_id', user.user_id)
          .maybeSingle();
        
        if (clientError) {
          console.error('TenantMaintenance: Error fetching client:', clientError);
          setUnitId(null);
          return;
        }

        if (!clientRecord?.client_id) {
          setUnitId(null);
          return;
        }

        // First try to get unit from active lease
        const { data: activeLease } = await supabase
          .from('lease_clients')
          .select('leases!inner(unit_id, status)')
          .eq('client_id', clientRecord.client_id)
          .eq('leases.status', 'active')
          .limit(1)
          .maybeSingle();

        if (activeLease?.leases) {
          setUnitId(activeLease.leases.unit_id);
          return;
        }

        // If no active lease, try to get unit from client_units
        const { data: clientUnit } = await supabase
          .from('client_units')
          .select('unit_id')
          .eq('client_id', clientRecord.client_id)
          .is('is_archived', false)
          .limit(1)
          .maybeSingle();

        if (clientUnit?.unit_id) {
          setUnitId(clientUnit.unit_id);
        } else {
          setUnitId(null);
        }
      }
    };
    fetchUnitId();
  }, [user?.user_id]);

  if (isLoading) {
    return <div className="p-4">Loading maintenance requests...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-800">Maintenance Requests</h1>
        <button 
          onClick={() => setIsModalOpen(true)} 
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
        >
          <PlusCircle size={16} /> New Request
        </button>
      </div>

      {/* Voice Bot Phone Number */}
      {phones.tenantMaintenanceTelHref && (
      <Card className="bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-200">
        <div className="flex items-center gap-4 p-4">
          <div className="flex-shrink-0">
            <div className="flex items-center justify-center w-12 h-12 bg-indigo-100 rounded-full">
              <Phone className="w-6 h-6 text-indigo-600" />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Need to speak with someone?</h3>
            <p className="text-sm text-gray-600 mb-2">
              Call our AI maintenance assistant 24/7 for immediate help with urgent issues or to report maintenance problems.
            </p>
            <a 
              href={phones.tenantMaintenanceTelHref} 
              className="inline-flex items-center gap-2 px-4 py-2 text-base font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
            >
              <Phone className="w-4 h-4" />
              {phones.tenantMaintenanceDisplay}
            </a>
          </div>
        </div>
      </Card>
      )}

      {/* AI Chat Bot */}
      {user && <MaintenanceChatBot user={user} unitId={unitId} onRequestCreated={fetchRequests} />}

      {requests.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">
          <Wrench className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>You don't have any maintenance requests yet.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map(request => {
            const status = statusConfig[request.status] || statusConfig.New;
            return (
              <Card key={request.request_id} className="bg-white hover:shadow-lg transition-shadow">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between">
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {formatAddress(request)}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">Unit {request.unit_number}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${status.color}`}>
                          {status.icon}
                          <span className="text-xs font-medium">{request.status}</span>
                        </div>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${priorityColors[request.priority] || 'bg-gray-100 text-gray-800'}`}>
                          {request.priority}
                        </span>
                      </div>
                    </div>

                    <p className="mb-4 text-sm text-gray-600">{request.description}</p>

                    <div className="flex items-center justify-between text-xs text-gray-500 pt-4 border-t">
                      <span>Created: {formatDate(request.created_at)}</span>
                      {request.completed_at && (
                        <span>Completed: {formatDate(request.completed_at)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {isModalOpen && <CreateRequestModal onClose={() => setIsModalOpen(false)} onUpdateSuccess={handleSuccess} user={user} />}
    </div>
  );
}

const CreateRequestModal = ({ onClose, onUpdateSuccess, user }) => {
  const [units, setUnits] = useState([]);
  const [unitId, setUnitId] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchUnits = async () => {
      try {
        // Get client_id from user_id
        const { data: clientRecord, error: clientRecordError } = await supabase
          .from('clients')
          .select('client_id')
          .eq('user_id', user.user_id)
          .maybeSingle();
        
        if (clientRecordError) {
          console.error('TenantMaintenance (modal): Error fetching client:', clientRecordError);
          setUnits([]);
          return;
        }

        if (!clientRecord?.client_id) {
          setUnits([]);
          return;
        }

        // Fetch unit IDs from both leases and client_units
        const [leaseClientsResult, clientUnitsResult] = await Promise.all([
          supabase
            .from('lease_clients')
            .select(`
              leases!inner(
                unit_id,
                status
              )
            `)
            .eq('client_id', clientRecord.client_id)
            .in('leases.status', ['active', 'future']),
          supabase
            .from('client_units')
            .select('unit_id')
            .eq('client_id', clientRecord.client_id)
            .is('is_archived', false)
        ]);

        const leaseUnitIds = [...new Set((leaseClientsResult.data || []).map(lc => lc.leases?.unit_id).filter(Boolean))];
        const clientUnitIds = [...new Set((clientUnitsResult.data || []).map(cu => cu.unit_id).filter(Boolean))];
        const allUnitIds = [...new Set([...leaseUnitIds, ...clientUnitIds])];

        if (allUnitIds.length > 0) {
          // Fetch full unit details with addresses
          const { data: unitsData, error: unitsError } = await supabase
            .from('units')
            .select(`
              unit_id,
              unit_number,
              properties!inner(
                property_id
              )
            `)
            .in('unit_id', allUnitIds);

          if (unitsError) {
            console.error('Error fetching units:', unitsError);
            setUnits([]);
            return;
          }

          // Fetch addresses
          const propertyIds = [...new Set(unitsData?.map(u => u.properties?.property_id).filter(Boolean) || [])];
          let addresses = [];
          if (propertyIds.length > 0) {
            const { data: addressesData, error: addressesError } = await supabase
              .from('addresses')
              .select('*')
              .eq('addressable_type', 'property')
              .in('addressable_id', propertyIds);
            
            if (addressesError) {
              console.error('Error fetching addresses:', addressesError);
            } else {
              addresses = addressesData || [];
            }
          }

          const unitsWithAddresses = (unitsData || []).map(unit => {
            const address = addresses.find(a => a.addressable_id === unit.properties?.property_id) || {};
            return {
              unit_id: unit.unit_id,
              unit_number: unit.unit_number,
              address: `${address.address_line_1 || ''}${address.address_line_2 ? `, ${address.address_line_2}` : ''}`.trim() || 'Address not available',
            };
          });

          setUnits(unitsWithAddresses);
        } else {
          setUnits([]);
        }
      } catch (error) {
        console.error('Error fetching units:', error);
        setUnits([]);
      }
    };

    if (user) {
      fetchUnits();
    }
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const payload = { 
        unit_id: unitId,
        tenant_user_id: user.user_id,
        description,
        priority,
        status: 'New'
      };
      const { error: insertError } = await supabase
        .from('maintenance_requests')
        .insert([payload])
        .select()
        .single();
      
      if (insertError) {
        setError(insertError.message || 'Failed to create request.');
      } else {
        onUpdateSuccess();
      }
    } catch {
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
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800">New Maintenance Request</h2>
          <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Property / Unit</label>
            <select 
              value={unitId} 
              onChange={e => setUnitId(e.target.value)} 
              required 
              className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm"
            >
              <option value="">Select a Unit</option>
              {units.map(u => (
                <option key={u.unit_id} value={u.unit_id}>
                  {u.address} - Unit {u.unit_number}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              rows={4}
              className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
              placeholder="Describe the maintenance issue..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Priority</label>
            <select 
              value={priority} 
              onChange={e => setPriority(e.target.value)} 
              className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm"
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
          </div>
          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
              {error}
            </div>
          )}
          <div className="flex justify-end space-x-4">
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
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

