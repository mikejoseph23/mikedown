import { AI_SENDS_TEXT, fromWireCompletionRequest, toAiError, type AiCompletionResult, type AiCompletionTurn, type AiSendsScope, type AiWireCompletionRequest } from '@mikedown/core/ai';
import type { AiDocBaseStatus, AiDocsIndex, AiDocsSection, AiDocsSectionRef } from '@mikedown/core/ai';
import type { AiEngineService } from './engineService';

/**
 * The AI half of the webview protocol (documented in
 * packages/core/src/editor-main.ts and src/webview/editor-main.ts).
 *
 * Webview → host:
 *   aiComplete            { request: AiWireCompletionRequest }  → aiToken*, then aiDone or aiError
 *       `request.turn` { id, sends?, baseIds?, isLocal? } (chat turn): finds this panel's "Allow once" for the turn and words a
 *       dialog raised mid-turn. A claim, never consent: only a dialog's answer makes a grant.
 *   aiCancel              { requestId }
 *   aiEndTurn             { turnId }                           (no reply; the turn is over, its "Allow once" is gone)
 *   aiListEngines         {}                                   → aiEngines
 *   aiTestEngine          { requestId, engineId }              → aiEngineStatus
 *   aiDiscoverModels      { requestId, engineId }              → aiEngineStatus
 *   aiSetSecret           { requestId, engineId, apiKey }      → aiEngineStatus (hasKey)
 *   aiRequestCloudConsent { requestId, engineId, feature?, sends?, baseIds?, turnId? } → aiConsent, or aiError (cloudBlocked while Allow cloud is off)
 *       `baseIds` (docs chat): the documentation bases the request would send pages from. The host maps the ids to names
 *       from its own user-level settings, drops unknown ids and puts only those names in the dialog. `turnId` (docs chat):
 *       "Allow once" holds for that turn in this panel.
 *   aiListConsents        { requestId }                        → aiConsents
 *   aiForgetConsent       { requestId, engineId }              → aiConsents (the list after forgetting)
 *   aiDetectLocalServers  { requestId, candidates: { presetId, baseUrl }[] } → aiEngineProbes
 *   aiDetectHostEngines   { requestId }                        → aiHostEngines
 *   aiHardwareInfo        { requestId }                        → aiHardware
 *   docsListBases         { requestId, refresh? }              → docsBases           (every base with its health; `refresh` walks again)
 *   docsIndex             { requestId, baseId }                → docsIndexResult     (pages, headings, links; no bodies)
 *   docsReadSections      { requestId, baseId, ids: string[] } → docsSections        (bodies; ids the host's index does not know are left out)
 *   docsKeywordSearch     { requestId, baseId, query }         → docsKeywordResults  (ids and labels, best first, at most 20)
 *   docsSaveBases         { requestId, bases }                 → docsSaved           (the host re-validates and writes user settings only)
 *   docsAddWorkspaceFolder { requestId }                       → docsWorkspaceFolder (a folder path from the open workspace, or null; it does not save)
 *   Every docs* message answers docsError { code: 'unavailable' } while AI is off, and { code: 'badRequest' } for a malformed field.
 *   A base id picks a base from the host's user-level settings; no message can name a folder to read.
 *
 * Host → webview:
 *   aiToken        { requestId, delta }
 *   aiDone         { requestId, result: AiCompletionResult }  (`result.timing` optional: total and first-token ms)
 *   aiError        { requestId, code, message }   (also answers a failed test/discover/setSecret/consent)
 *   aiEngines      { engines: AiEngineStatus[] }  (reply to aiListEngines, and pushed after a settings or status change)
 *   aiEngineStatus { requestId, status }
 *   aiConsent      { requestId, engineId, granted: true | 'once' | false | 'never' }  ('once': this request only, or this turn; false: don't allow, asked again after a restart; 'never': stored by an older version)
 *   aiConsents     { requestId, consents: AiConsentRecord[] }  (this workspace's stored answers and this session's "Don't allow", newest first)
 *   aiEngineProbes { requestId, probes: AiLocalServerProbe[] }  (one per candidate, in order; nothing cached)
 *   aiHostEngines  { requestId, probes: AiHostEngineProbe[] }   (VS Code's Copilot models: how many, never a prompt)
 *   aiHardware     { requestId, info: AiHardwareInfo | null }   (memory, CPU, Apple Silicon; read once per session)
 *   docsBases      { requestId, bases: AiDocBaseStatus[] }
 *   docsIndexResult { requestId, index: AiDocsIndex }
 *   docsSections   { requestId, sections: AiDocsSection[] }
 *   docsKeywordResults { requestId, refs: AiDocsSectionRef[] }
 *   docsSaved      { requestId }
 *   docsWorkspaceFolder { requestId, path: string | null }
 *   docsError      { requestId, code: 'unavailable' | 'badRequest' | 'failed', message }
 */

export const AI_WEBVIEW_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'aiComplete',
  'aiCancel',
  'aiEndTurn',
  'aiListEngines',
  'aiTestEngine',
  'aiDiscoverModels',
  'aiSetSecret',
  'aiRequestCloudConsent',
  'aiListConsents',
  'aiForgetConsent',
  'aiDetectLocalServers',
  'aiDetectHostEngines',
  'aiHardwareInfo',
  'docsListBases',
  'docsIndex',
  'docsReadSections',
  'docsKeywordSearch',
  'docsSaveBases',
  'docsAddWorkspaceFolder',
]);

export function isAiWebviewMessage(message: unknown): message is { type: string } & Record<string, unknown> {
  return typeof message === 'object' && message !== null && AI_WEBVIEW_MESSAGE_TYPES.has((message as { type?: unknown }).type as string);
}

/** What the docs messages need from `DocsHost` (kept narrow so tests can fake it). */
export interface DocsBridgeHost {
  listBases(opts?: { refresh?: boolean }): Promise<AiDocBaseStatus[]>;
  index(baseId: string): Promise<AiDocsIndex>;
  readSections(baseId: string, ids: string[]): Promise<AiDocsSection[]>;
  keywordSearch(baseId: string, query: string): Promise<AiDocsSectionRef[]>;
  saveBases(bases: unknown): Promise<void>;
  addWorkspaceFolder(): Promise<string | null>;
}

export interface AiBridgeHooks {
  /** A completion finished: the status bar mirrors who served it. */
  onServed?(result: AiCompletionResult): void;
  /** The documentation bases host and the AI switch. Absent: every docs* message answers `unavailable`. */
  docs?: { host: DocsBridgeHost; isEnabled(): boolean };
}

const MAX_BASE_ID = 200;
const MAX_QUERY = 2000;
const MAX_IDS = 200;
const MAX_ID_LENGTH = 2000;
const MAX_BASES = 100;
const MAX_BASE_IDS = 50;
const MAX_TURN_ID = 200;

/** A short string list from the webview: strings only, bounded count and length. */
function stringList(v: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(v)) {return [];}
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= maxLength).slice(0, maxItems);
}

class DocsBadRequest extends Error {}

function docsBaseId(message: Record<string, unknown>): string {
  const id = message.baseId;
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_BASE_ID) {throw new DocsBadRequest('Missing or malformed baseId.');}
  return id;
}

/** Answer one docs* message. Every field is validated; nothing here reads a path. */
async function handleDocsMessage(
  docs: AiBridgeHooks['docs'],
  message: { type: string } & Record<string, unknown>,
  post: (msg: unknown) => void,
): Promise<void> {
  const requestId = str(message.requestId);
  if (requestId === '' || requestId.length > 200) {return;}
  const reply = (type: string, body: Record<string, unknown> = {}): void => post({ type, requestId, ...body });
  const error = (code: 'unavailable' | 'badRequest' | 'failed', text: string): void => post({ type: 'docsError', requestId, code, message: text });
  if (!docs || !docs.isEnabled()) {
    error('unavailable', 'Documentation bases are unavailable: AI is turned off.');
    return;
  }
  const host = docs.host;
  try {
    switch (message.type) {
      case 'docsListBases':
        reply('docsBases', { bases: await host.listBases({ refresh: message.refresh === true }) });
        return;
      case 'docsIndex':
        reply('docsIndexResult', { index: await host.index(docsBaseId(message)) });
        return;
      case 'docsReadSections': {
        const baseId = docsBaseId(message);
        if (!Array.isArray(message.ids)) {throw new DocsBadRequest('ids must be a list.');}
        reply('docsSections', { sections: await host.readSections(baseId, stringList(message.ids, MAX_IDS, MAX_ID_LENGTH)) });
        return;
      }
      case 'docsKeywordSearch': {
        const baseId = docsBaseId(message);
        if (typeof message.query !== 'string') {throw new DocsBadRequest('query must be text.');}
        reply('docsKeywordResults', { refs: await host.keywordSearch(baseId, message.query.slice(0, MAX_QUERY)) });
        return;
      }
      case 'docsSaveBases':
        if (!Array.isArray(message.bases) || message.bases.length > MAX_BASES) {throw new DocsBadRequest('bases must be a list.');}
        await host.saveBases(message.bases);
        reply('docsSaved');
        return;
      case 'docsAddWorkspaceFolder':
        reply('docsWorkspaceFolder', { path: await host.addWorkspaceFolder() });
        return;
    }
  } catch (err) {
    if (err instanceof DocsBadRequest) {error('badRequest', err.message);}
    else {error('failed', err instanceof Error ? err.message : String(err));}
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** A known `sends` scope from the webview, else undefined. */
function sendsScope(v: unknown): AiSendsScope | undefined {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AI_SENDS_TEXT, v) ? v as AiSendsScope : undefined;
}

function turnId(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_TURN_ID ? v : undefined;
}

/** A request's turn from the webview, fields checked one by one; anything else is no turn. */
function turnClaim(v: unknown): AiCompletionTurn | undefined {
  if (typeof v !== 'object' || v === null) {return undefined;}
  const raw = v as Record<string, unknown>;
  const id = turnId(raw.id);
  if (!id) {return undefined;}
  const sends = sendsScope(raw.sends);
  const baseIds = stringList(raw.baseIds, MAX_BASE_IDS, MAX_BASE_ID);
  return { id, ...(sends ? { sends } : {}), ...(baseIds.length > 0 ? { baseIds } : {}), ...(typeof raw.isLocal === 'boolean' ? { isLocal: raw.isLocal } : {}) };
}

/** Handle one AI message from `panel`'s webview, posting the replies through `post`. */
export async function handleAiMessage(
  service: AiEngineService,
  panel: object,
  message: { type: string } & Record<string, unknown>,
  post: (msg: unknown) => void,
  hooks: AiBridgeHooks = {},
): Promise<void> {
  if (message.type.startsWith('docs')) {
    await handleDocsMessage(hooks.docs, message, post);
    return;
  }
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
        const { turn: rawTurn, ...request } = fromWireCompletionRequest(wire);
        const turn = turnClaim(rawTurn);
        const result = await service.complete(panel, turn ? { ...request, turn } : request, (delta) => post({ type: 'aiToken', requestId: id, delta }));
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
    case 'aiEndTurn':
      service.endTurn(panel, str(message.turnId));
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
        const feature = typeof message.feature === 'string' ? message.feature : undefined;
        const baseIds = stringList(message.baseIds, MAX_BASE_IDS, MAX_BASE_ID);
        const turn = turnId(message.turnId);
        const granted = turn
          ? await service.requestCloudConsent(engineId, feature, sendsScope(message.sends), baseIds, { panel, id: turn })
          : baseIds.length > 0
            ? await service.requestCloudConsent(engineId, feature, sendsScope(message.sends), baseIds)
            : await service.requestCloudConsent(engineId, feature, sendsScope(message.sends));
        post({ type: 'aiConsent', requestId, engineId, granted });
      } catch (err) {
        // cloudBlocked and friends reach the webview as an error, not as a quiet "no".
        fail(err);
      }
      return;
    }
    case 'aiDetectHostEngines':
      try {
        post({ type: 'aiHostEngines', requestId, probes: await service.detectHostEngines() });
      } catch (err) {
        fail(err);
      }
      return;
    case 'aiHardwareInfo':
      post({ type: 'aiHardware', requestId, info: service.hardwareInfo() });
      return;
    case 'aiListConsents':
      post({ type: 'aiConsents', requestId, consents: service.listConsents() });
      return;
    case 'aiForgetConsent':
      try {
        await service.forgetConsent(str(message.engineId));
        post({ type: 'aiConsents', requestId, consents: service.listConsents() });
      } catch (err) {
        fail(err);
      }
      return;
  }
}
