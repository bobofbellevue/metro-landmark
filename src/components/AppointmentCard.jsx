import React from 'react';
import { Calendar, Clock, MapPin, Wrench, CheckCircle, XCircle, AlertCircle, User } from 'lucide-react';
import { formatDateTime as formatLocaleDateTime, localeContextFromBrowser } from '../config/locale.js';
import { formatUnitAtProperty } from '../utils/unit-display.js';

export default function AppointmentCard({ appointment, onEdit, onCancel, onComplete, localeContext }) {
  const resolvedLocale = localeContext || localeContextFromBrowser();

  const formatDateTime = (dateTime) => {
    if (!dateTime) return 'Not scheduled';
    return formatLocaleDateTime(dateTime, resolvedLocale, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'no_show':
        return 'bg-orange-100 text-orange-800';
      case 'rescheduled':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4" />;
      case 'cancelled':
        return <XCircle className="h-4 w-4" />;
      case 'in_progress':
        return <Clock className="h-4 w-4" />;
      case 'no_show':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Calendar className="h-4 w-4" />;
    }
  };

  const vendorName = appointment.vendors?.company_name || 'Unknown Vendor';
  const issueDescription = appointment.maintenance_requests?.description || 'No description';
  const unit = appointment.maintenance_requests?.units;
  const propertyName = unit?.properties?.property_name || '';
  const priority = appointment.maintenance_requests?.priority || 'Not specified';

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-2">
          {getStatusIcon(appointment.status)}
          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(appointment.status)}`}>
            {appointment.status.replace('_', ' ').toUpperCase()}
          </span>
          {appointment.resolved_issue && (
            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
              RESOLVED
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {onEdit && appointment.status === 'scheduled' && (
            <button
              onClick={() => onEdit(appointment)}
              className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
            >
              Edit
            </button>
          )}
          {onCancel && ['scheduled', 'in_progress'].includes(appointment.status) && (
            <button
              onClick={() => onCancel(appointment)}
              className="text-red-600 hover:text-red-800 text-sm font-medium"
            >
              Cancel
            </button>
          )}
          {onComplete && appointment.status === 'scheduled' && (
            <button
              onClick={() => onComplete(appointment)}
              className="text-green-600 hover:text-green-800 text-sm font-medium"
            >
              Complete
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
          <div>
            <p className="text-sm text-gray-600">Scheduled</p>
            <p className="font-medium text-gray-900">{formatDateTime(appointment.scheduled_date_time)}</p>
          </div>
        </div>

        {appointment.actual_date_time && (
          <div className="flex items-start gap-2">
            <Clock className="h-5 w-5 text-gray-400 mt-0.5" />
            <div>
              <p className="text-sm text-gray-600">Actual Time</p>
              <p className="font-medium text-gray-900">{formatDateTime(appointment.actual_date_time)}</p>
            </div>
          </div>
        )}

        {appointment.estimated_duration_minutes && (
          <div className="flex items-start gap-2">
            <Clock className="h-5 w-5 text-gray-400 mt-0.5" />
            <div>
              <p className="text-sm text-gray-600">Duration</p>
              <p className="font-medium text-gray-900">{appointment.estimated_duration_minutes} minutes</p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-2">
          <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
          <div>
            <p className="text-sm text-gray-600">Location</p>
            <p className="font-medium text-gray-900">{formatUnitAtProperty(unit, propertyName)}</p>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Wrench className="h-5 w-5 text-gray-400 mt-0.5" />
          <div>
            <p className="text-sm text-gray-600">Vendor</p>
            <p className="font-medium text-gray-900">{vendorName}</p>
          </div>
        </div>

        <div className="border-t pt-3">
          <p className="text-sm text-gray-600 mb-1">Issue</p>
          <p className="text-sm text-gray-900">{issueDescription}</p>
          <p className="text-xs text-gray-500 mt-1">Priority: {priority}</p>
        </div>

        {appointment.result && (
          <div className="border-t pt-3">
            <p className="text-sm text-gray-600 mb-1">Result</p>
            <p className="text-sm text-gray-900">{appointment.result}</p>
          </div>
        )}

        {appointment.notes && (
          <div className="border-t pt-3">
            <p className="text-sm text-gray-600 mb-1">Notes</p>
            <p className="text-sm text-gray-900">{appointment.notes}</p>
          </div>
        )}

        {appointment.cancelled_at && (
          <div className="border-t pt-3">
            <p className="text-sm text-gray-600 mb-1">Cancelled</p>
            <p className="text-sm text-gray-900">{formatDateTime(appointment.cancelled_at)}</p>
            {appointment.cancelled_reason && (
              <p className="text-xs text-gray-500 mt-1">Reason: {appointment.cancelled_reason}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

















