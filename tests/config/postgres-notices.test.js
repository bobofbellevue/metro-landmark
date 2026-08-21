import { jest } from '@jest/globals';
import {
  handlePostgresNotice,
  isQuietPostgresNotice,
  postgresClientDefaults,
} from '../../scripts/postgres-notices.js';

describe('postgres notice filter', () => {
  test('IF NOT EXISTS skips are quiet', () => {
    expect(
      isQuietPostgresNotice({
        severity: 'NOTICE',
        code: '42P07',
        message: 'relation "listings" already exists, skipping',
      })
    ).toBe(true);
    expect(
      isQuietPostgresNotice({
        severity_local: 'NOTICE',
        severity: 'NOTICE',
        code: '42701',
        message: 'column "theme" of relation "pm_companies" already exists, skipping',
      })
    ).toBe(true);
  });

  test('warnings still log', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(isQuietPostgresNotice({ severity: 'WARNING', message: 'something odd' })).toBe(false);
      handlePostgresNotice({ severity: 'WARNING', message: 'something odd' });
      expect(warn).toHaveBeenCalledWith('⚠️ PostgreSQL WARNING: something odd');
      handlePostgresNotice({
        severity: 'NOTICE',
        message: 'relation "payments" already exists, skipping',
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('client defaults silence notices on every pooled connection', () => {
    const defaults = postgresClientDefaults();
    expect(defaults.connection.client_min_messages).toBe('warning');
    expect(typeof defaults.onnotice).toBe('function');
  });
});
