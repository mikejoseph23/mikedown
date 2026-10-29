import { isAiError, makeAiError, type AiCompletionRequest, type AiCompletionResult, type AiDiscoveredModel, type AiEngineConfig, type AiError, type AiMessage, type AiModelConfig, type ProviderAdapter } from '@mikedown/core/ai';

/**
 * `vscode-lm`: the chat models VS Code offers through `vscode.lm`, which the
 * GitHub Copilot Chat extension serves (vendor `copilot`). No address, no
 * key: VS Code signs in for us. Model ids are `vendor/family`
 * (`copilot/gpt-4o`), since a model's own `id` is opaque.
 *
 * The first `sendRequest` makes VS Code show its own permission prompt
 * ("allow MikeDown to use Copilot"); MikeDown's cloud consent runs before
 * it, so the first request asks twice. Discovery and Test connection only
 * list models and never send text, so they never prompt.
 *
 * The `vscode` API comes in through `VsCodeLmApi` (built in vscodeAi.ts), so
 * this file has no `vscode` import and tests run it against a fake.
 */

/** The parts of `vscode.LanguageModelChat` this adapter uses. */
export interface VsCodeLmModel {
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly family: string;
  readonly maxInputTokens: number;
  sendRequest(messages: unknown[], options: { justification?: string }, token: unknown): PromiseLike<{ text: AsyncIterable<string> }>;
}

/** The parts of `vscode` this adapter uses. */
export interface VsCodeLmApi {
  selectChatModels(selector: { vendor?: string; family?: string }): PromiseLike<readonly VsCodeLmModel[]>;
  /** `vscode.LanguageModelChatMessage.User`. */
  userMessage(text: string): unknown;
  /** `vscode.LanguageModelChatMessage.Assistant`. */
  assistantMessage(text: string): unknown;
  /** A fresh `vscode.CancellationTokenSource`. */
  tokenSource(): { readonly token: unknown; cancel(): void; dispose(): void };
}

/** Only Copilot's models: other extensions' models are not part of this engine kind. */
export const VSCODE_LM_VENDOR = 'copilot';

/** Shown in VS Code's own permission prompt. */
const JUSTIFICATION = 'MikeDown sends the text you ask about for AI writing help.';

const NO_MODELS = 'No GitHub Copilot model is available. Install the GitHub Copilot Chat extension and sign in.';
const NO_PERMISSION = 'Allow MikeDown to use Copilot in the VS Code prompt.';

export function vscodeLmModelId(model: Pick<VsCodeLmModel, 'vendor' | 'family'>): string {
  return `${model.vendor}/${model.family}`;
}

/**
 * A `vscode.LanguageModelError` (or anything else `vscode.lm` throws) as an
 * `AiError`: NoPermissions → auth, NotFound → modelNotFound, a quota or rate
 * limit → rateLimited, Blocked → badOutput, a cancellation → cancelled.
 */
export function vscodeLmError(err: unknown, signal?: AbortSignal): AiError {
  if (signal?.aborted) {return makeAiError('cancelled');}
  const e = (typeof err === 'object' && err !== null ? err : {}) as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' && e.message.trim() ? e.message.trim() : typeof err === 'string' ? err : '';
  if (e.name === 'Canceled' || e.name === 'AbortError') {return makeAiError('cancelled');}
  if (code === 'NoPermissions') {return makeAiError('auth', NO_PERMISSION);}
  if (code === 'NotFound') {return makeAiError('modelNotFound', message ? `Copilot model not found: ${message}` : 'That Copilot model is no longer available.');}
  if (/quota|rate.?limit|too many requests/i.test(message)) {return makeAiError('rateLimited', message);}
  if (code === 'Blocked') {return makeAiError('badOutput', message || 'GitHub Copilot blocked this request.');}
  return makeAiError('unknown', message || 'GitHub Copilot did not answer.');
}

function textOf(message: AiMessage): string {
  if (typeof message.content === 'string') {return message.content;}
  return message.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
}

/** `vscode.lm` has no system role: the system prompt goes first as a user message. */
export function toVsCodeLmMessages(api: Pick<VsCodeLmApi, 'userMessage' | 'assistantMessage'>, messages: readonly AiMessage[]): unknown[] {
  return messages
    .map((m) => ({ role: m.role, text: textOf(m) }))
    .filter((m) => m.text.length > 0)
    .map((m) => (m.role === 'assistant' ? api.assistantMessage(m.text) : api.userMessage(m.text)));
}

/** Copilot's chat models, one per `vendor/family` (the first VS Code lists wins). */
export async function listVsCodeLmModels(api: VsCodeLmApi): Promise<VsCodeLmModel[]> {
  const models = await api.selectChatModels({ vendor: VSCODE_LM_VENDOR });
  const seen = new Set<string>();
  return models.filter((m) => {
    const id = vscodeLmModelId(m);
    if (seen.has(id)) {return false;}
    seen.add(id);
    return true;
  });
}

export function createVsCodeLmAdapter(api: VsCodeLmApi): ProviderAdapter {
  return {
    kind: 'vscode-lm',

    async listModels(_engine: AiEngineConfig, _apiKey: string | null, signal: AbortSignal): Promise<AiDiscoveredModel[]> {
      let models: VsCodeLmModel[];
      try {
        models = await listVsCodeLmModels(api);
      } catch (err) {
        throw vscodeLmError(err, signal);
      }
      if (models.length === 0) {throw makeAiError('unreachable', NO_MODELS);}
      return models.map((m) => ({
        id: vscodeLmModelId(m),
        ...(m.name ? { label: m.name } : {}),
        capabilities: { chat: true, stream: true, ...(m.maxInputTokens > 0 ? { contextTokens: m.maxInputTokens } : {}) },
        source: 'endpoint',
      }));
    },

    async probe(_engine: AiEngineConfig, _apiKey: string | null, signal: AbortSignal) {
      const started = Date.now();
      try {
        const models = await listVsCodeLmModels(api);
        const latencyMs = Date.now() - started;
        return models.length > 0 ? { ok: true, latencyMs } : { ok: false, latencyMs, error: makeAiError('unreachable', NO_MODELS) };
      } catch (err) {
        return { ok: false, latencyMs: Date.now() - started, error: vscodeLmError(err, signal) };
      }
    },

    async complete(
      engine: AiEngineConfig,
      _apiKey: string | null,
      model: AiModelConfig,
      req: AiCompletionRequest,
      onToken: (delta: string) => void,
      signal: AbortSignal,
    ): Promise<AiCompletionResult> {
      if (signal.aborted) {throw makeAiError('cancelled');}
      const slash = model.id.indexOf('/');
      const vendor = slash > 0 ? model.id.slice(0, slash) : VSCODE_LM_VENDOR;
      const family = slash > 0 ? model.id.slice(slash + 1) : model.id;
      const source = api.tokenSource();
      const onAbort = (): void => source.cancel();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const [chat] = await api.selectChatModels({ vendor, family });
        if (!chat) {throw makeAiError('modelNotFound', `GitHub Copilot does not offer ${model.id} right now.`);}
        const response = await chat.sendRequest(toVsCodeLmMessages(api, req.messages), { justification: JUSTIFICATION }, source.token);
        let text = '';
        for await (const delta of response.text) {
          if (signal.aborted) {break;}
          text += delta;
          onToken(delta);
        }
        if (signal.aborted) {throw makeAiError('cancelled');}
        return {
          text,
          served: { engineId: engine.id, engineName: engine.name || engine.id, modelId: model.id, isLocal: false },
          finishReason: 'stop',
        };
      } catch (err) {
        // Ours (cancelled, modelNotFound) pass through; anything from `vscode.lm` is mapped.
        throw isAiError(err) && !signal.aborted ? err : vscodeLmError(err, signal);
      } finally {
        signal.removeEventListener('abort', onAbort);
        source.dispose();
      }
    },
  };
}
