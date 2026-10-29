import * as vscode from 'vscode';
import * as os from 'os';
import { AI_SETTINGS_KEYS, aiConsentHost, aiConsentText, aiProviderPolicy, parseAiSettings, serializeAiSettings, type AiEngineConfig, type AiSendsScope } from '@mikedown/core/ai';
import { getSettings, stableEngineIdGenerator, effectiveAiRaw } from '../settings';
import { AiEngineService, type ConsentDialogAnswer, type ConsentStore, type StoredConsent } from './engineService';
import { AiSecrets } from './secrets';
import { readHardwareInfo } from './hardware';
import { createAdapters, type VsCodeLmApi } from './providers';

/**
 * VS Code wiring for the AI layer: the engine service built on
 * `context.secrets` and `workspaceState`, the consent modal, and writing the
 * `ai.*` keys of a `saveSettings` patch into `mikedown.ai.*`.
 */

const CONSENT_PREFIX = 'mikedown.ai.consent.';

/** Keys that live in user settings only (OPEN-3). */
const USER_ONLY_KEYS = new Set(['engines', 'localNetworks', 'allowCloud']);

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * The consent modal: host UI, so a workspace cannot restyle or skip it. The
 * words come from core's `aiConsentText` (Desktop renders the same ones).
 * Three answers: Allow for this workspace (stored), Allow once (this request
 * only) and Don't allow (or closing the dialog; the service remembers it for
 * the session). "Read the provider's policy" opens the policy in the browser
 * and asks again.
 */
export async function askCloudConsent(engine: AiEngineConfig, feature: string | undefined, sends?: AiSendsScope): Promise<ConsentDialogAnswer> {
  const policy = aiProviderPolicy(engine);
  const text = aiConsentText({
    engineName: engine.name || engine.id,
    // "GitHub Copilot" for a vscode-lm engine, which has no address; the kind words the body for it.
    host: aiConsentHost(engine),
    kind: engine.kind,
    feature,
    sends,
    scopeWord: 'workspace',
    policy,
  });
  const allow: vscode.MessageItem = { title: text.allow };
  const allowOnce: vscode.MessageItem = { title: text.allowOnce };
  const deny: vscode.MessageItem = { title: text.deny, isCloseAffordance: true };
  const readPolicy: vscode.MessageItem | undefined = policy && text.readPolicy ? { title: text.readPolicy } : undefined;
  const items = readPolicy ? [allow, allowOnce, deny, readPolicy] : [allow, allowOnce, deny];
  for (;;) {
    const pick = await vscode.window.showWarningMessage(text.title, { modal: true, detail: text.body }, ...items);
    if (pick && pick === readPolicy && policy) {
      await vscode.env.openExternal(vscode.Uri.parse(policy.url));
      continue;
    }
    return pick === allow ? 'allow' : pick === allowOnce ? 'allowOnce' : 'deny';
  }
}

/**
 * Consent answers in `workspaceState`, one key per engine: `allow`, or a
 * `never` an older version stored (still read, listed and forgettable).
 * An even older version stored a bare `true`; with no fingerprint it cannot be matched to an engine,
 * so it counts as "never asked" and is replaced by the next answer.
 */
export function workspaceConsentStore(state: Pick<vscode.Memento, 'get' | 'update' | 'keys'>): ConsentStore {
  return {
    get: (id) => {
      const raw = state.get<unknown>(`${CONSENT_PREFIX}${id}`);
      if (typeof raw !== 'object' || raw === null) {return undefined;}
      const r = raw as Partial<StoredConsent>;
      return typeof r.fingerprint === 'string' && (r.answer === 'allow' || r.answer === 'never') && typeof r.at === 'number'
        ? { fingerprint: r.fingerprint, answer: r.answer, at: r.at }
        : undefined;
    },
    set: (id, record) => state.update(`${CONSENT_PREFIX}${id}`, record),
    forget: (id) => state.update(`${CONSENT_PREFIX}${id}`, undefined),
    ids: () => state.keys().filter((k) => k.startsWith(CONSENT_PREFIX)).map((k) => k.slice(CONSENT_PREFIX.length)),
  };
}

/** The `vscode.lm` pieces the `vscode-lm` adapter needs (GitHub Copilot's models). */
export function vscodeLmApi(): VsCodeLmApi {
  return {
    selectChatModels: (selector) => vscode.lm.selectChatModels(selector),
    userMessage: (text) => vscode.LanguageModelChatMessage.User(text),
    assistantMessage: (text) => vscode.LanguageModelChatMessage.Assistant(text),
    tokenSource: () => new vscode.CancellationTokenSource(),
  };
}

export function createVsCodeAiService(context: vscode.ExtensionContext, output: vscode.OutputChannel): AiEngineService {
  const log = (line: string) => output.appendLine(`[${timestamp()}] ${line}`);
  return new AiEngineService({
    adapters: createAdapters({ vscodeLm: vscodeLmApi() }),
    readHardware: () => readHardwareInfo(),
    readSettings: () => getSettings().ai,
    secrets: new AiSecrets(context.secrets, process.env, os.homedir, log),
    consent: workspaceConsentStore(context.workspaceState),
    askConsent: askCloudConsent,
    saveEngines: (engines) => vscode.workspace.getConfiguration('mikedown').update('ai.engines', JSON.parse(JSON.stringify(engines)), vscode.ConfigurationTarget.Global),
    log,
  });
}

/**
 * Engines hand-written without an `id` get a stable one from
 * `stableEngineIdGenerator`; write it back once so it survives reordering
 * (routes and the stored key refer to it). No-op when every engine has one.
 */
export async function writeBackEngineIds(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('mikedown');
  const raw = config.inspect<unknown[]>('ai.engines')?.globalValue;
  if (!Array.isArray(raw)) {return false;}
  const missing = raw.some((e) => typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id !== 'string');
  if (!missing) {return false;}
  const engines = getSettings().ai.engines;
  await config.update('ai.engines', JSON.parse(JSON.stringify(engines)), vscode.ConfigurationTarget.Global);
  return true;
}

/**
 * Write the `ai.*` keys of a `saveSettings` patch. The patch is validated by
 * parsing it over the current values (so a malformed engine is dropped, not
 * saved), then only the keys it named are written. `engines` and
 * `localNetworks` go to user settings; the others go where they are already
 * set (a workspace value wins over a user one, so writing user settings
 * under it would look like the save did nothing). Unknown `ai.*` keys are
 * skipped: VS Code refuses to write unregistered settings.
 *
 * Returns the keys written.
 */
export async function saveAiSettingsPatch(patch: Record<string, unknown>): Promise<string[]> {
  const keys = Object.keys(patch)
    .filter((k) => k.startsWith('ai.'))
    .map((k) => k.slice(3))
    .filter((k): k is (typeof AI_SETTINGS_KEYS)[number] => (AI_SETTINGS_KEYS as readonly string[]).includes(k));
  if (keys.length === 0) {return [];}

  const config = vscode.workspace.getConfiguration('mikedown');
  const current = effectiveAiRaw((key) => config.inspect(`ai.${key}`));
  const next = parseAiSettings({ ...current, ...Object.fromEntries(keys.map((k) => [k, patch[`ai.${k}`]])) }, { generateId: stableEngineIdGenerator() });
  const serialized = serializeAiSettings(next);

  const written: string[] = [];
  for (const key of keys) {
    const inspected = config.inspect(`ai.${key}`);
    let target = vscode.ConfigurationTarget.Global;
    if (!USER_ONLY_KEYS.has(key)) {
      if (inspected?.workspaceFolderValue !== undefined) {target = vscode.ConfigurationTarget.WorkspaceFolder;}
      else if (inspected?.workspaceValue !== undefined) {target = vscode.ConfigurationTarget.Workspace;}
    }
    try {
      await config.update(`ai.${key}`, serialized[`ai.${key}`], target);
      written.push(key);
    } catch (err) {
      void vscode.window.showErrorMessage(`MikeDown: could not save setting "ai.${key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (keys.includes('allowCloud') && next.allowCloud) {
    const inspected = config.inspect('ai.allowCloud');
    if ((inspected?.workspaceFolderValue ?? inspected?.workspaceValue) === false) {
      void vscode.window.showWarningMessage('MikeDown: this workspace turns "Allow cloud" off, so cloud AI engines stay blocked here.');
    }
  }
  return written;
}
