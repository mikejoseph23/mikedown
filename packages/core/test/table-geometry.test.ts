/**
 * Where the table overlays go: the floating toolbar, the drag handles and the
 * hover "+" strips. Pure rectangle arithmetic, no layout engine.
 */
import { describe, expect, it } from 'vitest';
import {
  ADD_STRIP_SIZE,
  HANDLE_SIZE,
  VIEWPORT_MARGIN,
  boxIntersectsViewport,
  computeAddColumnStrip,
  computeAddRowStrip,
  computeHandlePosition,
  computeToolbarPosition,
  isAnchorVisible,
  isPointerNearBox,
  type Box,
} from '../src/table-geometry';
import { moveGridSize } from '../src/tablepicker';

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const viewport = { width: 1000, height: 700 };
const toolbar = { width: 400, height: 40 };

describe('computeToolbarPosition', () => {
  it('sits above a table with room above it, at the table left', () => {
    const p = computeToolbarPosition({ table: box(100, 300, 600, 500), toolbar, viewport });
    expect(p.left).toBe(100);
    expect(p.top).toBeLessThan(300 - toolbar.height);
    expect(p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it('goes below a short table whose top is near the top of the window', () => {
    const p = computeToolbarPosition({ table: box(100, 20, 600, 120), toolbar, viewport });
    expect(p.top).toBeGreaterThan(120);
  });

  it('on a table taller than the window, lands in view next to the cursor row', () => {
    // Top is 900px above the window, bottom 900px below it.
    const table = box(100, -900, 600, 1600);
    const row = box(100, 330, 600, 370);
    const p = computeToolbarPosition({ table, row, toolbar, viewport });
    expect(p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(p.top + toolbar.height).toBeLessThanOrEqual(viewport.height - VIEWPORT_MARGIN);
    expect(p.top).toBe(370 + 6);
  });

  it('puts the toolbar above the row when there is no room below it', () => {
    const table = box(100, -900, 600, 1600);
    const row = box(100, 650, 600, 690);
    const p = computeToolbarPosition({ table, row, toolbar, viewport });
    expect(p.top + toolbar.height).toBeLessThanOrEqual(650);
    expect(p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it('is clamped into the viewport even with no row to follow', () => {
    const p = computeToolbarPosition({ table: box(100, -900, 600, 1600), toolbar, viewport });
    expect(p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(p.top + toolbar.height).toBeLessThanOrEqual(viewport.height);
  });

  it('keeps the toolbar inside the window horizontally', () => {
    const right = computeToolbarPosition({ table: box(900, 300, 1400, 500), toolbar, viewport });
    expect(right.left + toolbar.width).toBeLessThanOrEqual(viewport.width);
    const left = computeToolbarPosition({ table: box(-300, 300, 200, 500), toolbar, viewport });
    expect(left.left).toBe(VIEWPORT_MARGIN);
  });

  it('survives a toolbar larger than the window', () => {
    const p = computeToolbarPosition({
      table: box(0, 100, 300, 200),
      toolbar: { width: 2000, height: 2000 },
      viewport,
    });
    expect(Number.isFinite(p.left)).toBe(true);
    expect(Number.isFinite(p.top)).toBe(true);
  });
});

describe('boxIntersectsViewport', () => {
  it('is true while any part of the box shows', () => {
    expect(boxIntersectsViewport(box(0, -900, 500, 20), 1000, 700)).toBe(true);
    expect(boxIntersectsViewport(box(0, -900, 500, 1600), 1000, 700)).toBe(true);
  });
  it('is false once it is entirely off-screen', () => {
    expect(boxIntersectsViewport(box(0, -900, 500, -10), 1000, 700)).toBe(false);
    expect(boxIntersectsViewport(box(0, 800, 500, 900), 1000, 700)).toBe(false);
  });
});

describe('drag handle position', () => {
  const frame = box(100, 200, 700, 500);

  it('row handles sit left of the frame, centred on the row', () => {
    const p = computeHandlePosition('row', box(100, 250, 700, 290), frame);
    expect(p.left).toBe(100 - HANDLE_SIZE - 4);
    expect(p.top).toBe(270 - HANDLE_SIZE / 2);
  });

  it('a row handle stays put when the table scrolls sideways', () => {
    // The row box moves with the scroll; the frame (the wrapper) does not.
    const a = computeHandlePosition('row', box(100, 250, 700, 290), frame);
    const b = computeHandlePosition('row', box(-60, 250, 540, 290), frame);
    expect(b).toEqual(a);
  });

  it('column handles sit above the frame, centred on the column', () => {
    const p = computeHandlePosition('col', box(300, 200, 400, 240), frame);
    expect(p.left).toBe(350 - HANDLE_SIZE / 2);
    expect(p.top).toBe(200 - HANDLE_SIZE - 2);
  });

  it('a column handle follows its column when the wrapper scrolls', () => {
    const a = computeHandlePosition('col', box(300, 200, 400, 240), frame);
    const b = computeHandlePosition('col', box(250, 200, 350, 240), frame);
    expect(b.left).toBe(a.left - 50);
  });

  it('hides handles whose anchor has scrolled out of the visible frame', () => {
    expect(isAnchorVisible('col', box(300, 200, 400, 240), frame, 1000, 700)).toBe(true);
    expect(isAnchorVisible('col', box(-200, 200, -100, 240), frame, 1000, 700)).toBe(false);
    expect(isAnchorVisible('col', box(900, 200, 1000, 240), frame, 1000, 700)).toBe(false);
    expect(isAnchorVisible('row', box(100, 250, 700, 290), frame, 1000, 700)).toBe(true);
    expect(isAnchorVisible('row', box(100, 600, 700, 640), frame, 1000, 700)).toBe(false);
  });
});

describe('hover "+" strips', () => {
  const table = box(100, 200, 700, 500);

  it('the add-column strip is right of the table, as tall as the header row', () => {
    const s = computeAddColumnStrip(table, box(100, 200, 700, 236));
    expect(s.left).toBeGreaterThan(table.right);
    expect(s.right - s.left).toBe(ADD_STRIP_SIZE);
    expect(s.top).toBe(200);
    expect(s.bottom).toBe(236);
  });

  it('the add-row strip is under the last row, as wide as the table', () => {
    const s = computeAddRowStrip(table, box(100, 464, 700, 500));
    expect(s.top).toBeGreaterThan(500);
    expect(s.bottom - s.top).toBe(ADD_STRIP_SIZE);
    expect(s.left).toBe(100);
    expect(s.right).toBe(700);
  });

  it('counts the pointer as near a table within its reach', () => {
    expect(isPointerNearBox(400, 350, table)).toBe(true);
    expect(isPointerNearBox(710, 520, table)).toBe(true);
    expect(isPointerNearBox(900, 350, table)).toBe(false);
    expect(isPointerNearBox(400, 100, table)).toBe(false);
  });
});

describe('moveGridSize', () => {
  it('moves one step with the arrow keys', () => {
    expect(moveGridSize(3, 3, 'ArrowRight')).toEqual({ rows: 3, cols: 4 });
    expect(moveGridSize(3, 3, 'ArrowLeft')).toEqual({ rows: 3, cols: 2 });
    expect(moveGridSize(3, 3, 'ArrowDown')).toEqual({ rows: 4, cols: 3 });
    expect(moveGridSize(3, 3, 'ArrowUp')).toEqual({ rows: 2, cols: 3 });
  });

  it('clamps to the grid', () => {
    expect(moveGridSize(1, 1, 'ArrowUp')).toEqual({ rows: 1, cols: 1 });
    expect(moveGridSize(1, 1, 'ArrowLeft')).toEqual({ rows: 1, cols: 1 });
    expect(moveGridSize(8, 10, 'ArrowDown')).toEqual({ rows: 8, cols: 10 });
    expect(moveGridSize(8, 10, 'ArrowRight')).toEqual({ rows: 8, cols: 10 });
    expect(moveGridSize(3, 5, 'ArrowRight', 8, 5)).toEqual({ rows: 3, cols: 5 });
  });

  it('jumps with Home and End, and ignores other keys', () => {
    expect(moveGridSize(3, 6, 'Home')).toEqual({ rows: 3, cols: 1 });
    expect(moveGridSize(3, 6, 'End')).toEqual({ rows: 3, cols: 10 });
    expect(moveGridSize(3, 3, 'a')).toBeNull();
    expect(moveGridSize(3, 3, 'Enter')).toBeNull();
  });
});
