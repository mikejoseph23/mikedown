/**
 * Resolved light/dark for an editor element.
 *
 * `data-mikedown-theme` on the editor root (or the overlay portal) is
 * 'light', 'dark' or 'auto'. For 'auto' the stylesheet resolves the scheme
 * into the `--mikedown-scheme` custom property: tokens.css through
 * prefers-color-scheme, the VS Code shell from the VS Code theme. Without a
 * stylesheet (unit tests) the OS preference decides.
 */
export function isDarkScheme(el: Element | null | undefined): boolean {
  const themed = el?.closest?.('[data-mikedown-theme]') ?? null;
  const theme = themed?.getAttribute('data-mikedown-theme');
  if (theme === 'light') {return false;}
  if (theme === 'dark') {return true;}
  if (el) {
    const scheme = getComputedStyle(el).getPropertyValue('--mikedown-scheme').trim();
    if (scheme === 'dark') {return true;}
    if (scheme === 'light') {return false;}
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}
