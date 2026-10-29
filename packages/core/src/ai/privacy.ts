/**
 * Privacy copy for cloud engines: the four lines every surface shows (the
 * privacy card, the disclaimer, the consent dialogs), what each feature
 * sends, each provider's policy link, and the consent dialog text both hosts
 * render (VS Code's modal, Desktop's native dialog; Desktop has a Rust port
 * checked against `test/ai-fixtures/consent/`).
 *
 * No claims about any provider's training or retention: those are set by the
 * provider's terms and change. The copy says "may" and points at the policy.
 */

import { getAiFeature } from './features';
import { hostOfUrl } from './locality';
import { AI_ENGINE_PRESETS, type AiEnginePreset, type AiProviderPolicy } from './presets';
import type { AiConsentRecord, AiSendsScope } from './types';

/** The four lines of the privacy card, in display order. */
export const AI_CLOUD_PRIVACY = {
  leaves: 'Text you ask about is sent over the internet to the provider and processed on their servers.',
  terms:
    "API traffic is covered by the provider's API terms, which differ from its consumer apps. " +
    'Whether it is retained or used for training is set by those terms and may change; read them before you decide.',
  local: 'A local engine keeps everything on this machine or your network.',
  keys: "Your API key stays in this app's secure storage on this machine.",
} as const;

/**
 * The sentence about the consent step, for the cloud privacy card: whether
 * the host asks before a cloud engine's first request (`hostAsks`: it has
 * `requestCloudConsent`) or sends without asking.
 */
export function aiConsentStepNote(hostAsks: boolean): string {
  return hostAsks
    ? 'Even when allowed, each cloud engine asks for your OK before its first request in each workspace or folder.'
    : 'Once allowed, this app sends requests to cloud engines without asking again.';
}

/** What a request of each scope sends, as the object of "sends …". */
export const AI_SENDS_TEXT: Readonly<Record<AiSendsScope, string>> = {
  selection: 'the selected text and the paragraph before and after it',
  document: 'the whole document, up to what fits the model',
  documentAndTags: 'the document, its frontmatter and the tag names used in this workspace',
};

/** For a request whose feature is unknown. */
export const AI_SENDS_FALLBACK = 'the text you ask the AI about';

/**
 * What a request sends, as the object of a sentence ("MikeDown sends …").
 * `sends` wins (whole-document Translate runs as the `rewrite` feature);
 * else the feature's own scope; else a generic phrase.
 */
export function whatIsSent(feature?: string, sends?: AiSendsScope): string {
  const scope = sends ?? (feature ? getAiFeature(feature)?.sends : undefined);
  return scope ? AI_SENDS_TEXT[scope] : AI_SENDS_FALLBACK;
}

/** The policy of the cloud preset on `host` (an engine's base URL host), if one matches. */
export function aiProviderPolicyForHost(host: string | null | undefined, presets: readonly AiEnginePreset[] = AI_ENGINE_PRESETS): AiProviderPolicy | undefined {
  const h = host?.trim().toLowerCase();
  if (!h) {return undefined;}
  return presets.find((p) => p.family === 'cloud' && p.policy && hostOfUrl(p.baseUrl) === h)?.policy;
}

/** The policy for an engine, matched by its base URL's host (engines do not store a preset). */
export function aiProviderPolicy(engine: { baseUrl: string }, presets: readonly AiEnginePreset[] = AI_ENGINE_PRESETS): AiProviderPolicy | undefined {
  return aiProviderPolicyForHost(hostOfUrl(engine.baseUrl), presets);
}

/** Where a consent answer is remembered: VS Code says workspace, Desktop folder (or session without one). */
export type AiConsentScopeWord = 'workspace' | 'folder' | 'session';

export interface AiConsentTextInput {
  engineName: string;
  /** The engine's host ("api.anthropic.com"), or its base URL when it has none. */
  host: string;
  feature?: string;
  sends?: AiSendsScope;
  scopeWord: AiConsentScopeWord;
  /** The provider's policy (see `aiProviderPolicyForHost`); spelled out in the body, since native dialogs cannot link. */
  policy?: AiProviderPolicy | null;
  /** Add the "Not for this …" button text (`never`). */
  offerNever?: boolean;
}

export interface AiConsentText {
  title: string;
  /** Paragraphs separated by a blank line. */
  body: string;
  allow: string;
  notNow: string;
  never?: string;
}

/** The consent dialog's words, the single source for both hosts. */
export function aiConsentText(input: AiConsentTextInput): AiConsentText {
  const { engineName: name, host, scopeWord, policy } = input;
  const paragraphs = [
    `${name} is a cloud engine at ${host}. If you allow it, this request sends ${whatIsSent(input.feature, input.sends)}. ` +
      `It goes over the internet to ${host} and is processed on the provider's servers.`,
    policy?.note ? `${AI_CLOUD_PRIVACY.terms} ${policy.note}` : AI_CLOUD_PRIVACY.terms,
  ];
  if (policy) {paragraphs.push(`${policy.label}: ${policy.url}`);}
  paragraphs.push(`You can use a local engine instead. Allowing is remembered for this ${scopeWord}.`);
  return {
    title: `Send text to ${name}?`,
    body: paragraphs.join('\n\n'),
    allow: `Allow for this ${scopeWord}`,
    notNow: 'Not now',
    ...(input.offerNever ? { never: `Not for this ${scopeWord}` } : {}),
  };
}

/** Shown in the Cloud consents list when there is nothing stored. */
export const AI_NO_CONSENTS_TEXT = 'No cloud engine has been allowed here.';

/**
 * One line of the Cloud consents list, without the Forget button:
 * "Anthropic · this workspace · Allowed". A "never" answer reads "Not allowed".
 */
export function aiConsentSummary(record: Pick<AiConsentRecord, 'answer' | 'scope'>, engineName: string): string {
  const where = record.scope === 'folder' ? 'this folder' : 'this workspace';
  return `${engineName} \u00b7 ${where} \u00b7 ${record.answer === 'allow' ? 'Allowed' : 'Not allowed'}`;
}
