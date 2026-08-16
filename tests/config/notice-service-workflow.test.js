import {
  buildNoticeMailto,
  evictionNoticeFingerprint,
  isAwaitingNoticeService,
  rentIncreaseNoticeFingerprint,
  resumeStepIndex,
  tenantEmailsFromLeaseClients,
  validateNoticeService,
} from '../../src/utils/notice-service-workflow.js';

describe('isAwaitingNoticeService', () => {
  const base = {
    status: 'in_progress',
    workflow_type: 'rent_increase',
    workflow_data: { notice_document_id: 99 },
  };

  test('true when a notice exists and has not been served', () => {
    expect(isAwaitingNoticeService(base)).toBe(true);
    expect(
      isAwaitingNoticeService({
        ...base,
        workflow_data: { notice_document_id: 99, service_status: 'pending' },
      })
    ).toBe(true);
  });

  test('pending service stays awaiting even if a date was typed', () => {
    expect(
      isAwaitingNoticeService({
        ...base,
        workflow_data: {
          notice_document_id: 99,
          service_status: 'pending',
          served_date: '2026-08-20',
        },
      })
    ).toBe(true);
  });

  test('false when served, completed, or no document', () => {
    expect(
      isAwaitingNoticeService({
        ...base,
        workflow_data: { notice_document_id: 99, served_date: '2026-08-20' },
      })
    ).toBe(false);
    expect(
      isAwaitingNoticeService({
        ...base,
        workflow_data: { notice_document_id: 99, service_status: 'served' },
      })
    ).toBe(false);
    expect(isAwaitingNoticeService({ ...base, status: 'completed' })).toBe(
      false
    );
    expect(
      isAwaitingNoticeService({ ...base, workflow_data: {} })
    ).toBe(false);
    expect(
      isAwaitingNoticeService({ ...base, workflow_type: 'move_in' })
    ).toBe(false);
  });
});

describe('validateNoticeService', () => {
  test('Record Service requires date and method', () => {
    expect(validateNoticeService({}, { action: 'record_service' })).toEqual({
      served_date: 'Date notice served is required to record service.',
      served_method: 'Service method is required to record service.',
    });
    expect(
      validateNoticeService(
        { served_date: '2026-08-16', served_method: 'in_person' },
        { action: 'record_service' }
      )
    ).toEqual({});
  });

  test('Service Later and Next leave service fields optional', () => {
    expect(validateNoticeService({}, { action: 'service_later' })).toEqual({});
    expect(validateNoticeService({}, { action: 'next' })).toEqual({});
    expect(validateNoticeService({})).toEqual({});
  });
});

describe('resumeStepIndex', () => {
  test('drops from last step back to Generate when no PDF exists', () => {
    expect(
      resumeStepIndex({
        currentStep: 4,
        totalSteps: 4,
        workflowData: {},
        generateThenServe: true,
      })
    ).toBe(3);
  });

  test('stays on service when the notice was generated', () => {
    expect(
      resumeStepIndex({
        currentStep: 4,
        totalSteps: 4,
        workflowData: { notice_document_id: 12 },
        generateThenServe: true,
      })
    ).toBe(4);
  });

  test('clamps and ignores for other workflows', () => {
    expect(
      resumeStepIndex({ currentStep: 9, totalSteps: 4, generateThenServe: false })
    ).toBe(4);
    expect(
      resumeStepIndex({
        currentStep: 4,
        totalSteps: 4,
        workflowData: {},
        generateThenServe: false,
      })
    ).toBe(4);
  });
});

describe('fingerprints and mailto', () => {
  test('fingerprints change when terms change', () => {
    const a = { lease_id: 1, new_rent: 2000, effective_date: '2026-10-01' };
    expect(rentIncreaseNoticeFingerprint(a)).toBe('1|2000|2026-10-01');
    expect(
      rentIncreaseNoticeFingerprint({ ...a, new_rent: 2100 })
    ).not.toBe(rentIncreaseNoticeFingerprint(a));
    expect(
      evictionNoticeFingerprint({
        lease_id: 1,
        notice_type: '3_day_pay_or_vacate',
        effective_date: '2026-09-01',
      })
    ).toBe('1|3_day_pay_or_vacate|2026-09-01');
  });

  test('mailto includes recipients and attach reminder', () => {
    const href = buildNoticeMailto({
      emails: ['a@example.com', 'b@example.com'],
      propertyLabel: 'Oak St #2',
      noticeKind: 'rent increase',
    });
    expect(href.startsWith('mailto:a@example.com,b@example.com?')).toBe(true);
    expect(href).toContain(encodeURIComponent('Rent increase notice — Oak St #2'));
    expect(href).toContain(encodeURIComponent('Attach the downloaded PDF'));
  });

  test('tenantEmailsFromLeaseClients de-dupes nested user emails', () => {
    expect(
      tenantEmailsFromLeaseClients([
        { clients: { users: { email: 'a@x.com' } } },
        { client: { users: { email: 'a@x.com' } } },
        { clients: { users: { email: 'b@x.com' } } },
        { clients: { users: { email: '' } } },
      ])
    ).toEqual(['a@x.com', 'b@x.com']);
  });
});
