import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWheelZoom, WHEEL_ZOOM_MAX } from '../src/wheelZoom';

describe('installWheelZoom', () => {
  let size: number;
  let enabled: boolean;
  let persist: ReturnType<typeof vi.fn>;
  let target: HTMLDivElement;
  let dispose: () => void;

  const wheel = (deltaY: number, mods: WheelEventInit = { ctrlKey: true }): WheelEvent => {
    const e = new WheelEvent('wheel', { deltaY, cancelable: true, ...mods });
    target.dispatchEvent(e);
    return e;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    size = 16;
    enabled = true;
    persist = vi.fn();
    target = document.createElement('div');
    dispose = installWheelZoom(target, {
      isEnabled: () => enabled,
      getSize: () => size,
      setSize: (px) => { size = px; },
      persist,
    });
  });

  afterEach(() => {
    dispose();
    vi.useRealTimers();
  });

  it('grows on ctrl+scroll up and shrinks on ctrl+scroll down', () => {
    wheel(-100);
    expect(size).toBe(18);
    wheel(100);
    wheel(100);
    expect(size).toBe(14);
  });

  it('accepts Cmd (metaKey) on macOS', () => {
    wheel(-50, { metaKey: true });
    expect(size).toBe(17);
  });

  it('ignores plain scrolling and leaves it uncancelled', () => {
    const e = wheel(-100, {});
    expect(size).toBe(16);
    expect(e.defaultPrevented).toBe(false);
  });

  it('does nothing when the setting is off', () => {
    enabled = false;
    const e = wheel(-100);
    expect(size).toBe(16);
    expect(e.defaultPrevented).toBe(false);
  });

  it('accumulates small trackpad deltas before stepping', () => {
    wheel(-20);
    wheel(-20);
    expect(size).toBe(16);
    wheel(-20);
    expect(size).toBe(17);
  });

  it('clamps to the setting maximum', () => {
    size = WHEEL_ZOOM_MAX;
    wheel(-500);
    expect(size).toBe(WHEEL_ZOOM_MAX);
  });

  it('persists once after the gesture settles', () => {
    wheel(-50);
    wheel(-50);
    wheel(-50);
    expect(persist).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(19);
  });
});
