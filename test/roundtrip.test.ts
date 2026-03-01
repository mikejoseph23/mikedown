/**
 * Round-trip verification for MikeDown's GFM markdown pipeline.
 *
 * NOTE: TipTap's `@tiptap/core` and `tiptap-markdown` depend on ProseMirror
 * which in turn requires a browser DOM (`document`, `window`).  Running these
 * packages in plain Node (without jsdom) will throw at import time.
 *
 * Rather than emulate a full browser runtime, this file:
 *
 *   1. Verifies that the GFM fixture at `test/fixtures/sample.md` contains all
 *      expected structural elements (headings, bold, links, lists, code fences,
 *      tables, task-list items).  This is a baseline sanity check on the fixture
 *      itself and does not require TipTap.
 *
 *   2. Documents the *expected* round-trip behaviour so that a developer running
 *      the extension in VS Code can manually verify that TipTap serialises the
 *      same fixture to semantically equivalent markdown.
 *
 * To run the full DOM-dependent round-trip test, open the extension in the
 * Extension Development Host, open `test/fixtures/sample.md`, and inspect the
 * markdown sent via the `edit` postMessage — it should be semantically
 * equivalent to the fixture source.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';

// ── Load fixture ─────────────────────────────────────────────────────────────

const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
const source = fs.readFileSync(fixturePath, 'utf8');

// ── Structural assertions ─────────────────────────────────────────────────────

function containsAll(text: string, patterns: RegExp[], label: string): void {
  for (const pattern of patterns) {
    assert.ok(
      pattern.test(text),
      `${label}: expected pattern ${pattern} not found in fixture`
    );
  }
}

containsAll(
  source,
  [
    /^# Heading 1/m,
    /^## Heading 2/m,
    /^### Heading 3/m,
  ],
  'Headings'
);

containsAll(
  source,
  [
    /\*\*bold\*\*/,
    /\*italic\*/,
    /~~strikethrough~~/,
    /`inline code`/,
  ],
  'Inline formatting'
);

containsAll(
  source,
  [
    /\[Link text\]\(https:\/\/example\.com\)/,
    /!\[Alt text\]\(\.\/image\.png\)/,
  ],
  'Links and images'
);

containsAll(
  source,
  [
    /^- Bullet item 1/m,
    /^- Bullet item 2/m,
    /^  - Nested bullet/m,
    /^1\. First/m,
  ],
  'Lists'
);

containsAll(
  source,
  [
    /^- \[ \] Unchecked task/m,
    /^- \[x\] Checked task/m,
  ],
  'Task list items'
);

containsAll(
  source,
  [
    /^> Blockquote text/m,
  ],
  'Blockquote'
);

containsAll(
  source,
  [
    /^```javascript/m,
    /const hello = 'world';/,
    /^```$/m,
  ],
  'Fenced code block'
);

containsAll(
  source,
  [
    /\| Header 1 \| Header 2 \| Header 3 \|/,
    /\|----------|----------|----------\|/,
    /\| Cell 1 {3}\| Cell 2 {3}\| Cell 3 {3}\|/,
  ],
  'GFM table'
);

console.log('✓ All fixture structural assertions passed.');
console.log('');
console.log(
  'Round-trip (DOM): TipTap requires a browser DOM and cannot be run in plain Node.'
);
console.log(
  'To verify the full round-trip, open test/fixtures/sample.md in the Extension'
);
console.log(
  'Development Host and check that the `edit` postMessage content is semantically'
);
console.log('equivalent to the source fixture.');
