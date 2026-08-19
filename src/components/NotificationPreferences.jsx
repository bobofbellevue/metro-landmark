import React, { useState, useEffect, useContext } from 'react';
import { Card } from './ui';
import { AuthContext } from '../contexts';
import { api } from '../api';

const FREQUENCY_OPTIONS = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'daily_digest', label: 'Daily Digest (8 AM)' },
  { value: 'weekly_digest', label: 'Weekly Digest (Monday 8 AM)' }
];

const CATEGORIES = [
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'lease', label: 'Lease' },
  { key: 'payment', label: 'Payment' },
  { key: 'general', label: 'General' }
];

const NOTIFICATION_TYPES = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'push', label: 'Push' }
];

export default function NotificationPreferences() {
  const { user } = useContext(AuthContext);
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchPreferences();
  }, [user?.user_id]);

  const fetchPreferences = async () => {
    if (!user?.user_id) return;

    setLoading(true);
    setError('');
    try {
      const response = await api.get('/notifications/preferences', user);
      if (response.success && response.preferences) {
        setPreferences(response.preferences);
        if (response.warning) setError(response.warning);
      } else {
        setError(response.error || 'Failed to load preferences');
      }
    } catch (err) {
      console.error('Error fetching preferences:', err);
      setError('Failed to load notification preferences');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.user_id || !preferences) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const response = await api.put('/notifications/preferences', preferences, user);
      if (response.success) {
        setPreferences(response.preferences);
        setSuccess('Notification preferences saved successfully!');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(response.error || 'Failed to save preferences');
      }
    } catch (err) {
      console.error('Error saving preferences:', err);
      setError('Failed to save notification preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleTestNotification = async (notificationType, category) => {
    if (!user?.user_id) return;

    setTesting(true);
    setError('');
    setSuccess('');

    try {
      const response = await api.post('/notifications/test', {
        notification_type: notificationType,
        category
      }, user);

      if (response.success) {
        setSuccess(`${notificationType.charAt(0).toUpperCase() + notificationType.slice(1)} test notification sent!`);
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(response.error || 'Failed to send test notification');
      }
    } catch (err) {
      console.error('Error sending test notification:', err);
      setError('Failed to send test notification');
    } finally {
      setTesting(false);
    }
  };

  const updatePreference = (key, value) => {
    if (!preferences) return;
    setPreferences({
      ...preferences,
      [key]: value
    });
  };

  const toggleGlobal = (type) => {
    const key = `${type}_enabled`;
    const newValue = !preferences[key];
    updatePreference(key, newValue);

    // If disabling globally, disable all category-specific toggles
    if (!newValue) {
      CATEGORIES.forEach(category => {
        updatePreference(`${category.key}_${type}`, false);
      });
    }
  };

  const toggleCategory = (category, type) => {
    const key = `${category}_${type}`;
    const newValue = !preferences[key];
    updatePreference(key, newValue);

    // If enabling a category, ensure global is enabled
    if (newValue) {
      updatePreference(`${type}_enabled`, true);
    }
  };

  const updateFrequency = (category, frequency) => {
    updatePreference(`${category}_frequency`, frequency);
  };

  if (loading) {
    return (
      <Card title="Notification Preferences">
        <div className="text-center py-8">
          <p className="text-gray-500">Loading preferences...</p>
        </div>
      </Card>
    );
  }

  if (!preferences) {
    return (
      <Card title="Notification Preferences">
        <div className="text-center py-8">
          <p className="text-red-500">{error || 'Failed to load preferences'}</p>
          <button
            onClick={fetchPreferences}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
          >
            Retry
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Notification Preferences">
      <div className="space-y-6">
        {error && (
          <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 text-sm text-green-700 bg-green-100 border border-green-400 rounded-md">
            {success}
          </div>
        )}

        {/* Global Preferences */}
        <div className="border-b pb-6">
          <h4 className="text-lg font-medium text-gray-800 mb-4">Global Settings</h4>
          <div className="space-y-3">
            {NOTIFICATION_TYPES.map(type => (
              <div key={type.key} className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={preferences[`${type.key}_enabled`] || false}
                    onChange={() => toggleGlobal(type.key)}
                    className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <label className="text-sm font-medium text-gray-700">
                    Enable {type.label} Notifications
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Category-Specific Preferences */}
        <div className="space-y-6">
          <h4 className="text-lg font-medium text-gray-800">Category Preferences</h4>
          
          {CATEGORIES.map(category => (
            <div key={category.key} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <h5 className="text-md font-semibold text-gray-800 mb-4">{category.label}</h5>
              
              {/* Notification Type Toggles */}
              <div className="space-y-3 mb-4">
                {NOTIFICATION_TYPES.map(type => (
                  <div key={type.key} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={preferences[`${category.key}_${type.key}`] || false}
                        onChange={() => toggleCategory(category.key, type.key)}
                        disabled={!preferences[`${type.key}_enabled`]}
                        className={`h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 ${
                          !preferences[`${type.key}_enabled`] ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      />
                      <label className={`text-sm font-medium ${
                        !preferences[`${type.key}_enabled`] ? 'text-gray-400' : 'text-gray-700'
                      }`}>
                        {type.label}
                      </label>
                    </div>
                    {preferences[`${category.key}_${type.key}`] && preferences[`${type.key}_enabled`] && (
                      <button
                        onClick={() => handleTestNotification(type.key, category.key)}
                        disabled={testing}
                        className="px-3 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-50"
                      >
                        {testing ? 'Sending...' : 'Test'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Frequency Selection */}
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Delivery Frequency
                </label>
                <select
                  value={preferences[`${category.key}_frequency`] || 'immediate'}
                  onChange={(e) => updateFrequency(category.key, e.target.value)}
                  className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {FREQUENCY_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {preferences[`${category.key}_frequency`] === 'immediate' 
                    ? 'Notifications will be sent immediately when events occur.'
                    : preferences[`${category.key}_frequency`] === 'daily_digest'
                    ? 'Notifications will be aggregated and sent daily at 8 AM.'
                    : 'Notifications will be aggregated and sent weekly on Mondays at 8 AM.'}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-4 border-t">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </Card>
  );
}

