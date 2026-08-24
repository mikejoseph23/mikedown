import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Covers the four M1/M2 commands: mikedown.toggleBulletList,
// mikedown.toggleOrderedList, mikedown.toggleTaskList, mikedown.toggleSidebar.
// Registration is asserted here (not in commands.test.ts) and round-trip
// execution is driven through the real custom editor via
// mikedown.openWithMikeDown, matching the commands-first pattern used by
// exportPipeline.test.ts.
//
// Uses its own fixture (list-toggle-fixture.md) rather than sample.md: the
// list toggles are real doc edits that get auto-saved back to disk through
// the custom editor's applyEdit debounce, and sample.md is depended on by
// fileHandling.test.ts's exact-content assertions. Content is restored after
// each test regardless of outcome so this suite has no side effects on
// sibling suites or the working tree.

suite('List Toggle and Sidebar Command Tests', () => {
  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const sampleFile = path.join(workspaceRoot, 'list-toggle-fixture.md');
  const originalContent = fs.readFileSync(sampleFile, 'utf8');

  teardown(() => {
    fs.writeFileSync(sampleFile, originalContent);
  });

  const commandsUnderTest = [
    'mikedown.toggleBulletList',
    'mikedown.toggleOrderedList',
    'mikedown.toggleTaskList',
    'mikedown.toggleSidebar',
  ];

  test('list-toggle and sidebar commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const cmd of commandsUnderTest) {
      assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
    }
  });

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  for (const cmd of commandsUnderTest) {
    test(`${cmd} executes against an open MikeDown editor without error`, async function () {
      this.timeout(20000);

      const doc = await vscode.workspace.openTextDocument(sampleFile);
      await vscode.commands.executeCommand('mikedown.openWithMikeDown', doc.uri);

      // Give the webview a moment to mount TipTap before dispatching.
      await sleep(500);

      let errorThrown: unknown;
      try {
        await vscode.commands.executeCommand(cmd);
        // Fire twice to exercise the toggle-off path too (bullet/ordered/task
        // toggles wrap then unwrap; toggleSidebar shows then hides).
        await sleep(250);
        await vscode.commands.executeCommand(cmd);
      } catch (e) {
        errorThrown = e;
      }

      assert.ok(!errorThrown, `${cmd} should not throw, got: ${errorThrown}`);
    });
  }
});
