/**
 * Edge case 11 end to end on the TypeScript side: CRLF, BOM and non-UTF-8
 * fixtures (test/fixtures/encoding/) open through the document controller
 * into a real core editor (jsdom), save, and the `write_text` arguments are
 * checked against the file's bytes.
 *
 * `expected.json` is the `read_text` response for each fixture; the Rust test
 * `shared_fixtures_decode_to_expected_json_and_round_trip` in
 * src-tauri/src/commands/fs.rs proves `decode` produces it from the bytes.
 * `encodeLikeRust` mirrors `fs.rs#encode` (normalise to LF, apply the EOL,
 * prepend the BOM) so the test can compare bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMikeDownEditor, type MikeDownEditorHandle } from '@mikedown/core';
import { stubLayoutMeasurement } from '../../../../test/harness/webviewHarness';
import type { Encoding, Eol, ReadInfo } from '../../src/documents/documentModel';
import { createTestApp, flush, type TestApp } from './helpers/app';
import { buttonLabel, installIpc, uninstallIpc, type IpcCall } from './helpers/ipc';

stubLayoutMeasurement();

const FIXTURES = join(__dirname, '..', 'fixtures', 'encoding');
const EXPECTED = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as Record<
  string,
  { text: string; encoding: Encoding; eol: Eol }
>;
const DIR = '/Users/mike/enc';
const BOM = [0xef, 0xbb, 0xbf];

function encodeLikeRust(text: string, eol: Eol, bom: boolean): Uint8Array {
  const lf = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const body = new TextEncoder().encode(eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf);
  return bom ? new Uint8Array([...BOM, ...body]) : body;
}

interface WriteCall {
  path: string;
  text: string;
  options: { eol: Eol; bom: boolean };
}

let calls: IpcCall[];
let message: 'ok' | 'cancel';
let saveAnswer: string | null;
let app: TestApp;
let container: HTMLElement;

function handler(cmd: string, args: any): unknown {
  switch (cmd) {
    case 'read_text': {
      const name = String(args.path).slice(DIR.length + 1);
      const want = EXPECTED[name];
      const bytes = readFileSync(join(FIXTURES, name));
      const info: ReadInfo = { ...want, mtimeMs: 1, readOnly: false, size: bytes.length };
      return info;
    }
    case 'write_text':
      return { mtimeMs: 2, size: 0 };
    case 'plugin:dialog|message':
      return buttonLabel(args, message);
    case 'plugin:dialog|save':
      return saveAnswer;
    default:
      return null;
  }
}

function writes(): WriteCall[] {
  return calls.filter((c) => c.cmd === 'write_text').map((c) => c.args as WriteCall);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  message = 'ok';
  saveAnswer = null;
  calls = installIpc(handler);
  container = document.createElement('div');
  document.body.appendChild(container);
  app = createTestApp(
    (host) =>
      createMikeDownEditor(container, {
        host,
        initialMarkdown: '',
        theme: 'light',
        features: { sidebar: false, supportCard: false, sourceMode: true },
        hostOwnsShortcuts: true,
      }),
    { editorRoot: container },
  );
});

afterEach(() => {
  try { (app.handle as MikeDownEditorHandle).destroy(); } catch { /* already gone */ }
  container.remove();
  uninstallIpc();
  vi.restoreAllMocks();
});

const UTF8_FIXTURES = ['lf.md', 'crlf.md', 'bom-lf.md', 'bom-crlf.md'];

describe('encoding round-trip through the model', () => {
  it.each(UTF8_FIXTURES)('%s: unchanged save hands write_text the exact original bytes', async (name) => {
    const original = new Uint8Array(readFileSync(join(FIXTURES, name)));
    expect(await app.controller.openPath(`${DIR}/${name}`)).toBe(true);
    expect(app.model.dirty).toBe(false);
    expect(app.model.readOnly).toBe(false);
    expect(app.model.eol).toBe(EXPECTED[name].eol);
    expect(app.model.bom).toBe(EXPECTED[name].encoding === 'utf8-bom');
    expect(await app.controller.save()).toBe(true);
    const [w] = writes();
    expect(w.path).toBe(`${DIR}/${name}`);
    expect(w.options).toEqual({ eol: EXPECTED[name].eol, bom: EXPECTED[name].encoding === 'utf8-bom' });
    expect(w.text).toBe(EXPECTED[name].text);
    expect(Array.from(encodeLikeRust(w.text, w.options.eol, w.options.bom))).toEqual(Array.from(original));
  });

  it.each(UTF8_FIXTURES)('%s: an edit keeps the line ending and BOM, and never sends \\r', async (name) => {
    await app.controller.openPath(`${DIR}/${name}`);
    app.handle.setMarkdown(app.handle.getMarkdown() + '\nAdded line.\n', { pristine: false });
    await flush();
    expect(app.model.dirty).toBe(true);
    expect(await app.controller.save()).toBe(true);
    const [w] = writes();
    expect(w.text).not.toContain('\r');
    expect(w.text).toContain('Added line.');
    const bytes = encodeLikeRust(w.text, w.options.eol, w.options.bom);
    const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    expect(hasBom).toBe(EXPECTED[name].encoding === 'utf8-bom');
    const asText = new TextDecoder().decode(bytes);
    const crlf = (asText.match(/\r\n/g) ?? []).length;
    const lf = (asText.match(/\n/g) ?? []).length;
    if (EXPECTED[name].eol === 'crlf') {expect(crlf).toBe(lf);}
    else {expect(crlf).toBe(0);}
    expect(app.model.dirty).toBe(false);
  });

  it('a non-UTF-8 file opens read-only in source mode and is never written in place', async () => {
    const name = 'latin1-crlf.md';
    expect(await app.controller.openPath(`${DIR}/${name}`)).toBe(true);
    expect(app.model.encoding).toBe('unknown');
    expect(app.model.readOnly).toBe(true);
    expect(app.controller.isSourceMode()).toBe(true);
    expect(app.notices.at(-1)).toMatch(/not UTF-8/);

    // Cmd+S → "cannot be saved in place" → Cancel: nothing written.
    message = 'cancel';
    expect(await app.controller.save()).toBe(false);
    expect(writes()).toEqual([]);

    // Cmd+S → Save As… → a new path: a UTF-8 copy, original EOL, no BOM.
    message = 'ok';
    saveAnswer = `${DIR}/latin1-copy.md`;
    expect(await app.controller.save()).toBe(true);
    const ws = writes();
    expect(ws).toHaveLength(1);
    expect(ws[0].path).toBe(`${DIR}/latin1-copy.md`);
    expect(ws[0].options).toEqual({ eol: 'crlf', bom: false });
    expect(ws[0].text).toBe(EXPECTED[name].text);
    expect(calls.some((c) => c.cmd === 'write_text' && (c.args as WriteCall).path === `${DIR}/${name}`)).toBe(false);
    const prompt = calls.find((c) => c.cmd === 'plugin:dialog|message');
    expect((prompt?.args as { message: string }).message).toMatch(/cannot be saved in place[\s\S]*not UTF-8/);

    // The copy is an ordinary UTF-8 document from here on.
    expect(app.model.path).toBe(`${DIR}/latin1-copy.md`);
    expect(app.model.encoding).toBe('utf8');
    expect(app.model.readOnly).toBe(false);
    expect(app.notices.at(-1)).toBeNull();
    // Core restores the CodeMirror scroll position 10 ms after a source
    // toggle; let that timer run before afterEach destroys the editor.
    await new Promise((r) => setTimeout(r, 20));
  });
});
