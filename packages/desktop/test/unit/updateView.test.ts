/** U2: state-to-view mapping for the update window, and the Settings "Last checked" line. */
import { describe, expect, it } from 'vitest';
import { isMajorUpdate, lastCheckedText, liveProgressText, progressPercent, relativeTime, UPDATE_TEXT, updateWindowView } from '../../src/ui/updateView';

const mac = { windows: false };
const win = { windows: true };

describe('updateWindowView', () => {
  it('offer: buttons, no status', () => {
    expect(updateWindowView({ state: 'available', progress: null }, mac)).toEqual({
      mode: 'offer', status: null, buttons: true, error: false, websiteLink: false,
    });
  });

  it('downloading with a total shows the percent and hides the buttons', () => {
    const v = updateWindowView({ state: 'downloading', progress: { downloaded: 42, total: 100 } }, mac);
    expect(v).toMatchObject({ mode: 'progress', status: 'Downloading update… 42%', percent: 42, buttons: false });
  });

  it('downloading without a total is indeterminate', () => {
    const v = updateWindowView({ state: 'downloading', progress: { downloaded: 42, total: null } }, mac);
    expect(v).toMatchObject({ mode: 'progress', status: 'Downloading update…', percent: null });
  });

  it('verifying', () => {
    expect(updateWindowView({ state: 'verifying', progress: null }, mac)).toMatchObject({ mode: 'progress', status: 'Verifying…', percent: null, buttons: false });
  });

  it('ready after a cancelled quit dialog brings the buttons back', () => {
    expect(updateWindowView({ state: 'ready', progress: null }, mac)).toMatchObject({ mode: 'ready', status: "Update ready. Install when you're ready.", buttons: true });
  });

  it('installing shows the reopen line on Windows', () => {
    expect(updateWindowView({ state: 'installing', progress: null }, win).status).toBe('Installing. MikeDown will reopen in a moment.');
    expect(updateWindowView({ state: 'installing', progress: null }, mac)).toMatchObject({ mode: 'installing', buttons: false, percent: null });
  });

  it('failed shows the error line with the website link and the buttons', () => {
    expect(updateWindowView({ state: 'failed', progress: null }, mac)).toEqual({
      mode: 'failed', status: UPDATE_TEXT.failed, buttons: true, error: true, websiteLink: true,
    });
    expect(UPDATE_TEXT.failed).toBe("The update couldn't be installed. Please try again, or download it from the MikeDown website.");
  });
});

describe('progress', () => {
  it('clamps and floors', () => {
    expect(progressPercent({ downloaded: 999, total: 1000 })).toBe(99);
    expect(progressPercent({ downloaded: 2000, total: 1000 })).toBe(100);
    expect(progressPercent({ downloaded: 5, total: 0 })).toBeNull();
    expect(progressPercent(null)).toBeNull();
  });

  it('the live region moves in quarters', () => {
    const at = (pct: number) => liveProgressText(updateWindowView({ state: 'downloading', progress: { downloaded: pct, total: 100 } }, mac));
    expect(at(3)).toBe('Downloading update…');
    expect(at(24)).toBe('Downloading update…');
    expect(at(26)).toBe('Downloading update… 25%');
    expect(at(99)).toBe('Downloading update… 75%');
    expect(at(100)).toBe('Downloading update… 100%');
    expect(liveProgressText(updateWindowView({ state: 'verifying', progress: null }, mac))).toBe('Verifying…');
  });
});

describe('isMajorUpdate', () => {
  it('is true only when the first number grows', () => {
    expect(isMajorUpdate('1.4.2', '2.0.0')).toBe(true);
    expect(isMajorUpdate('0.9.0', '1.0.0')).toBe(true);
    expect(isMajorUpdate('0.1.0', '0.2.0')).toBe(false);
    expect(isMajorUpdate('1.0.0', '1.9.0-rc.1')).toBe(false);
    expect(isMajorUpdate('v1.0.0', 'v2.0.0')).toBe(true);
    expect(isMajorUpdate('', '2.0.0')).toBe(false);
  });
});

describe('subtitle', () => {
  it('follows the spec', () => {
    expect(UPDATE_TEXT.subtitle('0.2.0', '0.1.0')).toBe('MikeDown 0.2.0 is available. You have 0.1.0.');
  });
});

describe('lastCheckedText', () => {
  const now = 1_000_000_000_000;
  it('reads naturally', () => {
    expect(lastCheckedText(null, now)).toBe('Last checked: never');
    expect(lastCheckedText(now - 10_000, now)).toBe('Last checked: just now');
    expect(relativeTime(now - 60_000, now)).toBe('1 minute ago');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(relativeTime(now - 60 * 60_000, now)).toBe('1 hour ago');
    expect(relativeTime(now - 4 * 60 * 60_000, now)).toBe('4 hours ago');
    expect(relativeTime(now - 24 * 60 * 60_000, now)).toBe('yesterday');
    expect(relativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe('3 days ago');
  });
});
