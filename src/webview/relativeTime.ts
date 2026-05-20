// Format a millisecond timestamp as a human relative-time string like
// "just now", "5 minutes ago", "yesterday", "3 months ago". Buckets are
// deliberately coarse — the footer strip should read at a glance, not
// communicate millisecond accuracy.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const diff = nowMs - timestampMs;

  // Future timestamps (clock skew, freshly-touched-via-API files) — collapse
  // to "just now" rather than confusing the user with "in 3 seconds".
  if (diff < 0 && -diff < MINUTE) return 'just now';
  if (diff < 0) return 'in the future';

  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < WEEK) {
    const d = Math.floor(diff / DAY);
    return `${d} days ago`;
  }
  if (diff < MONTH) {
    const w = Math.floor(diff / WEEK);
    return `${w} week${w === 1 ? '' : 's'} ago`;
  }
  if (diff < YEAR) {
    const mo = Math.floor(diff / MONTH);
    return `${mo} month${mo === 1 ? '' : 's'} ago`;
  }
  const y = Math.floor(diff / YEAR);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}
