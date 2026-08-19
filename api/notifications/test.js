/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';
import { formatNotificationTestMessage } from '../utils/notification-test-message.js';

/**
 * POST /api/notifications/test
 *
 * Loads SendGrid or Twilio only for the channel being tested. Importing the
 * full notification-service (both providers + templates) crashed this
 * function on Vercel with FUNCTION_INVOCATION_FAILED.
 */

const SEND_TIMEOUT_MS = 8000;

function jsonBody(req) {
  const body = req?.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  if (typeof body === 'string' && body.trim()) {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

function withDeadline(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not respond in ${ms / 1000} seconds.`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  const body = jsonBody(req);
  const notificationType = body.notification_type;
  const category = body.category;

  const fail = (destination, error, extra = {}) => {
    const message = formatNotificationTestMessage({
      channel: notificationType,
      destination,
      error,
    });
    return res.status(200).json({
      success: false,
      error: message,
      message,
      destination,
      ...extra,
    });
  };

  try {
    const userId = req.headers['x-user-id'] ? parseInt(req.headers['x-user-id'], 10) : null;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    if (!notificationType || !category) {
      return res.status(400).json({
        success: false,
        error: 'notification_type and category are required',
      });
    }

    if (!['email', 'sms', 'push'].includes(notificationType)) {
      return res.status(400).json({
        success: false,
        error: 'notification_type must be email, sms, or push',
      });
    }

    if (!['maintenance', 'lease', 'payment', 'general'].includes(category)) {
      return res.status(400).json({
        success: false,
        error: 'category must be maintenance, lease, payment, or general',
      });
    }

    if (notificationType === 'push') {
      return fail(null, 'Browser notifications are not available yet.');
    }

    const supabase = createSupabaseClient();
    const { data: account, error: accountError } = await supabase
      .from('users')
      .select('user_id, email')
      .eq('user_id', userId)
      .maybeSingle();

    if (accountError) {
      console.error('Error loading user for notification test:', accountError);
    }

    const sessionEmail =
      typeof body.email === 'string' && body.email.includes('@')
        ? body.email.trim()
        : null;
    const accountEmail = account?.email || sessionEmail || null;

    const subject = 'Test Notification';
    const text =
      'This is a test notification to verify your notification preferences are working correctly.';

    if (notificationType === 'email') {
      const destination = accountEmail;
      if (!destination) {
        return fail(
          null,
          accountError?.message || 'this account has no email address.'
        );
      }

      let sendEmail;
      try {
        ({ sendEmail } = await import('../utils/email-service.js'));
      } catch (importError) {
        return fail(destination, importError.message || 'Email service failed to load.');
      }

      let result;
      try {
        result = await withDeadline(
          sendEmail({
            to: destination,
            subject,
            text,
            html: `<p>${text}</p>`,
          }),
          SEND_TIMEOUT_MS,
          'Email service'
        );
      } catch (sendError) {
        return fail(destination, sendError.message);
      }

      if (result?.skipped) {
        return fail(destination, 'this server is not set up to send emails.');
      }

      if (!result?.success) {
        return fail(destination, result?.error);
      }

      const message = formatNotificationTestMessage({
        channel: 'email',
        destination,
        success: true,
      });
      return res.status(200).json({ success: true, message, destination });
    }

    let sendSMS;
    let getUserPhoneNumber;
    try {
      ({ sendSMS, getUserPhoneNumber } = await import('../utils/sms-service.js'));
    } catch (importError) {
      return fail(null, importError.message || 'SMS service failed to load.');
    }

    const destination = await getUserPhoneNumber(supabase, userId);
    if (!destination) {
      return fail(null);
    }

    let result;
    try {
      result = await withDeadline(
        sendSMS({
          to: destination,
          message: text,
        }),
        SEND_TIMEOUT_MS,
        'Text message service'
      );
    } catch (sendError) {
      return fail(destination, sendError.message);
    }

    if (result?.skipped) {
      return fail(destination, 'this server is not set up to send text messages.');
    }

    if (!result?.success) {
      return fail(destination, result?.error);
    }

    const message = formatNotificationTestMessage({
      channel: 'sms',
      destination,
      success: true,
    });
    return res.status(200).json({ success: true, message, destination });
  } catch (error) {
    console.error('Error in test notification handler:', error);
    return fail(null, error.message || 'Internal server error');
  }
}
