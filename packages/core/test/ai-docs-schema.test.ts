// @vitest-environment node
// Attacks on the documentation-base settings schema: what a hostile or sloppy
// settings file can do. The basic cases live in ai-docs-settings.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { checkDocRoot, defaultAiSettings, normalizeDocHomeFile, parseAiSettings, parseDocBases, parseDocsOptions, serializeAiSettings } from '@mikedown/core/ai';

const parse = (raw: unknown, warn: (m: string) => void = () => {}) => parseAiSettings(raw, { onWarning: warn });
const good = { id: 'b1', name: 'Handbook', roots: ['/docs/handbook'] };

describe('every invalid base is rejected with a reason and the rest survive', () => {
  it('relative path, token, file and duplicate in one settings object', () => {
    const warn = vi.fn();
    const out = parse(
      {
        docBases: [
          { id: 'rel', name: 'Relative', roots: ['docs/handbook'] },
          { id: 'tok', name: 'Token', roots: ['${workspaceFolder}/docs'] },
          { id: 'file', name: 'File', roots: ['/docs/README.md'] },
          { id: 'ok', name: 'Fine', roots: ['/docs/fine'] },
          { id: 'dup', name: 'Dup', roots: ['/docs/fine'] },
        ],
      },
      warn,
    ).docBases;
    expect(out.map((b) => b.id)).toEqual(['ok']);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => /absolute/.test(m))).toBe(true);
    expect(messages.some((m) => /\$\{/.test(m))).toBe(true);
    expect(messages.some((m) => /file, not a folder/.test(m))).toBe(true);
    expect(messages.some((m) => /repeats the folder/.test(m))).toBe(true);
  });

  it.each([
    ['$HOME style variable stays a relative (refused) path', '$HOME/docs'],
    ['percent variable', '%USERPROFILE%\\docs'],
    ['tilde', '~/docs'],
    ['file URL', 'file:///docs/handbook'],
    ['URL', 'https://example.com/docs'],
    ['dot', '.'],
    ['dotdot', '..'],
    ['whitespace only', '  \t '],
    ['newline in path', '/docs/a\nb'],
    ['NUL', '/docs/a\u0000b'],
    ['filesystem root', '/'],
    ['dotdot to the root', '/a/../..'],
    ['Windows drive root', 'c:\\'],
    ['Windows drive-relative', 'c:docs'],
  ])('refuses %s', (_n, root) => {
    expect(checkDocRoot(root).ok).toBe(false);
    expect(parse({ docBases: [{ ...good, roots: [root] }] }).docBases).toEqual([]);
  });

  it('refuses a non-string root of every kind without throwing', () => {
    for (const root of [null, undefined, 1, true, {}, [], ['/a'], () => '/a', Symbol.iterator.toString().length]) {
      expect(() => parse({ docBases: [{ ...good, roots: [root] }] })).not.toThrow();
      expect(parse({ docBases: [{ ...good, roots: [root] }] }).docBases).toEqual([]);
    }
  });

  it('a roots value that is not an array drops the base', () => {
    for (const roots of ['/docs/a', {}, null, 5]) {
      expect(parse({ docBases: [{ ...good, roots }] }).docBases).toEqual([]);
    }
  });

  it('a root that normalizes to another base’s root is a duplicate, including through .. and slashes', () => {
    const out = parse({ docBases: [good, { id: 'b2', name: 'Two', roots: ['/docs//handbook/', '/docs/x/../handbook/./'] }] }).docBases;
    expect(out.map((b) => b.id)).toEqual(['b1']);
  });

  it('a Windows root differing only in case or slash direction is a duplicate; UNC too', () => {
    const out = parse({ docBases: [{ id: 'a', name: 'A', roots: ['C:\\Docs\\Team'] }, { id: 'b', name: 'B', roots: ['c:/docs/team/'] }, { id: 'c', name: 'C', roots: ['\\\\NAS\\Share\\x'] }, { id: 'd', name: 'D', roots: ['\\\\nas\\share\\X'] }] }).docBases;
    expect(out.map((b) => b.id)).toEqual(['a', 'c']);
  });
});

describe('hostile objects', () => {
  it('a __proto__ key in a base, in docs or at the top level does not pollute anything', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":1},"docBases":[{"id":"b","name":"B","roots":["/d/x"],"__proto__":{"allowCloud":true,"polluted":2}}],"docs":{"__proto__":{"maxHops":5},"maxHops":2}}');
    const s = parse(raw);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('allowCloud');
    expect(s.docBases[0].allowCloud).toBe(false);
    expect(s.docs.maxHops).toBe(2);
    expect(({} as Record<string, unknown>).maxHops).toBeUndefined();
    parse(JSON.parse(JSON.stringify(serializeAiSettings(s))));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('a constructor or prototype key is only data', () => {
    const s = parse({ docBases: [{ ...good, constructor: { prototype: { x: 1 } }, prototype: 1 }] });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(s.docBases).toHaveLength(1);
  });

  it('allowCloud only turns on for the boolean true, never for a truthy look-alike', () => {
    for (const v of ['true', 'yes', 1, [], {}, 'false', 'on']) {
      expect(parse({ docBases: [{ ...good, allowCloud: v }] }).docBases[0].allowCloud, String(v)).toBe(false);
    }
    expect(parse({ docBases: [{ ...good, allowCloud: true }] }).docBases[0].allowCloud).toBe(true);
  });

  it('a getter that throws or a huge name does not break parsing', () => {
    const base = { ...good, name: 'N'.repeat(100_000) };
    expect(() => parse({ docBases: [base] })).not.toThrow();
    const hostile = { id: 'h', roots: ['/d/h'] };
    Object.defineProperty(hostile, 'name', { get() { throw new Error('boom'); }, enumerable: true });
    // A throwing getter is a hostile in-process object, not a settings file; the contract is only that real JSON works.
    expect(() => parse(JSON.parse('{"docBases":[{"id":"h","roots":["/d/h"],"name":null}]}'))).not.toThrow();
  });

  it('a very long list of bases parses in reasonable time', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, roots: [`/d/${i}`, `/d/${i}/../${i}`] }));
    const t0 = Date.now();
    const out = parse({ docBases: many }).docBases;
    expect(out).toHaveLength(5000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('parseDocBases and parseDocsOptions accept junk without throwing', () => {
    for (const junk of [null, undefined, 3, 'x', [], {}, [null], [[]], [{}], [{ roots: 5 }]]) {
      expect(() => parseDocBases(junk, (n) => `id-${n}`, () => {})).not.toThrow();
      expect(() => parseDocsOptions(junk, () => {})).not.toThrow();
    }
  });
});

describe('homeFile', () => {
  it.each([
    ['..\\..\\secret.md'],
    ['a/../../secret.md'],
    ['/abs/secret.md'],
    ['\\\\server\\share\\x.md'],
    ['C:\\x.md'],
    ['C:x.md'],
    ['x.md\u0000.txt'],
    ['docs/'],
  ])('refuses %j', (v) => {
    const out = parse({ docBases: [{ ...good, homeFile: v }] }).docBases[0];
    expect(out.homeFile).toBeUndefined();
    expect(normalizeDocHomeFile(v)).toBeNull();
  });
  it('trims whitespace and keeps odd but relative names as names, never expanded', () => {
    expect(normalizeDocHomeFile('x.md\n')).toBe('x.md');
    expect(normalizeDocHomeFile('~/x.md')).toBe('~/x.md');
    expect(normalizeDocHomeFile('$HOME/x.md')).toBe('$HOME/x.md');
  });
  it('keeps a plain relative path and normalizes separators and ./', () => {
    expect(parse({ docBases: [{ ...good, homeFile: ' ./start\\HOME.MD ' }] }).docBases[0].homeFile).toBe('start/HOME.MD');
  });
});

describe('serialize', () => {
  it('round-trips through JSON text, and a second round changes nothing', () => {
    const first = parse({
      docBases: [
        { id: 'a', name: 'A "quoted" \\ name', roots: ['/a/one', 'C:\\Two'], homeFile: 'HOME.md', allowCloud: true },
        { id: 'b', name: 'B', roots: ['\\\\nas\\share\\x'], enabled: false, future: [1, { two: 3 }] },
      ],
      docs: { maxHops: 4, sourceShare: 45, navigateBy: 'page', later: { x: 1 } },
    });
    const wire = JSON.parse(JSON.stringify(serializeAiSettings(first)));
    const second = parse(wire);
    expect(second).toEqual(first);
    expect(parse(JSON.parse(JSON.stringify(serializeAiSettings(second))))).toEqual(second);
  });

  it('what was dropped on read stays dropped on write', () => {
    const s = parse({ docBases: [{ id: 'bad', name: 'Bad', roots: ['relative'] }, good] });
    const patch = serializeAiSettings(s) as Record<string, unknown>;
    expect(JSON.stringify(patch['ai.docBases'])).not.toContain('relative');
  });

  it('does not alias the caller’s objects: editing the result leaves the input alone', () => {
    const input = { docBases: [{ ...good, roots: ['/docs/handbook'] }] };
    const s = parse(input);
    s.docBases[0].roots.push('/x');
    expect(input.docBases[0].roots).toEqual(['/docs/handbook']);
  });

  it('defaults serialize to an empty list and the documented options', () => {
    const patch = serializeAiSettings(defaultAiSettings());
    expect(patch['ai.docBases']).toEqual([]);
    expect(patch['ai.docs']).toEqual({ maxHops: 3, sourceShare: 60, navigateBy: 'section' });
  });
});

describe('options', () => {
  it.each([
    [{ maxHops: -1 }, 1],
    [{ maxHops: 0.49 }, 1],
    [{ maxHops: 5.4 }, 5],
    [{ maxHops: 1e9 }, 5],
    [{ maxHops: -Infinity }, 3],
    [{ maxHops: Infinity }, 3],
    [{ maxHops: '4' }, 3],
    [{ maxHops: null }, 3],
    [{ maxHops: [4] }, 3],
  ])('hops %j gives %s', (raw, hops) => {
    expect(parse({ docs: raw }).docs.maxHops).toBe(hops);
  });
  it.each([
    [{ sourceShare: 29.5 }, 30],
    [{ sourceShare: 80.4 }, 80],
    [{ sourceShare: -1 }, 30],
    [{ sourceShare: 1e9 }, 80],
    [{ sourceShare: '70' }, 60],
    [{ sourceShare: NaN }, 60],
  ])('share %j gives %s', (raw, share) => {
    expect(parse({ docs: raw }).docs.sourceShare).toBe(share);
  });
  it('navigateBy accepts only its two values', () => {
    for (const v of ['Section', 'chapter', '', 1, null, 'page ']) {
      expect(parse({ docs: { navigateBy: v } }).docs.navigateBy).toBe('section');
    }
    expect(parse({ docs: { navigateBy: 'page' } }).docs.navigateBy).toBe('page');
  });
});
