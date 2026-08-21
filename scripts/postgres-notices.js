/**
 * postgres.js logs every server NoticeResponse with console.log by default,
 * including IF NOT EXISTS skips. Filter those so migration output stays
 * readable; still surface WARNING and above.
 */

const QUIET_SEVERITIES = new Set(['NOTICE', 'INFO', 'LOG', 'DEBUG', 'DEBUG1', 'DEBUG2', 'DEBUG3', 'DEBUG4', 'DEBUG5']);

export function postgresNoticeSeverity(notice) {
  return String(notice?.severity || notice?.severity_local || '').toUpperCase();
}

export function isQuietPostgresNotice(notice) {
  const severity = postgresNoticeSeverity(notice);
  return !severity || QUIET_SEVERITIES.has(severity);
}

export function handlePostgresNotice(notice) {
  if (isQuietPostgresNotice(notice)) return;
  const severity = postgresNoticeSeverity(notice) || 'WARNING';
  const message = notice?.message || String(notice);
  console.warn(`⚠️ PostgreSQL ${severity}: ${message}`);
}

export function postgresClientDefaults() {
  return {
    onnotice: handlePostgresNotice,
    connection: {
      application_name: 'metro-landmark-db-util',
      client_min_messages: 'warning',
    },
  };
}
