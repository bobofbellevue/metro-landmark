import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Building2, FileText, Wrench, Calendar, AlertTriangle, CheckCircle, Clock, TrendingUp, ClipboardCheck, Shield, FileCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext, SidebarContext } from '../../contexts';
import { Card } from '../../components/ui';
import { isAwaitingNoticeService } from '../../utils/notice-service-workflow.js';

export default function ManagerDashboard() {
    const { user } = useContext(AuthContext);
    const { setActivePage } = useContext(SidebarContext);
    const [stats, setStats] = useState(null);
    const [pendingTasks, setPendingTasks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDashboardData = useCallback(async () => {
        setIsLoading(true);
        try {
            const userId = user.user_id;
            const pmcId = user.pmc_id;

            // Fetch properties assigned to this manager
            // Managers can be assigned via properties.manager_id or through pmc_id
            let propertyQuery = supabase
                .from('properties')
                .select('property_id, property_name')
                .eq('is_archived', false);

            if (pmcId) {
                propertyQuery = propertyQuery.eq('pmc_id', pmcId);
            }

            const { data: properties, count: propertyCount } = await propertyQuery;

            const propertyIds = properties?.map(p => p.property_id) || [];

            // Fetch units for assigned properties
            const { data: units, count: unitCount } = propertyIds.length > 0
                ? await supabase
                    .from('units')
                    .select('unit_id, unit_number, property_id')
                    .in('property_id', propertyIds)
                : { data: [], count: 0 };

            // Fetch leases for assigned properties
            const unitIds = units?.map(u => u.unit_id) || [];
            const { data: leases } = unitIds.length > 0
                ? await supabase
                    .from('leases')
                    .select('lease_id, unit_id, start_date, end_date, status, monthly_rent_amount')
                    .in('unit_id', unitIds)
                : { data: [] };

            const activeLeases = leases?.filter(l => l.status === 'active') || [];

            // Fetch maintenance requests
            const { data: maintenanceRequests } = unitIds.length > 0
                ? await supabase
                    .from('maintenance_requests')
                    .select('request_id, unit_id, status, priority, created_at, description')
                    .in('unit_id', unitIds)
                    .eq('is_archived', false)
                : { data: [] };

            // Calculate pending tasks
            const tasks = [];
            const today = new Date();

            // Lease renewals (expiring in next 60 days)
            const renewalDate = new Date();
            renewalDate.setDate(today.getDate() + 60);
            const expiringLeases = activeLeases.filter(lease => {
                if (!lease.end_date) return false;
                const endDate = new Date(lease.end_date);
                return endDate >= today && endDate <= renewalDate;
            });

            expiringLeases.forEach(lease => {
                tasks.push({
                    type: 'lease_renewal',
                    title: `Lease Renewal Needed`,
                    description: `Lease expires on ${new Date(lease.end_date).toLocaleDateString()}`,
                    priority: 'high',
                    dueDate: lease.end_date,
                });
            });

            // Urgent maintenance requests
            const urgentMaintenance = maintenanceRequests?.filter(r => 
                r.priority === 'Urgent' && ['New', 'In Progress'].includes(r.status)
            ) || [];

            urgentMaintenance.forEach(req => {
                const unit = units.find(u => u.unit_id === req.unit_id);
                tasks.push({
                    type: 'maintenance',
                    title: `Urgent Maintenance: ${unit?.unit_number || 'Unit'}`,
                    description: req.description?.substring(0, 100) || 'No description',
                    priority: 'urgent',
                    requestId: req.request_id,
                });
            });

            // Pending maintenance requests
            const pendingMaintenance = maintenanceRequests?.filter(r => 
                r.status === 'New' && r.priority !== 'Urgent'
            ) || [];

            // Inspections (upcoming inspections in next 30 days)
            const inspectionDate = new Date();
            inspectionDate.setDate(today.getDate() + 30);
            const { data: upcomingInspections } = unitIds.length > 0
                ? await supabase
                    .from('property_inspections')
                    .select('inspection_id, unit_id, inspection_type, inspection_date, lease_id')
                    .in('unit_id', unitIds)
                    .gte('inspection_date', today.toISOString().split('T')[0])
                    .lte('inspection_date', inspectionDate.toISOString().split('T')[0])
                    .order('inspection_date', { ascending: true })
                : { data: [] };

            upcomingInspections?.forEach(inspection => {
                const unit = units.find(u => u.unit_id === inspection.unit_id);
                tasks.push({
                    type: 'inspection',
                    title: `${inspection.inspection_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} Inspection`,
                    description: `Unit ${unit?.unit_number || 'N/A'} - ${new Date(inspection.inspection_date).toLocaleDateString()}`,
                    priority: 'medium',
                    dueDate: inspection.inspection_date,
                    inspectionId: inspection.inspection_id,
                });
            });

            // Compliance deadlines (from compliance_workflows)
            const { data: complianceWorkflows } = unitIds.length > 0
                ? await supabase
                    .from('compliance_workflows')
                    .select('workflow_id, workflow_type, required_notice_date, effective_date, status, lease_id')
                    .in('unit_id', unitIds)
                    .in('status', ['draft', 'in_progress'])
                    .not('required_notice_date', 'is', null)
                    .order('required_notice_date', { ascending: true })
                : { data: [] };

            complianceWorkflows?.forEach(workflow => {
                const noticeDate = new Date(workflow.required_notice_date);
                const daysUntil = Math.ceil((noticeDate - today) / (1000 * 60 * 60 * 24));
                if (daysUntil >= 0 && daysUntil <= 30) {
                    tasks.push({
                        type: 'compliance',
                        title: `Compliance: ${workflow.workflow_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
                        description: `Notice required by ${workflow.required_notice_date}`,
                        priority: daysUntil <= 7 ? 'high' : 'medium',
                        dueDate: workflow.required_notice_date,
                        workflowId: workflow.workflow_id,
                    });
                }
            });

            const { data: noticeWorkflows } = unitIds.length > 0
                ? await supabase
                    .from('compliance_workflows')
                    .select('workflow_id, workflow_type, workflow_data, status, unit_id')
                    .in('unit_id', unitIds)
                    .in('status', ['draft', 'in_progress'])
                    .in('workflow_type', ['rent_increase', 'eviction'])
                : { data: [] };

            noticeWorkflows?.filter(isAwaitingNoticeService).forEach(workflow => {
                const unit = units.find(u => u.unit_id === workflow.unit_id);
                const label = workflow.workflow_type === 'eviction'
                    ? 'Eviction notice'
                    : 'Rent increase notice';
                tasks.push({
                    type: 'notice_service',
                    title: `Record service: ${label}`,
                    description: `Unit ${unit?.unit_number || 'N/A'} — notice generated, service not recorded`,
                    priority: 'high',
                    workflowId: workflow.workflow_id,
                });
            });

            // Document generation needed (leases without signed documents)
            const leasesNeedingDocs = activeLeases.filter(lease => {
                // This is a placeholder - would need to check documents table
                // For now, we'll flag leases expiring soon that might need renewal docs
                if (!lease.end_date) return false;
                const endDate = new Date(lease.end_date);
                const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                return daysUntilExpiry <= 60 && daysUntilExpiry > 0;
            });

            leasesNeedingDocs.forEach(lease => {
                const unit = units.find(u => u.unit_id === lease.unit_id);
                tasks.push({
                    type: 'document',
                    title: `Lease Renewal Document Needed`,
                    description: `Unit ${unit?.unit_number || 'N/A'} - Lease expires ${new Date(lease.end_date).toLocaleDateString()}`,
                    priority: 'high',
                    dueDate: lease.end_date,
                    leaseId: lease.lease_id,
                });
            });

            // Calculate stats
            const pendingMaintenanceCount = maintenanceRequests?.filter(r => 
                ['New', 'In Progress', 'On Hold'].includes(r.status)
            ).length || 0;

            const completedMaintenanceCount = maintenanceRequests?.filter(r => 
                r.status === 'Completed'
            ).length || 0;

            setStats({
                propertyCount: propertyCount || 0,
                unitCount: unitCount || 0,
                activeLeaseCount: activeLeases.length,
                pendingMaintenance: pendingMaintenanceCount,
                urgentMaintenance: urgentMaintenance.length,
                completedMaintenance: completedMaintenanceCount,
                upcomingRenewals: expiringLeases.length,
            });

            setPendingTasks(tasks.slice(0, 10)); // Show top 10 tasks
        } catch (error) {
            console.error('Error fetching manager dashboard data:', error);
            setStats({
                propertyCount: 0,
                unitCount: 0,
                activeLeaseCount: 0,
                pendingMaintenance: 0,
                urgentMaintenance: 0,
                completedMaintenance: 0,
                upcomingRenewals: 0,
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
        const palette = colorClasses[color] || colorClasses.indigo;
        const valueColor = palette.split(' ')[0];

        return (
            <div
                onClick={() => page && setActivePage(page)}
                className={page ? 'cursor-pointer' : ''}
            >
                <Card className={`bg-white ${page ? 'hover:shadow-xl transition-shadow duration-200' : ''}`}>
                    <div className="flex items-center">
                        <div className={`p-3 rounded-lg ${palette}`}>
                            {React.cloneElement(icon, { size: 24 })}
                        </div>
                        <div className="ml-4">
                            <p className="text-sm font-medium text-gray-500">{title}</p>
                            <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
                        </div>
                    </div>
                </Card>
            </div>
        );
    };

    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'urgent': return 'text-red-600 bg-red-100';
            case 'high': return 'text-orange-600 bg-orange-100';
            case 'medium': return 'text-yellow-600 bg-yellow-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Manager Dashboard</h2>

            {/* Main Statistics */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Building2 />} title="Assigned Properties" value={stats?.propertyCount || 0} page="Properties" color="indigo" />
                <StatCard icon={<FileText />} title="Active Leases" value={stats?.activeLeaseCount || 0} page="Leases" color="green" />
                <StatCard icon={<Wrench />} title="Pending Maintenance" value={stats?.pendingMaintenance || 0} page="Maintenance" color="orange" />
                <StatCard icon={<AlertTriangle />} title="Urgent Issues" value={stats?.urgentMaintenance || 0} page="Maintenance" color="red" />
            </div>

            {/* Secondary Statistics */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Calendar />} title="Upcoming Renewals" value={stats?.upcomingRenewals || 0} page="Leases" color="yellow" />
                <StatCard icon={<CheckCircle />} title="Completed Maintenance" value={stats?.completedMaintenance || 0} page="Maintenance" color="green" />
                <StatCard icon={<TrendingUp />} title="Total Units" value={stats?.unitCount || 0} page="Properties" color="blue" />
            </div>

            {/* Task Summary Cards */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard 
                    icon={<FileText />} 
                    title="Lease Renewals" 
                    value={pendingTasks.filter(t => t.type === 'lease_renewal').length} 
                    page="Leases" 
                    color="yellow" 
                />
                <StatCard 
                    icon={<ClipboardCheck />} 
                    title="Inspections" 
                    value={pendingTasks.filter(t => t.type === 'inspection').length} 
                    page="Compliance" 
                    color="blue" 
                />
                <StatCard 
                    icon={<Shield />} 
                    title="Compliance Tasks" 
                    value={pendingTasks.filter(t => t.type === 'compliance' || t.type === 'notice_service').length} 
                    page="Compliance" 
                    color="purple" 
                />
                <StatCard 
                    icon={<FileCheck />} 
                    title="Documents Needed" 
                    value={pendingTasks.filter(t => t.type === 'document').length} 
                    page="Documents" 
                    color="orange" 
                />
            </div>

            {/* Pending Tasks */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card title="Pending Tasks" className="lg:col-span-2">
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
                                            <span className={`px-2 py-1 text-xs font-semibold rounded ${getPriorityColor(task.priority)}`}>
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
                                        {task.type === 'lease_renewal' && (
                                            <button
                                                onClick={() => setActivePage('Leases')}
                                                className="text-sm text-indigo-600 hover:text-indigo-800"
                                            >
                                                View
                                            </button>
                                        )}
                                        {task.type === 'inspection' && (
                                            <button
                                                onClick={() => setActivePage('Compliance')}
                                                className="text-sm text-indigo-600 hover:text-indigo-800"
                                            >
                                                View
                                            </button>
                                        )}
                                        {(task.type === 'compliance' || task.type === 'notice_service') && (
                                            <button
                                                onClick={() => setActivePage('Compliance')}
                                                className="text-sm text-indigo-600 hover:text-indigo-800"
                                            >
                                                View
                                            </button>
                                        )}
                                        {task.type === 'document' && (
                                            <button
                                                onClick={() => setActivePage('Documents')}
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
            </div>
        </div>
    );
}

