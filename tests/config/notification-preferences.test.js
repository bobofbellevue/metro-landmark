import {
  NOTIFICATION_CATEGORIES,
  setCategoryFrequency,
  toggleCategoryChannel,
  toggleGlobalChannel,
} from '../../src/utils/notification-preferences.js';

const base = {
  email_enabled: true,
  sms_enabled: false,
  push_enabled: false,
  maintenance_email: true,
  maintenance_sms: false,
  lease_email: true,
  lease_sms: false,
  payment_email: true,
  general_email: true,
};

describe('notification preference toggles', () => {
  test('enabling global SMS does not wipe or auto-check categories', () => {
    const next = toggleGlobalChannel(base, 'sms');
    expect(next.sms_enabled).toBe(true);
    expect(next.maintenance_sms).toBe(false);
    expect(next.email_enabled).toBe(true);
    expect(next.maintenance_email).toBe(true);
  });

  test('disabling global Email leaves category email selections', () => {
    const next = toggleGlobalChannel(base, 'email');
    expect(next.email_enabled).toBe(false);
    expect(next.maintenance_email).toBe(true);
    expect(next.lease_email).toBe(true);
  });

  test('checking a category channel sticks and turns the global channel on', () => {
    const withSms = toggleGlobalChannel(base, 'sms');
    const next = toggleCategoryChannel(withSms, 'maintenance', 'sms');
    expect(next.maintenance_sms).toBe(true);
    expect(next.sms_enabled).toBe(true);
    expect(next.lease_sms).toBe(false);
  });

  test('unchecking then checking a category email box sticks', () => {
    const off = toggleCategoryChannel(base, 'maintenance', 'email');
    expect(off.maintenance_email).toBe(false);
    const on = toggleCategoryChannel(off, 'maintenance', 'email');
    expect(on.maintenance_email).toBe(true);
    expect(on.email_enabled).toBe(true);
  });

  test('setCategoryFrequency only changes that category', () => {
    const next = setCategoryFrequency(base, 'lease', 'daily_digest');
    expect(next.lease_frequency).toBe('daily_digest');
    expect(next.maintenance_email).toBe(true);
  });

  test('category list covers the four event groups', () => {
    expect(NOTIFICATION_CATEGORIES.map((c) => c.key)).toEqual([
      'maintenance',
      'lease',
      'payment',
      'general',
    ]);
  });
});
