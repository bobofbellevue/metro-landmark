import React, { useState, useEffect, useContext } from 'react';
import { Calendar, Plus, Search, Filter, CheckCircle, XCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card } from '../components/ui';
import AppointmentCard from '../components/AppointmentCard';
import AppointmentForm from '../components/AppointmentForm';

export default function AppointmentsPage() {
  const { user } = useContext(AuthContext);
  const [appointments, setAppointments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState(null);
  const [clients, setClients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      fetchAppointments();
      fetchClients();
      fetchVendors();
      fetchMaintenanceRequests();
    }
  }, [user, statusFilter]);

  const fetchAppointments = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('client_appointments')
        .select(`
          *,
          clients!inner(
            client_id,
            user_id,
            contacts!inner(
              first_name,
              last_name
            )
          ),
          vendors!inner(
            vendor_id,
            company_name,
            description
          ),
          maintenance_requests!inner(
            request_id,
            description,
            priority,
            status,
            units!inner(
              unit_number,
              properties!inner(
                property_name
              )
            )
          )
        `)
        .is('is_archived', false)
        .order('scheduled_date_time', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching appointments:', error);
        setError('Failed to load appointments');
        setAppointments([]);
      } else {
        setAppointments(data || []);
      }
    } catch (error) {
      console.error('Error fetching appointments:', error);
      setError('Failed to load appointments');
      setAppointments([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const { data, error } = await supabase
        .from('clients')
        .select(`
          client_id,
          user_id,
          contacts!inner(
            first_name,
            last_name
          )
        `)
        .is('is_archived', false);

      if (error) {
        console.error('Error fetching clients:', error);
      } else {
        setClients(data || []);
      }
    } catch (error) {
      console.error('Error fetching clients:', error);
    }
  };

  const fetchVendors = async () => {
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('vendor_id, company_name, description')
        .is('is_archived', false);

      if (error) {
        console.error('Error fetching vendors:', error);
      } else {
        setVendors(data || []);
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchMaintenanceRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('maintenance_requests')
        .select('request_id, description, priority, status, tenant_user_id')
        .is('is_archived', false)
        .in('status', ['New', 'In Progress', 'On Hold']);

      if (error) {
        console.error('Error fetching maintenance requests:', error);
      } else {
        setMaintenanceRequests(data || []);
      }
    } catch (error) {
      console.error('Error fetching maintenance requests:', error);
    }
  };

  const handleSave = async (appointmentData) => {
    try {
      const url = editingAppointment
        ? `/api/appointments/${editingAppointment.appointment_id}`
        : '/api/appointments/create';

      const method = editingAppointment ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(appointmentData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save appointment');
      }

      // Refresh appointments
      await fetchAppointments();
      setShowForm(false);
      setEditingAppointment(null);
    } catch (error) {
      console.error('Error saving appointment:', error);
      setError(error.message || 'Failed to save appointment');
    }
  };

  const handleEdit = (appointment) => {
    setEditingAppointment(appointment);
    setShowForm(true);
  };

  const handleCancel = async (appointment) => {
    if (!confirm('Are you sure you want to cancel this appointment?')) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${appointment.appointment_id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cancelledReason: 'Cancelled by admin',
          cancelledByUserId: user.user_id
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to cancel appointment');
      }

      await fetchAppointments();
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      setError(error.message || 'Failed to cancel appointment');
    }
  };

  const handleComplete = async (appointment) => {
    if (!confirm('Mark this appointment as completed? You can add result details after.')) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${appointment.appointment_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'completed',
          actualDateTime: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to complete appointment');
      }

      await fetchAppointments();
    } catch (error) {
      console.error('Error completing appointment:', error);
      setError(error.message || 'Failed to complete appointment');
    }
  };

  const filteredAppointments = appointments.filter(appointment => {
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const vendorName = appointment.vendors?.company_name?.toLowerCase() || '';
      const issueDescription = appointment.maintenance_requests?.description?.toLowerCase() || '';
      const unitNumber = appointment.maintenance_requests?.units?.unit_number?.toLowerCase() || '';
      const propertyName = appointment.maintenance_requests?.units?.properties?.property_name?.toLowerCase() || '';
      
      return vendorName.includes(searchLower) ||
             issueDescription.includes(searchLower) ||
             unitNumber.includes(searchLower) ||
             propertyName.includes(searchLower);
    }
    return true;
  });

  const statusCounts = {
    all: appointments.length,
    scheduled: appointments.filter(a => a.status === 'scheduled').length,
    completed: appointments.filter(a => a.status === 'completed').length,
    cancelled: appointments.filter(a => a.status === 'cancelled').length,
    in_progress: appointments.filter(a => a.status === 'in_progress').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
          <Calendar className="h-8 w-8" />
          Appointments
        </h1>
        <button
          onClick={() => {
            setEditingAppointment(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <Plus className="h-5 w-5" />
          New Appointment
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="max-h-[90vh] overflow-y-auto">
            <AppointmentForm
              appointment={editingAppointment}
              clients={clients}
              vendors={vendors}
              maintenanceRequests={maintenanceRequests}
              onSave={handleSave}
              onCancel={() => {
                setShowForm(false);
                setEditingAppointment(null);
              }}
            />
          </div>
        </div>
      )}

      <Card title="Filters" className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search appointments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Statuses ({statusCounts.all})</option>
              <option value="scheduled">Scheduled ({statusCounts.scheduled})</option>
              <option value="in_progress">In Progress ({statusCounts.in_progress})</option>
              <option value="completed">Completed ({statusCounts.completed})</option>
              <option value="cancelled">Cancelled ({statusCounts.cancelled})</option>
            </select>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-600">Loading appointments...</p>
        </div>
      ) : filteredAppointments.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No appointments found</p>
            {searchTerm || statusFilter !== 'all' ? (
              <p className="text-sm text-gray-500 mt-2">Try adjusting your filters</p>
            ) : (
              <button
                onClick={() => {
                  setEditingAppointment(null);
                  setShowForm(true);
                }}
                className="mt-4 text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Create your first appointment
              </button>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAppointments.map(appointment => (
            <AppointmentCard
              key={appointment.appointment_id}
              appointment={appointment}
              onEdit={handleEdit}
              onCancel={handleCancel}
              onComplete={handleComplete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

















