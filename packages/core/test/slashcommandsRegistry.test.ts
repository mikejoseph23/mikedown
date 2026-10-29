import { describe, it, expect } from 'vitest';
import { AI_SLASH_COMMANDS, SLASH_COMMANDS, matchCommands, extractSlashQuery } from '../src/slashcommands-registry';

/** Runs a query and returns just the matched ids, in ranked order. */
function idsFor(query: string, hasFrontmatter = false): string[] {
  return matchCommands(query, { hasFrontmatter }).map((c) => c.id);
}

describe('matchCommands — aliases from the table find their command', () => {
  const cases: Array<[string, string]> = [
    ['check', 'todo'], // Task list
    ['ol', 'numbered'],
    ['1.', 'numbered'],
    ['---', 'divider'],
    ['[[', 'wikilink'],
    [':', 'emoji'],
    ['warn', 'warning'],
    ['danger', 'caution'],
    ['h4', 'h4'],
    ['heading5', 'h5'],
    ['h6', 'h6'],
    ['yaml', 'properties'],
    ['today', 'date'],
    ['timestamp', 'datetime'],
    ['now', 'datetime'],
  ];

  for (const [query, expectedId] of cases) {
    it(`/${query} finds ${expectedId}`, () => {
      expect(idsFor(query)[0]).toBe(expectedId);
    });
  }
});

describe('matchCommands — ranking', () => {
  it('ranks an exact match above a prefix match', () => {
    // "date" is an exact id match for Date, and a name-prefix match for
    // Date and time (id "datetime"). Exact must come first.
    expect(idsFor('date')).toEqual(['date', 'datetime']);
  });

  it('/h lists H1–H6 in registry order (name-prefix tier keeps registry order)', () => {
    const heading = idsFor('h').filter((id) => /^h[1-6]$/.test(id));
    expect(heading).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  });

  it('an exact alias match ranks above a same-tier-losing prefix match', () => {
    // "warn" is an exact alias of Warning; nothing else in the registry has
    // an id or alias with "warn" as a prefix, so Warning is the sole result.
    expect(idsFor('warn')).toEqual(['warning']);
  });
});

describe('matchCommands — misc contract', () => {
  it('empty query returns every command, in registry order', () => {
    expect(idsFor('')).toEqual(SLASH_COMMANDS.map((c) => c.id));
  });

  it('unknown query returns an empty array', () => {
    expect(idsFor('zzznotacommand')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(idsFor('WARN')).toEqual(idsFor('warn'));
    expect(idsFor('Heading5')).toEqual(idsFor('heading5'));
    expect(idsFor('YAML')).toEqual(idsFor('yaml'));
  });

  it('excludes Properties for every query when hasFrontmatter is true', () => {
    for (const query of ['', 'yaml', 'frontmatter', 'prop', 'zzz']) {
      expect(idsFor(query, true)).not.toContain('properties');
    }
  });

  it('includes Properties when hasFrontmatter is false, for queries that match it', () => {
    expect(idsFor('', false)).toContain('properties');
    expect(idsFor('yaml', false)).toContain('properties');
    expect(idsFor('frontmatter', false)).toContain('properties');
  });
});

describe('extractSlashQuery', () => {
  it('matches "/" alone at the start of the block', () => {
    expect(extractSlashQuery('/', true)).toEqual({ offset: 0, query: '' });
  });

  it('matches "/query" at the start of the block', () => {
    expect(extractSlashQuery('/foo', true)).toEqual({ offset: 0, query: 'foo' });
  });

  it('does not trigger at position 0 when that is not really the block start', () => {
    // Can only happen if the caller mis-tracks atBlockStart, but the function
    // must not fall back to "start of block" behavior on its own say-so.
    expect(extractSlashQuery('/foo', false)).toBeNull();
  });

  it('matches "/query" right after a space, anywhere in the line', () => {
    const text = 'hi /foo';
    const slashIdx = text.indexOf('/');
    expect(extractSlashQuery(text, false)).toEqual({ offset: slashIdx, query: 'foo' });
  });

  it('matches "/query" right after a tab', () => {
    const text = 'hi\t/foo';
    const slashIdx = text.indexOf('/');
    expect(extractSlashQuery(text, false)).toEqual({ offset: slashIdx, query: 'foo' });
  });

  it('matches mid-line, well after the start, as long as a space precedes the slash', () => {
    const text = 'some text before /cmd';
    const slashIdx = text.indexOf('/');
    expect(extractSlashQuery(text, false)).toEqual({ offset: slashIdx, query: 'cmd' });
  });

  it('rejects "and/or" — the slash is preceded by a non-whitespace character', () => {
    expect(extractSlashQuery('and/or', true)).toBeNull();
    expect(extractSlashQuery('and/or', false)).toBeNull();
  });

  it('rejects "path/to"', () => {
    expect(extractSlashQuery('path/to', true)).toBeNull();
  });

  it('rejects "https://a.com/b"', () => {
    expect(extractSlashQuery('https://a.com/b', true)).toBeNull();
  });

  it('returns null once whitespace sits directly at the cursor (a trailing space after the query)', () => {
    expect(extractSlashQuery('/foo ', true)).toBeNull();
    expect(extractSlashQuery('hi /foo ', false)).toBeNull();
  });

  it('returns null on an empty textBefore', () => {
    expect(extractSlashQuery('', true)).toBeNull();
  });
});

describe('the ai group (summary, outline, title)', () => {
  const AI_IDS = ['summary', 'outline', 'title'];
  const all = (hidden: string[] = []) => matchCommands('', { hasFrontmatter: false, hidden: new Set(hidden) }).map((c) => c.id);

  it('is the last group in the registry, labelled by the ai group id', () => {
    expect(SLASH_COMMANDS.filter((c) => c.group === 'ai').map((c) => c.id)).toEqual(AI_IDS);
    expect(all().slice(-3)).toEqual(AI_IDS);
    expect(all(['image', 'properties']).slice(-3)).toEqual(AI_IDS);
  });

  it('is present only when it is not in the hidden set (the editor hides it unless the feature is available)', () => {
    expect(matchCommands('', { hasFrontmatter: false }).some((c) => AI_IDS.includes(c.id))).toBe(true);
    expect(all([...AI_SLASH_COMMANDS.summary, ...AI_SLASH_COMMANDS.title]).some((id) => AI_IDS.includes(id))).toBe(false);
    // Each feature hides its own commands.
    expect(all(AI_SLASH_COMMANDS.summary).filter((id) => AI_IDS.includes(id))).toEqual(['title']);
    expect(all(AI_SLASH_COMMANDS.title).filter((id) => AI_IDS.includes(id))).toEqual(['summary', 'outline']);
  });

  it('a hidden command is not found by its id or its aliases', () => {
    const hidden = new Set(AI_SLASH_COMMANDS.summary);
    for (const q of ['summary', 'sum', 'tldr', 'summarize', 'outline']) {
      expect(matchCommands(q, { hasFrontmatter: false, hidden }).some((c) => c.group === 'ai' && c.id !== 'title'), q).toBe(false);
    }
  });

  it('/sum, /summ, /tl and /summarize all put Summary first', () => {
    for (const q of ['sum', 'summ', 'tl', 'tldr', 'summarize']) {
      expect(idsFor(q)[0], q).toBe('summary');
    }
  });

  it('ranks a command whose id is the query above one that merely has it as an alias', () => {
    expect(idsFor('title').slice(0, 2)).toEqual(['title', 'h1']);
    expect(idsFor('outline').slice(0, 2)).toEqual(['outline', 'toc']);
    // `heading` is only a keyword of title, so it stays a heading command.
    expect(idsFor('heading')[0]).toBe('h1');
  });
});
