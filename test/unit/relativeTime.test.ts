import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../../src/webview/relativeTime';

const NOW = new Date('2026-05-20T12:00:00Z').getTime();
const seconds = (n: number): number => n * 1000;
const minutes = (n: number): number => n * 60 * 1000;
const hours = (n: number): number => n * 60 * 60 * 1000;
const days = (n: number): number => n * 24 * 60 * 60 * 1000;
const weeks = (n: number): number => n * 7 * 24 * 60 * 60 * 1000;
const months = (n: number): number => n * 30 * 24 * 60 * 60 * 1000;
const years = (n: number): number => n * 365 * 24 * 60 * 60 * 1000;

describe('formatRelativeTime', () => {
  it('returns "just now" within the last minute', () => {
    expect(formatRelativeTime(NOW - seconds(15), NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - seconds(59), NOW)).toBe('just now');
  });

  it('handles small clock skew (future timestamps) gracefully', () => {
    expect(formatRelativeTime(NOW + seconds(10), NOW)).toBe('just now');
  });

  it('flags blatantly future timestamps', () => {
    expect(formatRelativeTime(NOW + hours(2), NOW)).toBe('in the future');
  });

  it('formats minutes', () => {
    expect(formatRelativeTime(NOW - minutes(1), NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(NOW - minutes(5), NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(NOW - minutes(59), NOW)).toBe('59 minutes ago');
  });

  it('formats hours', () => {
    expect(formatRelativeTime(NOW - hours(1), NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(NOW - hours(3), NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(NOW - hours(23), NOW)).toBe('23 hours ago');
  });

  it('formats yesterday', () => {
    expect(formatRelativeTime(NOW - hours(25), NOW)).toBe('yesterday');
    expect(formatRelativeTime(NOW - hours(47), NOW)).toBe('yesterday');
  });

  it('formats days within the same week', () => {
    expect(formatRelativeTime(NOW - days(2), NOW)).toBe('2 days ago');
    expect(formatRelativeTime(NOW - days(6), NOW)).toBe('6 days ago');
  });

  it('formats weeks', () => {
    expect(formatRelativeTime(NOW - weeks(1), NOW)).toBe('1 week ago');
    expect(formatRelativeTime(NOW - weeks(3), NOW)).toBe('3 weeks ago');
  });

  it('formats months', () => {
    expect(formatRelativeTime(NOW - months(1), NOW)).toBe('1 month ago');
    expect(formatRelativeTime(NOW - months(6), NOW)).toBe('6 months ago');
  });

  it('formats years', () => {
    expect(formatRelativeTime(NOW - years(1), NOW)).toBe('1 year ago');
    expect(formatRelativeTime(NOW - years(4), NOW)).toBe('4 years ago');
  });
});
