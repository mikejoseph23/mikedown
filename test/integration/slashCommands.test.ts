import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * T2: integration coverage for the slash-command feature's host-side surface
 * — settings registration/persistence, the slash-menu-disable notification
 * (Open Settings / Undo), and the `/image` file picker (`handlePickImage`).
 *
 * These messages normally arrive via the webview's real `postMessage` (a
 * live Electron webview @vscode/test-electron doesn't let Mocha script
 * directly), so this suite reaches the extension's activation `exports`
 * instead — `__test.dispatchMessage` forwards straight to
 * `MarkdownEditorProvider.dispatchTestMessage` on the SAME provider/panel
 * instance the running extension uses (see extension.ts's `activate()` doc
 * comment on why importing `../../src/markdownEditorProvider` directly
 * would reach a different, inert module instance instead).
 *
 * Uses a private fixture in a temp dir, never `test/workspace/sample.md`
 * (same reasoning as supportCommand.test.ts: this suite writes images next
 * to the doc and mutates `mikedown.slashCommands.*`/global settings).
 */

interface TestExports {
  __test: {
    dispatchMessage: (document: vscode.TextDocument, panel: vscode.WebviewPanel, message: unknown) => Promise<void>;
    getActivePanel: () => vscode.WebviewPanel | undefined;
  };
}

// A 1x1 transparent PNG. Content is never actually decoded by handlePickImage
// (it just copies bytes), so any small buffer would do, but a real PNG is
// truthful about what's flowing through the "image picker" path.
const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
  'hex'
);

suite('Slash Commands Integration Tests', () => {
  let tempDir: string;
  let fixtureFile: string;
  let exportsApi: TestExports;
  let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
  let originalShowOpenDialog: typeof vscode.window.showOpenDialog;

  suiteSetup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-slashcommands-test-'));
    fixtureFile = path.join(tempDir, 'slash-commands-fixture.md');
    fs.writeFileSync(fixtureFile, '# Slash Commands Fixture\n\nUsed only by slashCommands.test.ts.\n');

    const ext = vscode.extensions.getExtension('interapp.mikedown-editor');
    exportsApi = (await ext?.activate()) as TestExports;
    assert.ok(exportsApi?.__test, 'expected activate() to return the T2 test seam');
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  setup(() => {
    originalShowInformationMessage = vscode.window.showInformationMessage;
    originalShowOpenDialog = vscode.window.showOpenDialog;
  });

  teardown(async () => {
    vscode.window.showInformationMessage = originalShowInformationMessage;
    vscode.window.showOpenDialog = originalShowOpenDialog;
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // Every test in this suite touches global mikedown.slashCommands.* —
    // reset to package.json defaults so sibling suites/tests never inherit
    // a value one of these left behind.
    const config = vscode.workspace.getConfiguration('mikedown');
    await Promise.all([
      config.update('slashCommands.enabled', undefined, vscode.ConfigurationTarget.Global),
      config.update('slashCommands.dateFormat', undefined, vscode.ConfigurationTarget.Global),
      config.update('slashCommands.timeZone', undefined, vscode.ConfigurationTarget.Global),
    ]);
  });

  async function openFixture(): Promise<{ document: vscode.TextDocument; panel: vscode.WebviewPanel }> {
    const document = await vscode.workspace.openTextDocument(fixtureFile);
    await vscode.commands.executeCommand('mikedown.openWithMikeDown', document.uri);
    let panel = exportsApi.__test.getActivePanel();
    for (let i = 0; i < 20 && !panel; i++) {
      await new Promise(r => setTimeout(r, 50));
      panel = exportsApi.__test.getActivePanel();
    }
    assert.ok(panel, 'expected a MikeDown panel to become active after opening the fixture');
    return { document, panel: panel! };
  }

  /** Intercepts every message the host posts to `panel`'s webview, without
   *  breaking the real postMessage call (handlePickImage's caller awaits it,
   *  and other host code may too). */
  function capturePosted(panel: vscode.WebviewPanel): any[] {
    const posted: any[] = [];
    const original = panel.webview.postMessage.bind(panel.webview);
    (panel.webview as any).postMessage = (msg: any) => {
      posted.push(msg);
      return original(msg);
    };
    return posted;
  }

  suite('Settings registration', () => {
    test('enabled/dateFormat/timeZone are registered with the right defaults; no trigger setting exists', () => {
      const config = vscode.workspace.getConfiguration('mikedown');
      assert.strictEqual(config.get('slashCommands.enabled'), true);
      assert.strictEqual(config.get('slashCommands.dateFormat'), 'iso');
      assert.strictEqual(config.get('slashCommands.timeZone'), 'local');
      assert.strictEqual(
        config.get('slashCommands.trigger'),
        undefined,
        'the trigger setting was dropped (Open Question 7) and must not exist'
      );
    });

    test('package.json declares the dateFormat enum as iso/long only', () => {
      const ext = vscode.extensions.getExtension('interapp.mikedown-editor')!;
      const pkg = JSON.parse(fs.readFileSync(path.join(ext.extensionPath, 'package.json'), 'utf8'));
      const props = pkg.contributes.configuration.properties;
      assert.deepStrictEqual(props['mikedown.slashCommands.dateFormat'].enum, ['iso', 'long']);
      assert.strictEqual(props['mikedown.slashCommands.enabled'].default, true);
      assert.strictEqual(props['mikedown.slashCommands.timeZone'].default, 'local');
      assert.ok(!('mikedown.slashCommands.trigger' in props));
    });
  });

  suite('saveSettings — dateFormat / timeZone', () => {
    test('a saveSettings message persists new dateFormat/timeZone values, readable back', async () => {
      const { document, panel } = await openFixture();
      await exportsApi.__test.dispatchMessage(document, panel, {
        type: 'saveSettings',
        settings: { slashCommandsDateFormat: 'long', slashCommandsTimeZone: 'America/New_York' },
      });
      // handleSaveSettings fires config.update() without awaiting it (same
      // fire-and-forget pattern as every other field it persists) — give it
      // a beat to land before reading back.
      await new Promise(r => setTimeout(r, 100));
      const config = vscode.workspace.getConfiguration('mikedown');
      assert.strictEqual(config.get('slashCommands.dateFormat'), 'long');
      assert.strictEqual(config.get('slashCommands.timeZone'), 'America/New_York');
    });

    test('updating slashCommands.enabled via getConfiguration().update is readable back', async () => {
      const config = vscode.workspace.getConfiguration('mikedown');
      await config.update('slashCommands.enabled', false, vscode.ConfigurationTarget.Global);
      assert.strictEqual(vscode.workspace.getConfiguration('mikedown').get('slashCommands.enabled'), false);
    });
  });

  suite('saveSettings — slash-menu disable notification', () => {
    test('source: "slashMenu" persists enabled:false and shows the Open Settings / Undo toast', async () => {
      const { document, panel } = await openFixture();
      let capturedMessage: string | undefined;
      let capturedActions: string[] = [];
      (vscode.window as any).showInformationMessage = (message: string, ...actions: string[]) => {
        capturedMessage = message;
        capturedActions = actions;
        return Promise.resolve(undefined); // dismissed — no follow-up action
      };

      await exportsApi.__test.dispatchMessage(document, panel, {
        type: 'saveSettings',
        settings: { slashCommandsEnabled: false },
        source: 'slashMenu',
      });
      await new Promise(r => setTimeout(r, 100));

      assert.strictEqual(vscode.workspace.getConfiguration('mikedown').get('slashCommands.enabled'), false);
      assert.ok(capturedMessage?.includes('turned off'), `unexpected message: ${capturedMessage}`);
      assert.deepStrictEqual(capturedActions, ['Open Settings', 'Undo']);
    });

    test('resolving the toast with "Undo" restores enabled:true', async () => {
      const { document, panel } = await openFixture();
      (vscode.window as any).showInformationMessage = () => Promise.resolve('Undo');

      await exportsApi.__test.dispatchMessage(document, panel, {
        type: 'saveSettings',
        settings: { slashCommandsEnabled: false },
        source: 'slashMenu',
      });
      // handleSaveSettings persists enabled:false synchronously, then chains
      // the toast's .then() — allow that microtask to land before asserting.
      await new Promise(r => setTimeout(r, 100));

      assert.strictEqual(vscode.workspace.getConfiguration('mikedown').get('slashCommands.enabled'), true);
    });

    test('resolving the toast with "Open Settings" posts an openSettings command to the panel', async () => {
      const { document, panel } = await openFixture();
      const posted = capturePosted(panel);
      (vscode.window as any).showInformationMessage = () => Promise.resolve('Open Settings');

      await exportsApi.__test.dispatchMessage(document, panel, {
        type: 'saveSettings',
        settings: { slashCommandsEnabled: false },
        source: 'slashMenu',
      });
      await new Promise(r => setTimeout(r, 100));

      const openSettingsMsg = posted.find(m => m.type === 'command' && m.command === 'openSettings');
      assert.ok(openSettingsMsg, `expected an openSettings command among posted messages: ${JSON.stringify(posted)}`);
      assert.strictEqual(openSettingsMsg.tab, 'behavior');
    });
  });

  suite('pickImage — host handler (handlePickImage)', () => {
    test('a file already next to the document is referenced in place with a relative insertPath', async () => {
      const { document, panel } = await openFixture();
      const imagePath = path.join(tempDir, 'inplace.png');
      fs.writeFileSync(imagePath, MINIMAL_PNG);
      (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file(imagePath)];
      const posted = capturePosted(panel);

      await exportsApi.__test.dispatchMessage(document, panel, { type: 'pickImage', requestId: 'req-inplace' });

      const result = posted.find(m => m.type === 'pickedImageResult' && m.requestId === 'req-inplace');
      assert.ok(result, `expected a pickedImageResult reply: ${JSON.stringify(posted)}`);
      assert.ok(!result.error && !result.cancelled, `unexpected error/cancel: ${JSON.stringify(result)}`);
      assert.strictEqual(result.insertPath, 'inplace.png');
    });

    test('a file outside the workspace is copied into the image-paste folder and returns a relative insertPath', async () => {
      const { document, panel } = await openFixture();
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-outside-'));
      const outsidePath = path.join(outsideDir, 'outside.png');
      fs.writeFileSync(outsidePath, MINIMAL_PNG);
      (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file(outsidePath)];
      const posted = capturePosted(panel);

      try {
        await exportsApi.__test.dispatchMessage(document, panel, { type: 'pickImage', requestId: 'req-outside' });

        const result = posted.find(m => m.type === 'pickedImageResult' && m.requestId === 'req-outside');
        assert.ok(result, `expected a pickedImageResult reply: ${JSON.stringify(posted)}`);
        assert.ok(!result.error && !result.cancelled, `unexpected error/cancel: ${JSON.stringify(result)}`);
        assert.ok(!path.isAbsolute(result.insertPath), `expected a relative insertPath, got ${result.insertPath}`);
        const copiedAbsPath = path.join(tempDir, result.insertPath);
        assert.ok(fs.existsSync(copiedAbsPath), `expected the file copied into the image-paste folder at ${copiedAbsPath}`);
        // The copy must be a real copy, not a move — the outside original is untouched.
        assert.ok(fs.existsSync(outsidePath), 'the original outside file should be left in place');
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    test('cancelling the dialog replies { cancelled: true }', async () => {
      const { document, panel } = await openFixture();
      (vscode.window as any).showOpenDialog = async () => undefined;
      const posted = capturePosted(panel);

      await exportsApi.__test.dispatchMessage(document, panel, { type: 'pickImage', requestId: 'req-cancel' });

      const result = posted.find(m => m.type === 'pickedImageResult' && m.requestId === 'req-cancel');
      assert.ok(result, `expected a pickedImageResult reply: ${JSON.stringify(posted)}`);
      assert.strictEqual(result.cancelled, true);
    });
  });
});
