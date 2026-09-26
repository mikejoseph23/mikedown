import { describe, it, expect } from 'vitest';
import { SLASH_COMMANDS, matchCommands, extractSlashQuery } from '../../src/webview/slashcommands-registry';

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
