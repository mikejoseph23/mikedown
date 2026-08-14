import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Exercises the real "View in Browser" / "Print" commands end to end: opens
// a fixture file in the actual MikeDown custom editor (real TipTap render in
// the real webview), invokes the command, and inspects the HTML file the
// extension host actually wrote via vscode.workspace.fs.
//
// This drives the pipeline through vscode.commands / the activated
// extension rather than importing src/export.ts directly — the integration
// runner resolves test files under Node's ESM loader, which can't resolve
// a bare extensionless `../../src/export` specifier the way the webpack
// bundle does. See the sibling test files in this directory for the same
// commands-first pattern.

suite('Export Pipeline Integration Tests', () => {
  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
  // Has an in-document `#features` anchor and a matching heading, so the
  // heading-id / anchor-preservation behavior can be asserted precisely —
  // sample.md (used by other integration tests) doesn't have one.
  const sampleFile = path.join(workspaceRoot, 'export-fixture.md');

  let originalOpenExternal: typeof vscode.env.openExternal;
  let capturedUri: vscode.Uri | undefined;
  let originalGlobalAssociations: Record<string, string> | undefined;
  let originalWorkspaceAssociations: Record<string, string> | undefined;

  suiteSetup(() => {
    // Opening the custom editor via `vscode.openWith` appears to make VS
    // Code remember the choice as a workspace-scoped editor association
    // (observed: `workbench.editorAssociations` picks up `"*.md":
    // "mikedown.editor"` at the Workspace scope after the first open in this
    // suite). That leaks into `defaultEditorCommand.test.ts`, which only
    // resets the Global scope before asserting. Save both scopes here and
    // restore them in suiteTeardown so this suite has no side effects on
    // sibling test files.
    const inspected = vscode.workspace
      .getConfiguration()
      .inspect<Record<string, string>>('workbench.editorAssociations');
    originalGlobalAssociations = inspected?.globalValue;
    originalWorkspaceAssociations = inspected?.workspaceValue;
  });

  suiteTeardown(async () => {
    const config = vscode.workspace.getConfiguration();
    await config.update(
      'workbench.editorAssociations',
      originalWorkspaceAssociations,
      vscode.ConfigurationTarget.Workspace
    );
    await config.update(
      'workbench.editorAssociations',
      originalGlobalAssociations,
      vscode.ConfigurationTarget.Global
    );
  });

  setup(() => {
    capturedUri = undefined;
    originalOpenExternal = vscode.env.openExternal;
    // Stand in for the real browser launch — asserting on the temp file the
    // pipeline actually wrote is a better end-to-end signal than opening a
    // window, and it keeps the test from popping a real browser in CI.
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

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * "View in Browser" round-trips through the webview (host sends
   * `requestViewInBrowser`, the webview posts rendered HTML back once
   * TipTap has mounted). There's no public hook to await that handshake,
   * so we retry the command until `vscode.env.openExternal` fires or we
   * time out.
   */
  async function invokeUntilCaptured(command: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!capturedUri && Date.now() < deadline) {
      await vscode.commands.executeCommand(command);
      await sleep(250);
    }
  }

  test('View in Browser writes a standalone HTML file with heading ids and working anchors', async function () {
    this.timeout(20000);

    const doc = await vscode.workspace.openTextDocument(sampleFile);
    await vscode.commands.executeCommand('mikedown.openWithMikeDown', doc.uri);

    await invokeUntilCaptured('mikedown.viewInBrowser', 15000);

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
    assert.ok(written.includes('Export Fixture'), 'exported HTML should contain the rendered body');
    assert.ok(written.includes('Bold <strong>text</strong>'), 'inline formatting should be preserved');

    // Heading id was added so the in-document anchor resolves.
    assert.ok(
      /<h2[^>]*\bid="features"[^>]*>Features<\/h2>/.test(written),
      `heading should get a slug id, got: ${written.slice(0, 800)}`
    );

    // The `#features` anchor must keep its `#` href untouched — not
    // rewritten into a file:// URL like the doc-relative links are.
    assert.ok(
      /<a[^>]*href="#features"[^>]*>Jump to Features<\/a>/.test(written),
      `same-document anchor should keep its # href, got: ${written.slice(0, 800)}`
    );

    // External links are left completely alone.
    assert.ok(written.includes('href="https://example.com"'), 'external links should be untouched');

    assert.ok(written.startsWith('<!DOCTYPE html>'), 'export should be a standalone HTML document');
  });

  test('Print / Export as PDF uses the mikedown-print- prefix and injects the print script', async function () {
    this.timeout(20000);

    const doc = await vscode.workspace.openTextDocument(sampleFile);
    await vscode.commands.executeCommand('mikedown.openWithMikeDown', doc.uri);

    await invokeUntilCaptured('mikedown.print', 15000);

    assert.ok(capturedUri, 'openExternal should have been called');
    assert.ok(
      path.basename(capturedUri!.fsPath).startsWith('mikedown-print-'),
      `expected a mikedown-print- temp file, got ${capturedUri!.fsPath}`
    );

    const written = fs.readFileSync(capturedUri!.fsPath, 'utf8');
    assert.ok(written.includes('window.print()'), 'print export should inject the auto-print script');
  });
});
