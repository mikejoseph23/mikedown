/**
 * T1: the update flow against a stub host that behaves like updater.rs for
 * Skip and Remind Me Later: the state lives in Node (like updater-state.json),
 * so it survives a page reload (a relaunch). A silent check is driven by the
 * dev hook `updater.tick()`; a found update reaches the page the way the host
 * delivers it, as a `mikedown:update-available` event.
 */
import type { Page } from '@playwright/test';
import { test, expect, type Ipc } from './fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Info { version: string; currentVersion: string; notes: string | null; date: string | null }
const info = (version: string): Info => ({ version, currentVersion: '0.1.0', notes: '- Something new', date: null });

/** The Rust side's skip / snooze bookkeeping, minus the network. */
function stubHost(ipc: Ipc, available: Info) {
  const host = {
    skipped: null as string | null,
    snoozeUntil: null as number | null,
    /** Fake clock offset, to run past a snooze without waiting. */
    clockSkew: 0,
    checks: [] as Array<{ manual: boolean; found: string | null }>,
    snoozeDays: [] as Array<number | null>,
    now: () => Date.now() + host.clockSkew,
    available,
  };
  ipc.custom.updater_status = () => ({
    phase: 'idle', version: null, channel: 'direct', lastCheckedAt: null, lastResult: null,
    skippedVersion: host.skipped, snoozeUntil: host.snoozeUntil,
  });
  ipc.custom.updater_claim = () => true;
  ipc.custom.updater_pending = () => null;
  ipc.custom.updater_check = (args: { manual: boolean }) => {
    if (args.manual) {
      host.skipped = null;
      host.snoozeUntil = null;
    }
    const v = host.available.version;
    const suppressed = !args.manual && (host.skipped === v || (host.snoozeUntil !== null && host.now() < host.snoozeUntil));
    const found = suppressed ? null : host.available;
    host.checks.push({ manual: args.manual, found: found?.version ?? null });
    return found;
  };
  ipc.custom.updater_skip = (args: { version: string }) => {
    host.skipped = args.version;
    return null;
  };
  ipc.custom.updater_snooze = (args: { days: number | null }) => {
    host.snoozeDays.push(args.days);
    host.snoozeUntil = host.now() + (args.days ?? 14) * DAY_MS;
    return null;
  };
  ipc.custom.updater_install = () => null;
  return host;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).mikedownApp?.updater);
}

/** One silent check, and the host's event if it found something. */
async function silentCheck(page: Page, host: ReturnType<typeof stubHost>): Promise<string | null> {
  const before = host.checks.length;
  await page.evaluate(() => (window as any).mikedownApp.updater.tick());
  expect(host.checks.length).toBe(before + 1);
  const found = host.checks[host.checks.length - 1].found;
  if (found) {
    // The page registers its event listener asynchronously after boot; re-emit
    // (announce is idempotent) until the page has heard it.
    await expect.poll(async () => {
      await page.evaluate((i) => (window as any).__mikedownE2eEmit('mikedown:update-available', i), host.available);
      return (await page.evaluate(() => (window as any).mikedownApp.updater.getSnapshot().info?.version ?? null)) as string | null;
    }, { timeout: 5000 }).toBe(found);
  }
  return found;
}

const NOTICE = '.mdapp-update';
const SHEET = '.mdapp-updwin';

test('the window opens from the notice', async ({ page, ipc }) => {
  const host = stubHost(ipc, info('1.0.0'));
  await boot(page);
  expect(await silentCheck(page, host)).toBe('1.0.0');
  await expect(page.locator(NOTICE)).toContainText('MikeDown 1.0.0 is available');
  await expect(page.locator(SHEET)).toHaveCount(0);
  await page.locator(`${NOTICE} [data-action="view"]`).click();
  await expect(page.locator(SHEET)).toHaveAttribute('data-mode', 'offer');
  await expect(page.locator(SHEET)).toContainText('Something new');
});

test('Skip This Version persists across a relaunch, and only for that version', async ({ page, ipc }) => {
  const host = stubHost(ipc, info('1.0.0'));
  await boot(page);
  await silentCheck(page, host);
  await page.locator(`${NOTICE} [data-action="view"]`).click();
  await page.locator(`${SHEET} [data-action="skip"]`).click();
  await expect(page.locator(SHEET)).toHaveCount(0);
  expect(host.skipped).toBe('1.0.0');

  // Relaunch: a fresh page, the same host state.
  await page.reload();
  await page.waitForFunction(() => !!(window as any).mikedownApp?.updater);
  expect(await silentCheck(page, host)).toBeNull();
  await expect(page.locator(NOTICE)).toHaveCount(0);

  // A later release is not skipped.
  host.available = info('1.1.0');
  expect(await silentCheck(page, host)).toBe('1.1.0');
  await expect(page.locator(NOTICE)).toContainText('MikeDown 1.1.0 is available');
});

test('Remind Me Later stays quiet until the snooze ends', async ({ page, ipc }) => {
  const host = stubHost(ipc, info('1.0.0'));
  await boot(page);
  await silentCheck(page, host);
  await page.locator(`${NOTICE} [data-action="view"]`).click();
  await page.locator(`${SHEET} [data-action="later"]`).click();
  await expect(page.locator(SHEET)).toHaveCount(0);
  expect(host.snoozeDays).toEqual([null]); // the host picks the 14 day default

  await page.reload();
  await page.waitForFunction(() => !!(window as any).mikedownApp?.updater);
  expect(await silentCheck(page, host)).toBeNull();
  await expect(page.locator(NOTICE)).toHaveCount(0);

  host.clockSkew = 13 * DAY_MS;
  expect(await silentCheck(page, host)).toBeNull();
  await expect(page.locator(NOTICE)).toHaveCount(0);

  host.clockSkew = 14 * DAY_MS + 1000;
  expect(await silentCheck(page, host)).toBe('1.0.0');
  await expect(page.locator(NOTICE)).toContainText('MikeDown 1.0.0 is available');
});

test('a manual check clears Skip and Snooze', async ({ page, ipc }) => {
  const host = stubHost(ipc, info('1.0.0'));
  host.skipped = '1.0.0';
  host.snoozeUntil = Date.now() + 5 * DAY_MS;
  await boot(page);
  expect(await silentCheck(page, host)).toBeNull();
  await page.evaluate(() => (window as any).mikedownApp.updater.manualCheck());
  expect(host.checks[host.checks.length - 1]).toEqual({ manual: true, found: '1.0.0' });
  expect(host.skipped).toBeNull();
  expect(host.snoozeUntil).toBeNull();
});

test('keyboard: Tab walks the notes, Skip, Remind Me Later and Install and Relaunch, and stays in the sheet', async ({ page, ipc }) => {
  const host = stubHost(ipc, info('1.0.0'));
  await boot(page);
  await silentCheck(page, host);
  await page.locator(`${NOTICE} [data-action="view"]`).click();
  const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.action ?? document.activeElement?.tagName ?? '');

  await expect(page.locator('[data-action="install"]')).toBeFocused();
  await page.keyboard.press('Tab'); // wraps past the end to the notes (a scrollable stop)
  await expect(page.locator('.mdapp-updwin__notes')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await focused()).toBe('skip');
  await page.keyboard.press('Tab');
  expect(await focused()).toBe('later');
  await page.keyboard.press('Tab');
  expect(await focused()).toBe('install');
  await page.keyboard.press('Shift+Tab');
  expect(await focused()).toBe('later');

  // Enter on the focused button activates that button (Remind Me Later), not Install.
  await page.keyboard.press('Enter');
  await expect(page.locator(SHEET)).toHaveCount(0);
  expect(host.snoozeDays).toHaveLength(1);
  expect(ipc.calls.some((c) => c.cmd === 'updater_install')).toBe(false);
});

test('keyboard: Enter on the default button installs; Escape is Remind Me Later', async ({ page, ipc }) => {
  const host = stubHost(ipc, info('1.0.0'));
  await boot(page);
  await silentCheck(page, host);
  await page.locator(`${NOTICE} [data-action="view"]`).click();
  await expect(page.locator('[data-action="install"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => ipc.calls.some((c) => c.cmd === 'updater_install')).toBe(true);

  // Fresh page for Escape.
  await page.reload();
  await page.waitForFunction(() => !!(window as any).mikedownApp?.updater);
  await silentCheck(page, host);
  await page.locator(`${NOTICE} [data-action="view"]`).click();
  await page.keyboard.press('Escape');
  await expect(page.locator(SHEET)).toHaveCount(0);
  expect(host.snoozeDays).toEqual([null]);
});
