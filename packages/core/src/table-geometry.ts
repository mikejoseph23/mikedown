// ============================================================================
// Table overlay geometry (pure)
//
// The floating table toolbar, the row and column drag handles and the hover
// "+" strips are `position: fixed` overlays in the portal. Where they go is
// plain arithmetic on rectangles, kept here so it can be tested without a
// layout engine. No DOM, no editor.
// ============================================================================

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  left: number;
  top: number;
}

/** Edge of the viewport the overlays keep clear of. */
export const VIEWPORT_MARGIN = 4;
/** Gap between the toolbar and the table or row it sits against. */
export const TOOLBAR_GAP = 6;
/**
 * Extra room kept above the table for the toolbar: the column drag handles sit
 * in the strip right above the header row.
 */
export const HANDLE_STRIP = 22;

export const HANDLE_SIZE = 18;
export const HANDLE_GAP = 4;
export const ADD_STRIP_SIZE = 18;
/** How far outside the table the pointer still counts as "near" it. */
export const ADD_STRIP_REACH = 28;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, Math.max(lo, hi)));

export function boxIntersectsViewport(box: Box, vw: number, vh: number): boolean {
  return box.bottom > 0 && box.top < vh && box.right > 0 && box.left < vw;
}

/**
 * Where the floating table toolbar goes. In order of preference: above the
 * table, below the table, then against the cursor's row (below it, else above
 * it). The last case is a table taller than the viewport, whose top and bottom
 * are both off-screen while the row being edited is not. The result is always
 * clamped into the viewport.
 */
export function computeToolbarPosition(args: {
  table: Box;
  /** The cursor's row, when known. */
  row?: Box | null;
  toolbar: Size;
  viewport: Size;
}): Point {
  const { table, row, toolbar, viewport } = args;
  const m = VIEWPORT_MARGIN;
  const maxTop = viewport.height - toolbar.height - m;

  let top: number;
  const above = table.top - toolbar.height - TOOLBAR_GAP - HANDLE_STRIP;
  const below = table.bottom + TOOLBAR_GAP;
  if (above >= m) {
    top = above;
  } else if (below <= maxTop) {
    top = below;
  } else if (row && row.bottom > 0 && row.top < viewport.height) {
    const underRow = row.bottom + TOOLBAR_GAP;
    top = underRow <= maxTop ? underRow : row.top - toolbar.height - TOOLBAR_GAP;
  } else {
    top = above >= m ? above : m;
  }

  const left = clamp(table.left, m, viewport.width - toolbar.width - 2 * m);
  return { left, top: clamp(top, m, maxTop) };
}

/** A drag handle's top-left corner. Row handles sit left of the table, column handles above it. */
export function computeHandlePosition(
  type: 'row' | 'col',
  anchor: Box,
  /** The scrolling wrapper (or the table) the handles are fixed against. */
  frame: Box
): Point {
  if (type === 'row') {
    return {
      left: frame.left - HANDLE_SIZE - HANDLE_GAP,
      top: anchor.top + (anchor.bottom - anchor.top) / 2 - HANDLE_SIZE / 2,
    };
  }
  return {
    left: anchor.left + (anchor.right - anchor.left) / 2 - HANDLE_SIZE / 2,
    top: frame.top - HANDLE_SIZE - 2,
  };
}

/**
 * Whether a handle's anchor is inside the part of the table that is actually
 * showing: a column scrolled out of a horizontally scrolling wrapper, or a row
 * above or below the visible part, must not leave its handle floating.
 */
export function isAnchorVisible(type: 'row' | 'col', anchor: Box, frame: Box, vw: number, vh: number): boolean {
  const center = type === 'row' ? (anchor.top + anchor.bottom) / 2 : (anchor.left + anchor.right) / 2;
  if (type === 'row') {
    return center >= frame.top && center <= frame.bottom && center >= 0 && center <= vh;
  }
  return center >= frame.left && center <= frame.right && center >= 0 && center <= vw;
}

/** The "+" strip that adds a column: right of the table, level with the header row. */
export function computeAddColumnStrip(table: Box, header: Box): Box {
  return {
    left: table.right + 2,
    right: table.right + 2 + ADD_STRIP_SIZE,
    top: header.top,
    bottom: header.bottom,
  };
}

/** The "+" strip that adds a row: under the table, as wide as it is. */
export function computeAddRowStrip(table: Box, lastRow: Box): Box {
  return {
    left: table.left,
    right: table.right,
    top: lastRow.bottom + 2,
    bottom: lastRow.bottom + 2 + ADD_STRIP_SIZE,
  };
}

/** Whether the pointer is over the table or within `reach` of its edge. */
export function isPointerNearBox(x: number, y: number, box: Box, reach: number = ADD_STRIP_REACH): boolean {
  return x >= box.left - reach && x <= box.right + reach && y >= box.top - reach && y <= box.bottom + reach;
}
