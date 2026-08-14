import React, { useState, useEffect, useContext } from 'react';
import { Home, PlusCircle, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';

export default function AvailableProperties() {
  const { user } = useContext(AuthContext);
  const [properties, setProperties] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [applicationSuccess, setApplicationSuccess] = useState('');

  useEffect(() => {
    if (user) {
      fetchAvailableProperties();
    }
  }, [user]);

  const fetchAvailableProperties = async () => {
    setIsLoading(true);
    try {
      // Find applicant record by email
      const { data: applicantRecord, error: applicantError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.user_id)
        .maybeSingle();

      if (applicantError && applicantError.code !== 'PGRST116') {
        console.error('Error fetching applicant record:', applicantError);
      }

      if (!applicantRecord) {
        // No applicant record found - user hasn't applied yet
        setProperties([]);
        setIsLoading(false);
        return;
      }

      // Fetch all units, leases, and existing applications
      const [unitsResult, leasesResult, applicationsResult, addressesResult] = await Promise.all([
        supabase.from('units').select(`
          unit_id,
          unit_number,
          beds,
          baths,
          square_footage,
          properties!inner(
            property_id,
            property_type
          )
        `),
        supabase.from('leases').select('unit_id').in('status', ['active', 'future']),
        supabase.from('client_applications')
          .select('unit_id')
          .eq('client_id', applicantRecord.client_id),
        supabase.from('addresses').select('*').eq('addressable_type', 'property')
      ]);

      if (unitsResult.error) {
        console.error('Error fetching units:', unitsResult.error);
        setProperties([]);
      } else {
        const units = unitsResult.data || [];
        const leasedUnitIds = new Set((leasesResult.data || []).map(l => l.unit_id));
        const appliedUnitIds = new Set((applicationsResult.data || []).map(a => a.unit_id));
        const addresses = addressesResult.data || [];

        // Filter available units (not leased and not already applied for)
        const availableUnits = units.filter(
          u => !leasedUnitIds.has(u.unit_id) && !appliedUnitIds.has(u.unit_id)
        );

        // Group by property and add addresses
        const propertiesMap = new Map();
        availableUnits.forEach(unit => {
          const propertyId = unit.properties.property_id;
          const address = addresses.find(a => a.addressable_id === propertyId);
          
          if (!propertiesMap.has(propertyId)) {
            propertiesMap.set(propertyId, {
              property_id: propertyId,
              property_type: unit.properties.property_type,
              address: address || {},
              units: []
            });
          }
          
          propertiesMap.get(propertyId).units.push({
            unit_id: unit.unit_id,
            unit_number: unit.unit_number,
            beds: unit.beds,
            baths: unit.baths,
            square_footage: unit.square_footage,
          });
        });

        setProperties(Array.from(propertiesMap.values()));
      }
    } catch (error) {
      console.error('Error fetching available properties:', error);
      setProperties([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async (unitId) => {
    setIsApplying(true);
    try {
      // Find applicant record
      const { data: applicantRecord } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.user_id)
        .maybeSingle();

      if (!applicantRecord) {
        setApplicationError('Applicant record not found. Please contact support.');
        setIsApplying(false);
        return;
      }

      setApplicationError('');
      setApplicationSuccess('');

      // Create application
      const { error } = await supabase
        .from('client_applications')
        .insert([{
          client_id: applicantRecord.client_id,
          unit_id: unitId,
          status: 'pending'
        }]);

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          setApplicationError('You have already applied for this unit.');
        } else {
          setApplicationError('Failed to submit application: ' + error.message);
        }
      } else {
        setApplicationSuccess('Application submitted successfully!');
        setSelectedProperty(null);
        fetchAvailableProperties(); // Refresh the list
        setTimeout(() => setApplicationSuccess(''), 3000);
      }
    } catch (error) {
      console.error('Error submitting application:', error);
      setApplicationError('Failed to submit application. Please try again.');
    } finally {
      setIsApplying(false);
    }
  };

  const formatAddress = (property) => {
    const parts = [
      property.address.address_line_1,
      property.address.address_line_2,
      property.address.city,
      property.address.state_province_region,
      property.address.postal_code
    ].filter(Boolean);
    return parts.join(', ') || 'Address not available';
  };

  const filteredProperties = properties.filter(property => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    const addressStr = formatAddress(property).toLowerCase();
    const propertyType = property.property_type?.toLowerCase() || '';
    return addressStr.includes(searchLower) || propertyType.includes(searchLower);
  });

  if (isLoading) {
    return <div className="p-4">Loading available properties...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-800">Available Properties</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search properties..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {applicationError && (
        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
          {applicationError}
          <button
            onClick={() => setApplicationError('')}
            className="ml-2 text-red-600 hover:text-red-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}
      
      {applicationSuccess && (
        <div className="p-3 text-sm text-green-700 bg-green-100 border border-green-400 rounded-md">
          {applicationSuccess}
        </div>
      )}

      {filteredProperties.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">
          <Home className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>{searchTerm ? 'No properties match your search.' : 'No available properties at this time.'}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredProperties.map(property => (
            <Card key={property.property_id} className="bg-white hover:shadow-lg transition-shadow">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    {formatAddress(property)}
                  </h3>
                  <p className="text-sm text-gray-600 mb-4 capitalize">{property.property_type}</p>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">Available Units:</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {property.units.map(unit => (
                        <div key={unit.unit_id} className="p-3 bg-gray-50 rounded-md border border-gray-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-gray-900">Unit {unit.unit_number}</span>
                            <button
                              onClick={() => handleApply(unit.unit_id)}
                              disabled={isApplying}
                              className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                            >
                              <PlusCircle size={14} />
                              Apply
                            </button>
                          </div>
                          <div className="text-xs text-gray-600">
                            {unit.beds} bed{unit.beds !== 1 ? 's' : ''}, {unit.baths} bath{unit.baths !== 1 ? 's' : ''}
                            {unit.square_footage && ` • ${unit.square_footage} sq ft`}
                          </div>
                        </div>
                      ))}
                    </div>
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

