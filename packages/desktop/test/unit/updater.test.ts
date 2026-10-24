import { describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS, createUpdater, FIRST_CHECK_DELAY_MS, MESSAGES, TICK_MS, type UpdaterDeps } from '../../src/app/updater';
import type { UpdateInfo, UpdaterApi, UpdaterStatus } from '../../src/app/updaterApi';
import { createUpdatePrompt } from '../../src/ui/updateToast';

const INFO: UpdateInfo = { version: '0.2.0', currentVersion: '0.1.0', notes: 'Fixes', date: null };

const STATUS: UpdaterStatus = {
  phase: 'idle', version: null, channel: 'direct', lastCheckedAt: null, lastResult: null, skippedVersion: null, snoozeUntil: null,
};

/** A fake host with the Rust side's claim semantics (one check per interval). */
function setup(opts: {
  checkOnLaunch?: boolean;
  check?: UpdaterApi['check'];
  install?: UpdaterApi['install'];
  status?: Partial<UpdaterStatus>;
} = {}) {
  let now = 0;
  let lastClaim: number | null = null;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const timeouts: Array<{ fn: () => void; ms: number }> = [];
  const api = {
    claim: vi.fn(async (interval: number) => {
      if (lastClaim !== null && now - lastClaim < interval) {return false;}
      lastClaim = now;
      return true;
    }),
    check: vi.fn(opts.check ?? (async () => null)),
    pending: vi.fn(async () => INFO),
    download: vi.fn(async () => undefined),
    install: vi.fn(opts.install ?? (async () => undefined)),
    skip: vi.fn(async () => undefined),
    snooze: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ ...STATUS, ...opts.status })),
    log: vi.fn(async () => undefined),
    onAvailable: vi.fn(async () => () => undefined),
    onProgress: vi.fn(async () => () => undefined),
    onState: vi.fn(async () => () => undefined),
  } satisfies UpdaterApi;
  const prompt = { show: vi.fn(), hide: vi.fn() };
  const toast = vi.fn();
  const checkOnLaunch = opts.checkOnLaunch ?? true;
  const deps: UpdaterDeps = {
    api,
    prompt,
    toast,
    checkOnLaunch: () => checkOnLaunch,
    appVersion: async () => '0.1.0',
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
  };
  const updater = createUpdater(deps);
  return {
    updater, api, prompt, toast, timers, timeouts,
    advance: (ms: number) => { now += ms; },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('updater: cadence', () => {
  it('constants: first check 10 s after launch, then every 4 h', () => {
    expect(FIRST_CHECK_DELAY_MS).toBe(10_000);
    expect(CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
  });

  it('start schedules the launch check 10 s out and the tick, without checking yet', async () => {
    const t = setup();
    await t.updater.start();
    expect(t.api.check).not.toHaveBeenCalled();
    expect(t.timeouts).toHaveLength(1);
    expect(t.timeouts[0].ms).toBe(FIRST_CHECK_DELAY_MS);
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0].ms).toBe(TICK_MS);
    t.timeouts[0].fn();
    await flush();
    expect(t.api.check).toHaveBeenCalledOnce();
    expect(t.api.check).toHaveBeenCalledWith(false);
    expect(t.api.claim).toHaveBeenCalledWith(CHECK_INTERVAL_MS);
  });

  it('start is idempotent', async () => {
    const t = setup();
    await t.updater.start();
    await t.updater.start();
    expect(t.timeouts).toHaveLength(1);
    expect(t.timers).toHaveLength(1);
  });

  it('re-checks only once 4 h have passed since the last claim', async () => {
    const t = setup();
    await t.updater.start();
    t.timeouts[0].fn();
    await flush();
    expect(t.api.check).toHaveBeenCalledTimes(1);
    for (let n = 1; n * TICK_MS < CHECK_INTERVAL_MS; n++) {
      t.advance(TICK_MS);
      t.timers[0].fn();
      await flush();
    }
    expect(t.api.check).toHaveBeenCalledTimes(1);
    t.advance(TICK_MS);
    t.timers[0].fn();
    await flush();
    expect(t.api.check).toHaveBeenCalledTimes(2);
  });

  it('a second window does not repeat the launch check (claim lost)', async () => {
    const a = setup();
    await a.updater.start();
    a.timeouts[0].fn();
    await flush();
    const second = createUpdater({
      api: a.api,
      prompt: { show: vi.fn(), hide: vi.fn() },
      toast: vi.fn(),
      checkOnLaunch: () => true,
      appVersion: async () => '0.1.0',
      setInterval: () => 0,
      setTimeout: (fn) => { fn(); return 0; },
    });
    await second.start();
    await flush();
    expect(a.api.check).toHaveBeenCalledOnce();
  });

  it('does nothing when "Check for updates on launch" is off, launch or tick', async () => {
    const t = setup({ checkOnLaunch: false });
    await t.updater.start();
    t.timeouts[0].fn();
    t.advance(CHECK_INTERVAL_MS);
    t.timers[0].fn();
    await flush();
    expect(t.api.claim).not.toHaveBeenCalled();
    expect(t.api.check).not.toHaveBeenCalled();
  });

  it('store channel: no timers, no checks, channel reported', async () => {
    const t = setup({ status: { channel: 'store' } });
    await t.updater.start();
    expect(t.timeouts).toHaveLength(0);
    expect(t.timers).toHaveLength(0);
    await t.updater.tick();
    expect(t.api.claim).not.toHaveBeenCalled();
    expect(t.updater.channel()).toBe('store');
  });

  it('swallows errors: no toast, one log line', async () => {
    const t = setup({ check: async () => { throw new Error('offline'); } });
    await t.updater.start();
    t.timeouts[0].fn();
    await flush();
    expect(t.toast).not.toHaveBeenCalled();
    expect(t.prompt.show).not.toHaveBeenCalled();
    expect(t.api.log).toHaveBeenCalledWith(expect.stringContaining('silent check error'));
    expect(t.api.log).toHaveBeenCalledWith(expect.stringContaining('offline'));
  });

  it('even a broken log does not surface', async () => {
    const t = setup({ check: async () => { throw new Error('offline'); } });
    t.api.log.mockRejectedValue(new Error('disk full'));
    await t.updater.start();
    t.timeouts[0].fn();
    await flush();
    expect(t.toast).not.toHaveBeenCalled();
  });
});

describe('updater: controller states', () => {
  it('starts idle; an announcement makes it available', () => {
    const t = setup();
    expect(t.updater.getSnapshot().state).toBe('idle');
    const seen: string[] = [];
    t.updater.subscribe((s) => seen.push(s.state));
    t.updater.announce(INFO);
    expect(t.updater.getSnapshot()).toMatchObject({ state: 'available', info: INFO });
    expect(seen).toEqual(['available']);
  });

  it('follows host states: downloading, verifying, ready, installing', () => {
    const t = setup();
    t.updater.announce(INFO);
    t.updater.applyHostState({ state: 'downloading', version: '0.2.0', error: null });
    t.updater.applyProgress({ downloaded: 50, total: 100 });
    expect(t.updater.getSnapshot()).toMatchObject({ state: 'downloading', progress: { downloaded: 50, total: 100 } });
    t.updater.applyHostState({ state: 'verifying', version: '0.2.0', error: null });
    expect(t.updater.getSnapshot().progress).toEqual({ downloaded: 50, total: 100 });
    t.updater.applyHostState({ state: 'ready', version: '0.2.0', error: null });
    expect(t.updater.getSnapshot()).toMatchObject({ state: 'ready', progress: null });
    t.updater.applyHostState({ state: 'installing', version: '0.2.0', error: null });
    expect(t.updater.getSnapshot().state).toBe('installing');
    expect(t.prompt.hide).toHaveBeenCalled();
  });

  it('failed carries the error; idle clears everything', () => {
    const t = setup();
    t.updater.announce(INFO);
    t.updater.applyHostState({ state: 'failed', version: '0.2.0', error: 'unexpected signer' });
    expect(t.updater.getSnapshot()).toMatchObject({ state: 'failed', error: 'unexpected signer' });
    t.updater.applyHostState({ state: 'idle', version: null, error: null });
    expect(t.updater.getSnapshot()).toEqual({ state: 'idle', info: null, progress: null, error: null });
  });

  it('a late announcement does not knock a running download back to available', () => {
    const t = setup();
    t.updater.announce(INFO);
    t.updater.applyHostState({ state: 'downloading', version: '0.2.0', error: null });
    t.prompt.show.mockClear();
    t.updater.announce(INFO);
    expect(t.updater.getSnapshot().state).toBe('downloading');
    expect(t.prompt.show).not.toHaveBeenCalled();
  });

  it('back to ready after a cancelled quit dialog offers the prompt again', () => {
    const t = setup();
    t.updater.announce(INFO);
    t.updater.applyHostState({ state: 'downloading', version: '0.2.0', error: null });
    t.updater.applyHostState({ state: 'ready', version: '0.2.0', error: null });
    expect(t.prompt.show).toHaveBeenCalledTimes(2);
  });

  it('a manual check during a download does not restart it', async () => {
    const t = setup();
    t.updater.announce(INFO);
    t.updater.applyHostState({ state: 'downloading', version: '0.2.0', error: null });
    await t.updater.manualCheck();
    expect(t.api.check).not.toHaveBeenCalled();
    expect(t.api.install).not.toHaveBeenCalled();
    expect(t.toast).toHaveBeenCalledWith(MESSAGES.downloading('0.2.0'), expect.anything());
  });

  it('Skip This Version tells the host and clears the state', async () => {
    const t = setup();
    t.updater.announce(INFO);
    await t.updater.skip();
    expect(t.api.skip).toHaveBeenCalledWith('0.2.0');
    expect(t.updater.getSnapshot().state).toBe('idle');
    expect(t.prompt.hide).toHaveBeenCalled();
    t.prompt.show.mockClear();
    t.updater.announce(INFO);
    expect(t.prompt.show).not.toHaveBeenCalled();
  });

  it('Remind Me Later snoozes through the host and hides the prompt', async () => {
    const t = setup();
    t.updater.announce(INFO);
    await t.updater.snooze();
    expect(t.api.snooze).toHaveBeenCalledWith(undefined);
    expect(t.prompt.hide).toHaveBeenCalled();
  });

  it('Restart Now on a failed update retries', async () => {
    const t = setup({ install: async () => { throw new Error('boom'); } });
    t.updater.announce(INFO);
    await t.updater.restartNow();
    expect(t.updater.getSnapshot().state).toBe('failed');
    t.api.install.mockResolvedValue(undefined);
    await t.updater.restartNow();
    expect(t.api.install).toHaveBeenCalledTimes(2);
  });
});

describe('updater: manual check feedback', () => {
  it('up to date names the version', async () => {
    const t = setup();
    await t.updater.manualCheck();
    expect(t.api.check).toHaveBeenCalledWith(true);
    expect(t.toast).toHaveBeenNthCalledWith(1, MESSAGES.checking, expect.anything());
    expect(t.toast).toHaveBeenLastCalledWith(MESSAGES.upToDate('0.1.0'), expect.anything());
  });

  it('update available shows the Restart Now / Later prompt', async () => {
    const t = setup({ check: async () => INFO });
    await t.updater.manualCheck();
    expect(t.prompt.show).toHaveBeenCalledWith(INFO, expect.objectContaining({ restartNow: expect.any(Function), later: expect.any(Function) }));
  });

  it('could not check is explicit and logged', async () => {
    const t = setup({ check: async () => { throw new Error('signature mismatch'); } });
    await t.updater.manualCheck();
    expect(t.toast).toHaveBeenLastCalledWith(MESSAGES.couldNotCheck, expect.objectContaining({ error: true }));
    expect(t.api.log).toHaveBeenCalledWith(expect.stringContaining('signature mismatch'));
  });

  it('a manual check shows the prompt again after Later', async () => {
    const t = setup({ check: async () => INFO });
    t.updater.announce(INFO);
    t.prompt.show.mock.calls[0][1].later();
    t.updater.announce(INFO);
    expect(t.prompt.show).toHaveBeenCalledOnce();
    await t.updater.manualCheck();
    expect(t.prompt.show).toHaveBeenCalledTimes(2);
  });
});

describe('updater: Restart Now', () => {
  it('hides the prompt and installs', async () => {
    const t = setup();
    t.updater.announce(INFO);
    t.prompt.show.mock.calls[0][1].restartNow();
    await flush();
    expect(t.prompt.hide).toHaveBeenCalled();
    expect(t.api.install).toHaveBeenCalledOnce();
    expect(t.toast).toHaveBeenCalledWith(MESSAGES.downloading('0.2.0'), expect.anything());
  });

  it('a failed download or install says so and logs it', async () => {
    const t = setup({ install: async () => { throw new Error('signature verification failed'); } });
    await t.updater.restartNow();
    expect(t.toast).toHaveBeenLastCalledWith(MESSAGES.installFailed, expect.objectContaining({ error: true }));
    expect(t.api.log).toHaveBeenCalledWith(expect.stringContaining('signature verification failed'));
  });

  it('a double click installs once', async () => {
    let release!: () => void;
    const t = setup({ install: () => new Promise<void>((r) => { release = r; }) });
    const first = t.updater.restartNow();
    void t.updater.restartNow();
    await flush();
    release();
    await first;
    expect(t.api.install).toHaveBeenCalledOnce();
  });
});

describe('update prompt (DOM)', () => {
  it('renders Restart Now and Later, Escape means Later', () => {
    const root = document.createElement('div');
    const prompt = createUpdatePrompt(root);
    const restartNow = vi.fn();
    const later = vi.fn();
    prompt.show(INFO, { restartNow, later });
    const el = root.querySelector<HTMLElement>('.mdapp-update')!;
    expect(el.getAttribute('role')).toBe('alertdialog');
    expect(el.textContent).toContain('MikeDown 0.2.0');
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Later', 'Restart Now']);
    buttons[1].click();
    expect(restartNow).toHaveBeenCalledOnce();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(later).toHaveBeenCalledOnce();
    prompt.show(INFO, { restartNow, later });
    expect(root.querySelectorAll('.mdapp-update')).toHaveLength(1);
    prompt.hide();
    expect(root.querySelector('.mdapp-update')).toBeNull();
  });
});
