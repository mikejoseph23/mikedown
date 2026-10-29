/**
 * Capability detection for models the endpoint does not describe (oMLX and
 * most OpenAI-compatible servers list bare ids). Order of trust: endpoint
 * metadata, then these heuristics, then user edits, which always win and
 * survive re-discovery (`capabilitiesSource: 'user'`).
 *
 * Local models: an ordered regex table of families; every matching rule
 * applies in order, so later, more specific rules override earlier ones.
 * Cloud models (Anthropic, OpenAI): static tables matched by the longest id
 * prefix, so a new model in a known line inherits its line's values.
 */

import { DEFAULT_CONTEXT_TOKENS } from './types';
import type { AiDiscoveredModel, AiEngineKind, AiModelCapabilities, AiModelConfig } from './types';

interface FamilyRule {
  family: string;
  pattern: RegExp;
  caps: Partial<AiModelCapabilities>;
}

const BASE_CAPABILITIES: AiModelCapabilities = {
  chat: true,
  stream: true,
  vision: false,
  json: false,
  tools: false,
  fim: false,
  embed: false,
  contextTokens: null,
};

const NOT_A_CHAT_MODEL: Partial<AiModelCapabilities> = { chat: false, stream: false, vision: false, json: false, tools: false, fim: false };

// Matched against the lower-cased id. Order matters: later rules override.
const FAMILY_RULES: FamilyRule[] = [
  { family: 'qwen', pattern: /qwen/, caps: { json: true, tools: true, contextTokens: 32768 } },
  { family: 'qwen3', pattern: /qwen-?3(?![.\d])/, caps: { contextTokens: 40960 } },
  // Qwen 3.5 and later (and the qwen4_exp preview) carry vision in the same weights.
  { family: 'qwen3.5+', pattern: /qwen-?3\.[5-9]|qwen-?4/, caps: { vision: true, contextTokens: 262144 } },
  { family: 'qwen-coder', pattern: /qwen.*coder/, caps: { vision: false, fim: true, contextTokens: 262144 } },
  { family: 'qwen2.5-coder', pattern: /qwen-?2\.5.*coder/, caps: { contextTokens: 32768 } },
  { family: 'gemma', pattern: /gemma/, caps: { json: true, contextTokens: 8192 } },
  { family: 'gemma3', pattern: /gemma-?3/, caps: { vision: true, contextTokens: 131072 } },
  { family: 'gemma4', pattern: /gemma-?4/, caps: { vision: true, tools: true, contextTokens: 131072 } },
  { family: 'codegemma', pattern: /codegemma/, caps: { vision: false, fim: true } },
  { family: 'llama3.1+', pattern: /llama-?3\.[1-3]/, caps: { json: true, tools: true, contextTokens: 131072 } },
  { family: 'llama4', pattern: /llama-?4/, caps: { json: true, tools: true, vision: true, contextTokens: 131072 } },
  { family: 'mistral', pattern: /mistral|mixtral|ministral|magistral/, caps: { json: true, tools: true, contextTokens: 32768 } },
  { family: 'mistral-vision', pattern: /mistral-small-3\.[1-9]|mistral-medium|magistral|pixtral/, caps: { vision: true, contextTokens: 131072 } },
  { family: 'codestral', pattern: /codestral/, caps: { fim: true, json: true, contextTokens: 32768 } },
  { family: 'deepseek', pattern: /deepseek/, caps: { json: true, tools: true, contextTokens: 131072 } },
  { family: 'deepseek-v4', pattern: /deepseek-?v4/, caps: { contextTokens: 1048576 } },
  { family: 'deepseek-coder', pattern: /deepseek-coder/, caps: { fim: true } },
  { family: 'minimax', pattern: /minimax/, caps: { json: true, tools: true, contextTokens: 196608 } },
  { family: 'glm', pattern: /glm/, caps: { json: true, tools: true, contextTokens: 131072 } },
  { family: 'glm5', pattern: /glm-?5/, caps: { contextTokens: 1048576 } },
  { family: 'gpt-oss', pattern: /gpt-oss/, caps: { json: true, tools: true, contextTokens: 131072 } },
  { family: 'phi4', pattern: /phi-?4/, caps: { json: true, contextTokens: 16384 } },
  { family: 'hermes', pattern: /hermes/, caps: { json: true, tools: true } },
  { family: 'nemotron', pattern: /nemotron/, caps: { json: true, tools: true, contextTokens: 131072 } },
  { family: 'starcoder', pattern: /starcoder|stable-?code/, caps: { fim: true } },
  // Name markers for multimodal builds, whatever the family.
  { family: 'vision', pattern: /(^|[^a-z])vl([^a-z]|$)|vision|llava|minicpm-v|moondream|omni|multimodal/, caps: { vision: true } },
  // Embedding models: not chat models at all.
  { family: 'embedding', pattern: /embed|(^|[/_-])(bge|gte|e5)-|minilm|mxbai|arctic-embed|snowflake/, caps: { ...NOT_A_CHAT_MODEL, embed: true, contextTokens: 8192 } },
  { family: 'bge', pattern: /(^|[/_-])bge-(small|base|large)/, caps: { contextTokens: 512 } },
  // Speech and rerankers.
  { family: 'speech', pattern: /whisper|parakeet|kokoro|(^|[/_-])tts([/_-]|$)|rerank/, caps: { ...NOT_A_CHAT_MODEL, embed: false } },
];

type CloudTable = Array<{ prefix: string; caps: Partial<AiModelCapabilities> }>;

const CLAUDE_BASE: Partial<AiModelCapabilities> = { chat: true, stream: true, vision: true, json: true, tools: true, fim: false, embed: false };

/** Anthropic models, matched by the longest prefix. Unknown `claude-*` ids get the generic row. */
export const ANTHROPIC_MODEL_TABLE: CloudTable = [
  { prefix: 'claude-', caps: { ...CLAUDE_BASE, contextTokens: 200000 } },
  { prefix: 'claude-3', caps: { contextTokens: 200000 } },
  { prefix: 'claude-haiku-4-5', caps: { contextTokens: 200000 } },
  { prefix: 'claude-opus-4-6', caps: { contextTokens: 1000000 } },
  { prefix: 'claude-opus-4-7', caps: { contextTokens: 1000000 } },
  { prefix: 'claude-opus-4-8', caps: { contextTokens: 1000000 } },
  { prefix: 'claude-sonnet-4-6', caps: { contextTokens: 1000000 } },
  { prefix: 'claude-opus-5', caps: { contextTokens: 1000000 } },
  { prefix: 'claude-sonnet-5', caps: { contextTokens: 1000000 } },
  { prefix: 'claude-haiku-5', caps: { contextTokens: 1000000 } },
  { prefix: 'claude-fable-5', caps: { contextTokens: 1000000 } },
  { prefix: 'claude-mythos-5', caps: { contextTokens: 1000000 } },
];

/** OpenAI models, matched by the longest prefix. */
export const OPENAI_MODEL_TABLE: CloudTable = [
  { prefix: 'gpt-', caps: { chat: true, stream: true, json: true, tools: true, vision: false, fim: false, embed: false, contextTokens: 128000 } },
  { prefix: 'gpt-3.5', caps: { contextTokens: 16385 } },
  { prefix: 'gpt-4o', caps: { vision: true, contextTokens: 128000 } },
  { prefix: 'gpt-4.1', caps: { vision: true, contextTokens: 1047576 } },
  { prefix: 'gpt-5', caps: { vision: true, contextTokens: 400000 } },
  { prefix: 'gpt-oss', caps: { contextTokens: 131072 } },
  { prefix: 'o1', caps: { chat: true, stream: true, json: true, tools: true, vision: true, contextTokens: 200000 } },
  { prefix: 'o3', caps: { chat: true, stream: true, json: true, tools: true, vision: true, contextTokens: 200000 } },
  { prefix: 'o4', caps: { chat: true, stream: true, json: true, tools: true, vision: true, contextTokens: 200000 } },
  { prefix: 'text-embedding-', caps: { ...NOT_A_CHAT_MODEL, embed: true, contextTokens: 8191 } },
  { prefix: 'whisper', caps: NOT_A_CHAT_MODEL },
  { prefix: 'tts-', caps: NOT_A_CHAT_MODEL },
  { prefix: 'gpt-4o-mini-tts', caps: NOT_A_CHAT_MODEL },
  { prefix: 'gpt-4o-transcribe', caps: NOT_A_CHAT_MODEL },
  { prefix: 'gpt-image', caps: NOT_A_CHAT_MODEL },
  { prefix: 'dall-e', caps: NOT_A_CHAT_MODEL },
  { prefix: 'omni-moderation', caps: NOT_A_CHAT_MODEL },
];

/** The o-series and GPT-5 onwards (`o3`, `o4-mini`, `gpt-5`, `gpt-5.5`, `gpt-6-mini`), not `gpt-4o` or `gpt-oss`. */
const OPENAI_REASONING_ID = /^(o\d+|gpt-([5-9]|\d{2,})(\.\d+)?)(-|$)/;

/**
 * OpenAI's reasoning models, which take only the default sampling: Chat
 * Completions rejects a `temperature` or `top_p` other than 1 for them. The
 * native `openai` kind matches on the id; any other kind only on an
 * `openai/` id (OpenRouter), so a local model that happens to be called
 * `o3-something` keeps its sampling. `-chat-latest` snapshots match too:
 * the default sampling costs nothing there.
 */
export function isOpenAiReasoningModel(modelId: string, kind?: AiEngineKind): boolean {
  const id = modelId.trim().toLowerCase();
  if (kind === 'openai') {return OPENAI_REASONING_ID.test(id.slice(id.lastIndexOf('/') + 1));}
  return id.startsWith('openai/') && OPENAI_REASONING_ID.test(id.slice('openai/'.length));
}

/** Every row whose prefix matches, shortest first, so longer prefixes override. */
function matchCloudTable(table: CloudTable, id: string): { caps: Partial<AiModelCapabilities>; prefix: string } | null {
  const rows = table.filter((r) => id.startsWith(r.prefix)).sort((a, b) => a.prefix.length - b.prefix.length);
  if (rows.length === 0) {return null;}
  return { caps: Object.assign({}, ...rows.map((r) => r.caps)) as Partial<AiModelCapabilities>, prefix: rows[rows.length - 1].prefix };
}

export interface DetectedCapabilities {
  capabilities: AiModelCapabilities;
  /** The family rule or table prefix that matched last, or null for the generic default. */
  family: string | null;
}

/**
 * Capabilities guessed from a model id. A `vscode-lm` model is a plain chat
 * model (the endpoint gives its context window). Anthropic and OpenAI engines use
 * their static tables; any engine whose id (after a `vendor/` prefix, as on
 * OpenRouter) starts with `claude-` or a known OpenAI line does too. An id
 * nothing matches is a plain chat model with `DEFAULT_CONTEXT_TOKENS`.
 */
export function detectCapabilities(modelId: string, kind?: AiEngineKind): DetectedCapabilities {
  // VS Code's language models (`vendor/family`): text chat, streamed. No JSON mode, images or tools through `vscode.lm` here.
  if (kind === 'vscode-lm') {return { capabilities: withDefaultContext({ ...BASE_CAPABILITIES }), family: 'vscode-lm' };}
  const id = modelId.trim().toLowerCase();
  const bare = id.slice(id.lastIndexOf('/') + 1);

  const cloudTable =
    kind === 'anthropic' || bare.startsWith('claude-')
      ? ANTHROPIC_MODEL_TABLE
      : kind === 'openai' || /^(gpt-[\d.]|o[134](-|$)|text-embedding-|whisper|tts-|dall-e|gpt-image|omni-moderation)/.test(bare)
        ? OPENAI_MODEL_TABLE
        : null;
  if (cloudTable) {
    const hit = matchCloudTable(cloudTable, bare);
    if (hit) {
      return { capabilities: withDefaultContext({ ...BASE_CAPABILITIES, ...hit.caps }), family: hit.prefix };
    }
  }

  let caps: AiModelCapabilities = { ...BASE_CAPABILITIES };
  let family: string | null = null;
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(id)) {
      caps = { ...caps, ...rule.caps };
      family = rule.family;
    }
  }
  return { capabilities: withDefaultContext(caps), family };
}

function withDefaultContext(caps: AiModelCapabilities): AiModelCapabilities {
  return caps.contextTokens === null ? { ...caps, contextTokens: DEFAULT_CONTEXT_TOKENS } : caps;
}

/** Endpoint values over heuristics: fields the endpoint left out (or null) come from the id. */
export function completeCapabilities(partial: Partial<AiModelCapabilities>, modelId: string, kind?: AiEngineKind): AiModelCapabilities {
  const out = { ...detectCapabilities(modelId, kind).capabilities };
  for (const [key, value] of Object.entries(partial) as Array<[keyof AiModelCapabilities, unknown]>) {
    if (key === 'contextTokens') {
      if (typeof value === 'number' && value > 0) {out.contextTokens = value;}
    } else if (typeof value === 'boolean' && key in out) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Merge one discovery into an engine's saved models, by id:
 *
 * - listed and saved: `endpoint`/`heuristic` rows get the fresh values, `user`
 *   rows keep theirs; `enabled`, `label` and `requestOverrides` are kept, and
 *   `missing` is cleared;
 * - saved but not listed: marked `missing: true` (greyed, not deleted), except
 *   manual entries, which are left alone;
 * - listed but new: appended in discovery order, enabled unless
 *   `opts.addEnabled` is false. Cloud engines pass false (OPEN-12): a
 *   300-model list must not flood the routing pickers, so the user picks.
 */
export function mergeDiscoveredModels(
  existing: readonly AiModelConfig[],
  discovered: readonly AiDiscoveredModel[],
  kind?: AiEngineKind,
  opts: { addEnabled?: boolean } = {},
): AiModelConfig[] {
  const addEnabled = opts.addEnabled ?? true;
  const found = new Map<string, AiDiscoveredModel>();
  for (const d of discovered) {
    if (!found.has(d.id)) {found.set(d.id, d);}
  }

  const merged = existing.map((model): AiModelConfig => {
    const d = found.get(model.id);
    if (!d) {
      return model.manual ? model : { ...model, missing: true };
    }
    const next: AiModelConfig = { ...model, label: model.label ?? d.label };
    delete next.missing;
    if (next.label === undefined) {delete next.label;}
    if (model.capabilitiesSource !== 'user') {
      next.capabilities = completeCapabilities(d.capabilities, d.id, kind);
      next.capabilitiesSource = d.source;
    }
    return next;
  });

  const known = new Set(existing.map((m) => m.id));
  for (const d of found.values()) {
    if (known.has(d.id)) {continue;}
    const added: AiModelConfig = {
      id: d.id,
      enabled: addEnabled,
      capabilities: completeCapabilities(d.capabilities, d.id, kind),
      capabilitiesSource: d.source,
    };
    if (d.label !== undefined) {added.label = d.label;}
    merged.push(added);
  }
  return merged;
}
