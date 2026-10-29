/**
 * Per-model thinking level (Off / Low / Medium / High) mapped onto each
 * engine kind's request fields, stored in the model's `requestOverrides`
 * (OPEN-6) so the adapters need no change: they merge the overrides into
 * every request body last.
 *
 * Mappings:
 * - `openai` and cloud `openai-compatible` (Gemini, Groq, OpenRouter...):
 *   `reasoning_effort` `none` / `low` / `medium` / `high`.
 * - local `openai-compatible` (oMLX, vLLM, llama.cpp): tiers through
 *   `reasoning_effort`; Off through `chat_template_kwargs.enable_thinking:
 *   false`, which the chat template honours (oMLX ignores
 *   `reasoning_effort: "none"`).
 * - `lmstudio`: on/off only, `reasoning_effort` `none` or `medium`.
 * - `ollama`: `reasoning_effort` `none` / `low` / `medium` / `high` (its
 *   OpenAI-compatible endpoint maps it onto `think`).
 * - `anthropic`: adaptive thinking with `output_config.effort` `low` /
 *   `medium` / `high`. No Off: current models reject `thinking: disabled`
 *   (Opus 5.5, Sonnet 5.5, Fable), so Low is the lightest setting.
 *
 * "Model default" (no level) removes the kind's thinking fields and leaves
 * everything else in `requestOverrides` alone.
 */

export type AiThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface AiThinkingChoice {
  level: AiThinkingLevel;
  label: string;
}

export interface AiThinkingOptions {
  /** The engine's locality is local (changes the Off mapping for `openai-compatible`). */
  local?: boolean;
}

type Json = Record<string, unknown>;

const TIERS: readonly AiThinkingLevel[] = ['low', 'medium', 'high'];
const LABELS: Record<AiThinkingLevel, string> = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The levels a kind can express, in order. Empty means no known mapping: hide the control. */
export function thinkingChoices(kind: string): AiThinkingChoice[] {
  switch (kind) {
    case 'openai':
    case 'openai-compatible':
    case 'ollama':
      return (['off', ...TIERS] as AiThinkingLevel[]).map((level) => ({ level, label: LABELS[level] }));
    case 'lmstudio':
      return [{ level: 'off', label: 'Off' }, { level: 'medium', label: 'On' }];
    case 'anthropic':
      return TIERS.map((level) => ({ level, label: LABELS[level] }));
    default:
      return [];
  }
}

/** The request fields for one level, or `{}` when the kind cannot express it. */
export function thinkingOverrides(kind: string, level: AiThinkingLevel, opts: AiThinkingOptions = {}): Json {
  if (!thinkingChoices(kind).some((c) => c.level === level)) {return {};}
  switch (kind) {
    case 'anthropic':
      return { thinking: { type: 'adaptive' }, output_config: { effort: level } };
    case 'openai-compatible':
      if (level === 'off' && opts.local) {return { chat_template_kwargs: { enable_thinking: false } };}
      return { reasoning_effort: level === 'off' ? 'none' : level };
    default:
      return { reasoning_effort: level === 'off' ? 'none' : level };
  }
}

/** The level `overrides` express for this kind, or null for "model default" (or a value the menu has no entry for). */
export function thinkingLevelFrom(kind: string, overrides: Json | undefined): AiThinkingLevel | null {
  if (!overrides || thinkingChoices(kind).length === 0) {return null;}
  if (kind === 'anthropic') {
    const effort = isObject(overrides.output_config) ? overrides.output_config.effort : undefined;
    return typeof effort === 'string' && (TIERS as readonly string[]).includes(effort) ? (effort as AiThinkingLevel) : null;
  }
  const kwargs = isObject(overrides.chat_template_kwargs) ? overrides.chat_template_kwargs : undefined;
  if (kwargs?.enable_thinking === false) {return 'off';}
  const effort = overrides.reasoning_effort;
  if (effort === 'none') {return 'off';}
  if (typeof effort !== 'string' || !(TIERS as readonly string[]).includes(effort)) {return null;}
  // LM Studio is on/off: any tier reads as On.
  return kind === 'lmstudio' ? 'medium' : (effort as AiThinkingLevel);
}

/** `overrides` without this kind's thinking fields; empty containers are dropped. */
function stripThinking(kind: string, overrides: Json): Json {
  const out: Json = { ...overrides };
  const dropNested = (key: string, inner: string) => {
    const current = out[key];
    if (!isObject(current)) {return;}
    const rest = { ...current };
    delete rest[inner];
    if (Object.keys(rest).length === 0) {delete out[key];} else {out[key] = rest;}
  };
  if (kind === 'anthropic') {
    delete out.thinking;
    dropNested('output_config', 'effort');
  } else {
    delete out.reasoning_effort;
    dropNested('chat_template_kwargs', 'enable_thinking');
  }
  return out;
}

function deepMerge(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : value;
  }
  return out;
}

/**
 * `requestOverrides` with the thinking level set (null: model default).
 * Other keys, nested ones included, are kept. Undefined when nothing is left.
 */
export function withThinkingLevel(
  kind: string,
  overrides: Json | undefined,
  level: AiThinkingLevel | null,
  opts: AiThinkingOptions = {},
): Json | undefined {
  const base = stripThinking(kind, overrides ?? {});
  const next = level ? deepMerge(base, thinkingOverrides(kind, level, opts)) : base;
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Output tokens a thinking model may spend reasoning before it answers, by
 * level. A thinking model counts its reasoning against `max_tokens`, so an
 * answer budget alone can be used up before the first visible word.
 */
export const THINKING_HEADROOM_TOKENS: Readonly<Record<AiThinkingLevel, number>> = { off: 0, low: 1024, medium: 2048, high: 4096 };

/** "Model default" (no level set): the model may think, at a level we cannot see. */
export const THINKING_DEFAULT_HEADROOM_TOKENS = THINKING_HEADROOM_TOKENS.medium;

/** The most `thinkingMaxTokens` raises a request to (a larger answer budget is kept as is). */
export const THINKING_MAX_TOKENS_CAP = 8192;

export interface ThinkingBudgetOptions {
  /** The model's context window, when known. */
  contextTokens?: number | null;
  /** Estimated prompt tokens; with `contextTokens`, the headroom never pushes past the window. */
  promptTokens?: number;
}

/**
 * The `max_tokens` to send for an answer budget of `answerTokens` on a model
 * that can think: the answer plus reasoning headroom for the effective level
 * (null: model default, counted as thinking). Off adds nothing. The raise is
 * capped at `THINKING_MAX_TOKENS_CAP` and at what is left of the context
 * window, and never goes below the answer budget.
 */
export function thinkingMaxTokens(answerTokens: number, level: AiThinkingLevel | null, opts: ThinkingBudgetOptions = {}): number {
  const headroom = level ? THINKING_HEADROOM_TOKENS[level] : THINKING_DEFAULT_HEADROOM_TOKENS;
  if (headroom <= 0) {return answerTokens;}
  let limit = THINKING_MAX_TOKENS_CAP;
  if (opts.contextTokens && opts.contextTokens > 0) {
    limit = Math.min(limit, opts.contextTokens - Math.ceil(opts.promptTokens ?? 0) - 256);
  }
  return Math.max(answerTokens, Math.min(answerTokens + headroom, limit));
}
