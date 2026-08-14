import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openRenderedInBrowser } from '../../src/export';

// Exercises the same local-session export pipeline the "View in Browser" and
// "Print / Export as PDF" commands drive (src/markdownEditorProvider.ts calls
// openRenderedInBrowser with the webview's rendered HTML). We call it
// directly with representative TipTap-shaped output instead of going through
// the webview, so this stays a real VS Code extension-host test (real
// vscode.workspace.fs, real temp file) without needing a rendered webview.

suite('Export Pipeline Integration Tests', () => {
  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const sourcePath = path.join(workspaceRoot, 'sample.md');

  // TipTap's serialized HTML has no heading ids and stamps target/rel on
  // every link, including same-document anchors — buildFullHtml is what
  // fixes both. This body mirrors that shape.
  const renderedHtml = [
    '<h1>Sample Document</h1>',
    '<p><a target="_blank" rel="noopener noreferrer nofollow" href="#features">Jump to Features</a></p>',
    '<h2>Features</h2>',
    '<p>Bold <strong>text</strong> and italic <em>text</em>.</p>',
    '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">External link</a></p>',
  ].join('');

  let originalOpenExternal: typeof vscode.env.openExternal;
  let capturedUri: vscode.Uri | undefined;

  setup(() => {
    capturedUri = undefined;
    originalOpenExternal = vscode.env.openExternal;
    // Stand in for the real browser launch — we only need to know which
    // temp file the export pipeline handed off, and asserting on the file
    // it actually wrote is a better end-to-end signal than opening a window.
    (vscode.env as any).openExternal = async (uri: vscode.Uri) => {
      capturedUri = uri;
      return true;
    };
  });

  teardown(async () => {
    (vscode.env as any).openExternal = originalOpenExternal;
    if (capturedUri) {
      try {
        fs.unlinkSync(capturedUri.fsPath);
      } catch {
        // Already cleaned up or never written — fine.
      }
    }
  });

  test('local "View in Browser" writes a standalone HTML file with heading ids and working anchors', async () => {
    await openRenderedInBrowser(renderedHtml, sourcePath);

    assert.ok(capturedUri, 'openExternal should have been called with the exported file');
    assert.ok(
      path.basename(capturedUri!.fsPath).startsWith('mikedown-preview-'),
      `expected a mikedown-preview- temp file, got ${capturedUri!.fsPath}`
    );
    assert.strictEqual(
      path.dirname(capturedUri!.fsPath),
      os.tmpdir(),
      'local export should land in the OS temp dir'
    );

    const written = fs.readFileSync(capturedUri!.fsPath, 'utf8');

    // Rendered body made it through.
    assert.ok(written.includes('Sample Document'), 'exported HTML should contain the rendered body');
    assert.ok(written.includes('Bold <strong>text</strong>'), 'inline formatting should be preserved');

    // Heading ids were added so the in-document anchor resolves.
    assert.ok(
      written.includes('<h2 id="features">Features</h2>'),
      'heading should get a slug id'
    );

    // The `#features` anchor lost its target/rel and still points at the
    // heading id — it must not have been rewritten into a file:// URL.
    assert.ok(
      written.includes('<a href="#features">Jump to Features</a>'),
      'same-document anchor should keep its # href and drop target/rel'
    );

    // External links are left completely alone.
    assert.ok(
      written.includes('href="https://example.com"'),
      'external links should be untouched'
    );

    assert.ok(written.startsWith('<!DOCTYPE html>'), 'export should be a standalone HTML document');
  });

  test('auto-print export uses the mikedown-print- prefix and injects the print script', async () => {
    await openRenderedInBrowser(renderedHtml, sourcePath, { autoPrint: true });

    assert.ok(capturedUri, 'openExternal should have been called');
    assert.ok(path.basename(capturedUri!.fsPath).startsWith('mikedown-print-'));

    const written = fs.readFileSync(capturedUri!.fsPath, 'utf8');
    assert.ok(written.includes('window.print()'), 'autoPrint export should inject the print script');
  });
});
