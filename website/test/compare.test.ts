// The compare page's matrix (website/compare/index.html), read from source so it
// runs without a build. The expected values below are the settled matrix: change
// them together with the page.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '../compare/index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');
const table = doc.querySelector('table.matrix') as HTMLTableElement;

const COLUMNS = ['Feature', 'Desktop', 'VS Code extension', 'Web component', 'React / Vue / Angular'];
const LEGEND = ['Yes', 'Partial', 'Host must provide', 'No', 'n/a'];
const Y = 'Yes';
const P = 'Partial';
const H = 'Host must provide';
const N = 'No';
const X = 'n/a';

// Desktop, VS Code extension, Web component, React / Vue / Angular.
const MATRIX: [string, string[]][] = [
  ['WYSIWYG and source mode', [Y, Y, Y, Y]],
  ['Tables, callouts, math, Mermaid, emoji, footnotes', [Y, Y, Y, Y]],
  ['Spellcheck', [Y, P, H, H]],
  ['Image paste to disk', [Y, Y, H, H]],
  ['Find and replace', [Y, Y, Y, Y]],
  ['Outline sidebar', [Y, Y, P, P]],
  ['Backlinks', [Y, Y, H, H]],
  ['Wikilinks and tags', [Y, Y, H, H]],
  ['Properties and frontmatter', [Y, Y, Y, Y]],
  ['Folder tree', [Y, H, N, N]],
  ['Tabs', [Y, H, N, N]],
  ['Split panes', [Y, H, N, N]],
  ['Folder search', [Y, H, N, N]],
  ['Version history', [Y, H, N, N]],
  ['Multi-window', [Y, H, N, N]],
  ['HTML and PDF export', [Y, Y, H, H]],
  ['Settings UI', [Y, Y, P, P]],
  ['Toolbar customization', [Y, Y, P, P]],
  ['Auto-update', [P, H, N, N]],
  ['AI writing tools', [Y, Y, H, H]],
  ['AI engine setup', [Y, Y, H, H]],
  ['Two-way value binding', [X, X, Y, Y]],
  ['Native form field', [X, X, Y, P]],
];

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const featureRows = () => [...table.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('th[scope="row"]'));

describe('compare page matrix', () => {
  it('is a captioned table with column headers', () => {
    expect(table).not.toBeNull();
    expect(text(table.querySelector('caption'))).not.toBe('');
    const cols = [...table.querySelectorAll('thead th')];
    expect(cols.map(text)).toEqual(COLUMNS);
    expect(cols.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
  });

  it('has the settled rows and cells', () => {
    const got = featureRows().map((tr) => [
      text(tr.querySelector('th[scope="row"] .feature')),
      [...tr.querySelectorAll('td')].map((td) => text(td.querySelector('.mark'))),
    ]);
    expect(got).toEqual(MATRIX);
  });

  it('labels every cell with its column and marks it with a legend word and an icon', () => {
    for (const tr of featureRows()) {
      const cells = [...tr.querySelectorAll('td')];
      expect(cells.map((td) => td.getAttribute('data-label'))).toEqual(COLUMNS.slice(1));
      for (const td of cells) {
        const mark = td.querySelector('.mark');
        expect(LEGEND).toContain(text(mark));
        expect(mark?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      }
    }
  });

  it('explains every Partial and Host must provide cell with a note or a footnote', () => {
    const missing: string[] = [];
    for (const tr of featureRows()) {
      const feature = text(tr.querySelector('.feature'));
      for (const td of tr.querySelectorAll('td')) {
        const mark = text(td.querySelector('.mark'));
        if (mark !== P && mark !== H) {
          continue;
        }
        const note = td.querySelector('.cell-note');
        const refs = [...td.querySelectorAll('a.fn-ref')];
        if (!note || (text(note) === '' && refs.length === 0)) {
          missing.push(`${feature} / ${td.getAttribute('data-label')}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('has a legend entry for every mark and a footnote for every reference', () => {
    const legend = [...doc.querySelectorAll('.legend dt')].map(text);
    expect(legend).toEqual(LEGEND);
    const refs = new Set([...doc.querySelectorAll('a.fn-ref')].map((a) => a.getAttribute('href')));
    const notes = [...doc.querySelectorAll('.notes li[id]')].map((li) => `#${li.id}`);
    expect(notes).toEqual(['#note-1', '#note-2', '#note-3', '#note-4']);
    expect([...refs].sort()).toEqual(notes);
  });
});
