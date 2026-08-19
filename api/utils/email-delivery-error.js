const DEFAULT_FROM = 'noreply@example.com';

export function formatSendGridDeliveryError(error, fromEmail) {
  const statusCode = error?.response?.statusCode ?? error?.code;
  const listed = error?.response?.body?.errors;
  const messages = Array.isArray(listed)
    ? listed.map((entry) => entry?.message).filter(Boolean)
    : [];
  const detail = messages[0] || error?.message || 'Failed to send email';
  const from = fromEmail || 'the configured From address';

  if (/sender identity|from address does not match/i.test(detail)) {
    if (!fromEmail || fromEmail === DEFAULT_FROM) {
      return `FROM_EMAIL is not a verified SendGrid Sender Identity (tried ${from}). Set FROM_EMAIL to an address or domain verified in SendGrid.`;
    }
    return `SendGrid rejected From address ${from}. Verify that address or its domain as a Sender Identity in SendGrid, then set FROM_EMAIL to it.`;
  }

  if (statusCode && statusCode !== 'undefined') {
    return `SendGrid error (${statusCode}): ${detail}`;
  }
  return detail;
}
