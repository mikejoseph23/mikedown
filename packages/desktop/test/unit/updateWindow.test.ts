/** U2: the update window in jsdom, driven by a fake controller snapshot. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdaterController, UpdaterSnapshot } from '../../src/app/updater';
import type { UpdateInfo } from '../../src/app/updaterApi';
import { createUpdateWindow } from '../../src/ui/updateWindow';

const INFO: UpdateInfo = { version: '1.0.0', currentVersion: '0.1.0', notes: '- Faster\n- [Site](https://www.iadev.net/)\n\n<script>bad()</script>', date: null };

function fakeController(info: UpdateInfo | null = INFO) {
  let snap: UpdaterSnapshot = { state: info ? 'available' : 'idle', info, progress: null, error: null };
  const listeners = new Set<(s: UpdaterSnapshot) => void>();
  const ctl = {
    getSnapshot: () => snap,
    subscribe: (fn: (s: UpdaterSnapshot) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    restartNow: vi.fn(async () => undefined),
    skip: vi.fn(async () => undefined),
    snooze: vi.fn(async () => undefined),
  };
  const set = (patch: Partial<UpdaterSnapshot>) => {
    snap = { ...snap, ...patch };
    for (const fn of [...listeners]) {fn(snap);}
  };
  return { ctl: ctl as unknown as UpdaterController & typeof ctl, set };
}

function setup(info: UpdateInfo | null = INFO) {
  const { ctl, set } = fakeController(info);
  const openExternal = vi.fn();
  const opener = document.createElement('button');
  opener.textContent = 'opener';
  document.body.appendChild(opener);
  opener.focus();
  const w = createUpdateWindow({ root: document.body, controller: () => ctl, openExternal, windows: true });
  w.open();
  const sheet = () => document.querySelector<HTMLElement>('.mdapp-updwin');
  const btn = (a: string) => sheet()!.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)!;
  const key = (k: string, target: Element = document.activeElement ?? sheet()!) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { w, ctl, set, openExternal, opener, sheet, btn, key };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('update window', () => {
  it('is an alertdialog with title, subtitle, major line and sanitized notes', () => {
    const t = setup();
    const s = t.sheet()!;
    expect(s.getAttribute('role')).toBe('alertdialog');
    expect(s.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(s.getAttribute('aria-labelledby')!)?.textContent).toBe('A new version of MikeDown is available');
    expect(document.getElementById(s.getAttribute('aria-describedby')!)?.textContent).toBe('MikeDown 1.0.0 is available. You have 0.1.0.');
    expect(s.querySelector<HTMLElement>('.mdapp-updwin__major')!.hidden).toBe(false);
    const notes = s.querySelector('.mdapp-updwin__notes')!;
    expect(notes.querySelectorAll('li')).toHaveLength(2);
    expect(notes.querySelector('script')).toBeNull();
    expect(s.dataset.mode).toBe('offer');
  });

  it('says so when there are no notes, and hides the major line for a minor bump', () => {
    const t = setup({ version: '0.2.0', currentVersion: '0.1.0', notes: null, date: null });
    expect(t.sheet()!.querySelector('.mdapp-updwin__notes')!.textContent).toBe('No release notes were provided for this version.');
    expect(t.sheet()!.querySelector<HTMLElement>('.mdapp-updwin__major')!.hidden).toBe(true);
  });

  it('buttons in order, Install and Relaunch focused by default', () => {
    const t = setup();
    const labels = [...t.sheet()!.querySelectorAll('.mdapp-updwin__actions button')].map((b) => b.textContent);
    expect(labels).toEqual(['Skip This Version', 'Remind Me Later', 'Install and Relaunch']);
    expect(document.activeElement).toBe(t.btn('install'));
  });

  it('Escape is Remind Me Later and focus returns', () => {
    const t = setup();
    t.key('Escape');
    expect(t.ctl.snooze).toHaveBeenCalledOnce();
    expect(t.sheet()).toBeNull();
    expect(document.activeElement).toBe(t.opener);
  });

  it('Skip This Version skips and closes', () => {
    const t = setup();
    t.btn('skip').click();
    expect(t.ctl.skip).toHaveBeenCalledOnce();
    expect(t.w.isOpen()).toBe(false);
  });

  it('Tab stays inside the sheet', () => {
    const t = setup();
    t.key('Tab');
    expect(t.sheet()!.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 10; i++) {t.key('Tab');}
    expect(t.sheet()!.contains(document.activeElement)).toBe(true);
  });

  it('Install and Relaunch gives way to progress, then ready, installing and failed', () => {
    const t = setup();
    t.btn('install').click();
    expect(t.ctl.restartNow).toHaveBeenCalledOnce();
    expect(t.w.installRequested()).toBe(true);
    t.set({ state: 'downloading', progress: { downloaded: 42, total: 100 } });
    const s = t.sheet()!;
    expect(s.dataset.mode).toBe('progress');
    expect(s.querySelector<HTMLElement>('.mdapp-updwin__actions')!.hidden).toBe(true);
    expect(s.querySelector('.mdapp-updwin__status')!.textContent).toContain('Downloading update… 42%');
    expect(s.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('42');
    expect(s.querySelector('[role="status"][aria-live="polite"]')!.textContent).toBe('Downloading update… 25%');
    t.set({ state: 'verifying', progress: null });
    expect(s.querySelector('.mdapp-updwin__status')!.textContent).toContain('Verifying…');
    expect(s.querySelector('[role="progressbar"]')!.hasAttribute('aria-valuenow')).toBe(false);
    t.set({ state: 'ready' });
    expect(s.dataset.mode).toBe('ready');
    expect(s.querySelector('.mdapp-updwin__status')!.textContent).toContain("Update ready. Install when you're ready.");
    expect(document.activeElement).toBe(t.btn('install'));
    t.set({ state: 'installing' });
    expect(s.querySelector('.mdapp-updwin__status')!.textContent).toContain('Installing. MikeDown will reopen in a moment.');
    t.set({ state: 'failed', error: 'boom' });
    expect(s.dataset.mode).toBe('failed');
    const link = s.querySelector<HTMLAnchorElement>('.mdapp-updwin__website')!;
    expect(link.hidden).toBe(false);
    link.click();
    expect(t.openExternal).toHaveBeenCalledWith('https://www.iadev.net/mikedown/');
  });

  it('Escape during a download hides without snoozing', () => {
    const t = setup();
    t.set({ state: 'downloading', progress: null });
    t.key('Escape');
    expect(t.ctl.snooze).not.toHaveBeenCalled();
    expect(t.w.isOpen()).toBe(false);
  });

  it('links in the notes open in the browser', () => {
    const t = setup();
    const a = t.sheet()!.querySelector<HTMLAnchorElement>('.mdapp-updwin__notes a')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(t.openExternal).toHaveBeenCalledWith('https://www.iadev.net/');
  });

  it('closes itself when the update goes away (skipped in another window)', () => {
    const t = setup();
    t.set({ state: 'idle', info: null });
    expect(t.w.isOpen()).toBe(false);
  });

  it('does nothing without an update', () => {
    const t = setup(null);
    expect(t.sheet()).toBeNull();
  });
});
