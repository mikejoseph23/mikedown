/**
 * Editor font-size zoom: Ctrl/Cmd + mouse wheel (issue #8) and the toolbar
 * zoom control share one controller, so both persist through the same
 * debounce.
 *
 * Trackpad pinch also arrives as a wheel event with `ctrlKey` set, so pinch
 * zooms too. Wheel deltas are accumulated so a high-resolution trackpad
 * doesn't jump several sizes per gesture; one mouse-wheel notch (~100px)
 * moves one step. The new size is persisted after the user stops zooming.
 */

export const WHEEL_ZOOM_MIN = 10;
export const WHEEL_ZOOM_MAX = 36;
/** Matches the `mikedown.fontSize` default in package.json. */
export const DEFAULT_FONT_SIZE = 15;
/** Accumulated deltaY needed for one 1px font-size step. */
const DELTA_PER_STEP = 50;
const PERSIST_DELAY_MS = 400;

export interface FontZoomOptions {
  getSize: () => number;
  setSize: (px: number) => void;
  persist: (px: number) => void;
}

export interface FontZoom {
  stepBy: (steps: number) => void;
  reset: () => void;
  dispose: () => void;
}

export interface WheelZoomOptions {
  isEnabled: () => boolean;
  zoom: FontZoom;
}

export function clampFontSize(px: number): number {
  return Math.max(WHEEL_ZOOM_MIN, Math.min(WHEEL_ZOOM_MAX, Math.round(px)));
}

export function createFontZoom(opts: FontZoomOptions): FontZoom {
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  const apply = (px: number): void => {
    const next = clampFontSize(px);
    if (next === opts.getSize()) {return;}
    opts.setSize(next);
    if (persistTimer) {clearTimeout(persistTimer);}
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      opts.persist(next);
    }, PERSIST_DELAY_MS);
  };

  return {
    stepBy: (steps) => apply(opts.getSize() + steps),
    reset: () => apply(DEFAULT_FONT_SIZE),
    dispose: () => {
      if (persistTimer) {clearTimeout(persistTimer);}
    },
  };
}

export function installWheelZoom(target: EventTarget, opts: WheelZoomOptions): () => void {
  let accumulated = 0;

  const onWheel = (evt: Event): void => {
    const e = evt as WheelEvent;
    if (!(e.ctrlKey || e.metaKey) || !opts.isEnabled()) {return;}
    e.preventDefault();
    accumulated += e.deltaY;
    const steps = Math.trunc(accumulated / DELTA_PER_STEP);
    if (steps === 0) {return;}
    accumulated -= steps * DELTA_PER_STEP;
    // Scrolling up (negative deltaY) grows the text, matching VS Code.
    opts.zoom.stepBy(-steps);
  };

  target.addEventListener('wheel', onWheel, { passive: false });
  return () => target.removeEventListener('wheel', onWheel);
}
