import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// @ts-expect-error plain .mjs build script without type declarations
import { ORDER } from '../../packages/core/scripts/build-css.mjs';

// The VS Code webview loads the core stylesheets one by one
// (markdownEditorProvider.ts#getWebviewContent); the package ships them
// concatenated by packages/core/scripts/build-css.mjs. Both must use the same
// cascade order or the two products render differently.
describe('core stylesheet order', () => {
  it('matches between the VS Code provider and the package build', () => {
    const provider = fs.readFileSync(path.join(__dirname, '../../src/markdownEditorProvider.ts'), 'utf8');
    const block = /const cssFiles = \[([\s\S]*?)\];/.exec(provider);
    expect(block).not.toBeNull();
    const providerOrder = [...block![1].matchAll(/'([^']+\.css)'/g)].map((m) => m[1]);
    expect(providerOrder).toEqual(ORDER);
  });
});
