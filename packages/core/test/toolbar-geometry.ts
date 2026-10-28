/**
 * Fake flex-row geometry for the REAL toolbar of a mounted editor (jsdom has
 * no layout). Every laid-out child is 30px wide, separators 7px, a flexible
 * spacer takes whatever room is left (0 when the row is full), like
 * `.toolbar-spacer { flex: 1 1 0 }`. The toolbar is `getWidth()` wide. Install
 * before the code under test runs; call the returned function to remove it.
 */
import { vi } from 'vitest';

const laidOut = (el: HTMLElement) =>
  !el.hidden && !el.classList.contains('toolbar-overflowed') && el.style.display !== 'none';

const rectOf = (left: number, width: number): DOMRect =>
  ({ left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON() {} }) as DOMRect;

function widthOf(el: HTMLElement, flexible: number): number {
  if (!laidOut(el)) {return 0;}
  if (el.classList.contains('toolbar-spacer')) {return flexible;}
  return el.classList.contains('toolbar-separator') ? 7 : 30;
}

export function fakeToolbarGeometry(getWidth: () => number): () => void {
  const original = Element.prototype.getBoundingClientRect;
  const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.classList?.contains('mikedown-toolbar')) {return rectOf(0, getWidth());}
    const toolbar = el.parentElement;
    if (!toolbar?.classList.contains('mikedown-toolbar')) {return original.call(this);}
    const kids = Array.from(toolbar.children) as HTMLElement[];
    const fixed = kids.reduce((sum, k) => sum + widthOf(k, 0), 0);
    const flexible = Math.max(0, getWidth() - fixed);
    let x = 0;
    for (const k of kids) {
      const w = widthOf(k, flexible);
      if (k === el) {return rectOf(x, w);}
      x += w;
    }
    return original.call(this);
  });
  return () => spy.mockRestore();
}
