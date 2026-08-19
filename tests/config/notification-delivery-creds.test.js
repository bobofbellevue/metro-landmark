import { resolveTwilioCredentials } from '../../api/utils/twilio-credentials.js';
import { formatSendGridDeliveryError } from '../../api/utils/email-delivery-error.js';

describe('resolveTwilioCredentials', () => {
  test('uses Account SID and auth token', () => {
    expect(
      resolveTwilioCredentials({
        TWILIO_ACCOUNT_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        TWILIO_AUTH_TOKEN: 'token',
      })
    ).toMatchObject({
      mode: 'auth_token',
      accountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  test('uses API key plus Account SID when SID was stored as SK', () => {
    expect(
      resolveTwilioCredentials({
        TWILIO_ACCOUNT_SID: 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        TWILIO_AUTH_TOKEN: 'secret',
        TWILIO_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      })
    ).toMatchObject({
      mode: 'api_key',
      accountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      apiKey: 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      apiSecret: 'secret',
    });
  });

  test('uses TWILIO_API_KEY with AC account SID', () => {
    expect(
      resolveTwilioCredentials({
        TWILIO_ACCOUNT_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        TWILIO_API_KEY: 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        TWILIO_API_SECRET: 'secret',
      })
    ).toMatchObject({
      mode: 'api_key',
      accountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      apiKey: 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
  });

  test('explains when only an API key is present', () => {
    const resolved = resolveTwilioCredentials({
      TWILIO_ACCOUNT_SID: 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      TWILIO_AUTH_TOKEN: 'secret',
    });
    expect(resolved.error).toMatch(/API key \(SK/);
    expect(resolved.error).toMatch(/Account SID \(AC/);
  });
});

describe('formatSendGridDeliveryError', () => {
  test('names an unverified From address', () => {
    const error = {
      response: {
        body: {
          errors: [
            {
              message:
                'The from address does not match a verified Sender Identity. Mail cannot be sent until this error is resolved.',
            },
          ],
        },
      },
    };
    expect(formatSendGridDeliveryError(error, 'noreply@example.com')).toMatch(
      /FROM_EMAIL is not a verified SendGrid Sender Identity/
    );
    expect(
      formatSendGridDeliveryError(error, 'alerts@salishlandmark.com')
    ).toMatch(/alerts@salishlandmark.com/);
  });
});
