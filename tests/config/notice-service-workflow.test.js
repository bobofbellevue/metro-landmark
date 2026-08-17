import {
  buildNoticeMailto,
  buildGmailComposeUrl,
  buildNoticeEmailPlainText,
  evictionNoticeFingerprint,
  isAwaitingNoticeService,
  NOTICE_PICKER_GROUP_GENERATE,
  NOTICE_PICKER_GROUP_RECORD_SERVICE,
  noticePickerAnnotation,
  openWorkflowsByLeaseId,
  rentIncreaseNoticeFingerprint,
  resumeStepIndex,
  tenantEmailsFromLeaseClients,
  validateNoticeService,
  workflowLeaseId,
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

  test('skips Select Lease when a lease is already saved but step is 1', () => {
    expect(
      resumeStepIndex({
        currentStep: 1,
        totalSteps: 4,
        workflowData: { lease_id: 42, new_rent: 2100 },
        generateThenServe: true,
      })
    ).toBe(2);
  });

  test('keeps Generate Notice when that is the saved step', () => {
    expect(
      resumeStepIndex({
        currentStep: 3,
        totalSteps: 4,
        workflowData: { lease_id: 42, new_rent: 2100, effective_date: '2026-10-01' },
        generateThenServe: true,
      })
    ).toBe(3);
  });

  test('uses workflow_data.current_step when the column is stale', () => {
    expect(
      resumeStepIndex({
        currentStep: 1,
        totalSteps: 4,
        workflowData: { lease_id: 42, current_step: 3 },
        generateThenServe: true,
      })
    ).toBe(3);
  });

  test('opens the service step when a notice PDF exists but step is 1', () => {
    expect(
      resumeStepIndex({
        currentStep: 1,
        totalSteps: 4,
        workflowData: { lease_id: 42, notice_document_id: 9 },
        generateThenServe: true,
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
    expect(href).toContain(encodeURIComponent('Please find the attached'));
    expect(href).not.toContain(encodeURIComponent('Attach the downloaded PDF'));
  });

  test('copy-text and Gmail compose share the same subject and body', () => {
    const opts = {
      emails: ['a@example.com', 'b@example.com'],
      propertyLabel: 'Oak St #2',
      noticeKind: 'rent increase',
    };
    const text = buildNoticeEmailPlainText(opts);
    expect(text).toContain('To: a@example.com, b@example.com');
    expect(text).toContain('Subject: Rent increase notice — Oak St #2');
    expect(text).toContain('Please find the attached rent increase notice');
    expect(text).not.toContain('Attach the downloaded PDF');

    const gmail = buildGmailComposeUrl(opts);
    expect(gmail.startsWith('https://mail.google.com/mail/?')).toBe(true);
    expect(gmail).toContain('view=cm');
    expect(gmail).toContain('a%40example.com');
    expect(gmail).toContain('b%40example.com');
    expect(gmail).toContain('Rent+increase+notice');
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

describe('notice picker lease grouping', () => {
  test('maps open workflows by lease and prefers awaiting service', () => {
    const draft = {
      workflow_id: 1,
      lease_id: 10,
      status: 'in_progress',
      workflow_type: 'rent_increase',
      workflow_data: {},
    };
    const awaiting = {
      workflow_id: 2,
      lease_id: 10,
      status: 'in_progress',
      workflow_type: 'rent_increase',
      workflow_data: { notice_document_id: 99, service_status: 'pending' },
    };
    const other = {
      workflow_id: 3,
      workflow_type: 'rent_increase',
      status: 'draft',
      workflow_data: { lease_id: 11 },
    };
    const byLease = openWorkflowsByLeaseId([draft, awaiting, other]);
    expect(workflowLeaseId(other)).toBe(11);
    expect(byLease.get('10').workflow_id).toBe(2);
    expect(byLease.get('11').workflow_id).toBe(3);
    expect(noticePickerAnnotation(awaiting).group).toBe(
      NOTICE_PICKER_GROUP_RECORD_SERVICE
    );
    expect(noticePickerAnnotation(draft).group).toBe(
      NOTICE_PICKER_GROUP_GENERATE
    );
    expect(noticePickerAnnotation(null)).toBeNull();
  });
});
