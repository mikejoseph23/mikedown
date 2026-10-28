/**
 * Toolbar overflow: keep the toolbar on one row at any width.
 *
 * The toolbar's last child is a More (⋯) button (`.toolbar-more`). When the
 * other children don't fit, they move into it from the right: each gets
 * `.toolbar-overflowed` (display: none) until the row fits, and More is shown.
 * The More menu lists the overflowed buttons (built in editor.ts). The first
 * child (the text format menu) never overflows.
 *
 * A `.toolbar-group` (several buttons that move as one, like the zoom control)
 * counts as one child: it overflows whole, and the More menu lists the
 * buttons inside it. Separators and flexible spacers (`.toolbar-spacer`)
 * overflow like any child but are never listed, and are trimmed when they
 * would end the visible row.
 *
 * Only toolbar chrome is touched here, never the ProseMirror DOM.
 */

const OVERFLOWED = 'toolbar-overflowed';

function isDivider(el: HTMLElement): boolean {
  return el.classList.contains('toolbar-separator') || el.classList.contains('toolbar-spacer');
}

function isLaidOut(el: HTMLElement): boolean {
  return !el.hidden && !el.classList.contains(OVERFLOWED) && el.style.display !== 'none';
}

/** True when the last laid-out child ends inside the toolbar's content box. */
function rowFits(toolbar: HTMLElement): boolean {
  const children = (Array.from(toolbar.children) as HTMLElement[]).filter(isLaidOut);
  const last = children[children.length - 1];
  if (!last) {return true;}
  const padRight = parseFloat(getComputedStyle(toolbar).paddingRight) || 0;
  return last.getBoundingClientRect().right <= toolbar.getBoundingClientRect().right - padRight + 0.5;
}

/** Re-flow `toolbar` so it fits on one row. Safe to call repeatedly. */
export function layoutToolbarOverflow(toolbar: HTMLElement): void {
  const more = toolbar.querySelector<HTMLElement>(':scope > .toolbar-more');
  if (!more) {return;}
  const items = (Array.from(toolbar.children) as HTMLElement[]).filter((el) => el !== more);

  items.forEach((el) => el.classList.remove(OVERFLOWED));
  more.hidden = true;
  if (rowFits(toolbar)) {return;}

  more.hidden = false;
  for (let i = items.length - 1; i >= 1; i--) {
    items[i].classList.add(OVERFLOWED);
    if (rowFits(toolbar)) {break;}
  }

  // Don't leave a separator dangling at the end of the visible row.
  for (let i = items.length - 1; i >= 1; i--) {
    const el = items[i];
    if (!isLaidOut(el)) {continue;}
    if (!isDivider(el)) {break;}
    el.classList.add(OVERFLOWED);
  }

  // Nothing listable moved (only separators, spacers or buttons the host hides).
  const listed = items.some((el) => el.classList.contains(OVERFLOWED)
    && (el.tagName === 'BUTTON' || el.classList.contains('toolbar-group')) && el.style.display !== 'none');
  if (!listed) {more.hidden = true;}
}
