/**
 * The little of the AI layer the editor needs before the AI UI is loaded,
 * and the loader for the rest.
 *
 * Everything behind `host.ai` (the rewrite popover, the AI settings tab and
 * Engines page, the toolbar menu, the prompts and the router) lives in
 * `ai-ui.ts`, which the editor imports with `import()` only when the host has
 * an AI adapter. Bundlers split it into its own chunk, so an editor without
 * AI never downloads it. A host that wants it in its main bundle, loaded
 * synchronously (the VS Code webview), imports `ai-ui-eager.ts` once.
 */

import type { AiSettings, MikeDownAiHost } from './ai/types';

export type AiUi = typeof import('./ai-ui');

let aiUi: AiUi | null = null;
let loading: Promise<AiUi> | null = null;

/** The AI UI when it is already loaded (or registered), else null. */
export function loadedAiUi(): AiUi | null {
  return aiUi;
}

/** Load the AI UI chunk once; a failed load is tried again on the next call. */
export function loadAiUi(): Promise<AiUi> {
  if (aiUi) {return Promise.resolve(aiUi);}
  loading ??= import('./ai-ui').then(
    (m) => { aiUi = m; return m; },
    (err: unknown) => { loading = null; throw err; },
  );
  return loading;
}

/** Make the AI UI available synchronously (`ai-ui-eager.ts`); null forgets it (tests). */
export function registerAiUi(m: AiUi | null): void {
  aiUi = m;
  loading = null;
}

// ── Host tier ───────────────────────────────────────────────────────────────

/** 1: `complete` only, the host routes. 2: the host has an engine registry and core routes. */
export type AiHostTier = 1 | 2;

export function aiHostTier(ai: MikeDownAiHost): AiHostTier {
  return typeof ai.listEngines === 'function' ? 2 : 1;
}

// ── Toolbar button ──────────────────────────────────────────────────────────

export type AiToolbarButtonMode = 'hidden' | 'firstRun' | 'menu';

/** What the button does: hidden without AI support or when turned off in settings. */
export function aiToolbarButtonMode(hasAiHost: boolean, settings: Pick<AiSettings, 'enabled' | 'showToolbarButton'>): AiToolbarButtonMode {
  if (!hasAiHost || !settings.showToolbarButton) {return 'hidden';}
  return settings.enabled ? 'menu' : 'firstRun';
}
