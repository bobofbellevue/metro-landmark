import React, { useState, useEffect, useContext } from 'react';
import { FileText, Calendar, DollarSign, Home, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';
import DocumentList from '../../components/DocumentList';

export default function TenantLeases() {
  const { user } = useContext(AuthContext);
  const [leases, setLeases] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchLeases();
    }
  }, [user]);

  const fetchLeases = async () => {
    setIsLoading(true);
    try {
      const userId = user.user_id;

      // Get client_id from user_id
      const { data: clientRecord, error: clientError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (clientError) {
        console.error('TenantLeases: Error fetching client:', clientError);
        setLeases([]);
        setIsLoading(false);
        return;
      }

      if (!clientRecord?.client_id) {
        setLeases([]);
        setIsLoading(false);
        return;
      }

      // Fetch all leases for this client
      const { data: leaseClients, error } = await supabase
        .from('lease_clients')
        .select(`
          leases!inner(
            lease_id,
            start_date,
            end_date,
            status,
            monthly_rent_amount,
            security_deposit_amount,
            pet_deposit_amount,
            other_fee_amount,
            date_of_agreement,
            dependent_names,
            pets,
            comment,
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
          )
        `)
        .eq('client_id', clientRecord.client_id);

      if (error) {
        console.error('Error fetching leases:', error);
        setLeases([]);
      } else {
        // Fetch addresses for properties
        const propertyIds = [...new Set(leaseClients?.map(lc => lc.leases.units.properties.property_id) || [])];
        
        const { data: addresses } = await supabase
          .from('addresses')
          .select('*')
          .eq('addressable_type', 'property')
          .in('addressable_id', propertyIds);

        // Combine lease data with addresses and sort by start_date
        const leasesWithAddresses = (leaseClients || []).map(lc => {
          const lease = lc.leases;
          const unit = lease.units;
          const property = unit.properties;
          const address = addresses?.find(a => a.addressable_id === property.property_id) || {};

          return {
            lease_id: lease.lease_id,
            start_date: lease.start_date,
            end_date: lease.end_date,
            status: lease.status,
            monthly_rent: lease.monthly_rent_amount,
            security_deposit: lease.security_deposit_amount,
            pet_deposit: lease.pet_deposit_amount,
            other_fee: lease.other_fee_amount,
            date_of_agreement: lease.date_of_agreement,
            dependent_names: lease.dependent_names,
            pets: lease.pets,
            comment: lease.comment,
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
        }).sort((a, b) => {
          // Sort by start_date descending
          const dateA = a.start_date ? new Date(a.start_date) : new Date(0);
          const dateB = b.start_date ? new Date(b.start_date) : new Date(0);
          return dateB - dateA;
        });

        setLeases(leasesWithAddresses);
      }
    } catch (error) {
      console.error('Error fetching leases:', error);
      setLeases([]);
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

  const formatAddress = (lease) => {
    const parts = [
      lease.address_line_1,
      lease.address_line_2,
      lease.city,
      lease.state,
      lease.postal_code
    ].filter(Boolean);
    return parts.join(', ') || 'Address not available';
  };

  const statusColors = {
    'active': 'bg-green-100 text-green-800',
    'future': 'bg-blue-100 text-blue-800',
    'expired': 'bg-gray-100 text-gray-800',
    'terminated': 'bg-red-100 text-red-800',
  };

  if (isLoading) {
    return <div className="p-4">Loading leases...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">My Leases</h1>

      {leases.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>You don't have any leases yet.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {leases.map(lease => (
            <Card key={lease.lease_id} className="bg-white hover:shadow-lg transition-shadow">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between">
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">
                        {formatAddress(lease)}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">Unit {lease.unit_number}</p>
                    </div>
                    <span className={`px-3 py-1 text-xs font-medium rounded-full capitalize ${statusColors[lease.status] || 'bg-gray-100 text-gray-800'}`}>
                      {lease.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
                    <div className="flex items-center text-sm text-gray-600">
                      <Home className="w-4 h-4 mr-2 text-gray-400" />
                      <span>{lease.beds} bed{lease.beds !== 1 ? 's' : ''}, {lease.baths} bath{lease.baths !== 1 ? 's' : ''}</span>
                    </div>
                    {lease.square_footage && (
                      <div className="flex items-center text-sm text-gray-600">
                        <span className="mr-2">📐</span>
                        <span>{lease.square_footage} sq ft</span>
                      </div>
                    )}
                    <div className="flex items-center text-sm text-gray-600">
                      <Calendar className="w-4 h-4 mr-2 text-gray-400" />
                      <span>{formatDate(lease.start_date)} - {lease.end_date ? formatDate(lease.end_date) : 'Ongoing'}</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <DollarSign className="w-4 h-4 mr-2 text-gray-400" />
                      <span>${lease.monthly_rent?.toLocaleString()}/month</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4 p-4 bg-gray-50 rounded-md">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Security Deposit</p>
                      <p className="text-lg font-semibold text-gray-900">${lease.security_deposit?.toLocaleString() || '0'}</p>
                    </div>
                    {lease.pet_deposit && (
                      <div>
                        <p className="text-sm font-medium text-gray-700">Pet Deposit</p>
                        <p className="text-lg font-semibold text-gray-900">${lease.pet_deposit.toLocaleString()}</p>
                      </div>
                    )}
                    {lease.other_fee && (
                      <div>
                        <p className="text-sm font-medium text-gray-700">Other Fees</p>
                        <p className="text-lg font-semibold text-gray-900">${lease.other_fee.toLocaleString()}</p>
                      </div>
                    )}
                    {lease.date_of_agreement && (
                      <div>
                        <p className="text-sm font-medium text-gray-700">Agreement Date</p>
                        <p className="text-sm text-gray-900">{formatDate(lease.date_of_agreement)}</p>
                      </div>
                    )}
                  </div>

                  {(lease.dependent_names || lease.pets || lease.comment) && (
                    <div className="space-y-2 p-4 bg-gray-50 rounded-md">
                      {lease.dependent_names && (
                        <div>
                          <p className="text-sm font-medium text-gray-700">Dependents</p>
                          <p className="text-sm text-gray-600">{lease.dependent_names}</p>
                        </div>
                      )}
                      {lease.pets && (
                        <div>
                          <p className="text-sm font-medium text-gray-700">Pets</p>
                          <p className="text-sm text-gray-600">{lease.pets}</p>
                        </div>
                      )}
                      {lease.comment && (
                        <div>
                          <p className="text-sm font-medium text-gray-700">Notes</p>
                          <p className="text-sm text-gray-600">{lease.comment}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Documents Section */}
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Lease Documents</h4>
                    <DocumentList
                      leaseId={lease.lease_id}
                      showActions={true}
                      onDocumentClick={async (doc) => {
                        try {
                          const response = await fetch(`/api/documents/${doc.document_id}/download`);
                          const result = await response.json();
                          if (result.success) {
                            window.open(result.url, '_blank');
                          }
                        } catch (error) {
                          console.error('Error opening document:', error);
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

