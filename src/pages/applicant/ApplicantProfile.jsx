import React, { useState, useContext, useEffect } from 'react';
import { Card } from '../../components/ui';
import { AuthContext } from '../../contexts';
import { supabase } from '../../lib/supabase';
import DateInput from '../../components/DateInput';

export default function ApplicantProfile() {
  const { user } = useContext(AuthContext);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [contactMethods, setContactMethods] = useState([]);
  const [applicantData, setApplicantData] = useState(null);
  
  // Form state
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [middleName, setMiddleName] = useState(user?.middle_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Fetch user contact information, contact methods, and applicant data
  useEffect(() => {
    const fetchUserData = async () => {
      if (user?.user_id) {
        try {
          const [contactResult, methodsResult, applicantResult] = await Promise.all([
            supabase
              .from('contacts')
              .select('first_name, middle_name, last_name')
              .eq('contactable_id', user.user_id)
              .eq('contactable_type', 'user')
              .single(),
            supabase
              .from('contact_methods')
              .select('method_id, method_type, value, contacts!inner(contactable_id, contactable_type)')
              .eq('contacts.contactable_id', user.user_id)
              .eq('contacts.contactable_type', 'user'),
            supabase
              .from('clients')
              .select('date_of_birth, gender')
              .eq('user_id', user.user_id)
              .maybeSingle()
          ]);

          if (contactResult.data && !contactResult.error) {
            setFirstName(contactResult.data.first_name || '');
            setMiddleName(contactResult.data.middle_name || '');
            setLastName(contactResult.data.last_name || '');
          }

          if (methodsResult.data && !methodsResult.error) {
            setContactMethods(methodsResult.data || []);
          }

          if (applicantResult.data && !applicantResult.error) {
            setApplicantData(applicantResult.data);
            setDateOfBirth(applicantResult.data.date_of_birth ? new Date(applicantResult.data.date_of_birth).toISOString().split('T')[0] : '');
            setGender(applicantResult.data.gender || '');
          } else if (applicantResult.error && applicantResult.error.code !== 'PGRST116') {
            // Only log non-PGRST116 errors (PGRST116 means no rows found, which is acceptable)
            console.error('Error fetching applicant data:', applicantResult.error);
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
        const response = await fetch('/api/update-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user.user_id, newPassword })
        });
        if (!response.ok) {
          throw new Error('Failed to update password');
        }
      }

      const { updateWithAudit } = await import('../lib/auditHelpers.js');
      
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
      
      // Get contact_id for updating contact record
      const { data: contactData } = await supabase
        .from('contacts')
        .select('contact_id')
        .eq('contactable_id', user.user_id)
        .eq('contactable_type', 'user')
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
      }

      // Update applicant record using audit helper
      if (applicantData) {
        const { data: clientRecord } = await supabase
          .from('clients')
          .select('client_id')
          .eq('user_id', user.user_id)
          .maybeSingle();
        
        if (clientRecord?.client_id) {
          const { error: applicantError } = await updateWithAudit(
            'clients',
            {
              date_of_birth: dateOfBirth || null,
              gender: gender || null
            },
            'client_id',
            clientRecord.client_id,
            user.user_id
          );
          
          if (applicantError) {
            setError(applicantError.message || 'Failed to update applicant record.');
            setIsSubmitting(false);
            return;
          }
        }
      }
      
      setSuccess('Profile updated successfully!');
      setIsEditing(false);
      setNewPassword('');
      setConfirmPassword('');
      
      // Refresh user data without page reload
      const [contactResult, methodsResult, applicantResult] = await Promise.all([
        supabase
          .from('contacts')
          .select('first_name, middle_name, last_name')
          .eq('contactable_id', user.user_id)
          .eq('contactable_type', 'user')
          .single(),
        supabase
          .from('contact_methods')
          .select('method_id, method_type, value, contacts!inner(contactable_id, contactable_type)')
          .eq('contacts.contactable_id', user.user_id)
          .eq('contacts.contactable_type', 'user'),
        supabase
          .from('clients')
          .select('date_of_birth, gender')
          .eq('user_id', user.user_id)
          .maybeSingle()
      ]);

      if (contactResult.data && !contactResult.error) {
        setFirstName(contactResult.data.first_name || '');
        setMiddleName(contactResult.data.middle_name || '');
        setLastName(contactResult.data.last_name || '');
      }

      if (methodsResult.data && !methodsResult.error) {
        setContactMethods(methodsResult.data || []);
      }

      if (applicantResult.data && !applicantResult.error) {
        setApplicantData(applicantResult.data);
        setDateOfBirth(applicantResult.data.date_of_birth ? new Date(applicantResult.data.date_of_birth).toISOString().split('T')[0] : '');
        setGender(applicantResult.data.gender || '');
      } else if (applicantResult.error && applicantResult.error.code !== 'PGRST116') {
        console.error('Error fetching applicant data:', applicantResult.error);
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
    setDateOfBirth(applicantData?.date_of_birth ? new Date(applicantData.date_of_birth).toISOString().split('T')[0] : '');
    setGender(applicantData?.gender || '');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    setIsEditing(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">My Profile</h1>
      
      <Card title="Personal Information">
        {!isEditing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">First Name</label>
                <p className="mt-1 text-sm text-gray-900">{firstName || 'Not set'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Last Name</label>
                <p className="mt-1 text-sm text-gray-900">{lastName || 'Not set'}</p>
              </div>
            </div>
            {middleName && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Middle Name</label>
                <p className="mt-1 text-sm text-gray-900">{middleName}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <p className="mt-1 text-sm text-gray-900">{user?.email || 'Not set'}</p>
            </div>
            {dateOfBirth && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Date of Birth</label>
                <p className="mt-1 text-sm text-gray-900">{new Date(dateOfBirth).toLocaleDateString()}</p>
              </div>
            )}
            {gender && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Gender</label>
                <p className="mt-1 text-sm text-gray-900 capitalize">{gender}</p>
              </div>
            )}
            {contactMethods.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Contact Methods</label>
                <div className="mt-1 space-y-1">
                  {contactMethods.map(method => (
                    <p key={method.method_id} className="text-sm text-gray-900">
                      <span className="capitalize">{method.method_type}:</span> {method.value}
                    </p>
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <DateInput
                  label="Date of Birth"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Gender</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                >
                  <option value="">Select...</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
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

