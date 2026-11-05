/**
 * `MikeDownDocsHost` for MikeDown Desktop: the chat panel's documentation
 * bases. The index, the reads and the keyword search run in Rust
 * (`commands/docs.rs`), which resolves every base id against the global
 * `settings.json` and checks every file it opens. This module only turns the
 * commands into the host contract core expects:
 *
 * - `listBases`, `index`, `readSections`, `keywordSearch` are plain commands. A
 *   failure rejects with an `Error` carrying Rust's sentence.
 * - `watch(baseId, cb)` starts the window's recursive watchers on that base's
 *   roots and calls `cb` on `docs-changed`; the returned function stops
 *   listening, and the watchers when this window's last subscriber for the
 *   base leaves (Rust also stops them when the window closes).
 * - `saveBases(bases)` re-validates with core's `parseAiSettings` (so a
 *   hand-built list cannot write a root core would drop) and persists
 *   `ai.docBases` to the global file only (`saveBases` dep; the settings
 *   manager keeps app-wide keys out of a folder's file). It rejects when the
 *   list had entries and none survived, rather than writing an empty list over
 *   a valid one. Afterwards the roots join the fs scope (S11).
 * - `pickFolder` is the native folder picker; the pick joins the fs scope.
 */
import type { AiDocBase, MikeDownDocsHost } from '@mikedown/core/ai';
import { parseAiSettings } from '@mikedown/core/ai';
import type { DocsApi } from './docsApi';

export interface DocsHostDeps {
  api: DocsApi;
  /** Persist the validated `ai.docBases` list (the global settings file). */
  saveBases(bases: AiDocBase[]): Promise<void>;
  /** The native folder picker; null when cancelled. Absent: the manager hides "Add folder". */
  pickFolder?(): Promise<string | null>;
}

/** Subscribers per base in this window: the last one out stops the Rust watchers. */
const watching = new Map<string, number>();

function fail(err: unknown): Error {
  if (err instanceof Error) {return err;}
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return new Error((err as { message: string }).message);
  }
  return new Error(String(err));
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw fail(err);
  }
}

export function createDocsHost(deps: DocsHostDeps): MikeDownDocsHost {
  const { api } = deps;
  const host: MikeDownDocsHost = {
    listBases: () => call(() => api.listBases()),
    index: (baseId) => call(() => api.index(baseId)),
    readSections: (baseId, ids) => call(() => api.readSections(baseId, ids)),
    keywordSearch: (baseId, query) => call(() => api.keywordSearch(baseId, query)),

    watch(baseId, onChange) {
      let stopped = false;
      let unlisten: (() => void) | null = null;
      let counted = false;
      void (async () => {
        try {
          const off = await api.onChanged((changed) => { if (changed === baseId && !stopped) {onChange();} });
          if (stopped) {
            off();
            return;
          }
          unlisten = off;
          await api.watch(baseId);
          if (stopped) {
            // Stopped while Rust was starting the watchers. Nobody else in this window listens: stop them.
            if (!watching.has(baseId)) {void api.unwatch(baseId).catch(() => { /* the window is closing */ });}
            return;
          }
          watching.set(baseId, (watching.get(baseId) ?? 0) + 1);
          counted = true;
        } catch (err) {
          console.warn('MikeDown: could not watch the documentation base', err);
        }
      })();
      return () => {
        if (stopped) {return;}
        stopped = true;
        unlisten?.();
        if (!counted) {return;}
        const left = (watching.get(baseId) ?? 1) - 1;
        if (left > 0) {
          watching.set(baseId, left);
        } else {
          watching.delete(baseId);
          void api.unwatch(baseId).catch(() => { /* the window is closing */ });
        }
      };
    },

    async saveBases(bases) {
      const parsed = parseAiSettings({ 'ai.docBases': bases }, { onWarning: () => { /* dropped entries are reported by the rejection below */ } }).docBases;
      if (bases.length > 0 && parsed.length === 0) {
        throw new Error('None of those documentation bases is valid (each needs a name, an absolute folder and no repeated folder), so nothing was saved.');
      }
      await call(() => deps.saveBases(parsed));
      await call(() => api.syncRoots());
    },
  };
  if (deps.pickFolder) {
    const pick = deps.pickFolder;
    host.pickFolder = () => call(() => pick());
  }
  return host;
}
