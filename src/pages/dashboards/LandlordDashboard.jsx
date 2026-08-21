import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Building2, Home, FileText, Wrench, DollarSign, TrendingUp, Calendar, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext, SidebarContext } from '../../contexts';
import { Card } from '../../components/ui';
import { formatUnitQualifier } from '../../utils/unit-display.js';

export default function LandlordDashboard() {
    const { user } = useContext(AuthContext);
    const { setActivePage } = useContext(SidebarContext);
    const [stats, setStats] = useState(null);
    const [pendingTasks, setPendingTasks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDashboardData = useCallback(async () => {
        setIsLoading(true);
        try {
            const userId = user.user_id;

            const { data: landlord } = await supabase
                .from('landlords')
                .select('landlord_id')
                .eq('user_id', userId)
                .eq('is_archived', false)
                .maybeSingle();

            if (!landlord?.landlord_id) {
            setStats({
                propertyCount: 0,
                unitCount: 0,
                activeLeaseCount: 0,
                pendingMaintenance: 0,
                upcomingRenewals: 0,
                totalRent: 0,
            });
                setIsLoading(false);
                return;
            }

            const landlordId = landlord.landlord_id;

            const { data: properties, count: propertyCount } = await supabase
                .from('properties')
                .select('*', { count: 'exact' })
                .eq('landlord_id', landlordId)
                .eq('is_archived', false);

            const propertyIds = properties?.map(p => p.property_id) || [];

            const { data: units, count: unitCount } = propertyIds.length > 0
                ? await supabase
                    .from('units')
                    .select('*', { count: 'exact' })
                    .in('property_id', propertyIds)
                : { data: [], count: 0 };

            const unitIds = units?.map(u => u.unit_id) || [];
            const { data: leases } = unitIds.length > 0
                ? await supabase
                    .from('leases')
                    .select('lease_id, unit_id, start_date, end_date, status, monthly_rent_amount')
                    .in('unit_id', unitIds)
                : { data: [] };

            const activeLeases = leases?.filter(l => l.status === 'active') || [];

            const totalRent = activeLeases.reduce((sum, lease) => {
                return sum + (parseFloat(lease.monthly_rent_amount) || 0);
            }, 0);

            const { data: maintenanceRequests } = unitIds.length > 0
                ? await supabase
                    .from('maintenance_requests')
                    .select('request_id, status, priority')
                    .in('unit_id', unitIds)
                    .eq('is_archived', false)
                : { data: [] };

            const pendingMaintenance = maintenanceRequests?.filter(r => 
                ['New', 'In Progress', 'On Hold'].includes(r.status)
            ).length || 0;

            // Upcoming renewals: leases expiring in next 90 days
            const today = new Date();
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + 90);
            const upcomingRenewals = activeLeases.filter(lease => {
                if (!lease.end_date) return false;
                const endDate = new Date(lease.end_date);
                return endDate >= today && endDate <= futureDate;
            });

            const occupiedUnits = activeLeases.length;
            const occupancyRate = unitCount > 0 ? (occupiedUnits / unitCount * 100).toFixed(1) : 0;

            const tasks = [];

            // Upcoming renewals: expiring in next 90 days
            upcomingRenewals.forEach(lease => {
                tasks.push({
                    type: 'renewal',
                    title: `Lease Renewal Needed`,
                    description: `Lease expires on ${new Date(lease.end_date).toLocaleDateString()}`,
                    priority: 'high',
                    dueDate: lease.end_date,
                    leaseId: lease.lease_id,
                });
            });

            const urgentMaintenance = maintenanceRequests?.filter(r => 
                r.priority === 'Urgent' && ['New', 'In Progress'].includes(r.status)
            ) || [];

            urgentMaintenance.forEach(req => {
                const unit = units.find(u => u.unit_id === req.unit_id);
                tasks.push({
                    type: 'maintenance',
                    title: `Urgent Maintenance Required`,
                    description: [formatUnitQualifier(unit), req.description?.substring(0, 50) || 'No description'].filter(Boolean).join(' - '),
                    priority: 'urgent',
                    requestId: req.request_id,
                });
            });

            const pendingMaintenanceReqs = maintenanceRequests?.filter(r => 
                ['New', 'In Progress'].includes(r.status) && r.priority !== 'Urgent'
            ) || [];

            pendingMaintenanceReqs.slice(0, 5).forEach(req => {
                const unit = units.find(u => u.unit_id === req.unit_id);
                tasks.push({
                    type: 'maintenance',
                    title: `Maintenance Request`,
                    description: [formatUnitQualifier(unit), req.description?.substring(0, 50) || 'No description'].filter(Boolean).join(' - '),
                    priority: req.priority === 'High' ? 'high' : 'medium',
                    requestId: req.request_id,
                });
            });

            setStats({
                propertyCount: propertyCount || 0,
                unitCount: unitCount || 0,
                activeLeaseCount: activeLeases.length,
                pendingMaintenance: pendingMaintenance,
                upcomingRenewals: upcomingRenewals.length,
                totalRent: totalRent,
                occupancyRate: occupancyRate,
                totalMaintenance: maintenanceRequests?.length || 0,
            });

            setPendingTasks(tasks.slice(0, 10));
        } catch (error) {
            console.error('Error fetching landlord dashboard data:', error);
            setStats({
                propertyCount: 0,
                unitCount: 0,
                activeLeaseCount: 0,
                pendingMaintenance: 0,
                upcomingRenewals: 0,
                totalRent: 0,
                occupancyRate: 0,
                totalMaintenance: 0,
            });
            setPendingTasks([]);
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (user) {
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

    const StatCard = ({ icon, title, value, page, color = 'indigo', format = 'number' }) => {
        const colorClasses = {
            indigo: 'text-indigo-600 bg-indigo-100',
            blue: 'text-blue-600 bg-blue-100',
            green: 'text-green-600 bg-green-100',
            yellow: 'text-yellow-600 bg-yellow-100',
            orange: 'text-orange-600 bg-orange-100',
            red: 'text-red-600 bg-red-100',
            purple: 'text-purple-600 bg-purple-100',
        };

        const formatValue = (val) => {
            if (format === 'currency') {
                return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else if (format === 'percent') {
                return `${val}%`;
            }
            return val;
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
                            <p className={`text-2xl font-bold ${colorClasses[color].split(' ')[0]}`}>
                                {formatValue(value)}
                            </p>
                        </div>
                    </div>
                </Card>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Landlord Dashboard</h2>

            {/* Main Statistics */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Building2 />} title="Properties" value={stats?.propertyCount || 0} page="Properties" color="indigo" />
                <StatCard icon={<Home />} title="Units" value={stats?.unitCount || 0} page="Properties" color="blue" />
                <StatCard icon={<FileText />} title="Active Leases" value={stats?.activeLeaseCount || 0} page="Leases" color="green" />
                <StatCard icon={<TrendingUp />} title="Occupancy Rate" value={stats?.occupancyRate || 0} page="Properties" color="purple" format="percent" />
            </div>

            {/* Financial Summary */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<DollarSign />} title="Monthly Rent" value={stats?.totalRent || 0} page="Leases" color="green" format="currency" />
                <StatCard icon={<Wrench />} title="Pending Maintenance" value={stats?.pendingMaintenance || 0} page="Maintenance" color="orange" />
                <StatCard icon={<Calendar />} title="Upcoming Renewals" value={stats?.upcomingRenewals || 0} page="Leases" color="yellow" />
                <StatCard icon={<AlertCircle />} title="Total Maintenance" value={stats?.totalMaintenance || 0} page="Maintenance" color="red" />
            </div>

            {/* Property Performance Overview */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card title="Property Overview">
                    <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Total Properties</span>
                            <span className="text-sm font-bold text-indigo-600">{stats?.propertyCount || 0}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Total Units</span>
                            <span className="text-sm font-bold text-blue-600">{stats?.unitCount || 0}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Active Leases</span>
                            <span className="text-sm font-bold text-green-600">{stats?.activeLeaseCount || 0}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-700">Occupancy Rate</span>
                            <span className="text-sm font-bold text-purple-600">{stats?.occupancyRate || 0}%</span>
                        </div>
                    </div>
                </Card>

                <Card title="Financial Summary">
                    <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm font-medium text-gray-700">Monthly Rent Income</span>
                            <span className="text-sm font-bold text-green-600">
                                ${(stats?.totalRent || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-700">Upcoming Renewals</span>
                            <span className="text-sm font-bold text-yellow-600">{stats?.upcomingRenewals || 0}</span>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Pending Tasks */}
            <Card title="Pending Tasks">
                {pendingTasks.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No pending tasks</p>
                ) : (
                    <div className="space-y-3">
                        {pendingTasks.map((task, index) => (
                            <div
                                key={index}
                                className="flex items-start justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`px-2 py-1 text-xs font-semibold rounded ${
                                            task.priority === 'urgent' ? 'text-red-600 bg-red-100' :
                                            task.priority === 'high' ? 'text-orange-600 bg-orange-100' :
                                            'text-yellow-600 bg-yellow-100'
                                        }`}>
                                            {task.priority.toUpperCase()}
                                        </span>
                                        <span className="text-sm font-medium text-gray-700">{task.title}</span>
                                    </div>
                                    <p className="text-sm text-gray-600">{task.description}</p>
                                    {task.dueDate && (
                                        <p className="text-xs text-gray-500 mt-1">
                                            Due: {new Date(task.dueDate).toLocaleDateString()}
                                        </p>
                                    )}
                                </div>
                                <div className="ml-4">
                                    {task.type === 'maintenance' && (
                                        <button
                                            onClick={() => setActivePage('Maintenance')}
                                            className="text-sm text-indigo-600 hover:text-indigo-800"
                                        >
                                            View
                                        </button>
                                    )}
                                    {task.type === 'renewal' && (
                                        <button
                                            onClick={() => setActivePage('Leases')}
                                            className="text-sm text-indigo-600 hover:text-indigo-800"
                                        >
                                            View
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Maintenance Overview */}
            <Card title="Maintenance Overview">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700">Pending Requests</span>
                            <span className="text-lg font-bold text-orange-600">{stats?.pendingMaintenance || 0}</span>
                        </div>
                    </div>
                    <div className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700">Total Requests</span>
                            <span className="text-lg font-bold text-blue-600">{stats?.totalMaintenance || 0}</span>
                        </div>
                    </div>
                    <div className="p-4 border border-gray-200 rounded-lg">
                        <button
                            onClick={() => setActivePage('Maintenance')}
                            className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                        >
                            View All Maintenance
                        </button>
                    </div>
                </div>
            </Card>
        </div>
    );
}

