import React, { useState, useEffect, useContext } from 'react';
import { Card } from './ui';
import { supabase } from '../lib/supabase';
import { AuthContext } from '../contexts';
import { 
  Clock, CheckCircle, AlertCircle, Calendar, FileText 
} from 'lucide-react';
import { isAwaitingNoticeService } from '../utils/notice-service-workflow.js';
import { activeWorkflowLocationLabel } from '../utils/workflow-lease-context.js';

/**
 * ComplianceDashboard - Dashboard view for compliance workflows
 */
export default function ComplianceDashboard() {
  const { user } = useContext(AuthContext);
  const [stats, setStats] = useState({
    active: 0,
    completed: 0,
    upcomingDeadlines: 0,
    overdue: 0,
    awaitingService: 0,
  });
  const [upcomingDeadlines, setUpcomingDeadlines] = useState([]);
  const [recentWorkflows, setRecentWorkflows] = useState([]);
  const [unservedNotices, setUnservedNotices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch active workflows
      const { data: activeData } = await supabase
        .from('compliance_workflows')
        .select('workflow_id, status')
        .in('status', ['draft', 'in_progress']);

      // Fetch completed workflows (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { data: completedData } = await supabase
        .from('compliance_workflows')
        .select('workflow_id, completed_at')
        .eq('status', 'completed')
        .gte('completed_at', thirtyDaysAgo.toISOString());

      // Fetch workflows with upcoming deadlines
      const today = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      
      const { data: deadlinesData } = await supabase
        .from('compliance_workflows')
        .select(`
          workflow_id,
          workflow_type,
          required_notice_date,
          effective_date,
          status,
          lease_id,
          lease:leases(
            lease_id,
            units(
              unit_id,
              unit_number,
              properties(property_id, property_name)
            )
          ),
          property:properties(property_name),
          unit:units(unit_number)
        `)
        .in('status', ['draft', 'in_progress'])
        .not('required_notice_date', 'is', null)
        .gte('required_notice_date', today.toISOString().split('T')[0])
        .lte('required_notice_date', nextWeek.toISOString().split('T')[0])
        .order('required_notice_date', { ascending: true })
        .limit(10);

      // Fetch overdue deadlines
      const { data: overdueData } = await supabase
        .from('compliance_workflows')
        .select('workflow_id')
        .in('status', ['draft', 'in_progress'])
        .not('required_notice_date', 'is', null)
        .lt('required_notice_date', today.toISOString().split('T')[0]);

      // Fetch recent workflows
      const { data: recentData } = await supabase
        .from('compliance_workflows')
        .select(`
          workflow_id,
          workflow_type,
          status,
          created_at,
          lease_id,
          workflow_data,
          lease:leases(
            lease_id,
            units(
              unit_id,
              unit_number,
              properties(property_id, property_name)
            )
          ),
          property:properties(property_name),
          unit:units(unit_number)
        `)
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: unservedData } = await supabase
        .from('compliance_workflows')
        .select(`
          workflow_id,
          workflow_type,
          status,
          lease_id,
          workflow_data,
          lease:leases(
            lease_id,
            units(
              unit_id,
              unit_number,
              properties(property_id, property_name)
            )
          ),
          property:properties(property_name),
          unit:units(unit_number)
        `)
        .in('status', ['draft', 'in_progress'])
        .in('workflow_type', ['rent_increase', 'eviction'])
        .order('updated_at', { ascending: false })
        .limit(25);

      const awaitingService = (unservedData || []).filter(isAwaitingNoticeService);

      setStats({
        active: activeData?.length || 0,
        completed: completedData?.length || 0,
        upcomingDeadlines: deadlinesData?.length || 0,
        overdue: overdueData?.length || 0,
        awaitingService: awaitingService.length,
      });

      setUpcomingDeadlines(deadlinesData || []);
      setRecentWorkflows(recentData || []);
      setUnservedNotices(awaitingService.slice(0, 10));
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getWorkflowTypeLabel = (type) => {
    const labels = {
      rent_increase: 'Rent Increase',
      eviction: 'Eviction',
      move_in: 'Move-In',
      move_out: 'Move-Out',
      security_deposit: 'Security Deposit',
      collections: 'Collections',
      lease_renewal: 'Lease Renewal',
      lease_violation: 'Lease Violation',
      lease_termination: 'Lease Termination',
      habitability: 'Habitability',
      entry_notice: 'Entry Notice',
      tenant_screening: 'Tenant Screening'
    };
    return labels[type] || type;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-800">Compliance Dashboard</h2>
        <p className="text-gray-600 mt-2">Overview of compliance workflows and deadlines</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card title="" className="bg-white">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Clock className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.active}</p>
              <p className="text-sm text-gray-600">Active Workflows</p>
            </div>
          </div>
        </Card>

        <Card title="" className="bg-white">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.completed}</p>
              <p className="text-sm text-gray-600">Completed (30 days)</p>
            </div>
          </div>
        </Card>

        <Card title="" className="bg-white">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <Calendar className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.upcomingDeadlines}</p>
              <p className="text-sm text-gray-600">Upcoming Deadlines</p>
            </div>
          </div>
        </Card>

        <Card title="" className="bg-white">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-100 rounded-lg">
              <FileText className="w-6 h-6 text-amber-700" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.awaitingService || 0}</p>
              <p className="text-sm text-gray-600">Awaiting service</p>
            </div>
          </div>
        </Card>

        <Card title="" className="bg-white">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-100 rounded-lg">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.overdue}</p>
              <p className="text-sm text-gray-600">Overdue</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Notices awaiting service">
          {unservedNotices.length === 0 ? (
            <p className="text-gray-600 text-sm">No generated notices waiting to be served</p>
          ) : (
            <div className="space-y-3">
              {unservedNotices.map(workflow => (
                <div
                  key={workflow.workflow_id}
                  className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-800">
                      {getWorkflowTypeLabel(workflow.workflow_type)}
                    </p>
                    <p className="text-xs text-gray-600">
                      {activeWorkflowLocationLabel(workflow)}
                    </p>
                  </div>
                  <span className="px-2 py-1 text-xs rounded bg-amber-100 text-amber-800">
                    Record service
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Upcoming Deadlines */}
        <Card title="Upcoming Deadlines (Next 7 Days)">
          {upcomingDeadlines.length === 0 ? (
            <p className="text-gray-600 text-sm">No upcoming deadlines</p>
          ) : (
            <div className="space-y-3">
              {upcomingDeadlines.map(workflow => (
                <div
                  key={workflow.workflow_id}
                  className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-800">
                      {getWorkflowTypeLabel(workflow.workflow_type)}
                    </p>
                    <p className="text-xs text-gray-600">
                      {activeWorkflowLocationLabel(workflow)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-yellow-800">
                      {new Date(workflow.required_notice_date).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-gray-500">
                      {Math.ceil((new Date(workflow.required_notice_date) - new Date()) / (1000 * 60 * 60 * 24))} days
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent Workflows */}
        <Card title="Recent Workflows">
          {recentWorkflows.length === 0 ? (
            <p className="text-gray-600 text-sm">No recent workflows</p>
          ) : (
            <div className="space-y-3">
              {recentWorkflows.map(workflow => (
                <div
                  key={workflow.workflow_id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-800">
                      {getWorkflowTypeLabel(workflow.workflow_type)}
                    </p>
                    <p className="text-xs text-gray-600">
                      {activeWorkflowLocationLabel(workflow)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-1 text-xs rounded ${
                      workflow.status === 'completed' ? 'bg-green-100 text-green-800' :
                      workflow.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-200 text-gray-700'
                    }`}>
                      {workflow.status}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(workflow.created_at).toLocaleDateString()}
                    </p>
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

