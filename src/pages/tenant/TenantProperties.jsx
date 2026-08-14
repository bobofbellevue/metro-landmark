import React, { useState, useEffect, useContext } from 'react';
import { Home, Calendar, DollarSign, MapPin, Phone, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';
import { getPropertyContactInfo } from '../../utils/propertyContactInfo.js';

export default function TenantProperties() {
  const { user } = useContext(AuthContext);
  const [properties, setProperties] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('current'); // 'current' or 'past'

  useEffect(() => {
    if (user) {
      fetchProperties();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchProperties = async () => {
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
        console.error('TenantProperties: Error fetching client:', clientError);
        setProperties([]);
        setIsLoading(false);
        return;
      }

      if (!clientRecord?.client_id) {
        setProperties([]);
        setIsLoading(false);
        return;
      }

      // Fetch all leases for this client
      const { data: leaseClients, error: leaseError } = await supabase
        .from('lease_clients')
        .select(`
          leases!inner(
            lease_id,
            start_date,
            end_date,
            status,
            monthly_rent_amount,
            security_deposit_amount,
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

      // Also fetch units from client_units table (direct assignments)
      // Note: We fetch unit_ids first, then fetch units separately because Supabase
      // doesn't recognize the foreign key relationship for joins
      const { data: clientUnitsData, error: clientUnitsError } = await supabase
        .from('client_units')
        .select('unit_id')
        .eq('client_id', clientRecord.client_id)
        .is('is_archived', false);
      
      let clientUnits = [];
      if (clientUnitsData && clientUnitsData.length > 0) {
        const unitIds = clientUnitsData.map(cu => cu.unit_id);
        const { data: unitsData, error: unitsError } = await supabase
          .from('units')
          .select(`
            unit_id,
            unit_number,
            beds,
            baths,
            square_footage,
            properties!inner(
              property_id,
              property_type
            )
          `)
          .in('unit_id', unitIds);
        
        if (unitsError) {
          console.error('Error fetching units for client_units:', unitsError);
        } else {
          // Map the units data to match the expected structure
          clientUnits = (unitsData || []).map(unit => ({
            unit_id: unit.unit_id,
            units: unit
          }));
        }
      }

      if (leaseError) {
        console.error('Error fetching leases:', leaseError);
      }
      if (clientUnitsError) {
        console.error('Error fetching client units:', clientUnitsError);
      }

      // Collect all property IDs from both sources
      const leasePropertyIds = [...new Set(leaseClients?.map(lc => lc.leases?.units?.properties?.property_id).filter(Boolean) || [])];
      const clientUnitPropertyIds = [...new Set(clientUnits?.map(cu => cu.units?.properties?.property_id).filter(Boolean) || [])];
      const allPropertyIds = [...new Set([...leasePropertyIds, ...clientUnitPropertyIds])];

      // Fetch addresses for all properties
      let addresses = [];
      if (allPropertyIds.length > 0) {
        const { data: addressesData, error: addressesError } = await supabase
          .from('addresses')
          .select('*')
          .eq('addressable_type', 'property')
          .in('addressable_id', allPropertyIds);
        
        if (addressesError) {
          console.error('Error fetching addresses:', addressesError);
        } else {
          addresses = addressesData || [];
        }
      }

      // Process lease data
      const leaseProperties = await Promise.all((leaseClients || []).map(async (lc) => {
        const lease = lc.leases;
        const unit = lease.units;
        const property = unit.properties;
        const address = addresses?.find(a => a.addressable_id === property.property_id) || {};
        
        // Fetch property contact info
        const contactInfo = await getPropertyContactInfo(property.property_id);

        return {
          lease_id: lease.lease_id,
          start_date: lease.start_date,
          end_date: lease.end_date,
          status: lease.status,
          monthly_rent: lease.monthly_rent_amount,
          security_deposit: lease.security_deposit_amount,
          unit_number: unit.unit_number,
          beds: unit.beds,
          baths: unit.baths,
          square_footage: unit.square_footage,
          property_type: property.property_type,
          property_id: property.property_id,
          address_line_1: address.address_line_1,
          address_line_2: address.address_line_2,
          city: address.city,
          state: address.state_province_region,
          postal_code: address.postal_code,
          contact_info: contactInfo
        };
      }));

      // Process client_units data (direct assignments without leases)
      const directUnitProperties = await Promise.all((clientUnits || [])
        .filter(cu => {
          // Only include if there's no corresponding lease
          const hasLease = leaseClients?.some(lc => lc.leases?.unit_id === cu.unit_id);
          return !hasLease;
        })
        .map(async (cu) => {
          const unit = cu.units;
          const property = unit.properties;
          const address = addresses?.find(a => a.addressable_id === property.property_id) || {};
          
          // Fetch property contact info
          const contactInfo = await getPropertyContactInfo(property.property_id);

          return {
            lease_id: null,
            start_date: null,
            end_date: null,
            status: 'active', // Direct assignments are considered active
            monthly_rent: null,
            security_deposit: null,
            unit_number: unit.unit_number,
            beds: unit.beds,
            baths: unit.baths,
            square_footage: unit.square_footage,
            property_type: property.property_type,
            property_id: property.property_id,
            address_line_1: address.address_line_1,
            address_line_2: address.address_line_2,
            city: address.city,
            state: address.state_province_region,
            postal_code: address.postal_code,
            contact_info: contactInfo
          };
        }));

      // Combine and sort all properties
      const allProperties = [...leaseProperties, ...directUnitProperties].sort((a, b) => {
        // Sort by start_date descending, with nulls last
        const dateA = a.start_date ? new Date(a.start_date) : new Date(0);
        const dateB = b.start_date ? new Date(b.start_date) : new Date(0);
        return dateB - dateA;
      });

      setProperties(allProperties);
    } catch (error) {
      console.error('Error fetching properties:', error);
      setProperties([]);
    } finally {
      setIsLoading(false);
    }
  };

  const currentProperties = properties.filter(p => p.status === 'active' || p.status === 'future');
  const pastProperties = properties.filter(p => p.status === 'expired' || p.status === 'terminated');

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatAddress = (property) => {
    const parts = [
      property.address_line_1,
      property.address_line_2,
      property.city,
      property.state,
      property.postal_code
    ].filter(Boolean);
    return parts.join(', ') || 'Address not available';
  };

  if (isLoading) {
    return <div className="p-4">Loading properties...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">My Properties</h1>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex -mb-px space-x-8">
          <button
            onClick={() => setActiveTab('current')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'current'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Current ({currentProperties.length})
          </button>
          <button
            onClick={() => setActiveTab('past')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'past'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Past ({pastProperties.length})
          </button>
        </nav>
      </div>

      {/* Properties List */}
      {activeTab === 'current' ? (
        <div className="space-y-4">
          {currentProperties.length === 0 ? (
            <Card className="p-8 text-center text-gray-500">
              <Home className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p>You don't have any current properties.</p>
            </Card>
          ) : (
            currentProperties.map(property => (
              <PropertyCard key={property.lease_id} property={property} formatDate={formatDate} formatAddress={formatAddress} />
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {pastProperties.length === 0 ? (
            <Card className="p-8 text-center text-gray-500">
              <Home className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p>You don't have any past properties.</p>
            </Card>
          ) : (
            pastProperties.map(property => (
              <PropertyCard key={property.lease_id} property={property} formatDate={formatDate} formatAddress={formatAddress} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PropertyCard({ property, formatDate, formatAddress }) {
  const statusColors = {
    'active': 'bg-green-100 text-green-800',
    'future': 'bg-blue-100 text-blue-800',
    'expired': 'bg-gray-100 text-gray-800',
    'terminated': 'bg-red-100 text-red-800',
  };

  return (
    <Card className="bg-white hover:shadow-lg transition-shadow">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between">
        <div className="flex-1">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">
                {formatAddress(property)}
              </h3>
              <p className="text-sm text-gray-600 mt-1">Unit {property.unit_number}</p>
            </div>
            <span className={`px-3 py-1 text-xs font-medium rounded-full capitalize ${statusColors[property.status] || 'bg-gray-100 text-gray-800'}`}>
              {property.status}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
            <div className="flex items-center text-sm text-gray-600">
              <Home className="w-4 h-4 mr-2 text-gray-400" />
              <span>{property.beds} bed{property.beds !== 1 ? 's' : ''}, {property.baths} bath{property.baths !== 1 ? 's' : ''}</span>
            </div>
            {property.square_footage && (
              <div className="flex items-center text-sm text-gray-600">
                <span className="mr-2">📐</span>
                <span>{property.square_footage} sq ft</span>
              </div>
            )}
            <div className="flex items-center text-sm text-gray-600">
              <Calendar className="w-4 h-4 mr-2 text-gray-400" />
              <span>{formatDate(property.start_date)} - {property.end_date ? formatDate(property.end_date) : 'Ongoing'}</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <DollarSign className="w-4 h-4 mr-2 text-gray-400" />
              <span>${property.monthly_rent?.toLocaleString()}/month</span>
            </div>
          </div>

          {property.security_deposit && (
            <div className="text-sm text-gray-600">
              <span className="font-medium">Security Deposit:</span> ${property.security_deposit.toLocaleString()}
            </div>
          )}
          
          {property.contact_info && (
            <div className="pt-4 mt-4 border-t">
              <label className="block text-sm font-medium text-gray-700 mb-2">{property.contact_info.role}</label>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-900">{property.contact_info.name}</p>
                {property.contact_info.phone && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Phone size={16} className="mr-2 text-gray-400" />
                    <span>{property.contact_info.phone}</span>
                  </div>
                )}
                {property.contact_info.email && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Mail size={16} className="mr-2 text-gray-400" />
                    <span>{property.contact_info.email}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

