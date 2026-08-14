import React, { useState, useContext, useEffect, useRef } from 'react';
import { Card } from '../../components/ui';
import { AuthContext } from '../../contexts';
import { supabase } from '../../lib/supabase';
import { PlusCircle, Trash2, Phone, Mail, Pencil } from 'lucide-react';
import ContactMethodTypeInput from '../../components/ContactMethodTypeInput';

export default function VendorProfile() {
  const { user } = useContext(AuthContext);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [contactMethods, setContactMethods] = useState([]);
  const contactMethodInputRefs = useRef({});
  const [vendor, setVendor] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Form state
  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [jobTitle, setJobTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Fetch vendor data
  useEffect(() => {
    const fetchVendorData = async () => {
      if (user?.user_id) {
        setIsLoading(true);
        try {
          // Find vendor by user_id
          const { data: vendorData, error: vendorError } = await supabase
            .from('vendors')
            .select('*')
            .eq('user_id', user.user_id)
            .maybeSingle();
          
          if (vendorError) {
            console.error('Error fetching vendor:', vendorError);
            setError('Failed to load vendor profile.');
            setIsLoading(false);
            return;
          }
          
          if (!vendorData) {
            setError('Vendor profile not found.');
            setIsLoading(false);
            return;
          }
          
          setVendor(vendorData);
          setCompanyName(vendorData.company_name || '');
          setJobTitle(vendorData.job_title || '');
          setDescription(vendorData.description || '');
          
          // Fetch contact
          const { data: contact, error: contactError } = await supabase
            .from('contacts')
            .select('contact_id, first_name, middle_name, last_name')
            .eq('contactable_id', vendorData.vendor_id)
            .eq('contactable_type', 'vendor')
            .maybeSingle();
          
          if (contactError && contactError.code !== 'PGRST116') {
            console.error('Error fetching contact:', contactError);
          }
          
          if (contact) {
            setFirstName(contact.first_name || '');
            setMiddleName(contact.middle_name || '');
            setLastName(contact.last_name || '');
            
            // Fetch contact methods
            const { data: methods, error: methodsError } = await supabase
              .from('contact_methods')
              .select('*')
              .eq('contact_id', contact.contact_id);
            
            if (methodsError) {
              console.error('Error fetching contact methods:', methodsError);
            } else {
              // Filter out email from contact methods (it's shown separately)
              const nonEmailMethods = (methods || []).filter(m => 
                m.method_type?.toLowerCase() !== 'email'
              );
              setContactMethods(nonEmailMethods.map(m => ({
                method_id: m.method_id,
                method_type: m.method_type,
                value: m.value,
                tempId: m.method_id || Date.now() + Math.random()
              })));
            }
          }
        } catch (err) {
          console.error('Error fetching vendor data:', err);
          setError('Failed to load vendor profile.');
        } finally {
          setIsLoading(false);
        }
      }
    };
    
    fetchVendorData();
  }, [user]);

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
    setIsSubmitting(true);
    setError('');
    setSuccess('');
    
    // Validate passwords match if provided
    if (newPassword && newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      setIsSubmitting(false);
      return;
    }
    
    if (!vendor) {
      setError('Vendor profile not found.');
      setIsSubmitting(false);
      return;
    }
    
    try {
      // Update vendor record
      const { error: vendorError } = await supabase
        .from('vendors')
        .update({
          company_name: companyName.trim() || null,
          job_title: jobTitle.trim() || null,
          description: description.trim() || null
        })
        .eq('vendor_id', vendor.vendor_id);
      
      if (vendorError) {
        setError(vendorError.message || 'Failed to update vendor profile.');
        setIsSubmitting(false);
        return;
      }
      
      // Update user account email and password if provided
      if (user?.user_id) {
        const updateData = {
          email: email.trim().toLowerCase()
        };
        
        if (newPassword) {
          const bcrypt = await import('bcryptjs');
          const salt = await bcrypt.genSalt(10);
          const passwordHash = await bcrypt.hash(newPassword, salt);
          updateData.password_hash = passwordHash;
        }
        
        const { error: userError } = await supabase
          .from('users')
          .update(updateData)
          .eq('user_id', user.user_id);
        
        if (userError) {
          setError(userError.message || 'Failed to update user account.');
          setIsSubmitting(false);
          return;
        }
      }
      
      // Get or create contact
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('contact_id')
        .eq('contactable_id', vendor.vendor_id)
        .eq('contactable_type', 'vendor')
        .maybeSingle();
      
      let contactId = existingContact?.contact_id;
      
      if (!contactId && (firstName.trim() || middleName.trim() || lastName.trim() || contactMethods.length > 0)) {
        // Create new contact
        const { data: newContact } = await supabase
          .from('contacts')
          .insert([{
            contactable_id: vendor.vendor_id,
            contactable_type: 'vendor',
            first_name: firstName.trim() || null,
            middle_name: middleName.trim() || null,
            last_name: lastName.trim() || null
          }])
          .select('contact_id')
          .single();
        contactId = newContact?.contact_id;
      } else if (contactId) {
        // Update existing contact
        await supabase
          .from('contacts')
          .update({
            first_name: firstName.trim() || null,
            middle_name: middleName.trim() || null,
            last_name: lastName.trim() || null
          })
          .eq('contact_id', contactId);
      }
      
      // Update contact methods
      if (contactId) {
        // Delete existing non-email methods
        await supabase
          .from('contact_methods')
          .delete()
          .eq('contact_id', contactId)
          .neq('method_type', 'Email');
        
        // Insert new methods
        const validMethods = contactMethods.filter(m => m.method_type && m.value);
        if (validMethods.length > 0) {
          const methodsToInsert = validMethods.map(m => ({
            contact_id: contactId,
            method_type: m.method_type,
            value: m.value
          }));
          
          await supabase
            .from('contact_methods')
            .insert(methodsToInsert);
        }
      }
      
      setSuccess('Profile updated successfully!');
      setIsEditing(false);
      setNewPassword('');
      setConfirmPassword('');
      
      // Reload vendor data
      const { data: updatedVendor } = await supabase
        .from('vendors')
        .select('*')
        .eq('vendor_id', vendor.vendor_id)
        .single();
      if (updatedVendor) setVendor(updatedVendor);
      
    } catch (err) {
      console.error('Error updating profile:', err);
      setError('Could not update profile.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatName = () => {
    const first = firstName || '';
    const last = lastName || '';
    const middle = middleName ? (middleName.length === 1 ? ` ${middleName}.` : ` ${middleName}`) : '';
    return `${first}${middle} ${last}`.replace(/\s+/g, ' ').trim() || 'Not set';
  };

  if (isLoading) {
    return <div className="p-4">Loading profile...</div>;
  }

  if (!vendor) {
    return <div className="p-4 text-red-600">Vendor profile not found.</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">My Profile</h1>
      
      <Card title="Vendor Information">
        {!isEditing ? (
          <div className="space-y-4">
            {companyName && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Company Name</label>
                <p className="mt-1 text-sm text-gray-900">{companyName}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <p className="mt-1 text-sm text-gray-900">{formatName()}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <p className="mt-1 text-sm text-gray-900">{email || 'Not set'}</p>
            </div>
            {jobTitle && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Job Title</label>
                <p className="mt-1 text-sm text-gray-900">{jobTitle}</p>
              </div>
            )}
            {description && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <p className="mt-1 text-sm text-gray-900">{description}</p>
              </div>
            )}
            {contactMethods.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Contact Methods</label>
                <div className="space-y-2">
                  {contactMethods.map((method) => (
                    <div key={method.method_id || method.tempId} className="flex items-center text-sm text-gray-600">
                      <span className="font-medium capitalize mr-2">{method.method_type}:</span>
                      <span>{method.value}</span>
                    </div>
                  ))}
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
            {companyName && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Company Name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                />
              </div>
            )}
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
              <label className="block text-sm font-medium text-gray-700">Job Title</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
              />
            </div>
            <div className="pt-4 border-t">
              <p className="text-sm font-medium text-gray-700 mb-2">Reset Password (Optional)</p>
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
            <div className="pt-4 border-t">
              <h4 className="text-md font-medium text-gray-800 mb-2">Contact Methods</h4>
              {contactMethods.map((method) => (
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
                    placeholder="Value"
                    autoComplete="tel"
                    name="contact-method-value"
                    className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeMethod(method.method_id || method.tempId)}
                    className="p-2 text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addMethod}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                <PlusCircle size={16} />
                Add Contact Method
              </button>
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
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setError('');
                  setSuccess('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
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
          </form>
        )}
      </Card>
    </div>
  );
}

