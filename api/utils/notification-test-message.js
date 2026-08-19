export const NOTIFICATION_TEST_KINDS = {
  email: 'email',
  sms: 'text message',
  push: 'browser notification',
};

function shortenError(error) {
  if (!error) return '';
  const text = String(error).replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}

/**
 * Operator-facing copy for a Test click: always names the channel and,
 * when known, the address or phone the system tried to use.
 */
export function formatNotificationTestMessage({
  channel,
  destination,
  success = false,
  skipped = false,
  queued = false,
  error,
} = {}) {
  const kind = NOTIFICATION_TEST_KINDS[channel] || 'notification';
  const to = destination ? ` to ${destination}` : '';

  if (success && skipped) {
    return `Test ${kind} was not sent${to}: this server is not set up to send ${kind}s.`;
  }

  if (success && queued) {
    return `Test ${kind}${to} was queued for the next digest.`;
  }

  if (success) {
    return `Sent a test ${kind}${to}.`;
  }

  if (channel === 'push') {
    return 'Could not send a test browser notification: that channel is not available yet.';
  }

  const reason = shortenError(error);
  if (reason) {
    return `Could not send a test ${kind}${to}: ${reason}`;
  }

  if (!destination && channel === 'email') {
    return 'Could not send a test email: this account has no email address.';
  }

  if (!destination && channel === 'sms') {
    return 'Could not send a test text message: this account has no phone number.';
  }

  return `Could not send a test ${kind}${to}.`;
}
