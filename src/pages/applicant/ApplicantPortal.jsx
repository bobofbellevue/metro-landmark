import React, { useState, useEffect, useContext } from 'react';
import { FileText, Home, Clock, CheckCircle, XCircle, User, PlusCircle, Search, Edit2, Save, X, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';
import DocumentManagement from '../../components/DocumentManagement';
import DateInput from '../../components/DateInput';

export default function ApplicantPortal() {
  const { user, logout } = useContext(AuthContext);
  const [activeSection, setActiveSection] = useState('overview'); // overview, profile, applications, properties
  const [isLoading, setIsLoading] = useState(true);
  
  // Overview stats
  const [stats, setStats] = useState(null);
  
  // Profile state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSubmittingProfile, setIsSubmittingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [contactMethods, setContactMethods] = useState([]);
  const [applicantData, setApplicantData] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Applications state
  const [applications, setApplications] = useState([]);
  
  // Properties state
  const [properties, setProperties] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [clientId, setClientId] = useState(null);
  const [applicationError, setApplicationError] = useState('');
  const [applicationSuccess, setApplicationSuccess] = useState('');

  useEffect(() => {
    if (user) {
      fetchAllData();
    }
  }, [user]);

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      // Find client record
      const { data: clientRecord, error: clientError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.user_id)
        .maybeSingle();

      if (clientError && clientError.code !== 'PGRST116') {
        console.error('Error fetching client record:', clientError);
      }

      if (clientRecord) {
        setClientId(clientRecord.client_id);
        await Promise.all([
          fetchOverviewStats(clientRecord.client_id),
          fetchProfileData(),
          fetchApplications(clientRecord.client_id),
          fetchAvailableProperties(clientRecord.client_id)
        ]);
      } else {
        // No client record found
        setStats({
          totalApplications: 0,
          pendingApplications: 0,
          approvedApplications: 0,
          rejectedApplications: 0,
          availableProperties: 0,
        });
        await fetchProfileData();
        await fetchAvailableProperties(null);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchOverviewStats = async (clientId) => {
    try {
      // Fetch applications
      const { data: applications } = await supabase
        .from('client_applications')
        .select('application_id, status')
        .eq('client_id', clientId);

      // Fetch available units (units without active/future leases)
      const [unitsResult, leasesResult] = await Promise.all([
        supabase.from('units').select('unit_id'),
        supabase.from('leases').select('unit_id').in('status', ['active', 'future'])
      ]);

      const leasedUnitIds = new Set((leasesResult.data || []).map(l => l.unit_id));
      const appliedUnitIds = new Set((applications || []).map(a => a.unit_id));
      
      // Available units = all units - leased units - already applied units
      const availableUnits = (unitsResult.data || []).filter(
        u => !leasedUnitIds.has(u.unit_id) && !appliedUnitIds.has(u.unit_id)
      );

      setStats({
        totalApplications: applications?.length || 0,
        pendingApplications: applications?.filter(a => a.status === 'pending').length || 0,
        approvedApplications: applications?.filter(a => a.status === 'approved').length || 0,
        rejectedApplications: applications?.filter(a => a.status === 'rejected').length || 0,
        availableProperties: availableUnits.length,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchProfileData = async () => {
    if (!user?.user_id) return;
    
    try {
      const [contactResult, applicantResult] = await Promise.all([
        supabase
          .from('contacts')
          .select('contact_id, first_name, middle_name, last_name')
          .eq('contactable_id', user.user_id)
          .eq('contactable_type', 'user')
          .maybeSingle(),
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
        
        // Fetch contact methods using contact_id
        if (contactResult.data.contact_id) {
          const { data: methodsData, error: methodsError } = await supabase
            .from('contact_methods')
            .select('method_id, method_type, value')
            .eq('contact_id', contactResult.data.contact_id);
          
          if (methodsData && !methodsError) {
            setContactMethods(methodsData || []);
          }
        }
      } else {
        // Fallback to user object if contact query fails or returns no data
        setFirstName(user?.first_name || '');
        setMiddleName(user?.middle_name || '');
        setLastName(user?.last_name || '');
      }

      if (applicantResult.data && !applicantResult.error) {
        setApplicantData(applicantResult.data);
        setDateOfBirth(applicantResult.data.date_of_birth ? new Date(applicantResult.data.date_of_birth).toISOString().split('T')[0] : '');
        setGender(applicantResult.data.gender || '');
      }

      setEmail(user.email || '');
    } catch (error) {
      console.error('Error fetching profile data:', error);
    }
  };

  const fetchApplications = async (clientId) => {
    if (!clientId) {
      setApplications([]);
      return;
    }

    try {
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
        .eq('client_id', clientId)
        .order('applied_at', { ascending: false });

      if (applicationsError) {
        console.error('Error fetching applications:', applicationsError);
        setApplications([]);
        return;
      }

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
    } catch (error) {
      console.error('Error fetching applications:', error);
      setApplications([]);
    }
  };

  const fetchAvailableProperties = async (clientId) => {
    try {
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
        clientId ? supabase.from('client_applications')
          .select('unit_id')
          .eq('client_id', clientId) : { data: [] },
        supabase.from('addresses').select('*').eq('addressable_type', 'property')
      ]);

      if (unitsResult.error) {
        console.error('Error fetching units:', unitsResult.error);
        setProperties([]);
        return;
      }

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
    } catch (error) {
      console.error('Error fetching available properties:', error);
      setProperties([]);
    }
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setIsSubmittingProfile(true);
    setProfileError('');
    setProfileSuccess('');

    try {
      if (newPassword && newPassword !== confirmPassword) {
        setProfileError('New passwords do not match.');
        setIsSubmittingProfile(false);
        return;
      }

      // Update user account
      const updateData = { email };
      if (newPassword) {
        const response = await fetch('/api/update-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user.user_id, newPassword })
        });
        if (!response.ok) {
          throw new Error('Failed to update password');
        }
      }

      const { error: userError } = await supabase
        .from('users')
        .update(updateData)
        .eq('user_id', user.user_id);
      
      if (userError) {
        setProfileError(userError.message || 'Failed to update user account.');
        setIsSubmittingProfile(false);
        return;
      }
      
      // Update contact record
      const { error: contactError } = await supabase
        .from('contacts')
        .update({
          first_name: firstName,
          middle_name: middleName,
          last_name: lastName
        })
        .eq('contactable_id', user.user_id)
        .eq('contactable_type', 'user');
      
      if (contactError) {
        setProfileError(contactError.message || 'Failed to update contact record.');
        setIsSubmittingProfile(false);
        return;
      }

      // Update client record
      if (applicantData || clientId) {
        const { error: clientError } = await supabase
          .from('clients')
          .update({
            date_of_birth: dateOfBirth || null,
            gender: gender || null
          })
          .eq('user_id', user.user_id);
        
        if (clientError) {
          setProfileError(clientError.message || 'Failed to update client record.');
          setIsSubmittingProfile(false);
          return;
        }
      }
      
      setProfileSuccess('Profile updated successfully!');
      setIsEditingProfile(false);
      setNewPassword('');
      setConfirmPassword('');
      await fetchProfileData();
    } catch (err) {
      console.error('Error updating profile:', err);
      setProfileError('Could not update profile. Please try again.');
    } finally {
      setIsSubmittingProfile(false);
    }
  };

  const handleApply = async (unitId) => {
    setApplicationError('');
    setApplicationSuccess('');
    
    if (!clientId) {
      setApplicationError('Please complete your profile first.');
      return;
    }

    setIsApplying(true);
    try {
      const { error } = await supabase
        .from('client_applications')
        .insert([{
          client_id: clientId,
          unit_id: unitId,
          status: 'pending'
        }]);

      if (error) {
        if (error.code === '23505') {
          setApplicationError('You have already applied for this unit.');
        } else {
          setApplicationError('Failed to submit application: ' + error.message);
        }
      } else {
        setApplicationSuccess('Application submitted successfully!');
        await fetchAllData(); // Refresh all data
        setTimeout(() => setApplicationSuccess(''), 3000);
      }
    } catch (error) {
      console.error('Error submitting application:', error);
      setApplicationError('Failed to submit application. Please try again.');
    } finally {
      setIsApplying(false);
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

  const formatApplicationAddress = (application) => {
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

  const filteredProperties = properties.filter(property => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    const addressStr = formatAddress(property).toLowerCase();
    const propertyType = property.property_type?.toLowerCase() || '';
    return addressStr.includes(searchLower) || propertyType.includes(searchLower);
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Application Portal</h1>
              <p className="mt-1 text-sm text-gray-600">Manage your profile, applications, and browse available properties</p>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8" aria-label="Tabs">
            {[
              { id: 'overview', label: 'Overview', icon: <Home className="w-5 h-5" /> },
              { id: 'profile', label: 'My Profile', icon: <User className="w-5 h-5" /> },
              { id: 'applications', label: 'My Applications', icon: <FileText className="w-5 h-5" /> },
              { id: 'properties', label: 'Available Properties', icon: <Home className="w-5 h-5" /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                className={`
                  flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
                  ${activeSection === tab.id
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overview Section */}
        {activeSection === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              <Card className="bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Applications</p>
                    <p className="text-3xl font-bold text-indigo-600">{stats?.totalApplications || 0}</p>
                  </div>
                  <FileText className="w-12 h-12 text-indigo-400" />
                </div>
              </Card>

              <Card className="bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Pending Applications</p>
                    <p className="text-3xl font-bold text-yellow-600">{stats?.pendingApplications || 0}</p>
                  </div>
                  <Clock className="w-12 h-12 text-yellow-400" />
                </div>
              </Card>

              <Card className="bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Approved Applications</p>
                    <p className="text-3xl font-bold text-green-600">{stats?.approvedApplications || 0}</p>
                  </div>
                  <CheckCircle className="w-12 h-12 text-green-400" />
                </div>
              </Card>

              <Card className="bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Available Properties</p>
                    <p className="text-3xl font-bold text-blue-600">{stats?.availableProperties || 0}</p>
                  </div>
                  <Home className="w-12 h-12 text-blue-400" />
                </div>
              </Card>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card className="bg-white p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Applications</h3>
                {applications.length === 0 ? (
                  <p className="text-sm text-gray-500">No applications yet. Browse available properties to get started.</p>
                ) : (
                  <div className="space-y-3">
                    {applications.slice(0, 3).map(application => {
                      const status = statusConfig[application.status] || statusConfig.pending;
                      return (
                        <div key={application.application_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">Unit {application.unit_number}</p>
                            <p className="text-xs text-gray-500">{formatApplicationAddress(application)}</p>
                          </div>
                          <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs ${status.color}`}>
                            {status.icon}
                            {status.label}
                          </div>
                        </div>
                      );
                    })}
                    {applications.length > 3 && (
                      <button
                        onClick={() => setActiveSection('applications')}
                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                      >
                        View all applications →
                      </button>
                    )}
                  </div>
                )}
              </Card>

              <Card className="bg-white p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Links</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setActiveSection('profile')}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md flex items-center gap-2"
                  >
                    <User className="w-4 h-4" />
                    Update Profile Information
                  </button>
                  <button
                    onClick={() => setActiveSection('applications')}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    View All Applications
                  </button>
                  <button
                    onClick={() => setActiveSection('properties')}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md flex items-center gap-2"
                  >
                    <Home className="w-4 h-4" />
                    Browse Available Properties
                  </button>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Profile Section */}
        {activeSection === 'profile' && (
          <Card className="bg-white">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">My Profile</h2>
              {!isEditingProfile && (
                <button
                  onClick={() => setIsEditingProfile(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit Profile
                </button>
              )}
            </div>

            {!isEditingProfile ? (
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
                  <p className="mt-1 text-sm text-gray-900">{email || 'Not set'}</p>
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

                {profileError && (
                  <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                    {profileError}
                  </div>
                )}
                
                {profileSuccess && (
                  <div className="p-3 text-sm text-green-700 bg-green-100 border border-green-400 rounded-md">
                    {profileSuccess}
                  </div>
                )}

                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingProfile(false);
                      setProfileError('');
                      setProfileSuccess('');
                      fetchProfileData();
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingProfile}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
                  >
                    <Save className="w-4 h-4" />
                    {isSubmittingProfile ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}
          </Card>
        )}

        {/* Applications Section */}
        {activeSection === 'applications' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">My Applications</h2>

            {applications.length === 0 ? (
              <Card className="p-8 text-center text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>You haven't submitted any applications yet.</p>
                <p className="mt-2 text-sm">Visit the Available Properties section to apply for a unit.</p>
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
                                {formatApplicationAddress(application)}
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
                            <div className="p-3 bg-gray-50 rounded-md mb-4">
                              <p className="text-sm font-medium text-gray-700 mb-1">Notes:</p>
                              <p className="text-sm text-gray-600">{application.notes}</p>
                            </div>
                          )}

                          {/* Documents Section */}
                          <div className="pt-4 border-t border-gray-200">
                            <DocumentManagement
                              tenantUserId={user?.user_id || null}
                              userRole="applicant"
                              userId={user?.user_id || null}
                              applicationId={application.application_id}
                            />
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Properties Section */}
        {activeSection === 'properties' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Available Properties</h2>
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
        )}
      </div>
    </div>
  );
}
