import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { Card } from './ui';
import { AuthContext } from '../contexts';
import { api } from '../api';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  createSerialSaver,
  setCategoryFrequency,
  toggleCategoryChannel,
  toggleGlobalChannel,
} from '../utils/notification-preferences.js';

const FREQUENCY_OPTIONS = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'daily_digest', label: 'Daily Digest (8 AM)' },
  { value: 'weekly_digest', label: 'Weekly Digest (Monday 8 AM)' }
];

const CHECKBOX_CLASS =
  'size-4 shrink-0 rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:outline-none focus:ring-0';

export default function NotificationPreferences() {
  const { user } = useContext(AuthContext);
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testingKey, setTestingKey] = useState(null);
  const [error, setError] = useState('');
  const [statusHint, setStatusHint] = useState('');
  const lastPersistedJson = useRef(null);
  const userRef = useRef(user);
  userRef.current = user;

  const enqueueSave = useMemo(
    () =>
      createSerialSaver(async (prefs) => {
        const currentUser = userRef.current;
        if (!currentUser?.user_id) return;
        setError('');
        setStatusHint('Saving…');
        try {
          const response = await api.put('/notifications/preferences', prefs, currentUser);
          if (response.success) {
            setStatusHint('Saved');
          } else {
            setError(response.error || 'Failed to save preferences');
            setStatusHint('');
          }
        } catch (err) {
          console.error('Error saving preferences:', err);
          setError('Failed to save notification preferences');
          setStatusHint('');
        }
      }),
    []
  );

  useEffect(() => {
    fetchPreferences();
  }, [user?.user_id]);

  useEffect(() => {
    if (!preferences || !user?.user_id) return;
    const json = JSON.stringify(preferences);
    if (json === lastPersistedJson.current) return;
    const isHydrate = lastPersistedJson.current === null;
    lastPersistedJson.current = json;
    if (isHydrate) return;
    enqueueSave(preferences);
  }, [preferences, user?.user_id, enqueueSave]);

  const fetchPreferences = async () => {
    if (!user?.user_id) return;

    setLoading(true);
    setError('');
    try {
      const response = await api.get('/notifications/preferences', user);
      if (response.success && response.preferences) {
        lastPersistedJson.current = null;
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

  const handleTestNotification = async (notificationType, category) => {
    if (!user?.user_id) return;

    const key = `${category}_${notificationType}`;
    setTestingKey(key);
    setError('');
    setStatusHint('');

    try {
      const response = await api.post('/notifications/test', {
        notification_type: notificationType,
        category
      }, user);

      if (response.success) {
        setStatusHint(
          `${notificationType.charAt(0).toUpperCase() + notificationType.slice(1)} test sent`
        );
      } else {
        setError(response.error || 'Failed to send test notification');
      }
    } catch (err) {
      console.error('Error sending test notification:', err);
      setError('Failed to send test notification');
    } finally {
      setTestingKey(null);
    }
  };

  const toggleGlobal = (type) => {
    setPreferences((prev) => (prev ? toggleGlobalChannel(prev, type) : prev));
  };

  const toggleCategory = (category, type) => {
    setPreferences((prev) =>
      prev ? toggleCategoryChannel(prev, category, type) : prev
    );
  };

  const updateFrequency = (category, frequency) => {
    setPreferences((prev) =>
      prev ? setCategoryFrequency(prev, category, frequency) : prev
    );
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
        <p className="text-sm text-gray-500 min-h-5 -mt-2">
          {statusHint || '\u00a0'}
        </p>

        {error && (
          <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
            {error}
          </div>
        )}

        <div className="border-b pb-6">
          <h4 className="text-lg font-medium text-gray-800 mb-4">Global Settings</h4>
          <div className="space-y-3">
            {NOTIFICATION_CHANNELS.map(type => (
              <div key={type.key} className="flex h-8 items-center">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={preferences[`${type.key}_enabled`] || false}
                    onChange={() => toggleGlobal(type.key)}
                    className={CHECKBOX_CLASS}
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Enable {type.label} Notifications
                  </span>
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <h4 className="text-lg font-medium text-gray-800">Category Preferences</h4>
          
          {NOTIFICATION_CATEGORIES.map(category => (
            <div key={category.key} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <h5 className="text-md font-semibold text-gray-800 mb-4">{category.label}</h5>
              
              <div className="space-y-1 mb-4">
                {NOTIFICATION_CHANNELS.map(type => {
                  const channelOn = Boolean(preferences[`${type.key}_enabled`]);
                  const categoryOn = Boolean(preferences[`${category.key}_${type.key}`]);
                  const canTest = channelOn && categoryOn && type.key !== 'push';
                  const rowTestKey = `${category.key}_${type.key}`;
                  return (
                    <div key={type.key} className="flex h-8 items-center justify-between">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={categoryOn}
                          onChange={() => toggleCategory(category.key, type.key)}
                          disabled={!channelOn}
                          className={`${CHECKBOX_CLASS} ${
                            !channelOn ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        />
                        <span className={`text-sm font-medium ${
                          !channelOn ? 'text-gray-400' : 'text-gray-700'
                        }`}>
                          {type.label}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleTestNotification(type.key, category.key)}
                        disabled={!canTest || Boolean(testingKey)}
                        tabIndex={canTest ? 0 : -1}
                        className={`min-w-[4.75rem] px-3 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-50 ${
                          canTest ? '' : 'invisible pointer-events-none'
                        }`}
                      >
                        {testingKey === rowTestKey ? 'Sending...' : 'Test'}
                      </button>
                    </div>
                  );
                })}
              </div>

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
      </div>
    </Card>
  );
}
