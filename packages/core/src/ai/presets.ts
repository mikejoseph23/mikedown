/**
 * "Add engine" presets. A preset only fills the new engine's name, kind, base
 * URL, key variable and key file; everything else is the user's. Presets also
 * drive the Express engine form: which family a card sits in, the caption
 * under it, where to get a key, and which fetched models count as Popular.
 *
 * No model ids here: they go stale, and the endpoint is the source of truth.
 * Popular rules are patterns matched against whatever the endpoint lists.
 */

import type { AiApiKeyFile, AiEngineKind } from './types';

/** Where a preset runs: your own server, or a cloud API you paste a key for. */
export type AiPresetFamily = 'local' | 'cloud';

/**
 * One Popular slot: the newest fetched id that matches `match` (and not
 * `exclude`). An id `prefer` matches (an alias such as `-latest`) wins;
 * otherwise "newest" compares the version numbers in the id, then a date
 * stamp.
 */
export interface AiPopularRule {
  /** Short family name, for the picker's tooltip ("Sonnet"). */
  label: string;
  match: RegExp;
  exclude?: RegExp;
  prefer?: RegExp;
}

export interface AiEnginePreset {
  id: string;
  name: string;
  kind: AiEngineKind;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyFile?: AiApiKeyFile;
  /** Whether the endpoint expects a key at all (LM Studio accepts any). */
  needsKey: boolean;
  family: AiPresetFamily;
  /** The quick-start card's one-line caption. */
  caption: string;
  /** Under the API key field: where to get one, or whether one is needed. A link to `keyUrl` when it has one. */
  keyHint: string;
  /** Cloud presets: the provider's page that creates API keys, opened through the host's `openLink`. */
  keyUrl?: string;
  /** Cloud presets: the Popular group, in order. The first rule that matches is the auto-picked default. */
  popular?: readonly AiPopularRule[];
  /**
   * Local presets: the path (from the server root, without `/v1`) that local
   * server detection GETs when it is not `{baseUrl}/models`. The native lists
   * answer without a key.
   */
  detectPath?: string;
  /** Cloud presets: the provider's own page on how API data is used (see `privacy.ts`). */
  policy?: AiProviderPolicy;
}

/**
 * A provider's official privacy or API data-use page. Only the link: what a
 * provider does with the text is set by its terms, which change, so no claim
 * about training or retention is made in code. URLs checked 2026-10-29.
 */
export interface AiProviderPolicy {
  /** Link text ("Anthropic privacy and data use"). */
  label: string;
  url: string;
  /** One extra neutral sentence, for a provider that passes requests on (OpenRouter). */
  note?: string;
}

export interface AiPresetFamilyInfo {
  family: AiPresetFamily;
  /** Group heading over the quick-start cards. */
  label: string;
  /** The "two ways to connect" line for this family. */
  explainer: string;
}

/** The two quick-start groups, in display order, with the "two ways to connect" copy. */
export const AI_PRESET_FAMILIES: readonly AiPresetFamilyInfo[] = [
  {
    family: 'local',
    label: 'Run on this machine',
    explainer: 'Your own model server, on this computer or your network. Text never leaves it.',
  },
  {
    family: 'cloud',
    label: 'Cloud API key',
    explainer: 'Paste a key from the provider. It bills your account for what you use.',
  },
];

/** Version numbers come before a dated suffix, so `-20250514` never outranks `-4-5`. */
const anthropicFamily = (word: string, label: string): AiPopularRule => ({ label, match: new RegExp(`^claude-${word}-\\d`) });

export const AI_ENGINE_PRESETS: readonly AiEnginePreset[] = [
  {
    id: 'omlx',
    name: 'oMLX',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    apiKeyEnv: 'OMLX_API_KEY',
    apiKeyFile: { path: '~/.omlx/settings.json', jsonPath: 'auth.api_key' },
    needsKey: true,
    family: 'local',
    caption: 'MLX models on Apple silicon',
    keyHint: 'oMLX keeps its key in ~/.omlx/settings.json, which is read automatically.',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'lmstudio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    needsKey: false,
    family: 'local',
    caption: 'The LM Studio app’s local server',
    keyHint: 'Only needed if you turned on authentication in LM Studio.',
    detectPath: '/api/v0/models',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    needsKey: false,
    family: 'local',
    caption: 'Models pulled with ollama',
    keyHint: 'Ollama needs no key.',
    detectPath: '/api/tags',
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp server',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8080/v1',
    needsKey: false,
    family: 'local',
    caption: 'llama-server with a GGUF model',
    keyHint: 'Only needed if you started llama-server with --api-key.',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    apiKeyEnv: 'VLLM_API_KEY',
    needsKey: false,
    family: 'local',
    caption: 'vllm serve on a GPU box',
    keyHint: 'Only needed if you started vLLM with --api-key.',
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    needsKey: false,
    family: 'local',
    caption: 'Any server that speaks the OpenAI API',
    keyHint: 'Leave blank if the server has no auth.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    needsKey: true,
    family: 'cloud',
    caption: 'Claude models, API key from Anthropic',
    keyHint: 'Get an API key in the Claude Console',
    keyUrl: 'https://platform.claude.com/settings/keys',
    policy: { label: 'Anthropic privacy and data use', url: 'https://privacy.claude.com/en/collections/10663361-commercial-customers' },
    popular: [anthropicFamily('sonnet', 'Sonnet'), anthropicFamily('opus', 'Opus'), anthropicFamily('haiku', 'Haiku')],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    needsKey: true,
    family: 'cloud',
    caption: 'GPT models, API key from OpenAI',
    keyHint: 'Get an API key on the OpenAI platform',
    keyUrl: 'https://platform.openai.com/api-keys',
    policy: { label: 'OpenAI API data controls', url: 'https://developers.openai.com/api/docs/guides/your-data' },
    popular: [
      { label: 'Flagship', match: /^gpt-\d+(\.\d+)?$/ },
      { label: 'Mini', match: /^gpt-\d+(\.\d+)?-mini$/ },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    needsKey: true,
    family: 'cloud',
    caption: 'Models from many providers with one key',
    keyHint: 'Get an API key on OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    policy: {
      label: 'OpenRouter privacy policy',
      url: 'https://openrouter.ai/privacy',
      note: 'OpenRouter passes each request on to the provider that serves the model, whose own terms apply as well.',
    },
    popular: [
      { label: 'Claude Sonnet', match: /^anthropic\/claude-sonnet-\d/ },
      { label: 'GPT', match: /^openai\/gpt-\d+(\.\d+)?$/ },
      { label: 'Gemini Pro', match: /^google\/gemini-\d+(\.\d+)?-pro$/ },
      { label: 'Gemini Flash', match: /^google\/gemini-\d+(\.\d+)?-flash$/ },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    needsKey: true,
    family: 'cloud',
    caption: 'Gemini models, API key from Google AI Studio',
    keyHint: 'Get an API key in Google AI Studio',
    keyUrl: 'https://aistudio.google.com/apikey',
    policy: { label: 'Gemini API terms and data use', url: 'https://ai.google.dev/gemini-api/terms' },
    popular: [
      { label: 'Flash', match: /(^|\/)gemini-\d+(\.\d+)?-flash$/ },
      { label: 'Pro', match: /(^|\/)gemini-\d+(\.\d+)?-pro$/ },
      { label: 'Flash-Lite', match: /(^|\/)gemini-\d+(\.\d+)?-flash-lite$/ },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    needsKey: true,
    family: 'cloud',
    caption: 'Fast open models such as Llama and Qwen',
    keyHint: 'Get an API key in the Groq console',
    keyUrl: 'https://console.groq.com/keys',
    policy: { label: 'Groq: your data in GroqCloud', url: 'https://console.groq.com/docs/your-data' },
    popular: [
      { label: 'GPT-OSS', match: /^openai\/gpt-oss-\d+b$/ },
      { label: 'Llama', match: /^(meta-llama\/)?llama-\d/, exclude: /guard|prompt/ },
      { label: 'Qwen', match: /^qwen\/qwen\d/ },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    needsKey: true,
    family: 'cloud',
    caption: 'Mistral models, API key from Mistral',
    keyHint: 'Get an API key in the Mistral console',
    keyUrl: 'https://console.mistral.ai/api-keys',
    policy: { label: 'Mistral AI privacy policy', url: 'https://legal.mistral.ai/terms/privacy-policy/' },
    popular: [
      { label: 'Medium', match: /^mistral-medium-/, prefer: /-latest$/ },
      { label: 'Large', match: /^mistral-large-/, prefer: /-latest$/ },
      { label: 'Small', match: /^mistral-small-/, prefer: /-latest$/ },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    needsKey: true,
    family: 'cloud',
    caption: 'DeepSeek chat and reasoning models',
    keyHint: 'Get an API key on the DeepSeek platform',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    policy: { label: 'DeepSeek privacy policy', url: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html' },
    popular: [
      { label: 'Chat', match: /^deepseek-chat/ },
      { label: 'Reasoner', match: /^deepseek-reasoner/ },
    ],
  },
];

function urlKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * The preset a saved engine most likely came from (engines do not store
 * one): same kind and address, then the same key variable as a tiebreak
 * (oMLX and vLLM share port 8000); else, for a cloud address, the preset on
 * the same host; else the one preset of a dedicated kind. Undefined when
 * nothing fits (a hand-made OpenAI-compatible engine).
 */
export function presetForEngine(
  engine: { kind: string; baseUrl: string; apiKeyEnv?: string },
  presets: readonly AiEnginePreset[] = AI_ENGINE_PRESETS,
): AiEnginePreset | undefined {
  const sameKind = presets.filter((p) => p.kind === engine.kind);
  const exact = sameKind.filter((p) => urlKey(p.baseUrl) === urlKey(engine.baseUrl));
  if (exact.length > 0) {
    return exact.find((p) => p.apiKeyEnv && p.apiKeyEnv === engine.apiKeyEnv)
      ?? exact.find((p) => !p.apiKeyEnv && !engine.apiKeyEnv)
      ?? exact[0];
  }
  let host = '';
  try { host = new URL(engine.baseUrl.trim()).hostname.toLowerCase(); } catch { /* not a URL yet */ }
  if (host) {
    const sameHost = sameKind.find((p) => p.family === 'cloud' && new URL(p.baseUrl).hostname.toLowerCase() === host);
    if (sameHost) {return sameHost;}
  }
  return engine.kind !== 'openai-compatible' && sameKind.length === 1 ? sameKind[0] : undefined;
}

/** Local server detection waits this long for each address. */
export const AI_LOCAL_DETECT_TIMEOUT_MS = 1500;

/** What `detectLocalServers` is asked about: every local preset but Custom, at its default address. */
export function localDetectCandidates(presets: readonly AiEnginePreset[] = AI_ENGINE_PRESETS): { presetId: string; baseUrl: string }[] {
  return presets.filter((p) => p.family === 'local' && p.id !== 'custom').map((p) => ({ presetId: p.id, baseUrl: p.baseUrl }));
}
