import {
  PHONE_PURPOSES,
  isPhonePurpose,
  normalizeVapiPhoneNumberId,
  resolveAllPhoneResources,
  resolvePhoneResource,
} from '../../src/utils/phone-resource-resolve.js';

const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('phone-resource-resolve', () => {
  test('isPhonePurpose and Vapi UUID', () => {
    expect(isPhonePurpose('tenant_maintenance')).toBe(true);
    expect(isPhonePurpose('fax')).toBe(false);
    expect(normalizeVapiPhoneNumberId(UUID)).toBe(UUID);
    expect(normalizeVapiPhoneNumberId('not-a-uuid')).toBeNull();
    expect(normalizeVapiPhoneNumberId('')).toBeNull();
  });

  test('PMC row wins over system, env, and default', () => {
    const resolved = resolvePhoneResource({
      purpose: PHONE_PURPOSES.TENANT_MAINTENANCE,
      pmcId: 9,
      resources: [
        {
          phone_resource_id: 1,
          pmc_id: null,
          purpose: 'tenant_maintenance',
          e164: '+12065550000',
          vapi_phone_number_id: UUID,
          is_active: true,
        },
        {
          phone_resource_id: 2,
          pmc_id: 9,
          purpose: 'tenant_maintenance',
          e164: '+12065551111',
          label: 'Acme bot',
          is_active: true,
        },
      ],
      envByPurpose: { tenant_maintenance: '+12065552222' },
      defaultE164: '+12064017109',
      envVapiPhoneNumberId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    expect(resolved).toMatchObject({
      e164: '+12065551111',
      source: 'pmc',
      label: 'Acme bot',
      phoneResourceId: 2,
      vapiPhoneNumberId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
  });

  test('PMC Vapi id is preferred when stored', () => {
    const resolved = resolvePhoneResource({
      purpose: PHONE_PURPOSES.VENDOR_DISPATCH,
      pmcId: 9,
      resources: [
        {
          pmc_id: 9,
          purpose: 'vendor_dispatch',
          e164: '+12065553333',
          vapi_phone_number_id: UUID,
          is_active: true,
        },
      ],
      envVapiPhoneNumberId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    expect(resolved.vapiPhoneNumberId).toBe(UUID);
    expect(resolved.source).toBe('pmc');
  });

  test('marketing does not inherit the maintenance default', () => {
    const resolved = resolvePhoneResource({
      purpose: PHONE_PURPOSES.MARKETING,
      pmcId: 9,
      resources: [],
      envByPurpose: { tenant_maintenance: '+12065552222' },
      defaultE164: '+12064017109',
    });
    expect(resolved.e164).toBe('');
    expect(resolved.source).toBeNull();
  });

  test('vendor_dispatch falls back to the shared voice default', () => {
    const resolved = resolvePhoneResource({
      purpose: PHONE_PURPOSES.VENDOR_DISPATCH,
      pmcId: 3,
      resources: [],
      envByPurpose: {},
      defaultE164: '+12064017109',
      envVapiPhoneNumberId: UUID,
    });
    expect(resolved).toMatchObject({
      e164: '+12064017109',
      source: 'default',
      vapiPhoneNumberId: UUID,
    });
  });

  test('inactive rows are ignored', () => {
    const resolved = resolvePhoneResource({
      purpose: PHONE_PURPOSES.APPOINTMENTS,
      pmcId: 9,
      resources: [
        {
          pmc_id: 9,
          purpose: 'appointments',
          e164: '+12065554444',
          is_active: false,
        },
      ],
      envByPurpose: { appointments: '+12065555555' },
    });
    expect(resolved).toMatchObject({
      e164: '+12065555555',
      source: 'env',
    });
  });

  test('resolveAllPhoneResources covers every purpose', () => {
    const all = resolveAllPhoneResources({
      pmcId: null,
      resources: [],
      envByPurpose: {},
      defaultE164: '+12064017109',
    });
    expect(all.tenant_maintenance.e164).toBe('+12064017109');
    expect(all.vendor_dispatch.e164).toBe('+12064017109');
    expect(all.marketing.e164).toBe('');
    expect(all.appointments.e164).toBe('');
  });
});
