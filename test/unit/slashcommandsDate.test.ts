import { describe, it, expect, vi } from 'vitest';
import { formatSlashDate, resolveTimeZone } from '../../src/webview/slashcommands-date';

// This suite assumes the process time zone is pinned to UTC (see
// vitest.config.ts `test.env.TZ`), so "local" results are deterministic.

describe('resolveTimeZone', () => {
  it('treats "local", empty, and whitespace as local (undefined)', () => {
    expect(resolveTimeZone('local')).toBeUndefined();
    expect(resolveTimeZone('Local')).toBeUndefined();
    expect(resolveTimeZone('')).toBeUndefined();
    expect(resolveTimeZone('   ')).toBeUndefined();
    expect(resolveTimeZone(undefined)).toBeUndefined();
    expect(resolveTimeZone(null)).toBeUndefined();
  });

  it('passes through "UTC" and valid IANA zone names', () => {
    expect(resolveTimeZone('UTC')).toBe('UTC');
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
    expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('falls back to local and warns once per distinct invalid value', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(resolveTimeZone('Not/ARealZone')).toBeUndefined();
      expect(resolveTimeZone('Not/ARealZone')).toBeUndefined();
      expect(resolveTimeZone('Not/ARealZone')).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('formatSlashDate', () => {
  // 2026-09-26T14:30:00Z. In the test's pinned-UTC "local" zone this is
  // 2026-09-26 14:30 with no zone label.
  const base = new Date('2026-09-26T14:30:00Z');

  it('/date: ISO format', () => {
    expect(formatSlashDate(base, { format: 'iso', timeZone: 'local', includeTime: false })).toBe('2026-09-26');
  });

  it('/date: long format (en-US month name)', () => {
    expect(formatSlashDate(base, { format: 'long', timeZone: 'local', includeTime: false })).toBe(
      'September 26, 2026',
    );
  });

  it('/datetime: ISO format, local time has no zone label', () => {
    expect(formatSlashDate(base, { format: 'iso', timeZone: 'local', includeTime: true })).toBe('2026-09-26 14:30');
  });

  it('/datetime: long format, local time has no zone label', () => {
    expect(formatSlashDate(base, { format: 'long', timeZone: 'local', includeTime: true })).toBe(
      'September 26, 2026 14:30',
    );
  });

  it('/datetime: UTC appends a "UTC" zone label', () => {
    // 18:30Z is also 18:30 in the UTC zone.
    const at = new Date('2026-09-26T18:30:00Z');
    expect(formatSlashDate(at, { format: 'iso', timeZone: 'UTC', includeTime: true })).toBe('2026-09-26 18:30 UTC');
  });

  it('/datetime: America/New_York shows EDT in September (DST)', () => {
    // 18:30Z is 14:30 in New York during EDT (UTC-4).
    const at = new Date('2026-09-26T18:30:00Z');
    expect(formatSlashDate(at, { format: 'iso', timeZone: 'America/New_York', includeTime: true })).toBe(
      '2026-09-26 14:30 EDT',
    );
  });

  it('/datetime: America/New_York shows EST in January (standard time)', () => {
    // 19:30Z is 14:30 in New York during EST (UTC-5).
    const at = new Date('2026-01-15T19:30:00Z');
    expect(formatSlashDate(at, { format: 'iso', timeZone: 'America/New_York', includeTime: true })).toBe(
      '2026-01-15 14:30 EST',
    );
  });

  it('falls back to local (no label) for an invalid time zone, warning once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const opts = { format: 'iso' as const, timeZone: 'Bogus/Zone', includeTime: true };
      expect(formatSlashDate(base, opts)).toBe('2026-09-26 14:30');
      expect(formatSlashDate(base, opts)).toBe('2026-09-26 14:30');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  describe('day rollover across time zones', () => {
    it('America/New_York rolls back to the previous calendar day', () => {
      // 2026-09-26T02:30Z is 2026-09-25T22:30 in New York (EDT, UTC-4).
      const at = new Date('2026-09-26T02:30:00Z');
      expect(formatSlashDate(at, { format: 'iso', timeZone: 'America/New_York', includeTime: false })).toBe(
        '2026-09-25',
      );
    });

    it('UTC keeps the same calendar day for the same instant', () => {
      const at = new Date('2026-09-26T02:30:00Z');
      expect(formatSlashDate(at, { format: 'iso', timeZone: 'UTC', includeTime: false })).toBe('2026-09-26');
    });

    it('Asia/Tokyo rolls forward to the next calendar day', () => {
      // 2026-09-26T23:30Z is 2026-09-27T08:30 in Tokyo (UTC+9).
      const at = new Date('2026-09-26T23:30:00Z');
      expect(formatSlashDate(at, { format: 'iso', timeZone: 'Asia/Tokyo', includeTime: false })).toBe('2026-09-27');
    });
  });

  describe('HH:mm zero-padding and 24-hour clock', () => {
    it('pads a single-digit hour and minute (00:05)', () => {
      const at = new Date('2026-09-26T00:05:00Z');
      expect(formatSlashDate(at, { format: 'iso', timeZone: 'UTC', includeTime: true })).toBe('2026-09-26 00:05 UTC');
    });

    it('renders the last minute of the day as 23:59, not 24-hour-cycle "24:xx"', () => {
      const at = new Date('2026-09-26T23:59:00Z');
      expect(formatSlashDate(at, { format: 'iso', timeZone: 'UTC', includeTime: true })).toBe('2026-09-26 23:59 UTC');
    });

    it('midnight local renders as 00:xx, not 24:xx', () => {
      const at = new Date('2026-09-26T00:00:00Z');
      expect(formatSlashDate(at, { format: 'iso', timeZone: 'local', includeTime: true })).toBe('2026-09-26 00:00');
    });
  });
});
