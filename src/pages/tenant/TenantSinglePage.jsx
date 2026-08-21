import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { Home, FileText, Wrench, LogOut, PlusCircle, Clock, CheckCircle, AlertCircle, Phone, X, User, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';
import MaintenanceChatBot from '../../components/MaintenanceChatBot';
import { getPropertyContactInfo } from '../../utils/propertyContactInfo.js';
import DocumentManagement from '../../components/DocumentManagement';
import DateInput from '../../components/DateInput';
import ContactMethodTypeInput from '../../components/ContactMethodTypeInput';
import { phones, phoneView } from '../../config/phones.js';
import { formatPlaceWithUnit, formatUnitQualifier } from '../../utils/unit-display.js';

// CreateRequestModal component (copied from TenantMaintenance.jsx)
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
        const { data: clientRecord } = await supabase
          .from('clients')
          .select('client_id')
          .eq('user_id', user.user_id)
          .maybeSingle();
        
        if (!clientRecord?.client_id) {
          setUnits([]);
          return;
        }

        const [leaseClientsResult, clientUnitsResult] = await Promise.all([
          supabase
            .from('lease_clients')
            .select(`leases!inner(unit_id, status)`)
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
          const { data: unitsData } = await supabase
            .from('units')
            .select(`unit_id, unit_number, properties!inner(property_id)`)
            .in('unit_id', allUnitIds);

          const propertyIds = [...new Set(unitsData?.map(u => u.properties?.property_id).filter(Boolean) || [])];
          const { data: addresses } = propertyIds.length > 0 ? await supabase
            .from('addresses')
            .select('*')
            .eq('addressable_type', 'property')
            .in('addressable_id', propertyIds) : { data: [] };

          const unitsWithAddresses = (unitsData || []).map(unit => {
            const address = addresses?.find(a => a.addressable_id === unit.properties?.property_id) || {};
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
      const { error: insertError } = await supabase
        .from('maintenance_requests')
        .insert([{
          unit_id: unitId,
          tenant_user_id: user.user_id,
          description,
          priority,
          status: 'New'
        }])
        .select()
        .single();
      
      if (insertError) {
        setError(insertError.message || 'Failed to create request.');
      } else {
        onUpdateSuccess();
        onClose();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={handleBackdropClick}>
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
                  {formatPlaceWithUnit(u.address, u.unit_number)}
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

export default function TenantSinglePage() {
  const { user, logout, resolvedPhones } = useContext(AuthContext);
  const maintenancePhone = phoneView(
    resolvedPhones?.tenant_maintenance?.e164 || phones.tenantMaintenanceE164
  );
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [properties, setProperties] = useState([]);
  const [leases, setLeases] = useState([]);
  const [applications, setApplications] = useState([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);
  const [isManualFormOpen, setIsManualFormOpen] = useState(false);
  const [unitId, setUnitId] = useState(null);
  const [reschedulingAppointment, setReschedulingAppointment] = useState(null);
  
  // Personal Information state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSubmittingProfile, setIsSubmittingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [contactMethods, setContactMethods] = useState([]);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [clientId, setClientId] = useState(null);
  const contactMethodInputRefs = useRef({});

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      const userId = user.user_id;

      // Get client_id from user_id
      const { data: clientRecord, error: clientError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (clientError || !clientRecord?.client_id) {
        console.error('Error fetching client:', clientError);
        setIsLoading(false);
        return;
      }

      setClientId(clientRecord.client_id);
      
      // Fetch unitId for maintenance chat (from active lease or client_units)
      const { data: activeLease } = await supabase
        .from('lease_clients')
        .select('leases!inner(unit_id, status)')
        .eq('client_id', clientRecord.client_id)
        .eq('leases.status', 'active')
        .limit(1)
        .maybeSingle();

      if (activeLease?.leases) {
        setUnitId(activeLease.leases.unit_id);
      } else {
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
      
      // Fetch tenant personal information
      const [contactResult, clientResult] = await Promise.all([
        supabase
          .from('contacts')
          .select('contact_id, first_name, middle_name, last_name')
          .eq('contactable_id', userId)
          .eq('contactable_type', 'client')
          .maybeSingle(),
        supabase
          .from('clients')
          .select('date_of_birth')
          .eq('client_id', clientRecord.client_id)
          .maybeSingle()
      ]);

      if (contactResult.data) {
        setFirstName(contactResult.data.first_name || '');
        setMiddleName(contactResult.data.middle_name || '');
        setLastName(contactResult.data.last_name || '');
        
        // Fetch contact methods for this contact
        const { data: contactMethodsData } = await supabase
          .from('contact_methods')
          .select('method_id, method_type, value')
          .eq('contact_id', contactResult.data.contact_id);
        
        if (contactMethodsData && contactMethodsData.length > 0) {
          const emailMethod = contactMethodsData.find(m => m.method_type?.toLowerCase() === 'email');
          if (emailMethod) {
            setEmail(emailMethod.value || user?.email || '');
          } else {
            setEmail(user?.email || '');
          }
          // Filter out email from contact methods (shown separately)
          const nonEmailMethods = contactMethodsData.filter(m => m.method_type?.toLowerCase() !== 'email');
          setContactMethods(nonEmailMethods.map(m => ({ ...m, tempId: m.method_id })));
        } else {
          setEmail(user?.email || '');
        }
      } else {
        setEmail(user?.email || '');
      }
      
      if (clientResult.data?.date_of_birth) {
        // Format date for input (YYYY-MM-DD) - parse directly from string to avoid timezone issues
        const dobStr = clientResult.data.date_of_birth;
        // If it's already in YYYY-MM-DD format, use it directly
        if (typeof dobStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dobStr)) {
          setDateOfBirth(dobStr.split('T')[0]); // Take only the date part if there's a time component
        } else {
          // If it's a Date object or other format, parse it carefully
          const dob = new Date(dobStr);
          // Use UTC methods to avoid timezone conversion
          const year = dob.getUTCFullYear();
          const month = String(dob.getUTCMonth() + 1).padStart(2, '0');
          const day = String(dob.getUTCDate()).padStart(2, '0');
          setDateOfBirth(`${year}-${month}-${day}`);
        }
      }

      // Fetch all data in parallel
      const [
        leasesResult,
        applicationsResult,
        maintenanceResult,
        clientUnitsResult
      ] = await Promise.all([
        // Leases
        supabase
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
          .eq('client_id', clientRecord.client_id),
        
        // Applications
        supabase
          .from('client_applications')
          .select(`
            application_id,
            status,
            applied_at,
            units!inner(
              unit_id,
              unit_number,
              properties!inner(
                property_id
              )
            )
          `)
          .eq('client_id', clientRecord.client_id)
          .order('applied_at', { ascending: false }),
        
        // Maintenance requests
        supabase
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
          .order('created_at', { ascending: false }),
        
        // Direct unit assignments
        supabase
          .from('client_units')
          .select('unit_id')
          .eq('client_id', clientRecord.client_id)
          .is('is_archived', false)
      ]);

      // Process leases
      const leaseClients = leasesResult.data || [];
      const propertyIds = [...new Set(leaseClients.map(lc => lc.leases?.units?.properties?.property_id).filter(Boolean))];
      
      // Fetch addresses
      const { data: addresses } = propertyIds.length > 0 ? await supabase
        .from('addresses')
        .select('*')
        .eq('addressable_type', 'property')
        .in('addressable_id', propertyIds) : { data: [] };

      // Process properties from leases
      const leaseProperties = await Promise.all((leaseClients || []).map(async (lc) => {
        const lease = lc.leases;
        const unit = lease.units;
        const property = unit.properties;
        const address = addresses?.find(a => a.addressable_id === property.property_id) || {};
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

      // Process direct unit assignments (client_units without leases)
      const clientUnits = clientUnitsResult.data || [];
      const clientUnitIds = [...new Set(clientUnits.map(cu => cu.unit_id).filter(Boolean))];
      const leaseUnitIds = [...new Set(leaseClients.map(lc => lc.leases?.units?.unit_id).filter(Boolean))];
      const directUnitIds = clientUnitIds.filter(id => !leaseUnitIds.includes(id));
      
      let directUnitProperties = [];
      if (directUnitIds.length > 0) {
        // Fetch units for direct assignments
        const { data: directUnitsData } = await supabase
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
          .in('unit_id', directUnitIds);
        
        if (directUnitsData && directUnitsData.length > 0) {
          const directPropertyIds = [...new Set(directUnitsData.map(u => u.properties?.property_id).filter(Boolean))];
          const { data: directAddresses } = directPropertyIds.length > 0 ? await supabase
            .from('addresses')
            .select('*')
            .eq('addressable_type', 'property')
            .in('addressable_id', directPropertyIds) : { data: [] };
          
          directUnitProperties = await Promise.all(directUnitsData.map(async (unit) => {
            const property = unit.properties;
            const address = directAddresses?.find(a => a.addressable_id === property.property_id) || {};
            const contactInfo = await getPropertyContactInfo(property.property_id);
            
            return {
              lease_id: null,
              start_date: null,
              end_date: null,
              status: 'active',
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
        }
      }

      setProperties([...leaseProperties, ...directUnitProperties]);
      setLeases(leaseProperties);
      setApplications(applicationsResult.data || []);
      setMaintenanceRequests(maintenanceResult.data || []);

      // Calculate stats - count all properties (both from leases and direct assignments)
      // For leases, count only active ones; for direct assignments, count all (they're all active)
      const activeLeaseProperties = leaseProperties.filter(p => p.status === 'active');
      const allProperties = [...activeLeaseProperties, ...directUnitProperties];
      const activeMaintenance = (maintenanceResult.data || []).filter(r => r.status !== 'Completed');
      
      setStats({
        currentLeases: allProperties.length,
        totalLeases: leaseProperties.length,
        pendingApplications: (applicationsResult.data || []).filter(a => a.status === 'pending').length,
        totalApplications: (applicationsResult.data || []).length,
        activeMaintenance: activeMaintenance.length,
        totalMaintenance: (maintenanceResult.data || []).length,
      });

    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchAllData();
    }
  }, [user, fetchAllData]);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    // If it's already in YYYY-MM-DD format, parse it directly to avoid timezone issues
    if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateString)) {
      const [year, month, day] = dateString.split('T')[0].split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
    // Otherwise, use the date as-is
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatAddress = (item) => {
    const parts = [
      item.address_line_1,
      item.address_line_2,
      item.city,
      item.state,
      item.postal_code
    ].filter(Boolean);
    return parts.join(', ') || 'Address not available';
  };

  const formatUserName = () => {
    if (!user) return '';
    const first = user.first_name || '';
    const last = user.last_name || '';
    const middle = user.middle_name ? (user.middle_name.length === 1 ? ` ${user.middle_name}.` : ` ${user.middle_name}`) : '';
    return `${first}${middle} ${last}`.replace(/\s+/g, ' ').trim() || user.email;
  };

  const formatNameWithMiddleInitial = (first, middle, last) => {
    const middleInitial = middle ? (middle.length === 1 ? ` ${middle}.` : ` ${middle}`) : '';
    return `${first}${middleInitial} ${last}`.replace(/\s+/g, ' ').trim();
  };

  // Contact methods handlers
  const handleMethodChange = (methodId, field, value) => {
    setContactMethods(prevMethods => 
      prevMethods.map(m => {
        if (m.method_id === methodId || m.tempId === methodId) {
          return { ...m, [field]: value };
        }
        return m;
      })
    );
  };

  const addMethod = () => {
    const newTempId = Date.now();
    setContactMethods([...contactMethods, { method_type: '', value: '', tempId: newTempId }]);
    setTimeout(() => {
      const input = contactMethodInputRefs.current[newTempId];
      if (input) input.focus();
    }, 0);
  };

  const removeMethod = (methodId) => {
    setContactMethods(contactMethods.filter(m => m.method_id !== methodId && m.tempId !== methodId));
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setIsSubmittingProfile(true);
    setProfileError('');
    setProfileSuccess('');

    if (newPassword && newPassword !== confirmPassword) {
      setProfileError('New password and confirmation do not match.');
      setIsSubmittingProfile(false);
      return;
    }

    try {
      // Update user email and password if changed
      if (user?.email !== email || newPassword) {
        const userUpdatePayload = { email: email.toLowerCase() };
        if (newPassword) {
          const bcrypt = await import('bcryptjs');
          const salt = await bcrypt.genSalt(10);
          userUpdatePayload.password_hash = await bcrypt.hash(newPassword, salt);
        }
        const { error: userUpdateError } = await supabase
          .from('users')
          .update(userUpdatePayload)
          .eq('user_id', user.user_id);

        if (userUpdateError) {
          setProfileError(userUpdateError.message || 'Failed to update user account.');
          setIsSubmittingProfile(false);
          return;
        }
      }

      if (!clientId) {
        setProfileError('Client record not found.');
        setIsSubmittingProfile(false);
        return;
      }

      // Update contact record
      const { error: contactError } = await supabase
        .from('contacts')
        .update({
          first_name: firstName.trim() || null,
          middle_name: middleName.trim() || null,
          last_name: lastName.trim() || null
        })
        .eq('contactable_id', userId)
        .eq('contactable_type', 'client');

      if (contactError) {
        setProfileError(contactError.message || 'Failed to update contact record.');
        setIsSubmittingProfile(false);
        return;
      }

      // Update client date of birth
      if (dateOfBirth) {
        const { error: clientUpdateError } = await supabase
          .from('clients')
          .update({ date_of_birth: dateOfBirth })
          .eq('client_id', clientId);

        if (clientUpdateError) {
          console.error('Error updating date of birth:', clientUpdateError);
        }
      }

      // Update contact methods
      const { data: contactData } = await supabase
        .from('contacts')
        .select('contact_id')
        .eq('contactable_id', userId)
        .eq('contactable_type', 'client')
        .maybeSingle();

      if (contactData) {
        // Delete existing contact methods (excluding email)
        await supabase
          .from('contact_methods')
          .delete()
          .eq('contact_id', contactData.contact_id)
          .neq('method_type', 'email');

        // Insert email contact method
        const emailMethod = {
          contact_id: contactData.contact_id,
          method_type: 'email',
          value: email.toLowerCase()
        };
        await supabase
          .from('contact_methods')
          .upsert(emailMethod, { onConflict: 'contact_id,method_type' });

        // Insert other contact methods
        const validContactMethods = contactMethods
          .filter(m => m.method_type && m.value && m.method_type.toLowerCase() !== 'email');
        
        if (validContactMethods.length > 0) {
          const methodsToInsert = validContactMethods.map(m => ({
            contact_id: contactData.contact_id,
            method_type: m.method_type,
            value: m.value
          }));
          
          const { error: methodsInsertError } = await supabase
            .from('contact_methods')
            .insert(methodsToInsert);
          
          if (methodsInsertError) {
            console.error('Error inserting contact methods:', methodsInsertError);
          }
        }
      }

      setProfileSuccess('Profile updated successfully!');
      setIsEditingProfile(false);
      setNewPassword('');
      setConfirmPassword('');
      
      // Refresh data
      fetchAllData();
    } catch (error) {
      console.error('Error updating profile:', error);
      setProfileError('An unexpected error occurred while updating your profile.');
    } finally {
      setIsSubmittingProfile(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Home className="w-8 h-8 text-indigo-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">My Portal</h1>
                <p className="text-sm text-gray-600">Welcome back, {formatUserName()}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Personal Information Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <User className="w-5 h-5" />
              Personal Information
            </h2>
              {!isEditingProfile && (
                <button
                  onClick={() => setIsEditingProfile(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100"
                >
                  <Pencil size={16} />
                  Edit
                </button>
              )}
            </div>
            
            {profileError && (
              <div className="mb-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                {profileError}
              </div>
            )}
            {profileSuccess && (
              <div className="mb-4 p-3 text-sm text-green-700 bg-green-100 border border-green-400 rounded-md">
                {profileSuccess}
              </div>
            )}

            <Card className="bg-white">
              {!isEditingProfile ? (
                <div className="space-y-4">
                  {/* Basic Personal Information on one line */}
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Name:</span>{' '}
                      <span className="text-gray-900">{formatNameWithMiddleInitial(firstName, middleName, lastName) || 'Not set'}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Email:</span>{' '}
                      <span className="text-gray-900">{email || 'Not set'}</span>
                    </div>
                    {dateOfBirth && (
                      <div>
                        <span className="font-medium text-gray-700">Date of Birth:</span>{' '}
                        <span className="text-gray-900">{formatDate(dateOfBirth)}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Contact Methods on same line */}
                  {contactMethods.filter(m => m.method_type?.toLowerCase() !== 'email').length > 0 && (
                    <div className="pt-2 border-t flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-gray-700">Contact Methods:</span>
                      {contactMethods.filter(m => m.method_type?.toLowerCase() !== 'email').map((method, idx) => (
                        <span key={method.method_id || idx} className="text-gray-900">
                          <span className="font-medium capitalize">{method.method_type}:</span> {method.value}
                          {idx < contactMethods.filter(m => m.method_type?.toLowerCase() !== 'email').length - 1 && <span className="text-gray-500 mx-1">•</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleProfileUpdate} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">First Name</label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Middle Name</label>
                      <input
                        type="text"
                        value={middleName}
                        onChange={(e) => setMiddleName(e.target.value)}
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Last Name</label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                      required
                    />
                  </div>

                  <div>
                    <DateInput
                      label="Date of Birth"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value || null)}
                    />
                  </div>

                  <div className="pt-4 border-t">
                    <h4 className="text-sm font-medium text-gray-800 mb-2">Contact Methods</h4>
                    {contactMethods.filter(m => m.method_type?.toLowerCase() !== 'email').map((method) => (
                      <div key={method.method_id || method.tempId} className="flex gap-2 mb-2 items-center">
                        <ContactMethodTypeInput
                          value={method.method_type || ''} 
                          onChange={value => handleMethodChange(method.method_id || method.tempId, 'method_type', value)} 
                          className="w-1/3 block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" 
                        />
                        <input 
                          type="text" 
                          value={method.value} 
                          onChange={e => handleMethodChange(method.method_id || method.tempId, 'value', e.target.value)} 
                          placeholder="Value"
                          autoComplete="tel"
                          name="contact-method-value"
                          className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                        <button type="button" onClick={() => removeMethod(method.method_id || method.tempId)} className="p-2 text-red-500 hover:text-red-700">
                          <Trash2 size={16}/>
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addMethod} className="flex items-center px-3 py-2 mt-2 text-sm font-medium text-indigo-600 border border-indigo-300 rounded-md shadow-sm hover:bg-indigo-50">
                      <PlusCircle size={16} className="mr-2"/> Add Contact Method
                    </button>
                  </div>

                  <div className="pt-4 border-t">
                    <p className="text-sm font-medium text-gray-700 mb-2">Change Password (Optional)</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">New Password</label>
                        <input 
                          type="password" 
                          value={newPassword} 
                          onChange={(e) => setNewPassword(e.target.value)} 
                          autoComplete="new-password" 
                          className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
                        <input 
                          type="password" 
                          value={confirmPassword} 
                          onChange={(e) => setConfirmPassword(e.target.value)} 
                          autoComplete="new-password" 
                          className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-4 pt-4 border-t">
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingProfile(false);
                        setProfileError('');
                        setProfileSuccess('');
                        setNewPassword('');
                        setConfirmPassword('');
                        // Reload data
                        fetchAllData();
                      }}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingProfile}
                      className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {isSubmittingProfile ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              )}
            </Card>
          </section>

          {/* Properties Section */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Home className="w-5 h-5" />
              My Properties
            </h2>
            {properties.length === 0 ? (
              <Card className="p-8 text-center text-gray-500">
                <Home className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>You don't have any properties yet.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {properties.slice(0, 3).map((property, idx) => (
                  <Card key={property.lease_id || `direct-${property.property_id}-${property.unit_number}-${idx}`} className="bg-white hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-base font-semibold text-gray-900 truncate">{formatAddress(property)}</h3>
                          {formatUnitQualifier(property) ? (
                          <span className="text-sm text-gray-600">{formatUnitQualifier(property)}</span>
                          ) : null}
                          <span className="text-sm text-gray-600">{property.beds} bed{property.beds !== 1 ? 's' : ''}, {property.baths} bath{property.baths !== 1 ? 's' : ''}</span>
                          {property.monthly_rent && <span className="text-sm font-medium text-gray-900">${property.monthly_rent.toLocaleString()}/month</span>}
                        </div>
                        {property.contact_info && (
                          <div className="mt-2 flex items-center gap-3 text-sm text-gray-600">
                            <span className="font-medium">{property.contact_info.role}:</span>
                            <span>{property.contact_info.name}</span>
                            {property.contact_info.phone && (
                              <>
                                <span>•</span>
                                <div className="flex items-center">
                                  <Phone size={12} className="mr-1" />
                                  {property.contact_info.phone}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize whitespace-nowrap ml-2 ${
                        property.status === 'active' ? 'bg-green-100 text-green-800' :
                        property.status === 'future' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {property.status}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Documents Section */}
          {properties.length > 0 && properties[0]?.lease_id && (
            <section>
              <h2 className="text-xl font-bold text-gray-800 mb-4">Documents</h2>
              <Card className="bg-white">
                <DocumentManagement
                  leaseId={properties[0].lease_id}
                  userRole="tenant"
                  userId={user?.user_id || null}
                />
              </Card>
            </section>
          )}

          {/* Maintenance Section */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Wrench className="w-5 h-5" />
              Maintenance Requests
            </h2>
            
            {maintenanceRequests.length === 0 ? (
              <Card className="p-8 text-center text-gray-500 mb-6">
                <Wrench className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>You don't have any maintenance requests yet.</p>
              </Card>
            ) : (
              <div className="space-y-4 mb-6">
                {maintenanceRequests.slice(0, 5).map(request => {
                  const statusConfig = {
                    'New': { icon: <Clock className="w-4 h-4" />, color: 'bg-blue-100 text-blue-800' },
                    'In Progress': { icon: <AlertCircle className="w-4 h-4" />, color: 'bg-yellow-100 text-yellow-800' },
                    'Completed': { icon: <CheckCircle className="w-4 h-4" />, color: 'bg-green-100 text-green-800' },
                  }[request.status] || { icon: <Clock className="w-4 h-4" />, color: 'bg-gray-100 text-gray-800' };

                  return (
                    <Card key={request.request_id} className="bg-white hover:shadow-lg transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm text-gray-600 mb-1">{formatUnitQualifier(request.units)}</p>
                          <p className="text-sm font-medium text-gray-900 mb-2">{request.description}</p>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>{formatDate(request.created_at)}</span>
                            <span className={`px-2 py-1 rounded-full ${request.priority === 'Urgent' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                              {request.priority}
                            </span>
                          </div>
                        </div>
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${statusConfig.color}`}>
                          {statusConfig.icon}
                          {request.status}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Three Options for Requesting Help */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Voice Bot Phone Number */}
              {maintenancePhone.telHref && (
              <Card className="bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-200">
                <div className="flex flex-col items-center text-center p-3">
                  <div className="flex items-center justify-center w-10 h-10 bg-indigo-100 rounded-full mb-2">
                    <Phone className="w-5 h-5 text-indigo-600" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">Call Voice Bot</h3>
                  <p className="text-xs text-gray-600 mb-2">
                    Speak with our AI assistant 24/7
                  </p>
                  <a 
                    href={maintenancePhone.telHref} 
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    {maintenancePhone.display}
                  </a>
                </div>
              </Card>
              )}

              {/* Chat Bot Button */}
              <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
                <div className="flex flex-col items-center text-center p-3">
                  <div className="flex items-center justify-center w-10 h-10 bg-green-100 rounded-full mb-2">
                    <Wrench className="w-5 h-5 text-green-600" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">Chat with AI</h3>
                  <p className="text-xs text-gray-600 mb-2">
                    Get help through text chat
                  </p>
                  <button
                    onClick={() => setIsMaintenanceModalOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors"
                  >
                    <Wrench className="w-4 h-4" />
                    Start Chat
                  </button>
                </div>
              </Card>

              {/* Manual Form Button */}
              <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
                <div className="flex flex-col items-center text-center p-3">
                  <div className="flex items-center justify-center w-10 h-10 bg-purple-100 rounded-full mb-2">
                    <PlusCircle className="w-5 h-5 text-purple-600" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">Manual Form</h3>
                  <p className="text-xs text-gray-600 mb-2">
                    Submit a request directly
                  </p>
                  <button
                    onClick={() => setIsManualFormOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Create Request
                  </button>
                </div>
              </Card>
            </div>
          </section>

          {/* Appointments Section */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Repair Appointments
            </h2>
            {appointments.length === 0 ? (
              <Card className="p-8 text-center text-gray-500">
                <Clock className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>You don't have any scheduled appointments yet.</p>
                <p className="text-sm mt-2">Appointments will appear here once a vendor is assigned to your maintenance request.</p>
              </Card>
            ) : (
              <div className="space-y-4">
                {appointments.map(appointment => {
                  const scheduledDate = appointment.scheduled_date_time 
                    ? new Date(appointment.scheduled_date_time).toLocaleString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      })
                    : 'Not scheduled';
                  
                  const statusConfig = {
                    'scheduled': { color: 'bg-blue-100 text-blue-800', label: 'Scheduled' },
                    'completed': { color: 'bg-green-100 text-green-800', label: 'Completed' },
                    'cancelled': { color: 'bg-red-100 text-red-800', label: 'Cancelled' },
                    'in_progress': { color: 'bg-yellow-100 text-yellow-800', label: 'In Progress' },
                    'no_show': { color: 'bg-orange-100 text-orange-800', label: 'No Show' },
                    'rescheduled': { color: 'bg-purple-100 text-purple-800', label: 'Rescheduled' },
                  }[appointment.status] || { color: 'bg-gray-100 text-gray-800', label: appointment.status };

                  return (
                    <Card key={appointment.appointment_id} className="bg-white hover:shadow-lg transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {appointment.vendors?.company_name || 'Unknown Vendor'}
                          </h3>
                          <p className="text-sm text-gray-600 mb-2">{appointment.maintenance_requests?.description}</p>
                          <div className="flex items-center gap-4 text-sm text-gray-500 mb-2">
                            <div className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              <span>{scheduledDate}</span>
                            </div>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusConfig.color}`}>
                              {statusConfig.label}
                            </span>
                          </div>
                          {appointment.notes && (
                            <p className="text-xs text-gray-500 mt-2">{appointment.notes}</p>
                          )}
                        </div>
                        {appointment.status === 'scheduled' && (
                          <button
                            onClick={() => setReschedulingAppointment(appointment)}
                            className="ml-4 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100"
                          >
                            Reschedule
                          </button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* Applications Section */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              My Applications
            </h2>
            {applications.length === 0 ? (
              <Card className="p-8 text-center text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>You don't have any applications yet.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {applications.slice(0, 3).map(application => (
                  <Card key={application.application_id} className="bg-white hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-600">{formatUnitQualifier(application.units)}</span>
                        <span className="text-sm text-gray-500">•</span>
                        <span className="text-sm text-gray-500">{formatDate(application.applied_at)}</span>
                      </div>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize whitespace-nowrap ${
                        application.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        application.status === 'approved' ? 'bg-green-100 text-green-800' :
                        application.status === 'rejected' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {application.status}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Leases Section */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              My Leases
            </h2>
            {leases.length === 0 ? (
              <Card className="p-8 text-center text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>You don't have any leases yet.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {leases.slice(0, 3).map(lease => (
                  <Card key={lease.lease_id} className="bg-white hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-wrap min-w-0">
                        <span className="text-sm font-medium text-gray-900 truncate">{formatAddress(lease)}</span>
                        <span className="text-sm text-gray-600">{formatUnitQualifier(lease)}</span>
                        {lease.monthly_rent && (
                          <>
                            <span className="text-sm text-gray-500">•</span>
                            <span className="text-sm font-medium text-gray-900">${lease.monthly_rent.toLocaleString()}/month</span>
                          </>
                        )}
                        {lease.start_date && (
                          <>
                            <span className="text-sm text-gray-500">•</span>
                            <span className="text-sm text-gray-600">{formatDate(lease.start_date)} - {lease.end_date ? formatDate(lease.end_date) : 'Ongoing'}</span>
                          </>
                        )}
                      </div>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize whitespace-nowrap ml-2 ${
                        lease.status === 'active' ? 'bg-green-100 text-green-800' :
                        lease.status === 'future' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {lease.status}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Chat Bot Modal */}
      {isMaintenanceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800">Chat with Maintenance Assistant</h2>
                <button
                  onClick={() => setIsMaintenanceModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>
              <MaintenanceChatBot 
                user={user}
                unitId={unitId}
                initialOpen={true}
                inline={true}
                onRequestCreated={() => {
                  setIsMaintenanceModalOpen(false);
                  fetchAllData();
                }} 
              />
            </div>
          </div>
        </div>
      )}

      {/* Manual Form Modal */}
      {isManualFormOpen && user && (
        <CreateRequestModal 
          user={user}
          onClose={() => setIsManualFormOpen(false)} 
          onUpdateSuccess={() => {
            setIsManualFormOpen(false);
            fetchAllData();
          }} 
        />
      )}

      {/* Reschedule Appointment Modal */}
      {reschedulingAppointment && (
        <RescheduleAppointmentModal
          appointment={reschedulingAppointment}
          onClose={() => setReschedulingAppointment(null)}
          onSuccess={() => {
            setReschedulingAppointment(null);
            fetchAllData();
          }}
        />
      )}
    </div>
  );
}

const RescheduleAppointmentModal = ({ appointment, onClose, onSuccess }) => {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/maintenance-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `I want to reschedule appointment ${appointment.appointment_id}. ${reason ? `Reason: ${reason}` : ''}`
            }
          ],
          userId: appointment.maintenance_requests?.tenant_user_id || null,
          unitId: null,
          email: null,
          conversationId: null
        })
      });

      const data = await response.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        // Also update the appointment status directly
        const { supabase } = await import('../../lib/supabase.js');
        await supabase
          .from('client_appointments')
          .update({ 
            status: 'rescheduled',
            notes: reason ? `Rescheduling requested: ${reason}` : 'Rescheduling requested by tenant',
            updated_at: new Date().toISOString()
          })
          .eq('appointment_id', appointment.appointment_id);
        
        onSuccess();
      }
    } catch (err) {
      console.error('Error rescheduling appointment:', err);
      setError('Failed to reschedule appointment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const scheduledDate = appointment.scheduled_date_time 
    ? new Date(appointment.scheduled_date_time).toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    : 'Not scheduled';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800">Reschedule Appointment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>
        
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            <strong>Vendor:</strong> {appointment.vendors?.company_name || 'Unknown'}
          </p>
          <p className="text-sm text-gray-600 mb-2">
            <strong>Current Date/Time:</strong> {scheduledDate}
          </p>
          <p className="text-sm text-gray-600">
            <strong>Issue:</strong> {appointment.maintenance_requests?.description}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for Rescheduling (Optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              rows="3"
              placeholder="e.g., I have a conflict, need a different time..."
            />
          </div>

          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Processing...' : 'Request Reschedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

