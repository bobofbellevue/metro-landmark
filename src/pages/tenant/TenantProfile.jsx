import React, { useState, useContext, useEffect, useRef } from 'react';
import { Card } from '../../components/ui';
import { AuthContext } from '../../contexts';
import { supabase } from '../../lib/supabase';
import { PlusCircle, Trash2, Phone, Mail } from 'lucide-react';
import { getPropertyContactInfo } from '../../utils/propertyContactInfo.js';
import ContactMethodTypeInput from '../../components/ContactMethodTypeInput';

// Helper function to format phone numbers to (999) 999-9999 format
const formatPhoneNumber = (phone) => {
  if (!phone) return phone;
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  // If it's exactly 10 digits, format as (999) 999-9999
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // Otherwise return original
  return phone;
};

export default function TenantProfile() {
  const { user } = useContext(AuthContext);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [contactMethods, setContactMethods] = useState([]);
  const contactMethodInputRefs = useRef({});
  
  // Form state
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [middleName, setMiddleName] = useState(user?.middle_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [propertyContactInfo, setPropertyContactInfo] = useState(null);

  // Contact methods handlers
  const handleMethodChange = (methodId, field, value) => {
    setContactMethods(prevMethods => 
      prevMethods.map(m => {
        if (m.method_id === methodId) {
          return { ...m, [field]: value };
        }
        if (m.tempId === methodId) {
          return { ...m, [field]: value };
        }
        return m;
      })
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

  const removeMethod = (methodId) => {
    setContactMethods(contactMethods.filter(m => m.method_id !== methodId && m.tempId !== methodId));
  };

  // Fetch user contact information and contact methods
  useEffect(() => {
    const fetchUserData = async () => {
      if (user?.user_id) {
        try {
          // First get client_id from user_id
          const { data: clientData, error: clientError } = await supabase
            .from('clients')
            .select('client_id')
            .eq('user_id', user.user_id)
            .maybeSingle();
          
          if (clientError) {
            console.error('Error fetching client record:', clientError);
            return;
          }
          
          if (!clientData?.client_id) {
            console.error('Client record not found for user');
            return;
          }
          
          const [contactResult, methodsResult, clientResult] = await Promise.all([
            supabase
              .from('contacts')
              .select('first_name, middle_name, last_name')
              .eq('contactable_id', user.user_id)
              .eq('contactable_type', 'client')
              .maybeSingle(),
            supabase
              .from('contact_methods')
              .select('method_id, method_type, value, contacts!inner(contactable_id, contactable_type)')
              .eq('contacts.contactable_id', user.user_id)
              .eq('contacts.contactable_type', 'client'),
            supabase
              .from('clients')
              .select('date_of_birth')
              .eq('client_id', clientData.client_id)
              .maybeSingle()
          ]);

          if (contactResult.error) {
            console.error('Error fetching contact:', contactResult.error);
          }

          if (contactResult.data) {
            setFirstName(contactResult.data.first_name || '');
            setMiddleName(contactResult.data.middle_name || '');
            setLastName(contactResult.data.last_name || '');
          } else {
            // Contact doesn't exist - try to create it with empty values
            console.warn('Contact record not found for tenant, creating one...');
            const { error: createError } = await supabase
              .from('contacts')
              .insert([{
                contactable_id: user.user_id,
                contactable_type: 'client',
                first_name: null,
                middle_name: null,
                last_name: null
              }]);
            
            if (createError) {
              console.error('Error creating contact:', createError);
            }
          }

          if (methodsResult.data && !methodsResult.error) {
            // Add tempId to existing methods for editing
            setContactMethods((methodsResult.data || []).map(m => ({ ...m, tempId: m.method_id })));
          }

          if (clientResult.data && !clientResult.error && clientResult.data.date_of_birth) {
            setDateOfBirth(clientResult.data.date_of_birth);
          }

          // Fetch current address from assigned unit based on current date
          // The assignment (client_units) controls - leases are optional
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of today for date comparison
          const { data: clientUnitsData, error: clientUnitsError } = await supabase
            .from('client_units')
            .select('unit_id, start_date, end_date, assigned_at, vacated_at')
            .eq('client_id', clientData.client_id)
            .is('is_archived', false)
            .order('assigned_at', { ascending: false });

          if (clientUnitsError) {
            console.error('Error fetching client_units:', clientUnitsError);
          }


          // Find the currently active assignment using start_date and end_date
          // Active if: (start_date IS NULL OR start_date <= today) AND (end_date IS NULL OR end_date >= today)
          // Fallback to assigned_at/vacated_at for legacy data
          let activeAssignment = clientUnitsData?.find(cu => {
            // Prefer start_date/end_date if available
            if (cu.start_date !== null || cu.end_date !== null) {
              const startDate = cu.start_date ? new Date(cu.start_date) : null;
              const endDate = cu.end_date ? new Date(cu.end_date) : null;
              const isStarted = !startDate || startDate <= today;
              const isNotEnded = !endDate || endDate >= today;
              return isStarted && isNotEnded;
            } else {
              // Fallback to assigned_at/vacated_at for legacy data
              const assignedAt = cu.assigned_at ? new Date(cu.assigned_at) : null;
              const vacatedAt = cu.vacated_at ? new Date(cu.vacated_at) : null;
              // If assigned_at is null, consider it active (legacy data)
              const isAssigned = !assignedAt || assignedAt <= now;
              const isNotVacated = !vacatedAt || vacatedAt > now;
              return isAssigned && isNotVacated;
            }
          });

          // Fallback: if no active assignment found, use the most recent one
          if (!activeAssignment && clientUnitsData && clientUnitsData.length > 0) {
            activeAssignment = clientUnitsData[0];
          }

          if (activeAssignment?.unit_id) {
            // Fetch unit details with property information
            const { data: unitData, error: unitError } = await supabase
              .from('units')
              .select(`
                unit_id,
                properties!inner(
                  property_id
                )
              `)
              .eq('unit_id', activeAssignment.unit_id)
              .maybeSingle();

            if (unitError) {
              console.error('Error fetching unit:', unitError);
            }

            if (unitData?.properties?.property_id) {
              const propertyId = unitData.properties.property_id;
              
              // Fetch property contact info (Manager/PM Company/Owner)
              const contactInfo = await getPropertyContactInfo(propertyId);
              setPropertyContactInfo(contactInfo);
              
              const { data: addressData, error: addressError } = await supabase
                .from('addresses')
                .select('*')
                .eq('addressable_id', propertyId)
                .eq('addressable_type', 'property')
                .maybeSingle();

              if (addressError) {
                console.error('Error fetching address:', addressError);
              }

              if (addressData) {
                const addressParts = [
                  addressData.address_line_1,
                  addressData.address_line_2,
                  addressData.city,
                  addressData.state_province_region,
                  addressData.postal_code
                ].filter(Boolean);
                const formattedAddress = addressParts.join(', ');
                setCurrentAddress(formattedAddress);
              } else {
                setCurrentAddress('');
              }
            } else {
              setCurrentAddress('');
            }
          } else {
            setCurrentAddress('');
          }
        } catch (err) {
          console.error('Error fetching user data:', err);
        }
      }
    };

    fetchUserData();
  }, [user?.user_id]);

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      if (newPassword && newPassword !== confirmPassword) {
        setError('New passwords do not match.');
        setIsSubmitting(false);
        return;
      }

      // Update user account
      const updateData = { email };
      if (newPassword) {
        // Note: Password hashing should be done server-side in production
        // For now, we'll update via API if available
        const response = await fetch('/api/update-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user.user_id, newPassword })
        });
        if (!response.ok) {
          throw new Error('Failed to update password');
        }
      }

      const { updateWithAudit, insertWithAudit, deleteWithAudit } = await import('../../lib/auditHelpers.js');
      
      const { error: userError } = await updateWithAudit(
        'users',
        updateData,
        'user_id',
        user.user_id,
        user.user_id
      );
      
      if (userError) {
        setError(userError.message || 'Failed to update user account.');
        setIsSubmitting(false);
        return;
      }
      
      // Get client_id from user_id
      const { data: clientData, error: clientDataError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.user_id)
        .maybeSingle();
      
      if (clientDataError) {
        console.error('TenantProfile (update): Error fetching client:', clientDataError);
      }
      
      if (!clientData?.client_id) {
        setError('Client record not found.');
        setIsSubmitting(false);
        return;
      }
      
      // Get contact_id for updating contact record
      const { data: contactData } = await supabase
        .from('contacts')
        .select('contact_id')
        .eq('contactable_id', user.user_id)
        .eq('contactable_type', 'client')
        .maybeSingle();
      
      if (contactData?.contact_id) {
        // Update contact record using audit helper
        const { error: contactError } = await updateWithAudit(
          'contacts',
          {
            first_name: firstName,
            middle_name: middleName,
            last_name: lastName
          },
          'contact_id',
          contactData.contact_id,
          user.user_id
        );
        
        if (contactError) {
          setError(contactError.message || 'Failed to update contact record.');
          setIsSubmitting(false);
          return;
        }
        
        // Update contact methods
        const validContactMethods = contactMethods.filter(m => m.method_type?.toLowerCase() !== 'email' && m.method_type && m.value);
        
        // Get existing contact methods to compare
        const { data: existingMethods } = await supabase
          .from('contact_methods')
          .select('method_id, method_type, value')
          .eq('contact_id', contactData.contact_id)
          .neq('method_type', 'email');
        
        // Create a map of existing methods
        const existingMethodsMap = new Map();
        if (existingMethods) {
          existingMethods.forEach(m => {
            const key = `${m.method_type}:${m.value}`;
            existingMethodsMap.set(key, m.method_id);
          });
        }
        
        // Determine which methods to delete
        const methodsToDelete = [];
        if (existingMethods) {
          existingMethods.forEach(existing => {
            const key = `${existing.method_type}:${existing.value}`;
            const stillExists = validContactMethods.some(m => {
              return `${m.method_type}:${m.value}` === key;
            });
            if (!stillExists) {
              methodsToDelete.push(existing.method_id);
            }
          });
        }
        
        // Delete methods that are no longer in the form
        for (const methodId of methodsToDelete) {
          await deleteWithAudit(
            'contact_methods',
            'method_id',
            methodId,
            user.user_id
          );
        }
        
        // Insert only new contact methods
        const methodsToInsert = validContactMethods.filter(method => {
          const key = `${method.method_type}:${method.value}`;
          return !existingMethodsMap.has(key);
        });
        
        if (methodsToInsert.length > 0) {
          const contactMethodsToInsert = methodsToInsert.map(method => ({
            contact_id: contactData.contact_id,
            method_type: method.method_type,
            value: method.value
          }));
          
          const { error: contactMethodsError } = await insertWithAudit(
            'contact_methods',
            contactMethodsToInsert,
            user.user_id
          );
            
          if (contactMethodsError) {
            console.error('Error updating contact methods:', contactMethodsError);
            setError(contactMethodsError.message || 'Failed to update contact methods.');
            setIsSubmitting(false);
            return;
          }
        } else if (validContactMethods.length === 0 && existingMethods && existingMethods.length > 0) {
          // Delete all existing contact methods if none are provided
          for (const method of existingMethods) {
            await deleteWithAudit(
              'contact_methods',
              'method_id',
              method.method_id,
              user.user_id
            );
          }
        }
      }
      
      setSuccess('Profile updated successfully!');
      setIsEditing(false);
      setNewPassword('');
      setConfirmPassword('');
      
      // Refresh user data without page reload (reuse existing clientData)
      const [contactResult, methodsResult, clientResult] = await Promise.all([
        supabase
          .from('contacts')
          .select('first_name, middle_name, last_name')
          .eq('contactable_id', user.user_id)
          .eq('contactable_type', 'client')
          .single(),
        supabase
          .from('contact_methods')
          .select('method_id, method_type, value, contacts!inner(contactable_id, contactable_type)')
          .eq('contacts.contactable_id', user.user_id)
          .eq('contacts.contactable_type', 'client'),
        supabase
          .from('clients')
          .select('date_of_birth')
          .eq('client_id', clientData.client_id)
          .maybeSingle()
      ]);

      if (contactResult.data && !contactResult.error) {
        setFirstName(contactResult.data.first_name || '');
        setMiddleName(contactResult.data.middle_name || '');
        setLastName(contactResult.data.last_name || '');
      }

      if (methodsResult.data && !methodsResult.error) {
        setContactMethods((methodsResult.data || []).map(m => ({ ...m, tempId: m.method_id })));
      }

      if (clientResult.data && !clientResult.error && clientResult.data.date_of_birth) {
        setDateOfBirth(clientResult.data.date_of_birth);
      }

      // Refresh current address from assigned unit based on current date
      // The assignment (client_units) controls - leases are optional
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of today for date comparison
      const { data: clientUnitsData, error: clientUnitsError } = await supabase
        .from('client_units')
        .select('unit_id, start_date, end_date, assigned_at, vacated_at')
        .eq('client_id', clientData.client_id)
        .is('is_archived', false)
        .order('assigned_at', { ascending: false });

      if (clientUnitsError) {
        console.error('Error fetching client_units (refresh):', clientUnitsError);
      }

      // Find the currently active assignment using start_date and end_date
      // Active if: (start_date IS NULL OR start_date <= today) AND (end_date IS NULL OR end_date >= today)
      // Fallback to assigned_at/vacated_at for legacy data
      let activeAssignment = clientUnitsData?.find(cu => {
        // Prefer start_date/end_date if available
        if (cu.start_date !== null || cu.end_date !== null) {
          const startDate = cu.start_date ? new Date(cu.start_date) : null;
          const endDate = cu.end_date ? new Date(cu.end_date) : null;
          const isStarted = !startDate || startDate <= today;
          const isNotEnded = !endDate || endDate >= today;
          return isStarted && isNotEnded;
        } else {
          // Fallback to assigned_at/vacated_at for legacy data
          const assignedAt = cu.assigned_at ? new Date(cu.assigned_at) : null;
          const vacatedAt = cu.vacated_at ? new Date(cu.vacated_at) : null;
          // If assigned_at is null, consider it active (legacy data)
          const isAssigned = !assignedAt || assignedAt <= now;
          const isNotVacated = !vacatedAt || vacatedAt > now;
          return isAssigned && isNotVacated;
        }
      });

      // Fallback: if no active assignment found, use the most recent one
      if (!activeAssignment && clientUnitsData && clientUnitsData.length > 0) {
        activeAssignment = clientUnitsData[0];
      }

      if (activeAssignment?.unit_id) {
        // Fetch unit details with property information
        const { data: unitData, error: unitError } = await supabase
          .from('units')
          .select(`
            unit_id,
            properties!inner(
              property_id
            )
          `)
          .eq('unit_id', activeAssignment.unit_id)
          .maybeSingle();

        if (unitError) {
          console.error('Error fetching unit (refresh):', unitError);
        }

        if (unitData?.properties?.property_id) {
          const propertyId = unitData.properties.property_id;
          const { data: addressData, error: addressError } = await supabase
            .from('addresses')
            .select('*')
            .eq('addressable_id', propertyId)
            .eq('addressable_type', 'property')
            .maybeSingle();

          if (addressError) {
            console.error('Error fetching address (refresh):', addressError);
          }

          if (addressData) {
            const addressParts = [
              addressData.address_line_1,
              addressData.address_line_2,
              addressData.city,
              addressData.state_province_region,
              addressData.postal_code
            ].filter(Boolean);
            setCurrentAddress(addressParts.join(', '));
          } else {
            setCurrentAddress('');
          }
        } else {
          setCurrentAddress('');
        }
      } else {
        setCurrentAddress('');
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      setError('Could not update profile. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setFirstName(user?.first_name || '');
    setMiddleName(user?.middle_name || '');
    setLastName(user?.last_name || '');
    setEmail(user?.email || '');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    setIsEditing(false);
    // Reset contact methods to original state
    if (user?.user_id) {
      supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.user_id)
        .maybeSingle()
        .then(({ data: clientData }) => {
          if (clientData?.client_id) {
            supabase
              .from('contact_methods')
              .select('method_id, method_type, value, contacts!inner(contactable_id, contactable_type)')
              .eq('contacts.contactable_id', clientData.client_id)
              .eq('contacts.contactable_type', 'tenant')
              .then(({ data }) => {
                if (data) {
                  setContactMethods(data.map(m => ({ ...m, tempId: m.method_id })));
                }
              });
          }
        });
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">My Profile</h1>
      
      <Card title="Personal Information">
        {!isEditing ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <p className="mt-1 text-sm text-gray-900">
                {(() => {
                  const first = firstName || '';
                  const last = lastName || '';
                  const middle = middleName ? (middleName.length === 1 ? ` ${middleName}.` : ` ${middleName}`) : '';
                  const fullName = `${first}${middle} ${last}`.replace(/\s+/g, ' ').trim();
                  return fullName || 'Not set';
                })()}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <p className="mt-1 text-sm text-gray-900">{user?.email || 'Not set'}</p>
            </div>
            {dateOfBirth && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Date of Birth</label>
                <p className="mt-1 text-sm text-gray-900">
                  {(() => {
                    // Format date directly from string to avoid timezone issues
                    const dateParts = dateOfBirth.split('-');
                    if (dateParts.length === 3) {
                      return `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`;
                    }
                    return dateOfBirth;
                  })()}
                </p>
              </div>
            )}
            {currentAddress && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Current Address</label>
                <p className="mt-1 text-sm text-gray-900">{currentAddress}</p>
              </div>
            )}
            {contactMethods.filter(m => m.method_type?.toLowerCase() !== 'email').length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Contact Methods</label>
                <div className="mt-1 space-y-1">
                  {contactMethods.filter(m => m.method_type?.toLowerCase() !== 'email').map(method => (
                    <p key={method.method_id || method.tempId} className="text-sm text-gray-900">
                      <span className="capitalize">{method.method_type}:</span> {
                        method.method_type?.toLowerCase() === 'phone' || method.method_type?.toLowerCase() === 'cell' || method.method_type?.toLowerCase() === 'mobile'
                          ? formatPhoneNumber(method.value)
                          : method.value
                      }
                    </p>
                  ))}
                </div>
              </div>
            )}
            {propertyContactInfo && (
              <div className="pt-4 border-t">
                <label className="block text-sm font-medium text-gray-700 mb-2">{propertyContactInfo.role}</label>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-900">{propertyContactInfo.name}</p>
                  {propertyContactInfo.phone && (
                    <div className="flex items-center text-sm text-gray-600">
                      <Phone size={16} className="mr-2 text-gray-400" />
                      <span>{formatPhoneNumber(propertyContactInfo.phone)}</span>
                    </div>
                  )}
                  {propertyContactInfo.email && (
                    <div className="flex items-center text-sm text-gray-600">
                      <Mail size={16} className="mr-2 text-gray-400" />
                      <span>{propertyContactInfo.email}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            <button
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
            >
              Edit Profile
            </button>
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
                  required
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
                  required
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
                autoComplete="off"
              />
            </div>

            <div className="pt-4 border-t">
              <h4 className="text-md font-medium text-gray-800 my-2">Contact Methods</h4>
              {contactMethods.filter(m => m.method_type?.toLowerCase() !== 'email').map((method) => (
                <div key={method.method_id || method.tempId} className="flex gap-2 mb-2 items-center">
                  <ContactMethodTypeInput
                    value={method.method_type || ''} 
                    onChange={value => handleMethodChange(method.method_id || method.tempId, 'method_type', value)} 
                    className="w-1/3 block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" 
                  />
                  <input 
                    type="text" 
                    value={method.value || ''} 
                    onChange={e => handleMethodChange(method.method_id || method.tempId, 'value', e.target.value)} 
                    placeholder="Value (e.g., 555-1234)"
                    autoComplete="tel"
                    name="contact-method-value"
                    className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                  />
                  <button 
                    type="button" 
                    onClick={() => removeMethod(method.method_id || method.tempId)} 
                    className="p-2 text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={16}/>
                  </button>
                </div>
              ))}
              <button 
                type="button" 
                onClick={addMethod} 
                className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 mt-2"
              >
                <PlusCircle size={16}/> Add Contact Method
              </button>
            </div>
            
            <div className="pt-4 border-t">
              <h4 className="text-md font-medium text-gray-800 mb-4">Change Password (Optional)</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                    placeholder="Leave blank to keep current password"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                {error}
              </div>
            )}
            
            {success && (
              <div className="p-3 text-sm text-green-700 bg-green-100 border border-green-400 rounded-md">
                {success}
              </div>
            )}

            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

