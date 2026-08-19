import { formatNotificationTestMessage } from '../../src/utils/notification-test-message.js';

describe('formatNotificationTestMessage', () => {
  test('names the email address on success', () => {
    expect(
      formatNotificationTestMessage({
        channel: 'email',
        destination: 'ops@example.com',
        success: true,
      })
    ).toBe('Sent a test email to ops@example.com.');
  });

  test('names the phone number on SMS failure', () => {
    expect(
      formatNotificationTestMessage({
        channel: 'sms',
        destination: '+12065550100',
        error: 'Twilio error (21211): Invalid phone number',
      })
    ).toBe(
      'Could not send a test text message to +12065550100: Twilio error (21211): Invalid phone number'
    );
  });

  test('explains a missing phone number', () => {
    expect(
      formatNotificationTestMessage({
        channel: 'sms',
        destination: null,
      })
    ).toBe(
      'Could not send a test text message: this account has no phone number.'
    );
  });

  test('explains that browser notifications are not available', () => {
    expect(
      formatNotificationTestMessage({
        channel: 'push',
      })
    ).toBe(
      'Could not send a test browser notification: that channel is not available yet.'
    );
  });
});
