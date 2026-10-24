/**
 * Internal hooks shared by the element and the CDN entry. Not part of the
 * public API: the standalone bundle registers a connect hook that injects the
 * core stylesheet and KaTeX CSS; npm users import `@mikedown/core/styles.css`
 * themselves, so nothing is registered there.
 */

export type ConnectHook = (element: HTMLElement & { features: Record<string, unknown> }) => void;

let connectHook: ConnectHook | null = null;

export function setConnectHook(hook: ConnectHook | null): void {
  connectHook = hook;
}

export function runConnectHook(element: HTMLElement & { features: Record<string, unknown> }): void {
  connectHook?.(element);
}

const styledTags = new WeakMap<Document, Set<string>>();

/**
 * `display: block` for the tag, at zero specificity so any page rule wins.
 * Uses a constructed stylesheet where supported (no inline <style>, so a
 * strict `style-src` CSP is fine), else one guarded <style> per tag.
 */
export function ensureDisplayStyle(doc: Document, tag: string): void {
  let tags = styledTags.get(doc);
  if (!tags) {
    tags = new Set();
    styledTags.set(doc, tags);
  }
  if (tags.has(tag)) {return;}
  tags.add(tag);
  const css = `:where(${tag}) { display: block; }`;
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  try {
    if (view && 'adoptedStyleSheets' in doc && typeof view.CSSStyleSheet?.prototype.replaceSync === 'function') {
      const sheet = new view.CSSStyleSheet();
      sheet.replaceSync(css);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      return;
    }
  } catch {
    // Fall through to a <style> element.
  }
  const style = doc.createElement('style');
  style.setAttribute('data-mikedown-element', tag);
  style.textContent = css;
  doc.head.appendChild(style);
}
