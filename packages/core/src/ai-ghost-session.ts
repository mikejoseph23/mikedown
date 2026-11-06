/**
 * Inline suggestions in one editor: the controller and its plugin, installed
 * together while the feature is on and removed together when it goes off, so
 * `editor.ts` holds one small handle (D13). Options are read on every use, so a
 * settings broadcast changes them without a rebuild, and the controller's "Don't
 * allow" latch (D9) lasts as long as the feature stays on.
 *
 * Request errors never toast: a local engine being down must not nag on every
 * pause. The last one is kept for the AI menu (`reason`).
 *
 * Lives in the lazy AI chunk (`ai-ui.ts`); the editor must not import it statically.
 */

import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  DEFAULT_CONTEXT_TOKENS, ghostTextOptions, isRouteUsable, resolveAiFeature, resolveRoute,
  type AiConsentState, type AiEngineStatus, type AiServedBy, type AiSettings, type MikeDownAiHost,
} from './ai';
import type { AiActivityEntry } from './ai-activity';
import { createGhostController, type GhostControllerDeps } from './ai-ghost';
import { aiGhostKey, createGhostPlugin, setGhostSuggestion, triggerGhostNow } from './ai-ghost-plugin';
import { aiFeatureAvailability, type AiFeatureAvailability } from './ai-request';
import { engineDisplayName } from './ai-settings-model';

export interface GhostSessionDeps {
  editor: Editor;
  /** The editor's run, with `activity: undefined` in its context (D10). */
  run: GhostControllerDeps['run'];
  settings(): AiSettings;
  statuses(): readonly AiEngineStatus[];
  consent: AiConsentState;
  /** A popup that claims Tab or Escape is open; it wins over a suggestion (D7). */
  popupOpen(): boolean;
  /** False stops everything (source mode). */
  enabled(): boolean;
  onBusy(busy: boolean): void;
  onServed(served: AiServedBy, viaFallback: boolean): void;
  record(entry: AiActivityEntry): void;
}

export interface GhostSession {
  /** Clear the suggestion and stop any request; the widget is gone when this returns. */
  dismiss(): void;
  /** The manual trigger: focuses the editor, because Tab needs it there and blur dismisses. */
  trigger(): void;
  /** Why the last request failed, until a suggestion shows again. */
  reason(): string | null;
  destroy(): void;
}

/** The master switch and the feature's own: what decides whether a session exists at all. */
export function ghostFeatureOn(settings: AiSettings): boolean {
  return settings.enabled && resolveAiFeature(settings.features, 'ghostText').enabled;
}

/** `aiFeatureAvailability` for a request as the controller sends it, which carries `localOnly`. */
export function ghostAvailability(
  ai: MikeDownAiHost | undefined,
  settings: AiSettings,
  statuses: readonly AiEngineStatus[],
  consent: AiConsentState,
): AiFeatureAvailability {
  const plain = aiFeatureAvailability(ai, settings, statuses, consent, 'ghostText');
  // A tier-1 host routes by itself, so there is no route here to hold to local engines.
  if (plain.state === 'hidden' || typeof ai?.listEngines !== 'function' || !ghostTextOptions(settings.features).localOnly) {return plain;}
  const route = resolveRoute(settings, statuses, consent, { feature: 'ghostText', localOnly: true });
  return isRouteUsable(route) ? { state: 'enabled' } : { state: 'disabled', reason: route.reason };
}

export function createGhostSession(deps: GhostSessionDeps): GhostSession {
  const { editor } = deps;
  let reason: string | null = null;

  const controller = createGhostController({
    run: (req, events, signal) => deps.run(req, events, signal),
    options: () => ghostTextOptions(deps.settings().features),
    contextTokens() {
      const settings = deps.settings();
      const { localOnly } = ghostTextOptions(settings.features);
      const route = resolveRoute(settings, deps.statuses(), deps.consent, { feature: 'ghostText', localOnly });
      if (!isRouteUsable(route)) {return DEFAULT_CONTEXT_TOKENS;}
      const model = settings.engines.find((e) => e.id === route.engineId)?.models.find((m) => m.id === route.modelId);
      return model?.capabilities.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
    },
    onSuggestion(text) {
      if (text) {reason = null;}
      setGhostSuggestion(editor.view, text);
    },
    onBusy: (busy) => deps.onBusy(busy),
    onServed: (served, viaFallback) => deps.onServed(served, viaFallback),
    onError(info) {
      reason = info.error.message;
    },
    record: (entry) => deps.record(entry),
    routeLabel(route) {
      const engine = deps.settings().engines.find((e) => e.id === route.engineId);
      return engine ? engineDisplayName(engine) : route.engineId;
    },
  });

  // Appended last, so its `view.update` sees the popups after theirs have run.
  editor.registerPlugin(createGhostPlugin({
    controller,
    serialize: (doc) => (editor.storage as unknown as { markdown: { serializer: { serialize(content: PmNode): string } } }).markdown.serializer.serialize(doc),
    popupOpen: () => deps.popupOpen(),
    enabled: () => deps.enabled(),
  }));

  return {
    dismiss() {
      controller.dismiss();
      setGhostSuggestion(editor.view, null);
    },
    trigger() {
      editor.view.focus();
      triggerGhostNow(editor.view);
    },
    reason: () => reason,
    destroy() {
      controller.destroy();
      editor.unregisterPlugin(aiGhostKey);
    },
  };
}
