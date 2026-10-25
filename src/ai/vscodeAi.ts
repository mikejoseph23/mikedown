import * as vscode from 'vscode';
import * as os from 'os';
import { AI_SETTINGS_KEYS, getAiFeature, hostOfUrl, parseAiSettings, serializeAiSettings, type AiEngineConfig } from '@mikedown/core/ai';
import { getSettings, stableEngineIdGenerator, effectiveAiRaw } from '../settings';
import { AiEngineService } from './engineService';
import { AiSecrets } from './secrets';

/**
 * VS Code wiring for the AI layer: the engine service built on
 * `context.secrets` and `workspaceState`, the consent modal, and writing the
 * `ai.*` keys of a `saveSettings` patch into `mikedown.ai.*`.
 */

const CONSENT_PREFIX = 'mikedown.ai.consent.';

/** Keys that live in user settings only (OPEN-3). */
const USER_ONLY_KEYS = new Set(['engines', 'localNetworks']);

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The consent modal: host UI, so a workspace cannot restyle or skip it. */
async function askCloudConsent(engine: AiEngineConfig, feature: string | undefined): Promise<boolean> {
  const name = engine.name || engine.id;
  const host = hostOfUrl(engine.baseUrl) ?? engine.baseUrl;
  const what = feature === 'rewrite' || !feature
    ? 'the selected text and the paragraph before and after it'
    : `the text ${getAiFeature(feature)?.label ?? feature} works on`;
  const allow: vscode.MessageItem = { title: 'Allow for this workspace' };
  const notNow: vscode.MessageItem = { title: 'Not now', isCloseAffordance: true };
  const pick = await vscode.window.showWarningMessage(
    `Send text to ${name}?`,
    {
      modal: true,
      detail: `${name} is a cloud engine (${host}). MikeDown will send it ${what}. Nothing is sent unless you allow it; allowing is remembered for this workspace.`,
    },
    allow,
    notNow,
  );
  return pick === allow;
}

export function createVsCodeAiService(context: vscode.ExtensionContext, output: vscode.OutputChannel): AiEngineService {
  const log = (line: string) => output.appendLine(`[${timestamp()}] ${line}`);
  return new AiEngineService({
    readSettings: () => getSettings().ai,
    secrets: new AiSecrets(context.secrets, process.env, os.homedir, log),
    consent: {
      get: (id) => context.workspaceState.get<boolean>(`${CONSENT_PREFIX}${id}`),
      grant: (id) => context.workspaceState.update(`${CONSENT_PREFIX}${id}`, true),
      forget: (id) => context.workspaceState.update(`${CONSENT_PREFIX}${id}`, undefined),
    },
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
    if (!USER_ONLY_KEYS.has(key) && key !== 'allowCloud') {
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
