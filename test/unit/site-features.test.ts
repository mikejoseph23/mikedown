import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EDITIONS, GROUPS, MARKS, applyFeatureMarkers, cell, renderFeatureList, renderHighlights, renderMatrixRows } from '../../website/shared/features.js';

const website = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'website');
const all = GROUPS.flatMap((g: { features: unknown[] }) => g.features) as {
  id: string; name: string; description: string; highlight?: boolean; editions: Record<string, unknown>;
}[];

describe('site feature data', () => {
  it('gives every feature a unique id, a description and a valid mark for every edition', () => {
    expect(new Set(all.map((f) => f.id)).size).toBe(all.length);
    for (const f of all) {
      expect(f.description, f.id).toBeTruthy();
      expect(Object.keys(f.editions).sort(), f.id).toEqual(EDITIONS.map((e: { id: string }) => e.id).sort());
      for (const e of EDITIONS) {
        expect(Object.keys(MARKS)).toContain(cell(f.editions[e.id]).mark);
      }
    }
  });

  it('only cites footnotes the compare page has', () => {
    const compare = readFileSync(join(website, 'compare', 'index.html'), 'utf8');
    for (const f of all) {
      for (const e of EDITIONS) {
        const { fn } = cell(f.editions[e.id]);
        if (fn) {expect(compare, `${f.id}/${e.id} cites note ${fn}`).toContain(`id="note-${fn}"`);}
      }
    }
  });

  it('renders one matrix row per feature, and a list entry with a chip per edition', () => {
    expect(renderMatrixRows().match(/<tr role="row">/g)).toHaveLength(all.length);
    const list = renderFeatureList();
    expect(list.match(/class="feat"/g)).toHaveLength(all.length);
    expect(list.match(/class="chip /g)).toHaveLength(all.length * EDITIONS.length);
  });

  it('highlights six features on the home page', () => {
    expect(renderHighlights().match(/class="highlight"/g)).toHaveLength(6);
  });

  it('fills the markers the pages use and rejects unknown ones', () => {
    for (const page of ['index.html', 'features/index.html', 'compare/index.html']) {
      const out = applyFeatureMarkers(readFileSync(join(website, page), 'utf8'));
      expect(out, page).not.toMatch(/<!--\s*features:/);
    }
    expect(() => applyFeatureMarkers('<!--features:nope-->')).toThrow(/unknown marker/);
  });
});
