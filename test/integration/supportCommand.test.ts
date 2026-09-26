import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Covers `mikedown.support` ("MikeDown: Support MikeDown") end to end: it
// must be registered, and must execute without throwing whether or not a
// MikeDown editor is open (the fallback-notice path vs. the in-editor card
// path — see src/supportPrompt.ts / src/extension.ts).
//
// Uses a private fixture copied to a temp dir rather than
// test/workspace/sample.md: this suite opens (and, via the real custom
// editor's save path, may write back to) the file, and sample.md's exact
// content is depended on by fileHandling.test.ts's assertions. A temp copy
// means this suite can never race or collide with sibling suites over
// shared workspace fixtures.

suite('Support Command Integration Tests', () => {
  let tempDir: string;
  let fixtureFile: string;

  suiteSetup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-support-test-'));
    fixtureFile = path.join(tempDir, 'support-command-fixture.md');
    fs.writeFileSync(fixtureFile, '# Support Command Fixture\n\nUsed only by supportCommand.test.ts.\n');

    // `mikedown.support` is not itself an activation event (only
    // onCustomEditor:mikedown.editor / onCommand:mikedown.openWithMikeDown
    // are), so if this suite happens to run before any other MikeDown
    // command/editor has activated the extension, `getCommands` won't see
    // it yet. Force activation explicitly so this suite's assertions don't
    // depend on sibling-suite run order.
    const ext = vscode.extensions.getExtension('interapp.mikedown-editor');
    await ext?.activate();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('mikedown.support is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mikedown.support'), 'mikedown.support should be registered');
  });

  test('mikedown.support executes without throwing when no MikeDown editor is open', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('mikedown.support');
    });
  });

  test('mikedown.support executes without throwing with a MikeDown editor open', async function () {
    this.timeout(15000);

    const doc = await vscode.workspace.openTextDocument(fixtureFile);
    await vscode.commands.executeCommand('mikedown.openWithMikeDown', doc.uri);

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('mikedown.support');
    });
  });
});
