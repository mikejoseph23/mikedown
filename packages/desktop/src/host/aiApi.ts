/**
 * Typed wrapper over the AI commands (`src-tauri/src/commands/ai.rs`) and
 * their per-request events. The host (`aiHost.ts`) takes this interface, so
 * tests swap in a fake. Nothing here ever sees an API key on the way back:
 * `setSecret` is write-only.
 */
import type { AiCompletionResult, AiErrorCode } from '@mikedown/core';
import type { AiLocalServerProbe } from '@mikedown/core/ai';
import type { AiDiscoveredModel, AiWireCompletionRequest } from '@mikedown/core/ai';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** What only the Rust side knows about an engine; the saved models stay in settings. */
export interface AiEngineInfo {
  engineId: string;
  /** Null until probed this session. */
  ok: boolean | null;
  isLocal: boolean;
  hasKey: boolean;
  /** `stored` (the keychain) or `file` (the engine's `apiKeyFile`); absent for a variable or no key. */
  keySource?: 'file' | 'stored';
  latencyMs?: number;
  error?: string;
}

export interface AiDiscoveryResult {
  info: AiEngineInfo;
  models: AiDiscoveredModel[];
}

export interface AiTokenEvent {
  requestId: string;
  delta: string;
}

export interface AiDoneEvent {
  requestId: string;
  result: AiCompletionResult;
}

export interface AiErrorEvent {
  requestId: string;
  code: AiErrorCode;
  message: string;
}

/**
 * The event channel for a request id: characters Tauri does not allow in an
 * event name become `_`. Same mapping as `channel_id` in `ai.rs`, so the
 * listeners can be registered before `ai_complete` is invoked.
 */
export function aiChannelId(requestId: string): string {
  return requestId.replace(/[^A-Za-z0-9_-]/g, '_');
}

export interface AiApi {
  /** Starts the request; resolves with the channel id once it is running. Tokens, the result and errors arrive as events. */
  complete(request: AiWireCompletionRequest): Promise<string>;
  cancel(requestId: string): Promise<boolean>;
  listEngines(): Promise<AiEngineInfo[]>;
  testEngine(engineId: string): Promise<AiEngineInfo>;
  discoverModels(engineId: string): Promise<AiDiscoveryResult>;
  setSecret(engineId: string, apiKey: string | null): Promise<void>;
  requestCloudConsent(engineId: string): Promise<boolean>;
  /** Which local presets answer at their addresses (1.5 s each, nothing cached). */
  detectLocalServers(candidates: { presetId: string; baseUrl: string }[]): Promise<AiLocalServerProbe[]>;
  onToken(requestId: string, handler: (e: AiTokenEvent) => void): Promise<UnlistenFn>;
  onDone(requestId: string, handler: (e: AiDoneEvent) => void): Promise<UnlistenFn>;
  onError(requestId: string, handler: (e: AiErrorEvent) => void): Promise<UnlistenFn>;
}

export const aiApi: AiApi = {
  complete: (request) => invoke<string>('ai_complete', { request }),
  cancel: (requestId) => invoke<boolean>('ai_cancel', { id: requestId }),
  listEngines: () => invoke<AiEngineInfo[]>('ai_list_engines'),
  testEngine: (engineId) => invoke<AiEngineInfo>('ai_test_engine', { id: engineId }),
  discoverModels: (engineId) => invoke<AiDiscoveryResult>('ai_discover_models', { id: engineId }),
  setSecret: (engineId, apiKey) => invoke<void>('ai_set_secret', { id: engineId, apiKey }),
  requestCloudConsent: (engineId) => invoke<boolean>('ai_request_cloud_consent', { id: engineId }),
  detectLocalServers: (candidates) => invoke<AiLocalServerProbe[]>('ai_detect_local_servers', { candidates }),
  onToken: (requestId, handler) => listen<AiTokenEvent>(`ai-token:${aiChannelId(requestId)}`, (e) => handler(e.payload)),
  onDone: (requestId, handler) => listen<AiDoneEvent>(`ai-done:${aiChannelId(requestId)}`, (e) => handler(e.payload)),
  onError: (requestId, handler) => listen<AiErrorEvent>(`ai-error:${aiChannelId(requestId)}`, (e) => handler(e.payload)),
};
