import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Wrench, Calendar, DollarSign, Clock, CheckCircle, AlertCircle, FileText, User } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext, SidebarContext } from '../../contexts';
import { Card } from '../../components/ui';

export default function VendorDashboard() {
    const { user } = useContext(AuthContext);
    const { setActivePage } = useContext(SidebarContext);
    const [stats, setStats] = useState(null);
    const [assignedRequests, setAssignedRequests] = useState([]);
    const [upcomingAppointments, setUpcomingAppointments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDashboardData = useCallback(async () => {
        setIsLoading(true);
        try {
            if (!user?.user_id) {
                setIsLoading(false);
                return;
            }

            // Find vendor by user_id
            const { data: vendorData, error: vendorError } = await supabase
                .from('vendors')
                .select('vendor_id, company_name')
                .eq('user_id', user.user_id)
                .maybeSingle();

            if (vendorError || !vendorData) {
                console.error('Error fetching vendor:', vendorError);
                setStats({
                    assignedRequests: 0,
                    completedRequests: 0,
                    urgentRequests: 0,
                    totalRequests: 0,
                    upcomingAppointments: 0,
                });
                setIsLoading(false);
                return;
            }

            const vendorId = vendorData.vendor_id;

            // Fetch maintenance requests assigned to this vendor
            const { data: maintenanceRequests, error: requestsError } = await supabase
                .from('maintenance_requests')
                .select(`
                    request_id,
                    description,
                    status,
                    priority,
                    created_at,
                    completed_at,
                    scheduled_date,
                    units!inner(
                        unit_id,
                        unit_number,
                        properties!inner(
                            property_id,
                            property_name
                        )
                    )
                `)
                .eq('assigned_vendor_id', vendorId)
                .eq('is_archived', false)
                .order('created_at', { ascending: false });

            if (requestsError) {
                console.error('Error fetching maintenance requests:', requestsError);
            }

            // Calculate stats
            const assigned = maintenanceRequests?.filter(r => 
                ['New', 'In Progress', 'On Hold'].includes(r.status)
            ) || [];
            const completed = maintenanceRequests?.filter(r => 
                r.status === 'Completed'
            ) || [];
            const urgent = assigned.filter(r => r.priority === 'Urgent');

            // Get upcoming appointments (scheduled maintenance requests)
            const today = new Date();
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + 30);
            const upcoming = assigned.filter(req => {
                if (!req.scheduled_date) return false;
                const scheduled = new Date(req.scheduled_date);
                return scheduled >= today && scheduled <= futureDate;
            }).sort((a, b) => {
                const dateA = new Date(a.scheduled_date);
                const dateB = new Date(b.scheduled_date);
                return dateA - dateB;
            });

            // Fetch addresses for properties
            const propertyIds = [...new Set(
                maintenanceRequests?.map(r => r.units?.properties?.property_id).filter(Boolean) || []
            )];
            
            const { data: addresses } = propertyIds.length > 0 ? await supabase
                .from('addresses')
                .select('*')
                .eq('addressable_type', 'property')
                .in('addressable_id', propertyIds) : { data: [] };

            // Enhance requests with address data
            const requestsWithData = (maintenanceRequests || []).map(request => {
                const propertyId = request.units?.properties?.property_id;
                const address = addresses?.find(a => a.addressable_id === propertyId) || {};
                
                return {
                    ...request,
                    address_line_1: address.address_line_1 || '',
                    city: address.city || '',
                    state: address.state_province_region || '',
                    postal_code: address.postal_code || '',
                    unit_number: request.units?.unit_number || '',
                    property_name: request.units?.properties?.property_name || '',
                };
            });

            setStats({
                assignedRequests: assigned.length,
                completedRequests: completed.length,
                urgentRequests: urgent.length,
                totalRequests: maintenanceRequests?.length || 0,
                upcomingAppointments: upcoming.length,
            });

            setAssignedRequests(requestsWithData.filter(r => 
                ['New', 'In Progress', 'On Hold'].includes(r.status)
            ).slice(0, 5));

            setUpcomingAppointments(upcoming.slice(0, 5));
        } catch (error) {
            console.error('Error fetching vendor dashboard data:', error);
            setStats({
                assignedRequests: 0,
                completedRequests: 0,
                urgentRequests: 0,
                totalRequests: 0,
                upcomingAppointments: 0,
            });
            setAssignedRequests([]);
            setUpcomingAppointments([]);
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (user && user.user_id) {
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

    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'Urgent': return 'text-red-600 bg-red-100';
            case 'High': return 'text-orange-600 bg-orange-100';
            case 'Medium': return 'text-yellow-600 bg-yellow-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'New': return 'text-blue-600 bg-blue-100';
            case 'In Progress': return 'text-yellow-600 bg-yellow-100';
            case 'On Hold': return 'text-gray-600 bg-gray-100';
            case 'Completed': return 'text-green-600 bg-green-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    const formatAddress = (request) => {
        const parts = [
            request.address_line_1,
            request.city,
            request.state,
            request.postal_code
        ].filter(Boolean);
        return parts.join(', ') || 'Address not available';
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold text-gray-800">Vendor Dashboard</h2>
                <p className="text-gray-600 mt-1">Manage your work orders and appointments</p>
            </div>

            {/* Main Statistics */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Wrench />} title="Assigned Requests" value={stats?.assignedRequests || 0} page="Maintenance" color="indigo" />
                <StatCard icon={<AlertCircle />} title="Urgent Requests" value={stats?.urgentRequests || 0} page="Maintenance" color="red" />
                <StatCard icon={<CheckCircle />} title="Completed" value={stats?.completedRequests || 0} page="Maintenance" color="green" />
                <StatCard icon={<Calendar />} title="Upcoming Appointments" value={stats?.upcomingAppointments || 0} page="Maintenance" color="blue" />
            </div>

            {/* Assigned Requests and Upcoming Appointments */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card title="Recent Assigned Requests">
                    {assignedRequests.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">No assigned requests</p>
                    ) : (
                        <div className="space-y-3">
                            {assignedRequests.map((request) => (
                                <div
                                    key={request.request_id}
                                    className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                                >
                                    <div className="flex items-start justify-between mb-1">
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-gray-700">
                                                {formatAddress(request)}
                                            </p>
                                            <p className="text-xs text-gray-500">Unit {request.unit_number}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded ${getStatusColor(request.status)}`}>
                                                {request.status}
                                            </span>
                                            <span className={`px-2 py-1 text-xs font-semibold rounded ${getPriorityColor(request.priority)}`}>
                                                {request.priority}
                                            </span>
                                        </div>
                                    </div>
                                    <p className="text-sm text-gray-600 mb-2">{request.description?.substring(0, 100) || 'No description'}</p>
                                    {request.scheduled_date && (
                                        <p className="text-xs text-gray-500">
                                            Scheduled: {new Date(request.scheduled_date).toLocaleDateString()}
                                        </p>
                                    )}
                                    <button
                                        onClick={() => setActivePage('Maintenance')}
                                        className="mt-2 text-xs text-indigo-600 hover:text-indigo-800"
                                    >
                                        View Details →
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                <Card title="Upcoming Appointments">
                    {upcomingAppointments.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">No upcoming appointments</p>
                    ) : (
                        <div className="space-y-3">
                            {upcomingAppointments.map((request) => (
                                <div
                                    key={request.request_id}
                                    className="p-3 border border-gray-200 rounded-lg bg-blue-50"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <Calendar className="w-4 h-4 text-blue-600" />
                                        <span className="text-sm font-medium text-gray-700">
                                            {new Date(request.scheduled_date).toLocaleDateString('en-US', {
                                                weekday: 'short',
                                                month: 'short',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </span>
                                    </div>
                                    <p className="text-sm font-medium text-gray-700 mb-1">
                                        {formatAddress(request)}
                                    </p>
                                    <p className="text-xs text-gray-600">Unit {request.unit_number}</p>
                                    <p className="text-sm text-gray-600 mt-2">{request.description?.substring(0, 80) || 'No description'}</p>
                                    <button
                                        onClick={() => setActivePage('Maintenance')}
                                        className="mt-2 text-xs text-indigo-600 hover:text-indigo-800"
                                    >
                                        View Details →
                                    </button>
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
                        <span className="text-sm font-medium text-gray-700">View All Requests</span>
                    </button>
                    <button
                        onClick={() => setActivePage('Profile')}
                        className="flex items-center gap-2 p-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-left"
                    >
                        <User className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-medium text-gray-700">Update Profile</span>
                    </button>
                </div>
            </Card>
        </div>
    );
}

