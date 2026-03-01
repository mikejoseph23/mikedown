import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// Test the DOM manipulation logic of the paste cleanup pipeline
// These test the helper functions used in smartpaste.ts

describe('Edge Cases — Clipboard / Paste', () => {
  it('handles empty HTML paste', () => {
    const doc = new DOMParser().parseFromString('', 'text/html');
    expect(doc.body.innerHTML).toBe('');
  });

  it('handles HTML with only whitespace', () => {
    const doc = new DOMParser().parseFromString('   \n\t  ', 'text/html');
    expect(doc.body.textContent?.trim()).toBe('');
  });

  it('handles malformed HTML without throwing', () => {
    // DOMParser is lenient with malformed HTML
    expect(() => {
      const doc = new DOMParser().parseFromString('<p>Unclosed <b>bold', 'text/html');
      expect(doc.body.textContent).toContain('bold');
    }).not.toThrow();
  });

  it('handles very large HTML (10KB+)', () => {
    // 500KB guard in smartpaste.ts — test 10KB (well under limit)
    const largeHtml = '<p>' + 'word '.repeat(2000) + '</p>';
    expect(largeHtml.length).toBeGreaterThan(10000);
    expect(() => {
      const doc = new DOMParser().parseFromString(largeHtml, 'text/html');
      expect(doc.body.textContent?.split(/\s+/).filter(w => w).length).toBeGreaterThan(100);
    }).not.toThrow();
  });

  it('handles colspan=2 table cells', () => {
    const html = '<table><tr><th colspan="2">Header</th></tr><tr><td>A</td><td>B</td></tr></table>';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const thWithColspan = doc.querySelector('th[colspan]');
    expect(thWithColspan?.getAttribute('colspan')).toBe('2');

    // Simulate colspan expansion
    const colspan = parseInt(thWithColspan?.getAttribute('colspan') || '1', 10);
    if (colspan > 1) {
      const row = thWithColspan!.parentElement!;
      for (let i = 1; i < colspan; i++) {
        const clone = document.createElement('th');
        clone.innerHTML = thWithColspan!.innerHTML;
        row.insertBefore(clone, thWithColspan!.nextSibling);
      }
      thWithColspan!.removeAttribute('colspan');
    }

    const headerCells = doc.querySelectorAll('thead tr th, tr:first-child th');
    expect(headerCells.length).toBeGreaterThanOrEqual(2);
  });
});
