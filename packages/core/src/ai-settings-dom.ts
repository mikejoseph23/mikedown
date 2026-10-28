/**
 * Small DOM builders shared by the AI settings tab (`ai-settings.ts`), the
 * AI Engines page (`ai-engines-page.ts`) and the Express engine form
 * (`ai-engine-form.ts`): inline icons, kind glyphs, buttons, switches, notes,
 * the status dot and locality pills, and a rebuild helper that keeps
 * keyboard focus.
 *
 * Modal UI only: nothing here touches the editor document or its DOM.
 */

import type { AiEngineConfig, AiEngineStatus, AiSettings } from './ai';
import { engineLocalityInfo } from './ai-settings-model';

// ── Icons (inline, currentColor) ────────────────────────────────────────────

const svg = (body: string, size = 14, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

export const ICONS = {
  starOff: svg('<path d="M8 1.9l1.86 3.77 4.16.6-3.01 2.94.71 4.14L8 11.4l-3.72 1.95.71-4.14L1.98 6.27l4.16-.6z"/>'),
  starOn: svg('<path d="M8 1.9l1.86 3.77 4.16.6-3.01 2.94.71 4.14L8 11.4l-3.72 1.95.71-4.14L1.98 6.27l4.16-.6z" fill="currentColor"/>'),
  trash: svg('<path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"/>'),
  chevron: svg('<path d="M6 4l4 4-4 4"/>', 12),
  plus: svg('<path d="M8 3v10M3 8h10"/>', 12),
  local: svg('<path d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h8V6.5"/>', 11),
  cloud: svg('<path d="M4.5 12.5h7a2.75 2.75 0 0 0 .3-5.48A4 4 0 0 0 4.1 7.6 2.5 2.5 0 0 0 4.5 12.5z"/>', 11),
  warn: svg('<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.5v3M8 11.4v.1"/>', 12),
  info: svg('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.8M8 5v.1"/>', 12),
  check: svg('<path d="M3.5 8.5l3 3 6-7"/>', 12),
  braces: svg('<path d="M6 2.5c-1.5 0-2 .7-2 2v1.6c0 .9-.5 1.4-1.4 1.9.9.5 1.4 1 1.4 1.9v1.6c0 1.3.5 2 2 2M10 2.5c1.5 0 2 .7 2 2v1.6c0 .9.5 1.4 1.4 1.9-.9.5-1.4 1-1.4 1.9v1.6c0 1.3-.5 2-2 2"/>', 16),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>', 10),
  refresh: svg('<path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v3h-3"/>', 12),
  search: svg('<circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2l3.3 3.3"/>', 12),
  back: svg('<path d="M10 3.5L5.5 8l4.5 4.5"/>', 14),
  routing: svg('<path d="M3 4h4.5a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2H13M3 12h3M11 2.5L13 4l-2 1.5M11 10.5l2 1.5-2 1.5"/>', 16),
};

/** Two-letter tiles for the kinds without a glyph; the generic kind gets braces. */
const KIND_MONOGRAMS: Record<string, string> = {
  lmstudio: 'LM',
  ollama: 'Ol',
  anthropic: 'An',
  openai: 'OA',
};

const KNOWN_KINDS = new Set(['openai-compatible', 'lmstudio', 'ollama', 'anthropic', 'openai']);

/** The kind tile (a rounded square like an extension icon). */
export function kindGlyphHtml(kind: string, extra = ''): string {
  const known = KNOWN_KINDS.has(kind);
  const inner = !known ? '?' : kind === 'openai-compatible' ? ICONS.braces : KIND_MONOGRAMS[kind] ?? '?';
  return `<span class="ai-glyph ${extra}" data-kind="${known ? kind : 'unknown'}" aria-hidden="true">${inner}</span>`;
}

// ── Experimental marking ────────────────────────────────────────────────────

/** Shown on the AI tab, the AI Engines page and the toolbar's first-run panel. */
export const AI_EXPERIMENTAL_DISCLAIMER =
  'AI features are experimental and may change or be removed. AI output can be wrong, so review it before you keep it. ' +
  'With a cloud engine, the selected text is sent to that provider; local engines keep it on your machine.';

/** The "Experimental" pill beside an AI title. */
export function experimentalBadge(): HTMLSpanElement {
  return el('span', 'ai-experimental-badge', 'Experimental');
}

/** The disclaimer as a quiet paragraph. */
export function experimentalDisclaimer(className = ''): HTMLParagraphElement {
  return el('p', `ai-disclaimer${className ? ` ${className}` : ''}`, AI_EXPERIMENTAL_DISCLAIMER);
}

// ── Small DOM helpers ───────────────────────────────────────────────────────

let uid = 0;
export const nextId = (prefix: string) => `${prefix}-${++uid}`;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {node.className = className;}
  if (text !== undefined) {node.textContent = text;}
  return node;
}

export function button(className: string, label: string, opts: { html?: string; ariaLabel?: string; title?: string; fk?: string } = {}): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  if (opts.html !== undefined) {
    b.innerHTML = opts.html;
    if (label) {b.append(el('span', 'ai-btn-text', label));}
  } else {
    b.textContent = label;
  }
  if (opts.ariaLabel) {b.setAttribute('aria-label', opts.ariaLabel);}
  if (opts.title) {b.title = opts.title;}
  if (opts.fk) {b.dataset.fk = opts.fk;}
  return b;
}

/** A switch-styled checkbox (role="switch"), labelled for screen readers. */
export function switchInput(checked: boolean, ariaLabel: string, fk?: string): HTMLInputElement {
  const input = el('input', 'ai-switch');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.setAttribute('aria-label', ariaLabel);
  if (fk) {input.dataset.fk = fk;}
  return input;
}

export function note(level: 'warning' | 'info' | 'error' | 'ok', text: string, className = ''): HTMLDivElement {
  const n = el('div', `ai-note ai-note--${level}${className ? ` ${className}` : ''}`);
  const icon = el('span', 'ai-note-icon');
  icon.innerHTML = level === 'ok' ? ICONS.check : level === 'info' ? ICONS.info : ICONS.warn;
  n.append(icon, el('span', 'ai-note-text', text));
  return n;
}

/**
 * Rebuild `scope` and put focus (and the caret) back on the control with the
 * same `data-fk`, so re-rendering a list never throws the keyboard user out.
 */
export function keepFocus(scope: HTMLElement, rebuild: () => HTMLElement | void): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active && scope.contains(active) ? active.dataset.fk : undefined;
  let sel: [number | null, number | null] | null = null;
  if (key && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
    try { sel = [active.selectionStart, active.selectionEnd]; } catch { sel = null; }
  }
  // A rebuild that swaps `scope` for a new node returns the new one.
  const target = rebuild() ?? scope;
  if (!key) {return;}
  const next = Array.from(target.querySelectorAll<HTMLElement>('[data-fk]')).find((n) => n.dataset.fk === key);
  if (!next) {return;}
  next.focus({ preventScroll: true });
  if (sel && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) {
    try { next.setSelectionRange(sel[0], sel[1]); } catch { /* number inputs have no selection */ }
  }
}

// ── Engine status and locality ──────────────────────────────────────────────

/**
 * The status dot with a terse label ("42 ms", "Failed"); the tooltip and the
 * accessible name say more. `compact` keeps only the dot on screen.
 */
export function statusBadge(status: AiEngineStatus | undefined, busy: 'test' | 'discover' | undefined, opts: { compact?: boolean } = {}): HTMLElement {
  const badge = el('span', `ai-status${opts.compact ? ' ai-status--compact' : ''}`);
  const dot = el('span', 'ai-status-dot');
  dot.setAttribute('aria-hidden', 'true');
  const text = el('span', 'ai-status-text');
  let state: string;
  let label: string;
  let title: string;
  if (busy) {
    state = 'busy';
    label = busy === 'test' ? 'Testing…' : 'Fetching…';
    title = busy === 'test' ? 'Testing the connection…' : 'Fetching models…';
  } else if (!status || status.ok === null) {
    state = 'unknown';
    label = 'Not tested';
    title = 'Never tested. Open the engine and choose Test connection.';
  } else if (status.ok) {
    state = 'ok';
    label = status.latencyMs !== undefined ? `${Math.round(status.latencyMs)} ms` : 'OK';
    title = `Connected${status.latencyMs !== undefined ? ` in ${Math.round(status.latencyMs)} ms` : ''} on the last test.`;
  } else {
    state = 'error';
    label = 'Failed';
    title = status.error ? `Last test failed: ${status.error}` : 'The last test failed.';
  }
  badge.dataset.state = state;
  badge.title = title;
  text.textContent = label;
  badge.append(dot, text);
  // The visible text is terse; screen readers get the tooltip.
  badge.setAttribute('aria-label', `Status: ${title}`);
  badge.setAttribute('role', 'img');
  return badge;
}

/** The local/cloud pill, plus "blocked by Allow cloud" for a cloud engine while cloud is off. */
export function localityPills(engine: AiEngineConfig, settings: AiSettings): HTMLElement[] {
  const info = engineLocalityInfo(engine, settings.localNetworks);
  const pill = el('span', `ai-pill ai-pill--${info.locality}`);
  pill.innerHTML = info.locality === 'local' ? ICONS.local : ICONS.cloud;
  pill.append(el('span', '', info.locality === 'local' ? 'local' : 'cloud'));
  if (info.mismatch) {
    pill.classList.add('ai-pill--mismatch');
    pill.title = info.locality === 'cloud' ? 'Pinned to cloud, but the address looks local.' : 'Pinned to local, but the address looks like a cloud server.';
  }
  const pills = [pill];
  if (info.locality === 'cloud' && !settings.allowCloud) {
    const blocked = el('span', 'ai-pill ai-pill--blocked', 'blocked by Allow cloud');
    blocked.title = 'Turn on Allow cloud engines to route tasks here.';
    pills.push(blocked);
  }
  return pills;
}
