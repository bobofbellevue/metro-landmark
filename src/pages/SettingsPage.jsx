import React, { useState, useContext, useEffect } from 'react';
import { Card } from '../components/ui';
import { AuthContext } from '../contexts';
import { supabase } from '../lib/supabase';
import NotificationPreferences from '../components/NotificationPreferences';
import OrgThemeSettings from '../components/OrgThemeSettings';

export default function SettingsPage() {
    const { user, setUser } = useContext(AuthContext);
    const [isEditing, setIsEditing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    // Form state
    const [firstName, setFirstName] = useState(user?.first_name || '');
    const [middleName, setMiddleName] = useState(user?.middle_name || '');
    const [lastName, setLastName] = useState(user?.last_name || '');
    const [email, setEmail] = useState(user?.email || '');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // Fetch user contact information
    useEffect(() => {
        const fetchUserContact = async () => {
            if (user?.user_id) {
                try {
                    const { data: contactData, error } = await supabase
                        .from('contacts')
                        .select('first_name, middle_name, last_name')
                        .eq('contactable_id', user.user_id)
                        .eq('contactable_type', 'user')
                        .single();

                    if (contactData && !error) {
                        setFirstName(contactData.first_name || '');
                        setMiddleName(contactData.middle_name || '');
                        setLastName(contactData.last_name || '');
                    }
                } catch (err) {
                    console.error('Error fetching user contact:', err);
                }
            }
        };

        fetchUserContact();
    }, [user?.user_id]);

    const handleProfileUpdate = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');
        setSuccess('');

        try {
            const updateData = {
                firstName,
                middleName,
                lastName,
                email
            };

            if (newPassword) {
                if (newPassword !== confirmPassword) {
                    setError('New passwords do not match.');
                    return;
                }
                // Hash the new password
                const bcrypt = await import('bcryptjs');
                const salt = await bcrypt.genSalt(10);
                const passwordHash = await bcrypt.hash(newPassword, salt);
                updateData.password_hash = passwordHash;
            }

            // Update user account
            const { error: userError } = await supabase
                .from('users')
                .update({
                    email: updateData.email,
                    ...(updateData.password_hash && { password_hash: updateData.password_hash })
                })
                .eq('user_id', user.user_id);
            
            if (userError) {
                setError(userError.message || 'Failed to update user account.');
                return;
            }
            
            // Update contact record
            const { error: contactError } = await supabase
                .from('contacts')
                .update({
                    first_name: updateData.firstName,
                    middle_name: updateData.middleName,
                    last_name: updateData.lastName
                })
                .eq('contactable_id', user.user_id)
                .eq('contactable_type', 'user');
            
            if (contactError) {
                setError(contactError.message || 'Failed to update contact record.');
                return;
            }
            
            setSuccess('Profile updated successfully!');
            // Update the user context with new data
            setUser({
                ...user,
                first_name: firstName,
                middle_name: middleName,
                last_name: lastName,
                email: email
            });
            setIsEditing(false);
            setNewPassword('');
            setConfirmPassword('');
            setCurrentPassword('');
        } catch (error) {
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
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setError('');
        setSuccess('');
        setIsEditing(false);
    };

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Settings</h2>
            
            <Card title="User Profile">
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
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Email</label>
                            <p className="mt-1 text-sm text-gray-900">{user?.email || 'Not set'}</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Role</label>
                            <p className="mt-1 text-sm text-gray-900 capitalize">{user?.role?.replace('_', ' ') || 'Not set'}</p>
                        </div>
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

            <OrgThemeSettings />

            <NotificationPreferences />

            <Card title="Account Information">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">User ID</label>
                        <p className="mt-1 text-sm text-gray-900 font-mono">{user?.user_id}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Account Created</label>
                        <p className="mt-1 text-sm text-gray-900">
                            {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown'}
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Last Updated</label>
                        <p className="mt-1 text-sm text-gray-900">
                            {user?.updated_at ? new Date(user.updated_at).toLocaleDateString() : 'Unknown'}
                        </p>
                    </div>
                </div>
            </Card>
        </div>
    );
}
