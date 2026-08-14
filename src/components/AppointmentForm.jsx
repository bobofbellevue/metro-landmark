import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, FileText } from 'lucide-react';

export default function AppointmentForm({ appointment, clients, vendors, maintenanceRequests, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    clientId: '',
    vendorId: '',
    maintenanceRequestId: '',
    scheduledDateTime: '',
    estimatedDurationMinutes: '',
    notes: '',
    status: 'scheduled'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (appointment) {
      setFormData({
        clientId: appointment.client_id?.toString() || '',
        vendorId: appointment.vendor_id?.toString() || '',
        maintenanceRequestId: appointment.maintenance_request_id?.toString() || '',
        scheduledDateTime: appointment.scheduled_date_time 
          ? new Date(appointment.scheduled_date_time).toISOString().slice(0, 16)
          : '',
        estimatedDurationMinutes: appointment.estimated_duration_minutes?.toString() || '',
        notes: appointment.notes || '',
        status: appointment.status || 'scheduled'
      });
    }
  }, [appointment]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      // Validate required fields
      if (!formData.clientId || !formData.vendorId || !formData.maintenanceRequestId || !formData.scheduledDateTime) {
        throw new Error('Please fill in all required fields');
      }

      // Convert scheduledDateTime to ISO format
      const scheduledDate = new Date(formData.scheduledDateTime);
      if (isNaN(scheduledDate.getTime())) {
        throw new Error('Invalid date/time format');
      }

      const appointmentData = {
        clientId: parseInt(formData.clientId, 10),
        vendorId: parseInt(formData.vendorId, 10),
        maintenanceRequestId: parseInt(formData.maintenanceRequestId, 10),
        scheduledDateTime: scheduledDate.toISOString(),
        estimatedDurationMinutes: formData.estimatedDurationMinutes 
          ? parseInt(formData.estimatedDurationMinutes, 10) 
          : null,
        notes: formData.notes || null,
        status: formData.status
      };

      if (appointment) {
        // Update existing appointment
        appointmentData.appointmentId = appointment.appointment_id;
      }

      await onSave(appointmentData);
    } catch (err) {
      setError(err.message || 'Failed to save appointment');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter maintenance requests by selected client
  const filteredMaintenanceRequests = maintenanceRequests?.filter(mr => {
    if (!formData.clientId) return true;
    // This assumes maintenance requests have a client_id or tenant_user_id
    // You may need to adjust this based on your data structure
    return true; // For now, show all requests
  }) || [];

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          {appointment ? 'Edit Appointment' : 'Create Appointment'}
        </h2>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Client <span className="text-red-500">*</span>
          </label>
          <select
            value={formData.clientId}
            onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
            disabled={!!appointment} // Don't allow changing client for existing appointments
          >
            <option value="">Select a client</option>
            {clients?.map(client => (
              <option key={client.client_id} value={client.client_id}>
                {client.contacts?.first_name} {client.contacts?.last_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Maintenance Request <span className="text-red-500">*</span>
          </label>
          <select
            value={formData.maintenanceRequestId}
            onChange={(e) => setFormData({ ...formData, maintenanceRequestId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
            disabled={!!appointment} // Don't allow changing request for existing appointments
          >
            <option value="">Select a maintenance request</option>
            {filteredMaintenanceRequests.map(mr => (
              <option key={mr.request_id} value={mr.request_id}>
                #{mr.request_id} - {mr.description?.substring(0, 50)}... ({mr.priority})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Vendor <span className="text-red-500">*</span>
          </label>
          <select
            value={formData.vendorId}
            onChange={(e) => setFormData({ ...formData, vendorId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          >
            <option value="">Select a vendor</option>
            {vendors?.map(vendor => (
              <option key={vendor.vendor_id} value={vendor.vendor_id}>
                {vendor.company_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Scheduled Date & Time <span className="text-red-500">*</span>
          </label>
          <input
            type="datetime-local"
            value={formData.scheduledDateTime}
            onChange={(e) => setFormData({ ...formData, scheduledDateTime: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Estimated Duration (minutes)
          </label>
          <input
            type="number"
            value={formData.estimatedDurationMinutes}
            onChange={(e) => setFormData({ ...formData, estimatedDurationMinutes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            min="1"
            placeholder="e.g., 60"
          />
        </div>

        {appointment && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No Show</option>
              <option value="rescheduled">Rescheduled</option>
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows="3"
            placeholder="Additional notes about the appointment..."
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={isSubmitting}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : (appointment ? 'Update' : 'Create')}
          </button>
        </div>
      </form>
    </div>
  );
}

















