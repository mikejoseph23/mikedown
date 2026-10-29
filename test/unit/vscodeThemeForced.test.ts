import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../../src/webview/vscode-theme.css'), 'utf8');

/** The declarations of one top-level `body[data-mikedown-theme="..."] { ... }` block. */
function forcedBlock(theme: 'light' | 'dark'): string {
  const head = `body[data-mikedown-theme="${theme}"] {\n`;
  const start = css.indexOf(head);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('forced editor theme', () => {
  // A forced scheme opposite to the VS Code theme left the theme's secondary
  // button colours in place: pale text on a light page (Test connection).
  it.each(['light', 'dark'] as const)('%s sets the secondary button colours and border', (theme) => {
    const block = forcedBlock(theme);
    for (const name of ['secondaryBackground', 'secondaryForeground', 'secondaryHoverBackground', 'border']) {
      expect(block).toContain(`--vscode-button-${name}:`);
    }
  });
});
