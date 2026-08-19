export const NOTIFICATION_CATEGORIES = [
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'lease', label: 'Lease' },
  { key: 'payment', label: 'Payment' },
  { key: 'general', label: 'General' },
];

export const NOTIFICATION_CHANNELS = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'push', label: 'Push' },
];

/**
 * Global channel switch. Category selections are left as-is so they return
 * when the channel is turned back on; the UI disables them while global is off.
 */
export function toggleGlobalChannel(preferences, type) {
  const key = `${type}_enabled`;
  return {
    ...preferences,
    [key]: !preferences[key],
  };
}

/**
 * Per-category channel. Turning a category on also turns the global channel on.
 */
export function toggleCategoryChannel(preferences, category, type) {
  const key = `${category}_${type}`;
  const enabled = !preferences[key];
  const next = {
    ...preferences,
    [key]: enabled,
  };
  if (enabled) {
    next[`${type}_enabled`] = true;
  }
  return next;
}

export function setCategoryFrequency(preferences, category, frequency) {
  return {
    ...preferences,
    [`${category}_frequency`]: frequency,
  };
}
