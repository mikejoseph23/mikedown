// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  AI_FEATURES,
  AI_SETTINGS_KEYS,
  AI_TASKS,
  SUMMARIZE_MIN_CONTEXT_TOKENS,
  checkDocRoot,
  defaultAiSettings,
  docRootKey,
  getAiFeature,
  getAiTask,
  missingCapabilities,
  normalizeDocHomeFile,
  parseAiSettings,
  resolveDocsSettings,
  serializeAiSettings,
  taskThinkingDefault,
} from '@mikedown/core/ai';

const parse = (raw: unknown, warn: (m: string) => void = () => {}) => parseAiSettings(raw, { onWarning: warn, generateId: (name) => `id-${name.toLowerCase().replace(/\W+/g, '-')}` });
const bases = (docBases: unknown, warn?: (m: string) => void) => parse({ docBases }, warn).docBases;

describe('checkDocRoot', () => {
  it('accepts absolute POSIX, drive and UNC folders and normalizes them', () => {
    expect(checkDocRoot('/Users/mike/docs')).toEqual({ ok: true, path: '/Users/mike/docs', windows: false });
    expect(checkDocRoot('  /a//b/./c/../d/  ')).toMatchObject({ ok: true, path: '/a/b/d' });
    expect(checkDocRoot('c:/Users/Mike/Docs/')).toMatchObject({ ok: true, path: 'C:\\Users\\Mike\\Docs', windows: true });
    expect(checkDocRoot('D:\\a\\\\b\\..\\c')).toMatchObject({ ok: true, path: 'D:\\a\\c' });
    expect(checkDocRoot('\\\\nas\\share\\team docs')).toMatchObject({ ok: true, path: '\\\\nas\\share\\team docs', windows: true });
    expect(checkDocRoot('\\\\nas\\share')).toMatchObject({ ok: true, path: '\\\\nas\\share' });
  });

  it.each([
    ['relative', 'docs/handbook', /absolute/],
    ['home shorthand', '~/docs', /absolute/],
    ['drive without a slash', 'C:docs', /absolute/],
    ['variable token', '${workspaceFolder}/docs', /\$\{/],
    ['token in the middle', '/home/${USER}/docs', /\$\{/],
    ['empty', '   ', /empty/],
    ['non-string', 42, /not a path/],
    ['POSIX root', '/', /root/],
    ['dotdot past the top', '/..', /root/],
    ['drive root', 'C:\\', /root/],
    ['a markdown file', '/Users/mike/notes/README.md', /file/],
    ['a markdown file, any case', '/Users/mike/notes/Guide.MARKDOWN', /file/],
    ['a control character', '/a/b\u0000c', /control/],
  ])('refuses %s', (_name, input, reason) => {
    const r = checkDocRoot(input);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(reason);
  });

  it('keys Windows paths case-insensitively and POSIX paths exactly', () => {
    expect(docRootKey('C:\\Docs')).toBe(docRootKey('c:\\docs'));
    expect(docRootKey('\\\\NAS\\Share')).toBe(docRootKey('\\\\nas\\share'));
    expect(docRootKey('/Docs')).not.toBe(docRootKey('/docs'));
  });
});

describe('normalizeDocHomeFile', () => {
  it('accepts a markdown file name or a relative path under the root', () => {
    expect(normalizeDocHomeFile('HOME.md')).toBe('HOME.md');
    expect(normalizeDocHomeFile(' ./guide\\start.markdown ')).toBe('guide/start.markdown');
  });
  it.each(['/etc/HOME.md', 'C:\\HOME.md', '../HOME.md', 'a/../../HOME.md', '${home}.md', 'HOME.txt', 'docs', '', 7])('refuses %j', (v) => {
    expect(normalizeDocHomeFile(v)).toBeNull();
  });
});

describe('docBases', () => {
  const good = { id: 'b1', name: 'Handbook', roots: ['/docs/handbook'] };

  it('defaults allowCloud to false, enabled to true, and keeps what is valid', () => {
    expect(bases([{ ...good, homeFile: 'HOME.md' }])).toEqual([{ ...good, homeFile: 'HOME.md', allowCloud: false, enabled: true }]);
    expect(bases([{ ...good, allowCloud: 'yes', enabled: 0 }])[0]).toMatchObject({ allowCloud: false, enabled: true });
    expect(bases([{ ...good, allowCloud: true, enabled: false }])[0]).toMatchObject({ allowCloud: true, enabled: false });
  });

  it('generates a missing or repeated id and a missing name, and says so for the repeat', () => {
    const warn = vi.fn();
    const out = bases([{ roots: ['/a/notes'] }, { ...good, id: 'x' }, { ...good, id: 'x', roots: ['/b'] }], warn);
    expect(out.map((b) => b.id)).toEqual(['id-notes', 'x', 'id-handbook']);
    expect(out[0].name).toBe('notes');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/repeats id "x"/));
  });

  it('drops a base that is not an object, has no roots, or has no valid roots, each with a reason', () => {
    const warn = vi.fn();
    const out = bases(['nope', { name: 'No roots' }, { roots: [] }, { roots: ['relative'] }, { roots: ['/ok/one'] }], warn);
    expect(out).toHaveLength(1);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => /docBases\[0\] is not an object/.test(m))).toBe(true);
    expect(messages.some((m) => /docBases\[1\] has no roots/.test(m))).toBe(true);
    expect(messages.some((m) => /docBases\[2\] has no roots/.test(m))).toBe(true);
    expect(messages.some((m) => /docBases\[3\]\.roots\[0\] is not an absolute path/.test(m))).toBe(true);
    expect(messages.some((m) => /docBases\[3\] has no valid roots left/.test(m))).toBe(true);
  });

  it('drops only the bad root when a base has a good one, and normalizes the good one', () => {
    const warn = vi.fn();
    const out = bases([{ ...good, roots: ['/ok/./x/', '${ws}/y', '/ok/notes/README.md'] }], warn);
    expect(out[0].roots).toEqual(['/ok/x']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('drops a duplicate root inside a base and across bases, first wins', () => {
    const warn = vi.fn();
    const out = bases([{ ...good, roots: ['/d/a', '/d//a/', '/d/b'] }, { id: 'b2', name: 'Other', roots: ['/d/a/../b'] }, { id: 'b3', name: 'Third', roots: ['/d/c'] }], warn);
    expect(out.map((b) => [b.id, b.roots])).toEqual([['b1', ['/d/a', '/d/b']], ['b3', ['/d/c']]]);
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => /repeats the folder/.test(m))).toHaveLength(2);
  });

  it('compares Windows roots case-insensitively and POSIX roots exactly', () => {
    expect(bases([{ ...good, roots: ['C:\\Docs', 'c:/docs'] }])[0].roots).toEqual(['C:\\Docs']);
    expect(bases([{ ...good, roots: ['/Docs', '/docs'] }])[0].roots).toEqual(['/Docs', '/docs']);
  });

  it('ignores a bad homeFile but keeps the base', () => {
    const warn = vi.fn();
    const out = bases([{ ...good, homeFile: '../../etc/passwd.md' }], warn);
    expect(out[0]).not.toHaveProperty('homeFile');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/homeFile/));
  });

  it('keeps unknown keys, and a non-array value is ignored with a warning', () => {
    expect(bases([{ ...good, futureKey: { a: 1 } }])[0]).toMatchObject({ futureKey: { a: 1 } });
    const warn = vi.fn();
    expect(bases({ nope: true }, warn)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('accepts the flat Desktop store', () => {
    expect(parse({ 'ai.docBases': [good], 'ai.docs': { maxHops: 4 } }).docBases[0].id).toBe('b1');
    expect(parse({ 'ai.docs': { maxHops: 4 } }).docs.maxHops).toBe(4);
  });
});

describe('docs options', () => {
  const docs = (raw: unknown, warn?: (m: string) => void) => parse({ docs: raw }, warn).docs;

  it('defaults to 3 hops, a 60 percent share and section navigation', () => {
    expect(docs(undefined)).toEqual({ maxHops: 3, sourceShare: 60, navigateBy: 'section' });
    expect(defaultAiSettings().docs).toEqual({ maxHops: 3, sourceShare: 60, navigateBy: 'section' });
  });

  it('clamps hops to 1 to 5 and the share to 30 to 80, rounding', () => {
    expect(docs({ maxHops: 0 }).maxHops).toBe(1);
    expect(docs({ maxHops: 99 }).maxHops).toBe(5);
    expect(docs({ maxHops: 2.6 }).maxHops).toBe(3);
    expect(docs({ sourceShare: 5 }).sourceShare).toBe(30);
    expect(docs({ sourceShare: 100 }).sourceShare).toBe(80);
    expect(docs({ sourceShare: 45 }).sourceShare).toBe(45);
  });

  it('falls back to the default with a warning for a value of the wrong type', () => {
    const warn = vi.fn();
    expect(docs({ maxHops: 'many', sourceShare: NaN, navigateBy: 'chapter' }, warn)).toEqual({ maxHops: 3, sourceShare: 60, navigateBy: 'section' });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(docs({ navigateBy: 'page' }).navigateBy).toBe('page');
    expect(docs('x', warn)).toEqual({ maxHops: 3, sourceShare: 60, navigateBy: 'section' });
  });

  it('keeps unknown keys and resolves with the bases', () => {
    expect(docs({ maxHops: 2, later: true })).toMatchObject({ maxHops: 2, later: true });
    const s = parse({ docBases: [{ id: 'b', name: 'B', roots: ['/b'] }], docs: { maxHops: 2 } });
    expect(resolveDocsSettings(s)).toMatchObject({ maxHops: 2, bases: [{ id: 'b' }] });
  });
});

describe('docs settings keys and round trip', () => {
  it('lists docBases and docs among the keys, so a save carries them', () => {
    expect(AI_SETTINGS_KEYS).toEqual(expect.arrayContaining(['docBases', 'docs']));
    const patch = serializeAiSettings(defaultAiSettings());
    expect(patch['ai.docBases']).toEqual([]);
    expect(patch['ai.docs']).toEqual({ maxHops: 3, sourceShare: 60, navigateBy: 'section' });
  });

  it('round-trips bases and options unchanged', () => {
    const first = parse({
      docBases: [{ id: 'b', name: 'B', roots: ['/b/one', 'C:\\two'], homeFile: 'HOME.md', allowCloud: true, enabled: false }],
      docs: { maxHops: 5, sourceShare: 75, navigateBy: 'page' },
    });
    expect(parse(serializeAiSettings(first))).toEqual(first);
  });
});

describe('the docs task and the chat feature', () => {
  it('adds a docs task that needs chat and prefers JSON and a large context', () => {
    const task = getAiTask('docs')!;
    expect(AI_TASKS.map((t) => t.id)).toContain('docs');
    expect(task.requires).toEqual({ chat: true });
    expect(task.prefers).toEqual({ json: true, contextTokens: SUMMARIZE_MIN_CONTEXT_TOKENS });
    const caps = { chat: true, stream: false, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 4096 };
    expect(missingCapabilities(caps, task.requires)).toEqual([]);
  });

  it('turns the navigate hops Off by default and leaves the answer to the model', () => {
    expect(taskThinkingDefault('navigate')).toBe('off');
    expect(taskThinkingDefault('answer')).toBeNull();
  });

  it('makes chat an available feature labelled Chat that names bases and sends the document', () => {
    const chat = getAiFeature('chat')!;
    expect(chat).toMatchObject({ label: 'Chat', status: 'available', sends: 'document', defaultTask: 'chat', id: 'chat' });
    expect(chat.description).toMatch(/documentation bases/);
    expect(AI_FEATURES.filter((f) => f.status === 'planned').map((f) => f.id)).not.toContain('chat');
  });
});
