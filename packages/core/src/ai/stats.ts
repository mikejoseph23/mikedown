/**
 * How long a result took and how fast it came: the popover footer's
 * "2.4 s · 38 tok/s", its tooltip, and the hosts' request log. Hosts measure
 * (`AiCompletionResult.timing`); this only does the arithmetic and the words.
 *
 * Output tokens are the engine's own count when it reports one (OpenAI-style
 * `usage` with `stream_options.include_usage`, Anthropic `message_delta`),
 * else about one token per four characters of output, marked approximate
 * ("~38 tok/s"). Speed is output tokens over the time from the first token to
 * the end; without a first-token time, over the whole request.
 *
 * Desktop's `request_log.rs` ports `aiTimingLogParts`; keep them in step.
 */

import type { AiCompletionResult } from './types';

/** Characters per token for the estimate when the engine reports no usage. */
export const AI_CHARS_PER_TOKEN = 4;

export interface AiResultStats {
  totalMs: number;
  firstTokenMs?: number;
  outputTokens?: number;
  inputTokens?: number;
  /** `outputTokens` (and so the speed) is estimated from the characters. */
  approximate: boolean;
  tokensPerSecond?: number;
}

function positive(n: number | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The numbers behind the footer, or null when the host measured nothing (an older host). */
export function aiResultStats(result: Pick<AiCompletionResult, 'text' | 'usage' | 'timing'>): AiResultStats | null {
  const t = result.timing;
  if (!t || typeof t.totalMs !== 'number' || !Number.isFinite(t.totalMs) || t.totalMs < 0) {return null;}
  const stats: AiResultStats = { totalMs: t.totalMs, approximate: false };
  if (typeof t.firstTokenMs === 'number' && Number.isFinite(t.firstTokenMs) && t.firstTokenMs >= 0) {stats.firstTokenMs = t.firstTokenMs;}
  // A zero count next to real text is a server that fills usage with zeros: estimate instead.
  const reported = positive(result.usage?.completionTokens);
  if (reported !== undefined) {
    stats.outputTokens = reported;
  } else {
    const chars = t.outputChars ?? result.text.length;
    if (chars > 0) {
      stats.outputTokens = Math.max(1, Math.round(chars / AI_CHARS_PER_TOKEN));
      stats.approximate = true;
    }
  }
  const input = positive(result.usage?.promptTokens);
  if (input !== undefined) {stats.inputTokens = input;}
  const first = stats.firstTokenMs;
  const generationMs = first !== undefined && t.totalMs > first ? t.totalMs - first : t.totalMs;
  if (stats.outputTokens !== undefined && generationMs > 0) {stats.tokensPerSecond = stats.outputTokens / (generationMs / 1000);}
  return stats;
}

/** "0.8 s", "2.4 s", "12 s". */
export function formatAiSeconds(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

/** "38 tok/s", "~38 tok/s", "4.5 tok/s". */
export function formatAiTokensPerSecond(tps: number, approximate: boolean): string {
  const n = tps < 10 ? tps.toFixed(1) : String(Math.round(tps));
  return `${approximate ? '~' : ''}${n} tok/s`;
}

/** The footer text: "2.4 s · 38 tok/s", or just "2.4 s" with no speed. */
export function aiResultStatsText(stats: AiResultStats): string {
  const time = formatAiSeconds(stats.totalMs);
  return stats.tokensPerSecond === undefined ? time : `${time} · ${formatAiTokensPerSecond(stats.tokensPerSecond, stats.approximate)}`;
}

/** The footer tooltip, one fact per line. */
export function aiResultStatsTitle(stats: AiResultStats): string {
  const lines: string[] = [];
  if (stats.firstTokenMs !== undefined) {lines.push(`First token after ${formatAiSeconds(stats.firstTokenMs)}`);}
  lines.push(`Total ${formatAiSeconds(stats.totalMs)}`);
  if (stats.outputTokens !== undefined) {
    lines.push(stats.approximate ? `About ${stats.outputTokens.toLocaleString('en-US')} output tokens (estimated from the text)` : `${stats.outputTokens.toLocaleString('en-US')} output tokens`);
  }
  if (stats.inputTokens !== undefined) {lines.push(`${stats.inputTokens.toLocaleString('en-US')} input tokens`);}
  if (stats.tokensPerSecond !== undefined) {lines.push(formatAiTokensPerSecond(stats.tokensPerSecond, stats.approximate));}
  return lines.join('\n');
}

/** The request log's additions: `first token N ms` and the speed, when measured. */
export function aiTimingLogParts(result: Pick<AiCompletionResult, 'text' | 'usage' | 'timing'>): string[] {
  const stats = aiResultStats(result);
  if (!stats) {return [];}
  const parts: string[] = [];
  if (stats.firstTokenMs !== undefined) {parts.push(`first token ${Math.round(stats.firstTokenMs)} ms`);}
  if (stats.tokensPerSecond !== undefined) {parts.push(formatAiTokensPerSecond(stats.tokensPerSecond, stats.approximate));}
  return parts;
}
