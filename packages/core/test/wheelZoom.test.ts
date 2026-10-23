import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFontZoom, DEFAULT_FONT_SIZE, installWheelZoom, WHEEL_ZOOM_MAX, WHEEL_ZOOM_MIN, type FontZoom } from '../src/wheelZoom';

describe('installWheelZoom', () => {
  let size: number;
  let enabled: boolean;
  let persist: ReturnType<typeof vi.fn>;
  let target: HTMLDivElement;
  let zoom: FontZoom;
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
    zoom = createFontZoom({
      getSize: () => size,
      setSize: (px) => { size = px; },
      persist,
    });
    dispose = installWheelZoom(target, { isEnabled: () => enabled, zoom });
  });

  afterEach(() => {
    dispose();
    zoom.dispose();
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

describe('createFontZoom (toolbar control)', () => {
  let size: number;
  let persist: ReturnType<typeof vi.fn>;
  let zoom: FontZoom;

  beforeEach(() => {
    vi.useFakeTimers();
    size = 20;
    persist = vi.fn();
    zoom = createFontZoom({ getSize: () => size, setSize: (px) => { size = px; }, persist });
  });

  afterEach(() => {
    zoom.dispose();
    vi.useRealTimers();
  });

  it('steps by one pixel and clamps at both ends', () => {
    zoom.stepBy(1);
    expect(size).toBe(21);
    zoom.stepBy(-100);
    expect(size).toBe(WHEEL_ZOOM_MIN);
    zoom.stepBy(100);
    expect(size).toBe(WHEEL_ZOOM_MAX);
  });

  it('resets to the default size', () => {
    zoom.reset();
    expect(size).toBe(DEFAULT_FONT_SIZE);
  });

  it('debounces persistence across repeated clicks', () => {
    zoom.stepBy(1);
    zoom.stepBy(1);
    vi.advanceTimersByTime(500);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(22);
  });

  it('does not persist a no-op step at the limit', () => {
    size = WHEEL_ZOOM_MAX;
    zoom.stepBy(1);
    vi.advanceTimersByTime(500);
    expect(persist).not.toHaveBeenCalled();
  });
});
