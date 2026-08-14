import {
  DEFAULT_TENANT_MAINTENANCE_PHONE_E164,
  formatPhoneDisplay,
  getPhoneForPurpose,
  getTenantMaintenancePhoneE164,
  PHONE_PURPOSES,
  toE164,
  toTelHref,
} from '../../src/config/phones.js';

describe('phone config', () => {
  test('normalizes US numbers to E.164', () => {
    expect(toE164('+12064017109')).toBe('+12064017109');
    expect(toE164('2064017109')).toBe('+12064017109');
    expect(toE164('(206) 401-7109')).toBe('+12064017109');
    expect(toE164('')).toBe('');
  });

  test('formats display and tel href', () => {
    expect(formatPhoneDisplay('+12064017109')).toBe('(206) 401-7109');
    expect(toTelHref('+12064017109')).toBe('tel:+12064017109');
    expect(toTelHref('')).toBe('');
  });

  test('defaults to shared reference VAPI number', () => {
    expect(DEFAULT_TENANT_MAINTENANCE_PHONE_E164).toBe('+12064017109');
    expect(getTenantMaintenancePhoneE164()).toBe('+12064017109');
    expect(getPhoneForPurpose(PHONE_PURPOSES.TENANT_MAINTENANCE)).toBe('+12064017109');
    expect(getPhoneForPurpose(PHONE_PURPOSES.VENDOR_DISPATCH)).toBe('+12064017109');
  });
});
