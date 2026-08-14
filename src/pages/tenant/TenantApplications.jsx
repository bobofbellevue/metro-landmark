import React, { useState, useEffect, useContext } from 'react';
import { FileText, Clock, CheckCircle, XCircle, Home } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';

export default function TenantApplications() {
  const { user } = useContext(AuthContext);
  const [applications, setApplications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchApplications();
    }
  }, [user]);

  const fetchApplications = async () => {
    setIsLoading(true);
    try {
      // Find client record
      const { data: clientRecord, error: clientError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.user_id)
        .maybeSingle();

      if (clientError && clientError.code !== 'PGRST116') {
        // Only log non-PGRST116 errors (PGRST116 means no rows found, which is acceptable)
        console.error('Error fetching client record:', clientError);
      }

      if (!clientRecord) {
        // No client record found - user hasn't applied yet
        setApplications([]);
        setIsLoading(false);
        return;
      }

      // Fetch all applications for this client
      const { data: applicationUnits, error: applicationsError } = await supabase
        .from('client_applications')
        .select(`
          application_id,
          status,
          applied_at,
          notes,
          units!inner(
            unit_id,
            unit_number,
            beds,
            baths,
            square_footage,
            properties!inner(
              property_id,
              property_type
            )
          )
        `)
        .eq('client_id', clientRecord.client_id)
        .order('applied_at', { ascending: false });

      if (applicationsError) {
        console.error('Error fetching applications:', applicationsError);
        setApplications([]);
      } else {
        // Fetch addresses for properties
        const propertyIds = [...new Set(applicationUnits?.map(au => au.units.properties.property_id) || [])];
        
        const { data: addresses } = await supabase
          .from('addresses')
          .select('*')
          .eq('addressable_type', 'property')
          .in('addressable_id', propertyIds);

        // Combine application data with addresses
        const applicationsWithAddresses = (applicationUnits || []).map(au => {
          const unit = au.units;
          const property = unit.properties;
          const address = addresses?.find(a => a.addressable_id === property.property_id) || {};

          return {
            application_id: au.application_id,
            status: au.status,
            applied_at: au.applied_at,
            notes: au.notes,
            unit_number: unit.unit_number,
            beds: unit.beds,
            baths: unit.baths,
            square_footage: unit.square_footage,
            property_type: property.property_type,
            address_line_1: address.address_line_1,
            address_line_2: address.address_line_2,
            city: address.city,
            state: address.state_province_region,
            postal_code: address.postal_code,
          };
        });

        setApplications(applicationsWithAddresses);
      }
    } catch (error) {
      console.error('Error fetching applications:', error);
      setApplications([]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatAddress = (application) => {
    const parts = [
      application.address_line_1,
      application.address_line_2,
      application.city,
      application.state,
      application.postal_code
    ].filter(Boolean);
    return parts.join(', ') || 'Address not available';
  };

  const statusConfig = {
    'pending': { icon: <Clock className="w-5 h-5" />, color: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
    'approved': { icon: <CheckCircle className="w-5 h-5" />, color: 'bg-green-100 text-green-800', label: 'Approved' },
    'rejected': { icon: <XCircle className="w-5 h-5" />, color: 'bg-red-100 text-red-800', label: 'Rejected' },
    'withdrawn': { icon: <XCircle className="w-5 h-5" />, color: 'bg-gray-100 text-gray-800', label: 'Withdrawn' },
  };

  if (isLoading) {
    return <div className="p-4">Loading applications...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">My Applications</h1>

      {applications.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>You haven't submitted any applications yet.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map(application => {
            const status = statusConfig[application.status] || statusConfig.pending;
            return (
              <Card key={application.application_id} className="bg-white hover:shadow-lg transition-shadow">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between">
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-semibold text-gray-900">
                          {formatAddress(application)}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">Unit {application.unit_number}</p>
                      </div>
                      <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${status.color}`}>
                        {status.icon}
                        <span className="text-xs font-medium capitalize">{status.label}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
                      <div className="flex items-center text-sm text-gray-600">
                        <Home className="w-4 h-4 mr-2 text-gray-400" />
                        <span>{application.beds} bed{application.beds !== 1 ? 's' : ''}, {application.baths} bath{application.baths !== 1 ? 's' : ''}</span>
                      </div>
                      {application.square_footage && (
                        <div className="flex items-center text-sm text-gray-600">
                          <span className="mr-2">📐</span>
                          <span>{application.square_footage} sq ft</span>
                        </div>
                      )}
                      <div className="flex items-center text-sm text-gray-600">
                        <FileText className="w-4 h-4 mr-2 text-gray-400" />
                        <span>Applied: {formatDate(application.applied_at)}</span>
                      </div>
                    </div>

                    {application.notes && (
                      <div className="p-3 bg-gray-50 rounded-md">
                        <p className="text-sm font-medium text-gray-700 mb-1">Notes:</p>
                        <p className="text-sm text-gray-600">{application.notes}</p>
                      </div>
                    )}
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

