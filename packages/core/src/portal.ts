/**
 * Overlay portal.
 *
 * Menus, pickers and dialogs that must escape the editor box (slash menu,
 * context menu, emoji picker, settings dialog, ...) are appended to a single
 * `<div class="mikedown-portal">` on `<body>` instead of to `<body>` itself.
 * The core CSS is scoped to `.mikedown-root` and `.mikedown-portal`, so this is
 * what lets those overlays be styled without the stylesheet touching the host
 * page. The portal is `display: contents` (no box of its own).
 *
 * The portal copies the theme attribute and inline CSS variables of the editor
 * root that last asked for it (the focused or most recently themed editor), so
 * overlays share that editor's tokens and fonts.
 */

let portalEl: HTMLElement | null = null;
let source: HTMLElement | null = null;

/** The portal element, created on first use (and again if something removed it). */
export function getPortal(): HTMLElement {
  if (!portalEl || !portalEl.isConnected) {
    portalEl = document.createElement('div');
    portalEl.className = 'mikedown-portal';
    document.body.appendChild(portalEl);
    syncPortal();
  }
  return portalEl;
}

/** Make `root` the editor whose theme the portal mirrors, and mirror it now. */
export function setPortalSource(root: HTMLElement): void {
  source = root;
  syncPortal();
}

/** Forget `root` as the portal's source (on destroy). */
export function releasePortalSource(root: HTMLElement): void {
  if (source === root) {source = null;}
}

/** Copy the source root's theme attribute and inline variables onto the portal. */
export function syncPortal(): void {
  if (!portalEl || !source) {return;}
  const theme = source.getAttribute('data-mikedown-theme');
  if (theme) {portalEl.setAttribute('data-mikedown-theme', theme);}
  else {portalEl.removeAttribute('data-mikedown-theme');}
  portalEl.style.cssText = source.style.cssText;
}
