import React, { useState, useEffect, useContext } from 'react';
import { Home, FileText, Wrench, CheckCircle, Clock, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';

export default function TenantDashboard() {
  const { user } = useContext(AuthContext);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user]);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      const userId = user.user_id;

      // Get client_id from user_id
      const { data: clientRecord, error: clientError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (clientError) {
        console.error('TenantDashboard: Error fetching client:', clientError);
        setStats({
          currentLeases: 0,
          totalLeases: 0,
          pendingApplications: 0,
          totalApplications: 0,
          activeMaintenance: 0,
          totalMaintenance: 0,
        });
        setIsLoading(false);
        return;
      }

      if (!clientRecord?.client_id) {
        setStats({
          currentLeases: 0,
          totalLeases: 0,
          pendingApplications: 0,
          totalApplications: 0,
          activeMaintenance: 0,
          totalMaintenance: 0,
        });
        setIsLoading(false);
        return;
      }

      // Fetch current leases
      const { data: currentLeases } = await supabase
        .from('lease_clients')
        .select(`
          leases!inner(
            lease_id,
            start_date,
            end_date,
            status,
            monthly_rent_amount,
            units!inner(
              unit_id,
              unit_number,
              properties!inner(
                property_id
              )
            )
          )
        `)
        .eq('client_id', clientRecord.client_id)
        .eq('leases.status', 'active');

      // Fetch applications
      const { data: applications = [] } = await supabase
        .from('client_applications')
        .select(`
          application_id,
          status,
          applied_at,
          units!inner(
            unit_id,
            unit_number,
            properties!inner(
              property_id
            )
          )
        `)
        .eq('client_id', clientRecord.client_id)
        .order('applied_at', { ascending: false });

      // Fetch maintenance requests
      const { data: maintenanceRequests } = await supabase
        .from('maintenance_requests')
        .select('request_id, status, priority, created_at')
        .eq('tenant_user_id', userId)
        .order('created_at', { ascending: false });

      // Fetch all leases (current and past)
      const { data: allLeases } = await supabase
        .from('lease_clients')
        .select(`
          leases!inner(
            lease_id,
            start_date,
            end_date,
            status
          )
        `)
        .eq('client_id', clientRecord.client_id);

      const stats = {
        currentLeases: currentLeases?.length || 0,
        totalLeases: allLeases?.length || 0,
        pendingApplications: applications.filter(a => a.status === 'pending').length,
        totalApplications: applications.length,
        activeMaintenance: maintenanceRequests?.filter(r => r.status !== 'Completed').length || 0,
        totalMaintenance: maintenanceRequests?.length || 0,
      };

      setStats(stats);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <div className="p-4">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">My Dashboard</h1>
      
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="bg-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Current Properties</p>
              <p className="text-3xl font-bold text-indigo-600">{stats?.currentLeases || 0}</p>
            </div>
            <Home className="w-12 h-12 text-indigo-400" />
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
              <p className="text-sm font-medium text-gray-600">Active Maintenance</p>
              <p className="text-3xl font-bold text-orange-600">{stats?.activeMaintenance || 0}</p>
            </div>
            <Wrench className="w-12 h-12 text-orange-400" />
          </div>
        </Card>

        <Card className="bg-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Leases</p>
              <p className="text-3xl font-bold text-blue-600">{stats?.totalLeases || 0}</p>
            </div>
            <FileText className="w-12 h-12 text-blue-400" />
          </div>
        </Card>

        <Card className="bg-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Applications</p>
              <p className="text-3xl font-bold text-purple-600">{stats?.totalApplications || 0}</p>
            </div>
            <FileText className="w-12 h-12 text-purple-400" />
          </div>
        </Card>

        <Card className="bg-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Maintenance Requests</p>
              <p className="text-3xl font-bold text-gray-600">{stats?.totalMaintenance || 0}</p>
            </div>
            <Wrench className="w-12 h-12 text-gray-400" />
          </div>
        </Card>
      </div>
    </div>
  );
}

