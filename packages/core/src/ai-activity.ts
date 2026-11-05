/**
 * The AI activity recorder: what each completion sent and what came back,
 * kept in memory for this editor instance only (the activity panel reads it).
 *
 * - One `AiActivityLog` per editor instance; `runAiCompletion` writes to it
 *   through `AiRunContext.activity`. Nothing is persisted, and the hosts'
 *   own request logs stay metadata only.
 * - Off by default (`ai.activityPanel`). While off, `record` retains nothing
 *   and `update` on an unknown entry is a no-op, so the setting can flip in
 *   the middle of a request. Turning it off clears everything.
 * - A ring of the last `AI_ACTIVITY_LIMIT` entries, oldest first.
 * - Entries are replaced, never mutated, on `update`, so a snapshot a panel
 *   holds stays stable.
 *
 * Lives in the lazy AI chunk (`ai-ui.ts`); the editor reaches it through the
 * loaded UI module, and `ai-lite.ts` re-exports only the types.
 */

import type { AiRunThinking } from './ai-request';
import type { AiCompletionRequest, AiCompletionResult, AiDocsActivityDetail, AiError, AiFinishReason, AiServedBy, AiThinkingJob, AiTiming, AiUsage } from './ai';

/** How many requests the log keeps. */
export const AI_ACTIVITY_LIMIT = 50;

/** The route a request was sent on (null on the entry for a tier-1 host, which routes by itself). */
export interface AiActivityRoute {
  engineId: string;
  modelId: string;
  /** The engine's name as the user sees it (falls back to the id). */
  label: string;
  isLocal: boolean;
  /** The router picked this engine because the preferred one was passed over. */
  viaFallback: boolean;
}

/** What came back: the text as streamed, then the final result's metadata once it arrives. */
export interface AiActivityResponse {
  /** Everything streamed so far; the final text once the request ends well. */
  text: string;
  usage?: AiUsage;
  finishReason?: AiFinishReason;
  timing?: AiTiming;
  served?: AiServedBy;
}

export interface AiActivityEntry {
  /** The request's `requestId`. */
  id: string;
  /** `Date.now()` right before the request went to the host. */
  startedAt: number;
  /** Null while streaming. */
  endedAt: number | null;
  feature: string;
  /** What the request was for when that differs from the feature (explain and translate run under `rewrite`); labels only, never routing. */
  job?: AiThinkingJob;
  task: string;
  route: AiActivityRoute | null;
  thinking: AiRunThinking | null;
  /** The exact object handed to `host.ai.complete`. */
  request: AiCompletionRequest;
  response: AiActivityResponse;
  /** Set when the request threw (a cancel is an error with code `cancelled`). */
  error: AiError | null;
  /** 1, or 2 for the retry on another engine after the first was unreachable. */
  attempt: 1 | 2;
  /** On attempt 1 only: the request failed and a fallback attempt follows as its own entry. */
  retried?: true;
  /** A documentation chat request (job `navigate` or `answer`): which pages, and the ids dropped. Ids only, never text. */
  docs?: AiDocsActivityDetail;
}

export type AiActivityStatus = 'streaming' | 'ok' | 'error' | 'cancelled' | 'fallback';

/** The one word a list row shows: still streaming, failed, cancelled, answered by a fallback engine, or fine. */
export function aiActivityStatus(entry: AiActivityEntry): AiActivityStatus {
  if (entry.error) {return entry.error.code === 'cancelled' ? 'cancelled' : 'error';}
  if (entry.endedAt === null) {return 'streaming';}
  return entry.route?.viaFallback ? 'fallback' : 'ok';
}

export type AiActivityPatch = Partial<Omit<AiActivityEntry, 'id'>>;

export interface AiActivityLog {
  /** Whether requests are recorded (`ai.activityPanel`). */
  readonly enabled: boolean;
  /** Turn recording on or off; going off clears the log. */
  setEnabled(on: boolean): void;
  /** The entries, oldest first (a copy). */
  entries(): AiActivityEntry[];
  get(id: string): AiActivityEntry | undefined;
  /** Append an entry (no-op while off); the oldest drops past the limit. */
  record(entry: AiActivityEntry): void;
  /** Change an entry, by a patch or a function of the current entry (no-op for an unknown id). */
  update(id: string, patch: AiActivityPatch | ((entry: AiActivityEntry) => AiActivityPatch)): void;
  clear(): void;
  /** Called after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createAiActivityLog(): AiActivityLog {
  let enabled = false;
  let list: AiActivityEntry[] = [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const fn of [...listeners]) {
      try { fn(); } catch { /* a bad listener never breaks a request */ }
    }
  };

  return {
    get enabled() { return enabled; },
    setEnabled(on) {
      if (enabled === on) {return;}
      enabled = on;
      if (!on && list.length > 0) {
        list = [];
        notify();
      }
    },
    entries: () => [...list],
    get: (id) => list.find((e) => e.id === id),
    record(entry) {
      if (!enabled) {return;}
      list = [...list, entry].slice(-AI_ACTIVITY_LIMIT);
      notify();
    },
    update(id, patch) {
      const i = list.findIndex((e) => e.id === id);
      if (i < 0) {return;}
      const current = list[i];
      const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch), id };
      list = [...list.slice(0, i), next, ...list.slice(i + 1)];
      notify();
    },
    clear() {
      if (list.length === 0) {return;}
      list = [];
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The final result as the entry's response. */
export function aiActivityResponse(result: AiCompletionResult): AiActivityResponse {
  return {
    text: result.text,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
    ...(result.timing ? { timing: result.timing } : {}),
    served: result.served,
  };
}
