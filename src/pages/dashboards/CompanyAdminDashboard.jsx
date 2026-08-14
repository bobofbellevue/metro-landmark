import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Building2, Home, FileText, Wrench, Users, TrendingUp, AlertCircle, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext, SidebarContext } from '../../contexts';
import { Card } from '../../components/ui';

export default function CompanyAdminDashboard() {
    const { user } = useContext(AuthContext);
    const { setActivePage } = useContext(SidebarContext);
    const [stats, setStats] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDashboardData = useCallback(async () => {
        setIsLoading(true);
        try {
            const pmcId = user.pmc_id;

            // Fetch company information
            const { data: company } = await supabase
                .from('pm_companies')
                .select('company_name')
                .eq('pmc_id', pmcId)
                .single();

            // Fetch properties managed by company
            const { data: properties, count: propertyCount } = await supabase
                .from('properties')
                .select('*', { count: 'exact' })
                .eq('pmc_id', pmcId)
                .eq('is_archived', false);

            const propertyIds = properties?.map(p => p.property_id) || [];

            // Fetch units for company properties
            const { data: units, count: unitCount } = propertyIds.length > 0
                ? await supabase
                    .from('units')
                    .select('*', { count: 'exact' })
                    .in('property_id', propertyIds)
                : { data: [], count: 0 };

            // Fetch leases under management
            const { count: leaseCount } = await supabase
                .from('leases')
                .select('*', { count: 'exact' })
                .eq('pmc_id', pmcId)
                .eq('status', 'active');

            // Fetch maintenance requests for company properties
            const unitIds = units?.map(u => u.unit_id) || [];
            const { data: maintenanceRequests } = unitIds.length > 0
                ? await supabase
                    .from('maintenance_requests')
                    .select('request_id, status, priority')
                    .in('unit_id', unitIds)
                    .eq('is_archived', false)
                : { data: [] };

            // Fetch staff count (users with manager or staff role in this company)
            const { count: staffCount } = await supabase
                .from('users')
                .select('*', { count: 'exact' })
                .eq('pmc_id', pmcId)
                .in('role', ['manager', 'staff'])
                .eq('is_archived', false);

            // Calculate maintenance stats
            const pendingMaintenance = maintenanceRequests?.filter(r => 
                ['New', 'In Progress', 'On Hold'].includes(r.status)
            ).length || 0;
            const urgentMaintenance = maintenanceRequests?.filter(r => 
                r.priority === 'Urgent'
            ).length || 0;

            // Fetch upcoming lease renewals (leases expiring in next 90 days)
            const today = new Date();
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + 90);
            const { data: upcomingRenewals } = await supabase
                .from('leases')
                .select('lease_id')
                .eq('pmc_id', pmcId)
                .eq('status', 'active')
                .gte('end_date', today.toISOString().split('T')[0])
                .lte('end_date', futureDate.toISOString().split('T')[0]);

            setStats({
                companyName: company?.company_name || 'Company',
                propertyCount: propertyCount || 0,
                unitCount: unitCount || 0,
                leaseCount: leaseCount || 0,
                staffCount: staffCount || 0,
                pendingMaintenance: pendingMaintenance,
                urgentMaintenance: urgentMaintenance,
                totalMaintenance: maintenanceRequests?.length || 0,
                upcomingRenewals: upcomingRenewals?.length || 0,
            });
        } catch (error) {
            console.error('Error fetching company admin dashboard data:', error);
            setStats({
                companyName: 'Company',
                propertyCount: 0,
                unitCount: 0,
                leaseCount: 0,
                staffCount: 0,
                pendingMaintenance: 0,
                urgentMaintenance: 0,
                totalMaintenance: 0,
                upcomingRenewals: 0,
            });
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (user && user.pmc_id) {
            fetchDashboardData();
        }
    }, [user, fetchDashboardData]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    const StatCard = ({ icon, title, value, page, color = 'indigo' }) => {
        const colorClasses = {
            indigo: 'text-indigo-600 bg-indigo-100',
            blue: 'text-blue-600 bg-blue-100',
            green: 'text-green-600 bg-green-100',
            yellow: 'text-yellow-600 bg-yellow-100',
            orange: 'text-orange-600 bg-orange-100',
            red: 'text-red-600 bg-red-100',
            purple: 'text-purple-600 bg-purple-100',
        };

        return (
            <div
                onClick={() => page && setActivePage(page)}
                className={page ? 'cursor-pointer' : ''}
            >
                <Card className={`bg-white ${page ? 'hover:shadow-xl transition-shadow duration-200' : ''}`}>
                    <div className="flex items-center">
                        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
                            {React.cloneElement(icon, { size: 24 })}
                        </div>
                        <div className="ml-4">
                            <p className="text-sm font-medium text-gray-500">{title}</p>
                            <p className={`text-2xl font-bold ${colorClasses[color].split(' ')[0]}`}>{value}</p>
                        </div>
                    </div>
                </Card>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold text-gray-800">Company Dashboard</h2>
                <p className="text-gray-600 mt-1">{stats?.companyName}</p>
            </div>

            {/* Main Statistics */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Building2 />} title="Properties" value={stats?.propertyCount || 0} page="Properties" color="indigo" />
                <StatCard icon={<Home />} title="Units" value={stats?.unitCount || 0} page="Properties" color="blue" />
                <StatCard icon={<FileText />} title="Active Leases" value={stats?.leaseCount || 0} page="Leases" color="green" />
                <StatCard icon={<Users />} title="Staff" value={stats?.staffCount || 0} page="Admin" color="purple" />
            </div>

            {/* Secondary Statistics */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Wrench />} title="Pending Maintenance" value={stats?.pendingMaintenance || 0} page="Maintenance" color="orange" />
                <StatCard icon={<AlertCircle />} title="Urgent Maintenance" value={stats?.urgentMaintenance || 0} page="Maintenance" color="red" />
                <StatCard icon={<Clock />} title="Upcoming Renewals" value={stats?.upcomingRenewals || 0} page="Leases" color="yellow" />
                <StatCard icon={<TrendingUp />} title="Total Maintenance" value={stats?.totalMaintenance || 0} page="Maintenance" color="blue" />
            </div>

            {/* Company Overview */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card title="Company Overview">
                    <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Properties Managed</span>
                            <span className="text-sm font-bold text-indigo-600">{stats?.propertyCount || 0}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Total Units</span>
                            <span className="text-sm font-bold text-blue-600">{stats?.unitCount || 0}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Active Leases</span>
                            <span className="text-sm font-bold text-green-600">{stats?.leaseCount || 0}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-700">Staff Members</span>
                            <span className="text-sm font-bold text-purple-600">{stats?.staffCount || 0}</span>
                        </div>
                    </div>
                </Card>

                <Card title="Maintenance Overview">
                    <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Pending Requests</span>
                            <span className="text-sm font-bold text-orange-600">{stats?.pendingMaintenance || 0}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Urgent Priority</span>
                            <span className="text-sm font-bold text-red-600">{stats?.urgentMaintenance || 0}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Total Requests</span>
                            <span className="text-sm font-bold text-blue-600">{stats?.totalMaintenance || 0}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-700">Upcoming Renewals</span>
                            <span className="text-sm font-bold text-yellow-600">{stats?.upcomingRenewals || 0}</span>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}

