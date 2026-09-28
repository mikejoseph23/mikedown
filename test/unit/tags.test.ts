import { describe, it, expect, afterEach } from 'vitest';
import { findInlineTags, normalizeTag, isValidTag } from '../../src/tagSyntax';
import { extractTags } from '../../src/tagExtract';
import { findTagMatches } from '../../src/webview/tagautocomplete';
import { bootWebview, type Harness } from '../harness/webviewHarness';

describe('inline tag syntax', () => {
  const tagsIn = (s: string) => findInlineTags(s).map(m => m.tag);

  it('matches simple and nested tags', () => {
    expect(tagsIn('a #foo b #project/active c')).toEqual(['foo', 'project/active']);
  });

  it('requires a letter (rejects pure-number tags)', () => {
    expect(tagsIn('issue #1234 and #v2')).toEqual(['v2']);
  });

  it('allows hyphen and underscore', () => {
    expect(tagsIn('#my-tag #to_do')).toEqual(['my-tag', 'to_do']);
  });

  it('ignores `#` preceded by a word char, `#`, `&`, or `/`', () => {
    expect(tagsIn('foo#bar ##heading url/#frag &#39;')).toEqual([]);
  });

  it('does not treat ATX headings (`# Heading`) as tags', () => {
    expect(tagsIn('# Heading')).toEqual([]);
  });

  it('reports the offset of the `#`', () => {
    const [m] = findInlineTags('hi #tag');
    expect(m.index).toBe(3);
    expect(m.length).toBe(4);
  });

  it('normalizeTag strips leading # and lowercases', () => {
    expect(normalizeTag('#Foo')).toBe('foo');
    expect(normalizeTag('  Bar/Baz ')).toBe('bar/baz');
    expect(normalizeTag('#123')).toBeNull();
    expect(isValidTag('123')).toBe(false);
  });
});

describe('inline tags — hex colors', () => {
  const tags = (t: string) => findInlineTags(t).map((m) => m.tag);

  it('skips 6- and 8-digit hex colors', () => {
    expect(tags('bg #2563eb, fg #ffffff, overlay #eef0f3cc')).toEqual([]);
  });

  it('skips 3- and 4-digit hex colors that contain a digit', () => {
    expect(tags('use #f0f or #fa08')).toEqual([]);
  });

  it('keeps word-like hex tags', () => {
    expect(tags('#bad #cafe #face #add')).toEqual(['bad', 'cafe', 'face', 'add']);
  });

  it('keeps tags that are not pure hex', () => {
    expect(tags('#design #v2')).toEqual(['design', 'v2']);
  });

  it('still honors explicit frontmatter tags that look like hex', () => {
    expect(extractTags('---\ntags: [ffffff]\n---\nbody')).toContain('ffffff');
  });
});

describe('extractTags (frontmatter + body)', () => {
  it('reads frontmatter array tags', () => {
    const doc = ['---', 'title: x', 'tags: [Alpha, beta]', '---', 'body'].join('\n');
    expect([...extractTags(doc)].sort()).toEqual(['alpha', 'beta']);
  });

  it('reads frontmatter block-style tags and merges with inline', () => {
    const doc = ['---', 'tags:', '  - one', '  - two', '---', 'inline #three here'].join('\n');
    expect([...extractTags(doc)].sort()).toEqual(['one', 'three', 'two']);
  });

  it('ignores tags inside fenced and inline code', () => {
    const doc = ['real #keep', '```', '#nope', '```', 'and `#alsonope` done'].join('\n');
    expect([...extractTags(doc)]).toEqual(['keep']);
  });

  it('ignores `#anchor` inside markdown link targets', () => {
    const doc = 'see [docs](./other.md#section) and #realtag';
    expect([...extractTags(doc)]).toEqual(['realtag']);
  });

  it('dedupes case-insensitively across sources', () => {
    const doc = ['---', 'tags: [Foo]', '---', 'body #foo #FOO'].join('\n');
    expect([...extractTags(doc)]).toEqual(['foo']);
  });
});

describe('extractTags — things that look like tags but are not', () => {
  const tagsOf = (doc: string) => [...extractTags(doc)].sort();

  it('skips headings but keeps tags written inside them', () => {
    expect(tagsOf('# Title\n\n## Sub #real')).toEqual(['real']);
  });

  it('skips URL fragments and page#anchor', () => {
    expect(tagsOf('see https://example.com/page#frag and page#anchor and <https://x.dev/#top>')).toEqual([]);
  });

  it('skips wikilink heading targets', () => {
    expect(tagsOf('[[Note#Heading]] and [[#Local Heading]] and [[Note#H|alias]]')).toEqual([]);
  });

  it('skips HTML attributes', () => {
    expect(tagsOf('<a href="#section">jump</a> <span style="color:#fff">x</span>')).toEqual([]);
  });

  it('skips reference-link definitions', () => {
    expect(tagsOf('[ref]\n\n[ref]: #anchor')).toEqual([]);
  });

  it('skips hex colors in inline and fenced code', () => {
    expect(tagsOf('`#fff` and\n```css\na { color: #abc; }\n```\nok #kept')).toEqual(['kept']);
  });

  it('skips `#` inside inline and display math', () => {
    const doc = ['inline $\\#x + #y$ then #after', '', '$$', '#nope', '$$', '', '$$ #also $$', 'tail #tail'].join('\n');
    expect(tagsOf(doc)).toEqual(['after', 'tail']);
  });

  it('still reads tags next to prices', () => {
    expect(tagsOf('costs $5 and #budget $10')).toEqual(['budget']);
  });

  it('does not end a fence on a shorter marker', () => {
    expect(tagsOf('````\n```\n#nope\n````\n#yes')).toEqual(['yes']);
  });
});

describe('findTagMatches', () => {
  const list = [
    { tag: 'project', count: 5 },
    { tag: 'project/active', count: 2 },
    { tag: 'myproject', count: 1 },
    { tag: 'idea', count: 3 },
  ];

  it('puts prefix matches before substring matches', () => {
    expect(findTagMatches(list, 'proj').map(t => t.tag)).toEqual(['project', 'project/active', 'myproject']);
  });

  it('is case-insensitive', () => {
    expect(findTagMatches(list, 'IDE').map(t => t.tag)).toEqual(['idea']);
  });

  it('drops a lone exact match so Enter stays a newline', () => {
    expect(findTagMatches(list, 'idea')).toEqual([]);
  });

  it('returns nothing for an empty query', () => {
    expect(findTagMatches(list, '')).toEqual([]);
  });
});

// ── Full webview harness ─────────────────────────────────────────────────────

let harness: Harness | null = null;
const settle = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Type like a user: each char goes through `handleTextInput` so input rules fire. */
function typeWithRules(h: Harness, text: string): void {
  const view = h.wysiwygEditor().view;
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f: any) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) {view.dispatch(view.state.tr.insertText(ch, from, to));}
  }
}

async function boot(md: string): Promise<Harness> {
  const h = await bootWebview();
  harness = h;
  h.send({ type: 'update', content: md });
  await settle();
  return h;
}

const markdownOf = (h: Harness): string => h.wysiwygEditor().storage.markdown.getMarkdown();
const tagEls = (h: Harness): string[] =>
  [...h.wysiwygEditor().view.dom.querySelectorAll('.mikedown-tag')].map(el => el.getAttribute('data-tag') ?? '');

describe('inline tags — webview round-trip', () => {
  const cases = [
    'Plain #tag in prose.',
    '#tag at the start of a line',
    'Nested #project/active and #to_do-item here.',
    '# Heading with #tag',
    'Issue #1234 is not a tag.',
    'A link [docs](./other.md#section) and page#anchor.',
    'Math $a\\#b$ beside #real.',
    'Code `#fff` and #kept.',
    'See [[Note#Heading]] and #kept.',
    '- item #one\n- item #two',
    '> quoted #tag',
  ];
  for (const md of cases) {
    it(`round-trips byte-for-byte: ${JSON.stringify(md)}`, async () => {
      const h = await boot(md);
      expect(markdownOf(h)).toBe(md);
    });
  }

  it('decorates real tags only', async () => {
    const h = await boot('Hi #alpha and `#code` and [link #x](https://a.b) and $#m$ and [[Note#H]] and #project/active');
    expect(tagEls(h)).toEqual(['alpha', 'project/active']);
  });

  it('does not decorate a heading marker', async () => {
    const h = await boot('# Title\n\n## Sub');
    expect(tagEls(h)).toEqual([]);
  });

  it('turns decorations off and back on with the setting', async () => {
    const h = await boot('Hi #alpha');
    h.send({ type: 'settings', tagsEnabled: false });
    await settle();
    expect(tagEls(h)).toEqual([]);
    h.send({ type: 'settings', tagsEnabled: true });
    await settle();
    expect(tagEls(h)).toEqual(['alpha']);
  });

  it('Cmd+click on a tag posts openTag', async () => {
    const h = await boot('Hi #alpha');
    const el = h.wysiwygEditor().view.dom.querySelector('.mikedown-tag')!;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, metaKey: true, button: 0 }));
    expect(h.last('openTag')).toEqual({ type: 'openTag', tag: 'alpha' });
  });
});

describe('`#` autocomplete', () => {
  const popup = () => document.getElementById('mikedown-tag-ac');
  const TAGS = [{ tag: 'project', count: 3 }, { tag: 'project/active', count: 1 }, { tag: 'idea', count: 2 }];

  it('suggests workspace tags mid-line and inserts the chosen one', async () => {
    const h = await boot('');
    h.send({ type: 'tags', tags: TAGS });
    typeWithRules(h, 'note #pro');
    await settle();
    expect(popup()).not.toBeNull();
    expect([...popup()!.querySelectorAll('.wac-label')].map(e => e.textContent)).toEqual(['#project', '#project/active']);
    h.pressKeyInWysiwyg('ArrowDown');
    h.pressKeyInWysiwyg('Enter');
    await settle();
    expect(popup()).toBeNull();
    expect(markdownOf(h)).toBe('note #project/active ');
  });

  it('does not trigger at line start, and `# ` still makes a heading', async () => {
    const h = await boot('');
    h.send({ type: 'tags', tags: TAGS });
    typeWithRules(h, '#pro');
    await settle();
    expect(popup()).toBeNull();

    const h2 = await boot('');
    h2.send({ type: 'tags', tags: TAGS });
    typeWithRules(h2, '# Title');
    await settle();
    expect(popup()).toBeNull();
    expect(h2.wysiwygEditor().state.doc.firstChild.type.name).toBe('heading');
    expect(markdownOf(h2)).toBe('# Title');
  });

  it('does not trigger after a word character (page#anchor)', async () => {
    const h = await boot('');
    h.send({ type: 'tags', tags: TAGS });
    typeWithRules(h, 'page#pro');
    await settle();
    expect(popup()).toBeNull();
  });

  it('asks the host once when the tag cache is empty', async () => {
    const h = await boot('');
    h.send({ type: 'tags', tags: [] });
    h.clear();
    typeWithRules(h, 'x #ab');
    await settle();
    expect(h.ofType('getTags').length).toBe(1);
  });

  it('stays closed while tags are disabled', async () => {
    const h = await boot('');
    h.send({ type: 'tags', tags: TAGS });
    h.send({ type: 'settings', tagsEnabled: false });
    typeWithRules(h, 'note #pro');
    await settle();
    expect(popup()).toBeNull();
    h.send({ type: 'settings', tagsEnabled: true });
  });
});

describe('live tags — unsaved tags reach the sidebar', () => {
  let h: Harness | null = null;
  afterEach(() => { h?.dispose(); h = null; });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const sidebarTags = () =>
    [...document.querySelectorAll('.tags-section .tags-item')].map((r) => ({
      name: r.querySelector('.tags-item-name')!.textContent,
      count: r.querySelector('.tags-item-count')!.textContent,
    }));

  it('merges the current doc tags with the workspace index as you type', async () => {
    h = await bootWebview();
    h.send({ type: 'update', content: 'hello #shared' });
    h.send({ type: 'tags', tags: [{ tag: 'shared', count: 2 }, { tag: 'other', count: 1 }] });
    await wait(50);
    expect(sidebarTags()).toContainEqual({ name: '#shared', count: '3' });

    h.setWysiwygCursor(h.wysiwygEditor().state.doc.content.size - 1);
    h.typeInWysiwyg(' #fresh ');
    await wait(400);
    expect(sidebarTags()).toContainEqual({ name: '#fresh', count: '1' });
    expect(sidebarTags()).toContainEqual({ name: '#other', count: '1' });
  });
});
