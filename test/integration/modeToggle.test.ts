import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Mode Toggle Tests', () => {
  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const sampleFile = path.join(workspaceRoot, 'sample.md');

  test('toggleSourceMode command executes without error', async () => {
    const doc = await vscode.workspace.openTextDocument(sampleFile);
    await vscode.window.showTextDocument(doc);

    let errorThrown = false;
    try {
      await vscode.commands.executeCommand('mikedown.toggleSourceMode');
    } catch (e) {
      errorThrown = true;
    }
    // Command may silently do nothing if no webview panel is active — that's OK
    assert.ok(!errorThrown, 'toggleSourceMode should not throw');
  });
});
