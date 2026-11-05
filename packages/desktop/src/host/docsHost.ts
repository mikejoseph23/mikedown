/**
 * `MikeDownDocsHost` for MikeDown Desktop: the chat panel's documentation
 * bases. The index, the reads and the keyword search run in Rust
 * (`commands/docs.rs`), which resolves every base id against the global
 * `settings.json` and checks every file it opens. This module only turns the
 * commands into the host contract core expects:
 *
 * - `listBases`, `index`, `readSections`, `keywordSearch` are plain commands. A
 *   failure rejects with an `Error` carrying Rust's sentence. A plain
 *   `listBases` (the chat, once per turn) walks only a base with no usable
 *   index and fetches no index of its own; `{ refresh: true }` (the manager)
 *   walks every enabled base and adds `brokenLinks` from core's link resolver
 *   over `docs_index`, which Rust serves from the index that call just built.
 *   A plain call reports the last count; a disabled or unreadable base keeps
 *   it undefined.
 * - `watch(baseId, cb)` starts the window's recursive watchers on that base's
 *   roots and calls `cb` on `docs-changed`; the returned function stops
 *   listening, and the watchers when this window's last subscriber for the
 *   base leaves (Rust also stops them when the window closes).
 * - Nothing in core calls `watch`, so this host starts one itself: the first
 *   successful `index(baseId)` subscribes (a reference count with any other
 *   subscriber, one watcher per root, never a workspace-wide one), so Rust drops
 *   its cached index when a file changes instead of waiting for the minute's
 *   TTL. The subscription ends when the base is removed or disabled (seen in
 *   `listBases` or `saveBases`), when `index` stops working for it, and when the
 *   window closes (`pagehide`).
 * - `saveBases(bases)` re-validates with core's `parseAiSettings` (so a
 *   hand-built list cannot write a root core would drop) and persists
 *   `ai.docBases` to the global file only (`saveBases` dep; the settings
 *   manager keeps app-wide keys out of a folder's file). It rejects when the
 *   list had entries and none survived, rather than writing an empty list over
 *   a valid one. Afterwards the roots join the fs scope (S11).
 * - `pickFolder` is the native folder picker; the pick joins the fs scope.
 */
import type { AiDocBase, AiDocBaseStatus, AiDocsIndex, MikeDownDocsHost } from '@mikedown/core/ai';
import { createDocsLinkResolver, parseAiSettings } from '@mikedown/core/ai';
import type { DocsApi } from './docsApi';

export interface DocsHostDeps {
  api: DocsApi;
  /** Persist the validated `ai.docBases` list (the global settings file). */
  saveBases(bases: AiDocBase[]): Promise<void>;
  /**
   * The native folder picker; null when cancelled. Absent: the manager hides
   * "Add folder". It must be the Rust one (`DocsApi.pickFolder`): Rust trusts a
   * root for the fs scope only when the pick ran there (F8).
   */
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

/** Pages whose links are counted between yields to the UI. */
const COUNT_YIELD_EVERY = 25;

/**
 * Broken links over an index with core's resolver, a page at a time with a
 * turn for the UI between slices (the resolver's work is bounded, but a big
 * base is still thousands of pages). The count is a lower bound for a base that
 * hit the resolver's work bound (`workExceeded`).
 */
export async function countBrokenYielding(index: AiDocsIndex): Promise<number> {
  const resolver = createDocsLinkResolver(index);
  let broken = 0;
  for (let at = 0; at < index.pages.length; at++) {
    broken += resolver.countBrokenOn(index.pages[at].id);
    if (resolver.workExceeded()) {break;}
    if (at % COUNT_YIELD_EVERY === COUNT_YIELD_EVERY - 1) {await new Promise<void>((resolve) => setTimeout(resolve, 0));}
  }
  return broken;
}

/**
 * The statuses with `brokenLinks` filled in. On `refresh` the count comes from
 * the base's index (one IPC per base) and is remembered; a plain call fetches
 * no index and reports the last count it knows (undefined before any refresh).
 * A base whose index cannot be read keeps it undefined.
 */
async function withBrokenLinks(api: DocsApi, list: AiDocBaseStatus[], known: Map<string, number>, refresh: boolean): Promise<AiDocBaseStatus[]> {
  const out: AiDocBaseStatus[] = [];
  for (const status of list) {
    const id = status.base.id;
    if (!status.base.enabled || !status.active) {
      known.delete(id);
      out.push(status);
      continue;
    }
    if (!refresh) {
      const last = known.get(id);
      out.push(last === undefined ? status : { ...status, brokenLinks: last });
      continue;
    }
    try {
      const count = await countBrokenYielding(await api.index(id));
      known.set(id, count);
      out.push({ ...status, brokenLinks: count });
    } catch {
      known.delete(id);
      out.push(status);
    }
  }
  return out;
}

export function createDocsHost(deps: DocsHostDeps): MikeDownDocsHost {
  const { api } = deps;
  /** Last broken-link count per base, so a plain `listBases` can report it without fetching an index. */
  const brokenKnown = new Map<string, number>();
  /** The subscriptions this host holds for its own use (see the header): base id to the function that ends it. */
  const autoWatch = new Map<string, () => void>();
  const startAuto = (baseId: string): void => {
    if (autoWatch.has(baseId)) {return;}
    // A file change makes the last broken-link count stale as well.
    autoWatch.set(baseId, host.watch?.(baseId, () => { brokenKnown.delete(baseId); }) ?? (() => { /* no watch */ }));
  };
  const stopAuto = (baseId: string): void => {
    const stop = autoWatch.get(baseId);
    if (!stop) {return;}
    autoWatch.delete(baseId);
    stop();
  };
  /** Stop the subscription of every base that is gone or switched off in `list`. */
  const dropGone = (list: ReadonlyArray<{ id: string; enabled: boolean }>): void => {
    for (const id of [...autoWatch.keys()]) {
      const base = list.find((b) => b.id === id);
      if (!base || !base.enabled) {stopAuto(id);}
    }
  };
  const host: MikeDownDocsHost = {
    listBases: (opts) => call(async () => {
      const refresh = opts?.refresh === true;
      const list = await api.listBases({ refresh });
      dropGone(list.map((s) => ({ id: s.base.id, enabled: s.base.enabled })));
      return withBrokenLinks(api, list, brokenKnown, refresh);
    }),
    index: (baseId) => call(async () => {
      try {
        const index = await api.index(baseId);
        startAuto(baseId);
        return index;
      } catch (err) {
        // Unknown, turned off or unreadable: nothing to watch for this base.
        stopAuto(baseId);
        throw err;
      }
    }),
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
      dropGone(parsed.map((b) => ({ id: b.id, enabled: b.enabled })));
      await call(() => api.syncRoots());
    },
  };
  // Rust stops this window's watchers when it closes; the counts here go with the page.
  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', () => { for (const id of [...autoWatch.keys()]) {stopAuto(id);} });
  }
  if (deps.pickFolder) {
    const pick = deps.pickFolder;
    host.pickFolder = () => call(() => pick());
  }
  return host;
}
