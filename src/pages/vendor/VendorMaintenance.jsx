import React, { useState, useEffect, useContext } from 'react';
import { Clock, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';

export default function VendorMaintenance() {
  const { user } = useContext(AuthContext);
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [vendorId, setVendorId] = useState(null);

  useEffect(() => {
    const fetchVendorAndRequests = async () => {
      if (!user?.user_id) return;
      
      setIsLoading(true);
      try {
        // Find vendor by user_id
        const { data: vendorData, error: vendorError } = await supabase
          .from('vendors')
          .select('vendor_id')
          .eq('user_id', user.user_id)
          .maybeSingle();
        
        if (vendorError) {
          console.error('Error fetching vendor:', vendorError);
          setIsLoading(false);
          return;
        }
        
        if (!vendorData) {
          console.error('Vendor not found for user');
          setIsLoading(false);
          return;
        }
        
        setVendorId(vendorData.vendor_id);
        
        // Fetch maintenance requests assigned to this vendor
        const { data: requestsData, error: requestsError } = await supabase
          .from('maintenance_requests')
          .select(`
            request_id,
            description,
            status,
            priority,
            created_at,
            completed_at,
            admin_notes,
            units!inner(
              unit_id,
              unit_number,
              properties!inner(
                property_id
              )
            )
          `)
          .eq('assigned_vendor_id', vendorData.vendor_id)
          .order('created_at', { ascending: false });
        
        if (requestsError) {
          console.error('Error fetching maintenance requests:', requestsError);
          setRequests([]);
        } else {
          // Fetch addresses for properties
          const propertyIds = [...new Set(requestsData?.map(r => r.units?.properties?.property_id).filter(Boolean) || [])];
          
          const { data: addresses } = propertyIds.length > 0 ? await supabase
            .from('addresses')
            .select('*')
            .eq('addressable_type', 'property')
            .in('addressable_id', propertyIds) : { data: [] };
          
          // Combine request data with addresses
          const requestsWithData = (requestsData || []).map(request => {
            const propertyId = request.units?.properties?.property_id;
            const address = addresses?.find(a => a.addressable_id === propertyId) || {};
            
            return {
              ...request,
              address_line_1: address.address_line_1 || '',
              address_line_2: address.address_line_2 || '',
              city: address.city || '',
              state: address.state_province_region || '',
              postal_code: address.postal_code || '',
              unit_number: request.units?.unit_number || ''
            };
          });
          
          setRequests(requestsWithData);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        setRequests([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchVendorAndRequests();
  }, [user]);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
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

  const getStatusConfig = (status) => {
    const configs = {
      'New': { icon: <Clock className="w-5 h-5" />, color: 'bg-blue-100 text-blue-800', label: 'New' },
      'In Progress': { icon: <AlertCircle className="w-5 h-5" />, color: 'bg-yellow-100 text-yellow-800', label: 'In Progress' },
      'On Hold': { icon: <XCircle className="w-5 h-5" />, color: 'bg-gray-100 text-gray-800', label: 'On Hold' },
      'Completed': { icon: <CheckCircle className="w-5 h-5" />, color: 'bg-green-100 text-green-800', label: 'Completed' },
    };
    return configs[status] || configs['New'];
  };

  const getPriorityConfig = (priority) => {
    const configs = {
      'Low': { color: 'bg-gray-100 text-gray-800' },
      'Medium': { color: 'bg-yellow-100 text-yellow-800' },
      'High': { color: 'bg-orange-100 text-orange-800' },
      'Urgent': { color: 'bg-red-100 text-red-800' },
    };
    return configs[priority] || configs['Medium'];
  };

  if (isLoading) {
    return <div className="p-4">Loading maintenance requests...</div>;
  }

  if (!vendorId) {
    return <div className="p-4 text-red-600">Vendor profile not found.</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">My Maintenance Requests</h1>

      {requests.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>You don't have any assigned maintenance requests yet.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map(request => {
            const statusConfig = getStatusConfig(request.status);
            const priorityConfig = getPriorityConfig(request.priority);
            return (
              <Card key={request.request_id} className="bg-white hover:shadow-lg transition-shadow">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between">
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-semibold text-gray-900">
                          {formatAddress(request)}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">Unit {request.unit_number}</p>
                      </div>
                      <div className="flex gap-2">
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${statusConfig.color}`}>
                          {statusConfig.icon}
                          <span className="text-xs font-medium">{statusConfig.label}</span>
                        </div>
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${priorityConfig.color}`}>
                          {request.priority}
                        </div>
                      </div>
                    </div>

                    <div className="mb-4">
                      <p className="text-sm font-medium text-gray-700 mb-1">Description:</p>
                      <p className="text-sm text-gray-900">{request.description}</p>
                    </div>

                    {request.admin_notes && (
                      <div className="mb-4 p-3 bg-gray-50 rounded-md">
                        <p className="text-sm font-medium text-gray-700 mb-1">Admin Notes:</p>
                        <p className="text-sm text-gray-600">{request.admin_notes}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="flex items-center text-sm text-gray-600">
                        <Clock className="w-4 h-4 mr-2 text-gray-400" />
                        <span>Created: {formatDate(request.created_at)}</span>
                      </div>
                      {request.completed_at && (
                        <div className="flex items-center text-sm text-gray-600">
                          <CheckCircle className="w-4 h-4 mr-2 text-gray-400" />
                          <span>Completed: {formatDate(request.completed_at)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

