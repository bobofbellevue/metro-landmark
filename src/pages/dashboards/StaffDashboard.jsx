import React, { useState, useEffect, useContext, useCallback } from 'react';
import { ClipboardList, Clock, CheckCircle, AlertCircle, FileText, Wrench } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext, SidebarContext } from '../../contexts';
import { Card } from '../../components/ui';

export default function StaffDashboard() {
    const { user } = useContext(AuthContext);
    const { setActivePage } = useContext(SidebarContext);
    const [stats, setStats] = useState(null);
    const [assignedTasks, setAssignedTasks] = useState([]);
    const [recentActivity, setRecentActivity] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDashboardData = useCallback(async () => {
        setIsLoading(true);
        try {
            const userId = user.user_id;
            const pmcId = user.pmc_id;

            // For staff, we'll show tasks they might be assigned to
            // This is a simplified version - in a full implementation, you'd have a tasks/assignments table
            
            // Fetch maintenance requests that might be assigned to staff
            // (In a real system, there would be an assignment table)
            let maintenanceQuery = supabase
                .from('maintenance_requests')
                .select('request_id, unit_id, status, priority, created_at, description')
                .eq('is_archived', false);

            if (pmcId) {
                // Get properties for this company
                const { data: properties } = await supabase
                    .from('properties')
                    .select('property_id')
                    .eq('pmc_id', pmcId)
                    .eq('is_archived', false);

                const propertyIds = properties?.map(p => p.property_id) || [];

                if (propertyIds.length > 0) {
                    // Get units for these properties
                    const { data: units } = await supabase
                        .from('units')
                        .select('unit_id')
                        .in('property_id', propertyIds);

                    const unitIds = units?.map(u => u.unit_id) || [];

                    if (unitIds.length > 0) {
                        maintenanceQuery = maintenanceQuery.in('unit_id', unitIds);
                    } else {
                        maintenanceQuery = maintenanceQuery.eq('unit_id', -1); // No results
                    }
                } else {
                    maintenanceQuery = maintenanceQuery.eq('unit_id', -1); // No results
                }
            }

            const { data: maintenanceRequests } = await maintenanceQuery;

            // Calculate task stats
            const pendingTasks = maintenanceRequests?.filter(r => 
                ['New', 'In Progress', 'On Hold'].includes(r.status)
            ) || [];

            const completedTasks = maintenanceRequests?.filter(r => 
                r.status === 'Completed'
            ) || [];

            const urgentTasks = pendingTasks.filter(r => r.priority === 'Urgent');

            // Create assigned tasks list (simplified - showing recent pending tasks)
            const tasks = pendingTasks.slice(0, 5).map(req => ({
                id: req.request_id,
                type: 'maintenance',
                title: `Maintenance Request #${req.request_id}`,
                description: req.description?.substring(0, 100) || 'No description',
                status: req.status,
                priority: req.priority,
                createdAt: req.created_at,
            }));

            // Recent activity (completed tasks)
            const activity = completedTasks.slice(0, 5).map(req => ({
                id: req.request_id,
                type: 'maintenance',
                title: `Completed: Maintenance Request #${req.request_id}`,
                description: req.description?.substring(0, 100) || 'No description',
                completedAt: req.created_at,
            }));

            setStats({
                assignedTasks: pendingTasks.length,
                completedTasks: completedTasks.length,
                urgentTasks: urgentTasks.length,
                totalTasks: maintenanceRequests?.length || 0,
            });

            setAssignedTasks(tasks);
            setRecentActivity(activity);
        } catch (error) {
            console.error('Error fetching staff dashboard data:', error);
            setStats({
                assignedTasks: 0,
                completedTasks: 0,
                urgentTasks: 0,
                totalTasks: 0,
            });
            setAssignedTasks([]);
            setRecentActivity([]);
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

    const StatCard = ({ icon, title, value, page, color = 'indigo' }) => {
        const colorClasses = {
            indigo: 'text-indigo-600 bg-indigo-100',
            blue: 'text-blue-600 bg-blue-100',
            green: 'text-green-600 bg-green-100',
            yellow: 'text-yellow-600 bg-yellow-100',
            orange: 'text-orange-600 bg-orange-100',
            red: 'text-red-600 bg-red-100',
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

    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'Urgent': return 'text-red-600 bg-red-100';
            case 'High': return 'text-orange-600 bg-orange-100';
            case 'Medium': return 'text-yellow-600 bg-yellow-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Staff Dashboard</h2>

            {/* Main Statistics */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<ClipboardList />} title="Assigned Tasks" value={stats?.assignedTasks || 0} page="Maintenance" color="indigo" />
                <StatCard icon={<AlertCircle />} title="Urgent Tasks" value={stats?.urgentTasks || 0} page="Maintenance" color="red" />
                <StatCard icon={<CheckCircle />} title="Completed Tasks" value={stats?.completedTasks || 0} page="Maintenance" color="green" />
                <StatCard icon={<Clock />} title="Total Tasks" value={stats?.totalTasks || 0} page="Maintenance" color="blue" />
            </div>

            {/* Assigned Tasks and Recent Activity */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card title="Assigned Tasks">
                    {assignedTasks.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">No assigned tasks</p>
                    ) : (
                        <div className="space-y-3">
                            {assignedTasks.map((task) => (
                                <div
                                    key={task.id}
                                    className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                                >
                                    <div className="flex items-start justify-between mb-1">
                                        <span className="text-sm font-medium text-gray-700">{task.title}</span>
                                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getPriorityColor(task.priority)}`}>
                                            {task.priority}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500">Status: {task.status}</span>
                                        <button
                                            onClick={() => setActivePage('Maintenance')}
                                            className="text-xs text-indigo-600 hover:text-indigo-800"
                                        >
                                            View Details
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                <Card title="Recent Activity">
                    {recentActivity.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">No recent activity</p>
                    ) : (
                        <div className="space-y-3">
                            {recentActivity.map((activity) => (
                                <div
                                    key={activity.id}
                                    className="p-3 border border-gray-200 rounded-lg bg-green-50"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                        <span className="text-sm font-medium text-gray-700">{activity.title}</span>
                                    </div>
                                    <p className="text-sm text-gray-600 mb-2">{activity.description}</p>
                                    <span className="text-xs text-gray-500">
                                        {activity.completedAt ? new Date(activity.completedAt).toLocaleDateString() : ''}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* Quick Actions */}
            <Card title="Quick Actions">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <button
                        onClick={() => setActivePage('Maintenance')}
                        className="flex items-center gap-2 p-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-left"
                    >
                        <Wrench className="w-5 h-5 text-indigo-600" />
                        <span className="text-sm font-medium text-gray-700">View Maintenance</span>
                    </button>
                    <button
                        onClick={() => setActivePage('Properties')}
                        className="flex items-center gap-2 p-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-left"
                    >
                        <FileText className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-medium text-gray-700">View Properties</span>
                    </button>
                </div>
            </Card>
        </div>
    );
}

