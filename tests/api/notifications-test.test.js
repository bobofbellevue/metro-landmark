import { jest } from '@jest/globals';

function createRes() {
  const res = { headers: {}, statusCode: 200, jsonData: null };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.jsonData = obj;
    return res;
  };
  res.end = () => res;
  return res;
}

let usersRow = { user_id: 7, email: 'ops@example.com' };
let usersError = null;
let sendEmail = async () => ({ success: true, messageId: 'sg-1' });
let sendSMS = async () => ({ success: true, messageSid: 'sm-1' });
let getUserPhoneNumber = async () => '+12065550100';

await jest.unstable_mockModule('../../api/utils/supabase-client.js', () => ({
  createSupabaseClient: () => ({
    from: (table) => {
      if (table !== 'users') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: usersRow, error: usersError }),
          }),
        }),
      };
    },
  }),
}));

await jest.unstable_mockModule('../../api/utils/email-service.js', () => ({
  sendEmail: (...args) => sendEmail(...args),
}));

await jest.unstable_mockModule('../../api/utils/sms-service.js', () => ({
  sendSMS: (...args) => sendSMS(...args),
  getUserPhoneNumber: (...args) => getUserPhoneNumber(...args),
}));

const { default: handler } = await import('../../api/notifications/test.js');

describe('api/notifications/test', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    usersRow = { user_id: 7, email: 'ops@example.com' };
    usersError = null;
    sendEmail = async () => ({ success: true, messageId: 'sg-1' });
    sendSMS = async () => ({ success: true, messageSid: 'sm-1' });
    getUserPhoneNumber = async () => '+12065550100';
  });

  test('sends a test email and names the address', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-user-id': '7' },
        body: { notification_type: 'email', category: 'maintenance' },
      },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.message).toBe('Sent a test email to ops@example.com.');
  });

  test('reports a SendGrid failure with the destination', async () => {
    sendEmail = async () => ({
      success: false,
      error: 'SendGrid API error (403): forbidden',
    });
    const res = createRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-user-id': '7' },
        body: { notification_type: 'email', category: 'lease' },
      },
      res
    );
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('ops@example.com');
    expect(res.jsonData.message).toContain('SendGrid');
  });

  test('reports a missing phone number', async () => {
    getUserPhoneNumber = async () => null;
    const res = createRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-user-id': '7' },
        body: { notification_type: 'sms', category: 'payment' },
      },
      res
    );
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toBe(
      'Could not send a test text message: this account has no phone number.'
    );
  });

  test('sends a test SMS and names the number', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-user-id': '7' },
        body: { notification_type: 'sms', category: 'general' },
      },
      res
    );
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.message).toBe('Sent a test text message to +12065550100.');
  });

  test('uses the signed-in email when the users row cannot be loaded', async () => {
    usersRow = null;
    usersError = { message: "column users.first_name does not exist" };
    const res = createRes();
    await handler(
      {
        method: 'POST',
        headers: { 'x-user-id': '7' },
        body: {
          notification_type: 'email',
          category: 'maintenance',
          email: 'bobofbellevue@gmail.com',
        },
      },
      res
    );
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.message).toBe(
      'Sent a test email to bobofbellevue@gmail.com.'
    );
  });
});
