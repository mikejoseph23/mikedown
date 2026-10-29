// @vitest-environment node
/**
 * Lenient JSON for local models (`ai/json.ts`): every shared reply fixture in
 * `test/ai-fixtures/outputs/`, the cases around them, and the one-shot repair
 * turn that quotes the parse error back to the model.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSON_SHAPE_HINT, jsonRepairMessages, parseLenientJson } from '@mikedown/core/ai';

const OUTPUTS = join(__dirname, '..', '..', '..', 'test', 'ai-fixtures', 'outputs');
const files = readdirSync(OUTPUTS).filter((f) => f.endsWith('.json')).sort();

interface Fixture {
  description: string;
  raw: string;
  expected: { ok: boolean; value?: unknown };
}
const fixture = (file: string): Fixture => JSON.parse(readFileSync(join(OUTPUTS, file), 'utf8'));

describe('reply fixtures', () => {
  it('finds all nine', () => {
    expect(files).toHaveLength(9);
  });

  for (const file of files) {
    const fx = fixture(file);
    it(`${file}: ${fx.description}`, () => {
      const r = parseLenientJson(fx.raw);
      expect(r.ok).toBe(fx.expected.ok);
      if (r.ok) {
        expect(r.value).toEqual(fx.expected.value);
      } else {
        expect(r.error.length).toBeGreaterThan(0);
      }
    });
  }

  it('the failures say why, in words the repair turn can quote', () => {
    const truncated = parseLenientJson(fixture('truncated.json').raw);
    expect(truncated).toEqual({ ok: false, error: 'The JSON was cut off before it closed.' });
    const plain = parseLenientJson(fixture('plain-text.json').raw);
    expect(plain).toEqual({ ok: false, error: 'No JSON object found in the reply.' });
  });
});

describe('parseLenientJson', () => {
  it('takes a top-level array', () => {
    expect(parseLenientJson('["a", "b"]')).toEqual({ ok: true, value: ['a', 'b'] });
  });

  it('reads the first fenced block that holds JSON, whatever the fence is labelled', () => {
    expect(parseLenientJson('```\n{"a": 1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseLenientJson('```text\nnot json\n```\n```json\n{"a": 2}\n```')).toEqual({ ok: true, value: { a: 2 } });
  });

  it('an unclosed fence still yields the object inside it', () => {
    expect(parseLenientJson('```json\n{"a": 3}')).toEqual({ ok: true, value: { a: 3 } });
  });

  it('JSON that exists only inside a think block is not a reply', () => {
    expect(parseLenientJson('<think>{"titles": ["x"]}</think>').ok).toBe(false);
    expect(parseLenientJson('<THINK>{"a": 1}</THINK>{"a": 2}')).toEqual({ ok: true, value: { a: 2 } });
  });

  it('repairs the common slips together', () => {
    const r = parseLenientJson("{ titles: ['It\\'s fine', \"two\",], 'n': 3, }");
    expect(r).toEqual({ ok: true, value: { titles: ["It's fine", 'two'], n: 3 } });
  });

  it('a raw newline inside a string is kept as a newline', () => {
    expect(parseLenientJson('{"a": "line one\nline two"}')).toEqual({ ok: true, value: { a: 'line one\nline two' } });
  });

  it('nested objects and arrays come through whole', () => {
    const r = parseLenientJson('Result: {"a": {"b": [1, {"c": null}]}, "d": true} done');
    expect(r).toEqual({ ok: true, value: { a: { b: [1, { c: null }] }, d: true } });
  });

  it('a bracket pair that is not JSON reports the parse error when nothing else is', () => {
    const r = parseLenientJson('The tags are [alpha beta] only.');
    expect(r.ok).toBe(false);
    if (!r.ok) {expect(r.error.startsWith('Invalid JSON:')).toBe(true);}
  });

  it('non-string input is an empty reply, not a throw', () => {
    expect(parseLenientJson(undefined as unknown as string)).toEqual({ ok: false, error: 'The reply was empty.' });
    expect(parseLenientJson('   \n')).toEqual({ ok: false, error: 'The reply was empty.' });
  });
});

describe('jsonRepairMessages', () => {
  it('asks again with the earlier reply and the error quoted', () => {
    const error = 'The JSON was cut off before it closed.';
    const [assistant, user] = jsonRepairMessages(fixture('truncated.json').raw, error);
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe(fixture('truncated.json').raw);
    expect(user.role).toBe('user');
    expect(user.content).toContain(error);
    expect(user.content).toBe(`Your previous reply was not valid JSON (${error}). Reply with the JSON object only.`);
  });

  it('echoes the reply without its reasoning', () => {
    const [assistant] = jsonRepairMessages('<think>plan</think>Sure thing', 'No JSON object found in the reply.');
    expect(assistant.content).toBe('Sure thing');
  });

  it('caps a long earlier reply and stands in for an empty one', () => {
    const [long] = jsonRepairMessages('x'.repeat(10_000), 'e');
    expect(String(long.content)).toHaveLength(4000);
    const [empty] = jsonRepairMessages('<think>only thinking</think>', 'e');
    expect(empty.content).toBe('(empty reply)');
  });

  it('the error from a real failed parse is the one quoted', () => {
    const failed = parseLenientJson(fixture('plain-text.json').raw);
    if (failed.ok) {throw new Error('expected a failure');}
    const msgs = jsonRepairMessages(fixture('plain-text.json').raw, failed.error);
    expect(msgs[1].content).toContain('No JSON object found in the reply.');
  });
});

describe('JSON_SHAPE_HINT', () => {
  it('serialises an example value on one line and takes a string as written', () => {
    const hint = JSON_SHAPE_HINT({ titles: ['a', 'b'], n: 1 });
    expect(hint).toContain('{"titles":["a","b"],"n":1}');
    expect(hint.split('\n')).toHaveLength(1);
    expect(JSON_SHAPE_HINT('{"x": "y"}')).toContain('{"x": "y"}');
    expect(hint).toContain('no code fence');
  });
});
