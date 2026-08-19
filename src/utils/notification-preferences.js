export const NOTIFICATION_CATEGORIES = [
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'lease', label: 'Lease' },
  { key: 'payment', label: 'Payment' },
  { key: 'general', label: 'General' },
];

export const NOTIFICATION_CHANNELS = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'push', label: 'Browser push' },
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

/**
 * Serialize preference writes so a slower older PUT cannot overwrite a newer one.
 * Overlapping calls keep only the latest queued value after the in-flight save.
 */
export function createSerialSaver(saveFn) {
  let inFlight = false;
  let queued = undefined;
  let hasQueued = false;

  const drain = async () => {
    inFlight = true;
    try {
      while (hasQueued) {
        const sending = queued;
        hasQueued = false;
        queued = undefined;
        await saveFn(sending);
      }
    } finally {
      inFlight = false;
      if (hasQueued) {
        await drain();
      }
    }
  };

  return (value) => {
    queued = value;
    hasQueued = true;
    if (!inFlight) {
      return drain();
    }
    return undefined;
  };
}
