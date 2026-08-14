import React, { useState, useEffect, useContext, lazy, Suspense } from 'react';
import { Building2, Home, Wrench, Users, Building, Database, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext, SidebarContext } from '../contexts';
import { Card } from '../components/ui';

// Lazy load role-specific dashboards for better performance
const CompanyAdminDashboard = lazy(() => import('./dashboards/CompanyAdminDashboard'));
const ManagerDashboard = lazy(() => import('./dashboards/ManagerDashboard'));
const StaffDashboard = lazy(() => import('./dashboards/StaffDashboard'));
const LandlordDashboard = lazy(() => import('./dashboards/LandlordDashboard'));
const VendorDashboard = lazy(() => import('./dashboards/VendorDashboard'));

// This is the main component for the Dashboard page
export default function DashboardPage() {
    const { user } = useContext(AuthContext);
    const [stats, setStats] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [systemStatus, setSystemStatus] = useState({
        databaseConnected: false,
        apiWorking: false,
        lastChecked: null
    });

    // Route to appropriate dashboard based on user role
    const userRole = user?.role;

    // Loading component for lazy-loaded dashboards
    const DashboardLoader = () => (
        <div className="flex items-center justify-center p-8">
            <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading dashboard...</p>
            </div>
        </div>
    );

    // Render role-specific dashboards with lazy loading
    if (userRole === 'company_admin') {
        return (
            <Suspense fallback={<DashboardLoader />}>
                <CompanyAdminDashboard />
            </Suspense>
        );
    }

    if (userRole === 'manager') {
        return (
            <Suspense fallback={<DashboardLoader />}>
                <ManagerDashboard />
            </Suspense>
        );
    }

    if (userRole === 'staff') {
        return (
            <Suspense fallback={<DashboardLoader />}>
                <StaffDashboard />
            </Suspense>
        );
    }

    if (userRole === 'landlord') {
        return (
            <Suspense fallback={<DashboardLoader />}>
                <LandlordDashboard />
            </Suspense>
        );
    }

    if (userRole === 'vendor') {
        return (
            <Suspense fallback={<DashboardLoader />}>
                <VendorDashboard />
            </Suspense>
        );
    }

    // Default to Global Admin dashboard (existing implementation)

    /**
     * Fetches dashboard statistics from the database
     * Retrieves counts for properties, units, users, and companies
     */
    const fetchStats = async () => {
        setIsLoading(true);
        try {
            // Get real data from database using Supabase
            // Determine applicants vs tenants based on active client_units assignments
            const today = new Date().toISOString().split('T')[0];
            const [landlordsResult, propertiesResult, allClientsResult, usersResult, activeClientUnitsResult, leasesResult, companiesResult, unitsResult, vendorsResult] = await Promise.all([
                supabase.from('landlords').select('*', { count: 'exact' }).eq('is_archived', false),
                supabase.from('properties').select('*', { count: 'exact' }).eq('is_archived', false),
                supabase.from('clients').select('*', { count: 'exact' }),
                supabase.from('users').select('user_id, role, is_archived').eq('is_archived', false),
                supabase.from('client_units').select('client_id')
                    .eq('is_archived', false)
                    .lte('start_date', today)
                    .or(`end_date.is.null,end_date.gte.${today}`),
                supabase.from('leases').select('*', { count: 'exact' }).eq('is_archived', false),
                supabase.from('pm_companies').select('*', { count: 'exact' }).eq('is_archived', false),
                supabase.from('units').select('*', { count: 'exact' }).eq('is_archived', false),
                supabase.from('vendors').select('*', { count: 'exact' }).eq('is_archived', false)
            ]);
            
            // Calculate applicants vs tenants based on active client_units
            const activeClientIds = new Set((activeClientUnitsResult.data || []).map(cu => cu.client_id));
            const allClients = allClientsResult.data || [];
            const applicantsCount = allClients.filter(c => !activeClientIds.has(c.client_id)).length;
            const tenantsCount = activeClientIds.size;
            
            // Get user role breakdown (excluding archived users and orphaned landlords)
            const usersData = usersResult.data || [];
            
            // Get landlord user_ids to filter out orphaned landlord users
            const landlordUserIds = new Set((landlordsResult.data || []).map(l => l.user_id).filter(Boolean));
            
            // Filter out users with role='landlord' who don't have a landlord record
            const validUsers = usersData.filter(u => {
                if (u.role === 'landlord') {
                    return landlordUserIds.has(u.user_id);
                }
                return true;
            });
            
            const userRoleBreakdown = {
                global_admin: validUsers.filter(u => u.role === 'global_admin' && !u.is_archived).length,
                company_admin: validUsers.filter(u => u.role === 'company_admin' && !u.is_archived).length,
                manager: validUsers.filter(u => u.role === 'manager' && !u.is_archived).length,    
                staff: validUsers.filter(u => u.role === 'staff' && !u.is_archived).length,        
                tenant: tenantsCount,  // Tenants = clients with active unit assignments
                landlord: landlordsResult.count || 0,  // Use actual landlords table count, not users with role='landlord'
                applicant: applicantsCount  // Applicants = clients without active unit assignments
            };
            
            const stats = {
                landlordCount: landlordsResult.count || 0,
                propertyCount: propertiesResult.count || 0,
                unitCount: unitsResult.count || 0,
                applicantCount: applicantsCount,
                tenantCount: tenantsCount,
                leaseCount: leasesResult.count || 0,
                userCount: validUsers.length,  // Count only valid users (excluding orphaned landlords)
                companyCount: companiesResult.count || 0,
                vendorCount: vendorsResult.count || 0,
                userRoleBreakdown
            };
            setStats(stats);
            
            // Update system status
            setSystemStatus({
                databaseConnected: true,
                apiWorking: true,
                lastChecked: new Date().toLocaleTimeString()
            });
        } catch (error) {
            console.error("Failed to fetch dashboard stats:", error);
            setStats({
                landlordCount: 0,
                propertyCount: 0,
                unitCount: 0,
                applicantCount: 0,
                tenantCount: 0,
                leaseCount: 0,
                userCount: 0,
                companyCount: 0,
                vendorCount: 0,
                userRoleBreakdown: {
                    global_admin: 0,
                    company_admin: 0,
                    manager: 0,
                    staff: 0,
                    tenant: 0,
                    landlord: 0,
                    applicant: 0
                }
            });
            
            // Update system status to show error
            setSystemStatus({
                databaseConnected: false,
                apiWorking: false,
                lastChecked: new Date().toLocaleTimeString()
            });
        }
        setIsLoading(false);
    };

    useEffect(() => {
        if (user) {
            fetchStats();
            
            // Auto-refresh every 30 seconds
            const interval = setInterval(() => {
                fetchStats();
            }, 30000);
            
            return () => clearInterval(interval);
        }
    }, [user]);

    if (isLoading) {
        return <p>Loading dashboard...</p>;
    }

    if (!stats) {
        return <p>Could not load dashboard statistics. Please try again later.</p>;
    }

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Dashboard</h2>
            
            {/* Main Dashboard Statistics - Ordered to match left menu */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Users />} title="Landlords" value={stats.landlordCount} page="Landlords" />
                <StatCard icon={<Building2 />} title="Properties" value={stats.propertyCount} page="Properties" />
                <StatCard icon={<Home />} title="Total Units" value={stats.unitCount} page="Properties" />
                <StatCard icon={<Wrench />} title="Vendors" value={stats.vendorCount} page="Vendors" />
            </div>

            {/* Secondary Statistics Row */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Users />} title="Applicants" value={stats.applicantCount} page="Applicants" />
                <StatCard icon={<Users />} title="Tenants" value={stats.tenantCount} page="Tenants" />
                <StatCard icon={<Building />} title="Leases" value={stats.leaseCount} page="Leases" />
                <StatCard icon={<Building />} title="Companies" value={stats.companyCount} page="Admin" />
            </div>

            {/* Third Statistics Row */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Users />} title="Users" value={stats.userCount} page="Admin" />
            </div>

            {/* User Type Breakdown and Property Management Overview */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card title="User Types Breakdown">
                    <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Global Admins</span>
                            <span className="text-sm font-bold text-indigo-600">{stats.userRoleBreakdown.global_admin}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Company Admins</span>
                            <span className="text-sm font-bold text-blue-600">{stats.userRoleBreakdown.company_admin}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Managers</span>
                            <span className="text-sm font-bold text-green-600">{stats.userRoleBreakdown.manager}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Staff</span>
                            <span className="text-sm font-bold text-yellow-600">{stats.userRoleBreakdown.staff}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Landlords</span>
                            <span className="text-sm font-bold text-purple-600">{stats.userRoleBreakdown.landlord}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Applicants</span>
                            <span className="text-sm font-bold text-teal-600">{stats.userRoleBreakdown.applicant}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-700">Tenants</span>
                            <span className="text-sm font-bold text-orange-600">{stats.userRoleBreakdown.tenant}</span>
                        </div>
                    </div>
                </Card>

                <Card title="Property Management Overview">
                    <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Total Landlords</span>
                            <span className="text-sm font-bold text-purple-600">{stats.landlordCount}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Total Tenants</span>
                            <span className="text-sm font-bold text-orange-600">{stats.tenantCount}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Total Applicants</span>
                            <span className="text-sm font-bold text-teal-600">{stats.applicantCount}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">PM Companies</span>
                            <span className="text-sm font-bold text-blue-600">{stats.companyCount}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-700">Properties</span>
                            <span className="text-sm font-bold text-indigo-600">{stats.propertyCount}</span>
                        </div>
                    </div>
                </Card>
            </div>

            {/* System Status */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-1">
                <Card title="System Status">
                    <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                            {systemStatus.databaseConnected ? (
                                <CheckCircle className="w-5 h-5 text-green-500" />
                            ) : (
                                <AlertCircle className="w-5 h-5 text-red-500" />
                            )}
                            <span className={`text-sm ${systemStatus.databaseConnected ? 'text-green-600' : 'text-red-600'}`}>
                                Database connection {systemStatus.databaseConnected ? 'active' : 'failed'}
                            </span>
                        </div>
                        <div className="flex items-center space-x-2">
                            {systemStatus.apiWorking ? (
                                <CheckCircle className="w-5 h-5 text-green-500" />
                            ) : (
                                <AlertCircle className="w-5 h-5 text-red-500" />
                            )}
                            <span className={`text-sm ${systemStatus.apiWorking ? 'text-green-600' : 'text-red-600'}`}>
                                Supabase API {systemStatus.apiWorking ? 'working' : 'failed'}
                            </span>
                        </div>
                        <div className="flex items-center space-x-2">
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            <span className="text-sm text-green-600">
                                Vercel deployment active
                            </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-2">
                            Last checked: {systemStatus.lastChecked || 'Never'}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                            All data retrieved from live database
                        </div>
                    </div>
                </Card>
            </div>

        </div>
    );
}

/**
 * A reusable component for displaying dashboard statistics
 * @param {React.ReactElement} icon - Icon component to display
 * @param {string} title - Title text for the statistic
 * @param {string|number} value - The statistic value to display
 * @param {string} page - The page name to navigate to when clicked
 */
const StatCard = ({ icon, title, value, page }) => {
    const { setActivePage } = useContext(SidebarContext);
    
    const handleClick = () => {
        if (page && setActivePage) {
            setActivePage(page);
        }
    };
    
    return (
        <div 
            onClick={handleClick}
            className={page ? 'cursor-pointer' : ''}
        >
            <Card title="" className={`bg-white ${page ? 'hover:shadow-xl transition-shadow duration-200' : ''}`}>
                <div className="flex items-center">
                    <div className="p-3 bg-indigo-100 rounded-lg text-indigo-600">
                        {React.cloneElement(icon, { size: 24 })}
                    </div>
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-500">{title}</p>
                        <p className="text-2xl font-bold text-gray-900">{value}</p>
                    </div>
                </div>
            </Card>
        </div>
    );
};

