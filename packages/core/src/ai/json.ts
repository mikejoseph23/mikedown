/**
 * Lenient JSON for local models (D6). Many local models have no JSON mode, so
 * a reply can arrive as clean JSON, inside a code fence, after a sentence of
 * prose, behind a `<think>` block, with a trailing comma or with single
 * quotes. `parseLenientJson` takes all of those; plain text is `ok: false`
 * with a message the repair turn can quote. Pure, no DOM.
 */

import type { AiMessage } from './types';

export type LenientJsonResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

/** `<think>…</think>` blocks removed, and an unclosed `<think>` dropped to the end. */
function stripReasoning(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = text.search(/<think>/i);
  if (open >= 0) {text = text.slice(0, open);}
  return text.trim();
}

/** The bodies of fenced code blocks, in order. An unclosed fence runs to the end. */
function fencedBodies(text: string): string[] {
  const out: string[] = [];
  const re = /```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)(?:\r?\n```|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
    if (m[0].length === 0) {re.lastIndex++;}
  }
  return out;
}

/**
 * The balanced `{…}` or `[…]` starting at `start`, aware of strings (double or
 * single quoted). `end` is the index after the closer; null when it never
 * closes (a truncated reply).
 */
function balancedSpan(text: string, start: number): { end: number } | null {
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') {i++;}
      else if (c === quote) {quote = null;}
      continue;
    }
    if (c === '"' || c === "'") {quote = c;}
    else if (c === '{') {stack.push('}');}
    else if (c === '[') {stack.push(']');}
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) {return null;}
      if (stack.length === 0) {return { end: i + 1 };}
    }
  }
  return null;
}

/**
 * The usual slips: single-quoted strings, trailing commas, unquoted keys and
 * raw newlines inside strings. One pass over the text, string aware.
 */
function repairJson(src: string): string {
  let out = '';
  let i = 0;
  // The last significant character written outside a string, for key detection.
  let prev = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c;
      let body = '';
      i++;
      while (i < src.length && src[i] !== q) {
        const ch = src[i];
        if (ch === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          // `\'` is not a JSON escape.
          body += next === "'" ? "'" : ch + next;
          i += 2;
          continue;
        }
        if (ch === '\n') {body += '\\n';}
        else if (ch === '\r') {body += '\\r';}
        else if (ch === '\t') {body += '\\t';}
        else if (ch === '"') {body += '\\"';}
        else {body += ch;}
        i++;
      }
      i++; // closing quote
      out += `"${body}"`;
      prev = '"';
      continue;
    }
    if (c === ',') {
      // Trailing comma: the next significant character closes the container.
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) {j++;}
      if (src[j] === '}' || src[j] === ']') {i++; continue;}
    }
    if ((prev === '{' || prev === ',') && /[A-Za-z_$]/.test(c)) {
      const m = /^([A-Za-z_$][\w$-]*)(\s*):/.exec(src.slice(i));
      if (m) {
        out += `"${m[1]}"${m[2]}:`;
        i += m[0].length;
        prev = ':';
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) {prev = c;}
    i++;
  }
  return out;
}

function tryParse(text: string): LenientJsonResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const MAX_STARTS = 24;

/**
 * Strip `<think>`, look inside code fences, take the first balanced `{…}` or
 * `[…]` that parses (after one repair pass for the common slips) and return
 * it. A reply with no JSON, or one cut off before it closed, is `ok: false`.
 * `T` is only the caller's claim about the shape; validate before trusting it.
 */
export function parseLenientJson<T = unknown>(raw: string): LenientJsonResult<T> {
  const text = stripReasoning(typeof raw === 'string' ? raw : '');
  if (!text) {return { ok: false, error: 'The reply was empty.' };}
  let firstError = '';
  let sawStart = false;
  let truncated = false;
  for (const source of [...fencedBodies(text), text]) {
    let from = 0;
    let attempts = 0;
    while (attempts < MAX_STARTS) {
      const rel = source.slice(from).search(/[{[]/);
      if (rel < 0) {break;}
      const start = from + rel;
      sawStart = true;
      attempts++;
      const span = balancedSpan(source, start);
      if (!span) {
        truncated = true;
        break;
      }
      const slice = source.slice(start, span.end);
      const direct = tryParse(slice);
      if (direct.ok) {return direct as LenientJsonResult<T>;}
      const fixed = tryParse(repairJson(slice));
      if (fixed.ok) {return fixed as LenientJsonResult<T>;}
      if (!firstError && !direct.ok) {firstError = direct.error;}
      from = span.end;
    }
  }
  if (!sawStart) {return { ok: false, error: 'No JSON object found in the reply.' };}
  if (firstError) {return { ok: false, error: `Invalid JSON: ${firstError}` };}
  return { ok: false, error: truncated ? 'The JSON was cut off before it closed.' : 'No JSON object found in the reply.' };
}

/** Longest earlier reply quoted back in the repair turn, in characters. */
const REPAIR_ECHO_CHARS = 4000;

/**
 * The one-shot repair turn: append these two messages to the original ones
 * and ask again. The failed reply goes back as the assistant turn (reasoning
 * removed, capped), then the parse error.
 */
export function jsonRepairMessages(previousRaw: string, error: string): AiMessage[] {
  const previous = stripReasoning(previousRaw).slice(0, REPAIR_ECHO_CHARS);
  return [
    { role: 'assistant', content: previous || '(empty reply)' },
    { role: 'user', content: `Your previous reply was not valid JSON (${error}). Reply with the JSON object only.` },
  ];
}

/**
 * The prompt line that fixes the reply shape: a one-line example object.
 * Pass the example as a value (serialised on one line) or as a string.
 */
export function JSON_SHAPE_HINT(example: unknown): string {
  const shape = typeof example === 'string' ? example : JSON.stringify(example);
  return `Reply with a JSON object only, in exactly this shape and with no other text, no code fence and no comments: ${shape}`;
}
