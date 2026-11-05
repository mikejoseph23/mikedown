/**
 * The documentation chat's wiring: `ai/docs/loop.ts` is pure, so it is handed
 * the editor's request layer here. Beside `ai-request.ts`, in the lazy AI chunk;
 * the chat panel reaches it through `ai-ui.ts`.
 */

import { createDocsChat, type AiDocsActivityDetail, type DocsChat, type DocsLoopDeps, type DocsRunRequest } from './ai';
import { resolveAiTurnRoute, runAiCompletion, type AiRunContext } from './ai-request';

/** `format: 'json'` is dropped for a model known not to do it: the prompt still asks, and the parser is lenient. */
function withSupportedFormat(ctx: AiRunContext, req: DocsRunRequest): DocsRunRequest {
  if (req.format !== 'json' || !req.pin) {return req;}
  const { pin } = req;
  const model = ctx.settings().engines.find((e) => e.id === pin.engineId)?.models.find((m) => m.id === pin.modelId);
  if (model?.capabilities.json !== false) {return req;}
  const { format: _format, ...rest } = req;
  return rest;
}

export function aiDocsLoopDeps(ctx: AiRunContext): DocsLoopDeps {
  return {
    resolveRoute: (req, signal) => resolveAiTurnRoute(ctx, req, signal),
    run: (req, events, signal) => runAiCompletion(ctx, withSupportedFormat(ctx, req), events, signal),
    contextTokens(route) {
      if (!route) {return null;}
      const engine = ctx.settings().engines.find((e) => e.id === route.engineId);
      return engine?.models.find((m) => m.id === route.modelId)?.capabilities.contextTokens ?? null;
    },
    annotate(requestId: string, detail: AiDocsActivityDetail) {
      // The recorder is a side channel: a failure in it never reaches the turn.
      try { ctx.activity?.update(requestId, { docs: detail }); } catch { /* ignore */ }
    },
  };
}

/** One per editor instance: it holds the one-request-in-flight rule. */
export function createAiDocsChat(ctx: AiRunContext): DocsChat {
  return createDocsChat(aiDocsLoopDeps(ctx));
}
