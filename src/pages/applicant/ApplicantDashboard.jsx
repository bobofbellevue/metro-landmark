import React, { useState, useEffect, useContext } from 'react';
import { FileText, Home, Clock, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { AuthContext } from '../../contexts';
import { Card } from '../../components/ui';

export default function ApplicantDashboard() {
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
      // Find applicant record by email
      const { data: applicantRecord, error: applicantError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.user_id)
        .maybeSingle();

      if (applicantError && applicantError.code !== 'PGRST116') {
        // Only log non-PGRST116 errors (PGRST116 means no rows found, which is acceptable)
        console.error('Error fetching applicant record:', applicantError);
      }

      if (!applicantRecord) {
        // No applicant record found - user hasn't applied yet
        setStats({
          totalApplications: 0,
          pendingApplications: 0,
          approvedApplications: 0,
          rejectedApplications: 0,
          availableProperties: 0,
        });
        setIsLoading(false);
        return;
      }

      // Fetch applications
      const { data: applications } = await supabase
        .from('client_applications')
        .select('application_id, status')
        .eq('client_id', applicantRecord.client_id);

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

      const stats = {
        totalApplications: applications?.length || 0,
        pendingApplications: applications?.filter(a => a.status === 'pending').length || 0,
        approvedApplications: applications?.filter(a => a.status === 'approved').length || 0,
        rejectedApplications: applications?.filter(a => a.status === 'rejected').length || 0,
        availableProperties: availableUnits.length,
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
              <p className="text-sm font-medium text-gray-600">Rejected Applications</p>
              <p className="text-3xl font-bold text-red-600">{stats?.rejectedApplications || 0}</p>
            </div>
            <XCircle className="w-12 h-12 text-red-400" />
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
    </div>
  );
}

