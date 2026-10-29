import { fromWireCompletionRequest, toAiError, type AiCompletionResult, type AiWireCompletionRequest } from '@mikedown/core/ai';
import type { AiEngineService } from './engineService';

/**
 * The AI half of the webview protocol (documented in
 * packages/core/src/editor-main.ts and src/webview/editor-main.ts).
 *
 * Webview → host:
 *   aiComplete            { request: AiWireCompletionRequest }  → aiToken*, then aiDone or aiError
 *   aiCancel              { requestId }
 *   aiListEngines         {}                                   → aiEngines
 *   aiTestEngine          { requestId, engineId }              → aiEngineStatus
 *   aiDiscoverModels      { requestId, engineId }              → aiEngineStatus
 *   aiSetSecret           { requestId, engineId, apiKey }      → aiEngineStatus (hasKey)
 *   aiRequestCloudConsent { requestId, engineId, feature? }    → aiConsent
 *   aiDetectLocalServers  { requestId, candidates: { presetId, baseUrl }[] } → aiEngineProbes
 *
 * Host → webview:
 *   aiToken        { requestId, delta }
 *   aiDone         { requestId, result: AiCompletionResult }
 *   aiError        { requestId, code, message }   (also answers a failed test/discover/setSecret/consent)
 *   aiEngines      { engines: AiEngineStatus[] }  (reply to aiListEngines, and pushed after a settings or status change)
 *   aiEngineStatus { requestId, status }
 *   aiConsent      { requestId, engineId, granted }
 *   aiEngineProbes { requestId, probes: AiLocalServerProbe[] }  (one per candidate, in order; nothing cached)
 */

export const AI_WEBVIEW_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'aiComplete',
  'aiCancel',
  'aiListEngines',
  'aiTestEngine',
  'aiDiscoverModels',
  'aiSetSecret',
  'aiRequestCloudConsent',
  'aiDetectLocalServers',
]);

export function isAiWebviewMessage(message: unknown): message is { type: string } & Record<string, unknown> {
  return typeof message === 'object' && message !== null && AI_WEBVIEW_MESSAGE_TYPES.has((message as { type?: unknown }).type as string);
}

export interface AiBridgeHooks {
  /** A completion finished: the status bar mirrors who served it. */
  onServed?(result: AiCompletionResult): void;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Handle one AI message from `panel`'s webview, posting the replies through `post`. */
export async function handleAiMessage(
  service: AiEngineService,
  panel: object,
  message: { type: string } & Record<string, unknown>,
  post: (msg: unknown) => void,
  hooks: AiBridgeHooks = {},
): Promise<void> {
  const requestId = str(message.requestId);
  const fail = (err: unknown, id = requestId): void => {
    const e = toAiError(err);
    post({ type: 'aiError', requestId: id, code: e.code, message: e.message });
  };

  switch (message.type) {
    case 'aiComplete': {
      const wire = message.request as AiWireCompletionRequest | undefined;
      const id = str(wire?.requestId);
      if (!wire || !id || !Array.isArray(wire.messages)) {
        fail(new Error('Malformed aiComplete request.'), id);
        return;
      }
      try {
        const result = await service.complete(panel, fromWireCompletionRequest(wire), (delta) => post({ type: 'aiToken', requestId: id, delta }));
        post({ type: 'aiDone', requestId: id, result });
        hooks.onServed?.(result);
      } catch (err) {
        fail(err, id);
      }
      return;
    }
    case 'aiCancel':
      service.cancel(panel, requestId);
      return;
    case 'aiListEngines':
      try {
        post({ type: 'aiEngines', engines: await service.listEngines() });
      } catch {
        post({ type: 'aiEngines', engines: [] });
      }
      return;
    case 'aiTestEngine':
    case 'aiDiscoverModels':
    case 'aiSetSecret':
      try {
        const engineId = str(message.engineId);
        const status =
          message.type === 'aiTestEngine'
            ? await service.testEngine(engineId)
            : message.type === 'aiDiscoverModels'
              ? await service.discoverModels(engineId)
              : await service.setSecret(engineId, typeof message.apiKey === 'string' ? message.apiKey : null);
        post({ type: 'aiEngineStatus', requestId, status });
      } catch (err) {
        fail(err);
      }
      return;
    case 'aiDetectLocalServers': {
      const candidates = Array.isArray(message.candidates) ? message.candidates : [];
      try {
        post({ type: 'aiEngineProbes', requestId, probes: await service.detectLocalServers(candidates) });
      } catch (err) {
        fail(err);
      }
      return;
    }
    case 'aiRequestCloudConsent': {
      const engineId = str(message.engineId);
      try {
        const granted = await service.requestCloudConsent(engineId, typeof message.feature === 'string' ? message.feature : undefined);
        post({ type: 'aiConsent', requestId, engineId, granted });
      } catch {
        post({ type: 'aiConsent', requestId, engineId, granted: false });
      }
      return;
    }
  }
}
