import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * T1 gap-fill: end-to-end parity checks through the real custom editor.
 *
 * The webview is a real Electron webview that Mocha cannot click or type
 * into, so editor actions go through two paths:
 *   - the real `mikedown.*` commands (bold, source toggle, sidebar), which
 *     post to the live webview exactly as a keybinding does;
 *   - the `__testOp` hook in src/webview/editor-main.ts for actions that
 *     have no command (select all, insert table, type, press a key, click).
 *     It is inert unless the host renders the page with data-test-hooks,
 *     which this suite turns on via MIKEDOWN_TEST_HOOKS before opening.
 *
 * Every assertion is on host-side state: document text, dirty flag, config,
 * files on disk. Fixtures live in a temp dir, never test/workspace.
 */

interface TestExports {
  __test: {
    dispatchMessage: (document: vscode.TextDocument, panel: vscode.WebviewPanel, message: unknown) => Promise<void>;
    getActivePanel: () => vscode.WebviewPanel | undefined;
    postToActivePanel: (message: unknown) => Thenable<boolean> | undefined;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await sleep(50);
  }
}

suite('T1 Parity Gap-Fill Integration Tests', () => {
  let tempDir: string;
  let api: TestExports['__test'];
  let originalAssociations: { global?: Record<string, string>; workspace?: Record<string, string> };

  const readConfig = (key: string) => vscode.workspace.getConfiguration('mikedown').inspect(key);

  suiteSetup(async () => {
    process.env.MIKEDOWN_TEST_HOOKS = '1';
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-gapfill-test-'));
    const ext = vscode.extensions.getExtension('interapp.mikedown-editor');
    api = ((await ext?.activate()) as TestExports).__test;
    assert.ok(api, 'expected activate() to return the test seam');
    // vscode.openWith can leave a workbench.editorAssociations entry behind
    // (see exportPipeline.test.ts); restore it so sibling suites are unaffected.
    const inspected = vscode.workspace.getConfiguration().inspect<Record<string, string>>('workbench.editorAssociations');
    originalAssociations = { global: inspected?.globalValue, workspace: inspected?.workspaceValue };
  });

  suiteTeardown(async () => {
    delete process.env.MIKEDOWN_TEST_HOOKS;
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const config = vscode.workspace.getConfiguration();
    await config.update('workbench.editorAssociations', originalAssociations.workspace, vscode.ConfigurationTarget.Workspace);
    await config.update('workbench.editorAssociations', originalAssociations.global, vscode.ConfigurationTarget.Global);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  function makeFixture(name: string, content: string): string {
    const file = path.join(tempDir, name);
    fs.writeFileSync(file, content);
    return file;
  }

  async function openInMikeDown(file: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.commands.executeCommand('mikedown.openWithMikeDown', doc.uri);
    await waitFor(() => !!api.getActivePanel(), 5000, 'active MikeDown panel');
    // The webview has no "ready" signal visible to the host; give TipTap time
    // to mount and receive its first `update`.
    await sleep(1500);
    return doc;
  }

  const op = (o: string, extra: Record<string, unknown> = {}) =>
    api.postToActivePanel({ type: '__testOp', op: o, ...extra });

  /**
   * Run `action` until the document text satisfies `done`. The webview offers
   * no ready handshake, so a first attempt that lands before TipTap mounts is
   * simply repeated. Actions passed here must be idempotent.
   */
  async function actUntil(doc: vscode.TextDocument, action: () => Promise<void>, done: (t: string) => boolean): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await action();
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        if (done(doc.getText())) {
          return doc.getText();
        }
        await sleep(50);
      }
    }
    throw new Error(`document never reached expected state; text was: ${JSON.stringify(doc.getText())}`);
  }

  test('insert table (toolbar picker call) writes a markdown table', async function () {
    this.timeout(30000);
    const doc = await openInMikeDown(makeFixture('table.md', 'Before\n'));
    const text = await actUntil(
      doc,
      async () => { await op('endOfDoc'); await op('insertTable'); },
      (t) => /\|.*\|/.test(t)
    );
    const lines = text.split('\n').filter((l) => l.trim().startsWith('|'));
    assert.ok(lines.length >= 3, `expected a header, separator and rows, got: ${JSON.stringify(text)}`);
    assert.ok(/^\|[\s:|-]+\|$/.test(lines[1].trim()), `second table line should be the separator, got: ${lines[1]}`);
    assert.strictEqual((lines[0].match(/\|/g) ?? []).length, 4, 'a 3-column table has 4 pipes per row');
    assert.ok(text.startsWith('Before'), 'existing text is preserved');
  });

  test('mikedown.toggleBold bolds the selected text', async function () {
    this.timeout(30000);
    const doc = await openInMikeDown(makeFixture('bold.md', 'plain words\n'));
    // toggleBold is not idempotent, so select-all + the real command run once
    // per attempt only while the text is still unbolded.
    const text = await actUntil(
      doc,
      async () => {
        await op('selectAll');
        await vscode.commands.executeCommand('mikedown.toggleBold');
      },
      (t) => t.includes('**')
    );
    assert.ok(/\*\*plain words\*\*/.test(text), `expected bolded text, got ${JSON.stringify(text)}`);
  });

  test('source mode toggle and back leaves text unchanged and the editor clean', async function () {
    this.timeout(30000);
    const original = '# Heading\n\nSome *emphasis* and a [link](https://example.com).\n';
    const doc = await openInMikeDown(makeFixture('mode.md', original));
    await vscode.commands.executeCommand('mikedown.toggleSourceMode');
    await sleep(800);
    assert.strictEqual(doc.getText(), original, 'entering source mode must not rewrite the document');
    assert.strictEqual(doc.isDirty, false, 'entering source mode must not dirty the document');
    await vscode.commands.executeCommand('mikedown.toggleSourceMode');
    await sleep(800);
    assert.strictEqual(doc.getText(), original, 'returning to WYSIWYG must not rewrite the document');
    assert.strictEqual(doc.isDirty, false, 'returning to WYSIWYG must not dirty the document');
  });

  test('/date slash command inserts today\'s date', async function () {
    this.timeout(30000);
    const config = vscode.workspace.getConfiguration('mikedown');
    await config.update('slashCommands.enabled', true, vscode.ConfigurationTarget.Global);
    await config.update('slashCommands.dateFormat', 'iso', vscode.ConfigurationTarget.Global);
    await config.update('slashCommands.timeZone', undefined, vscode.ConfigurationTarget.Global);
    try {
      const doc = await openInMikeDown(makeFixture('date.md', ''));
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const isoDates = new Set<string>();
      // Allow for a local-midnight rollover mid-test.
      for (const d of [now, new Date(now.getTime() + 60000)]) {
        isoDates.add(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      }
      const text = await actUntil(
        doc,
        async () => {
          await op('endOfDoc');
          await op('type', { text: '/date' });
          await sleep(300);
          await op('key', { key: 'Enter' });
        },
        (t) => /\d{4}-\d{2}-\d{2}/.test(t)
      );
      const found = text.match(/\d{4}-\d{2}-\d{2}/)![0];
      assert.ok(isoDates.has(found), `expected today's date, got ${found} in ${JSON.stringify(text)}`);
      assert.ok(!text.includes('/date'), `the /date query is replaced, not left behind: ${JSON.stringify(text)}`);
    } finally {
      await config.update('slashCommands.enabled', undefined, vscode.ConfigurationTarget.Global);
      await config.update('slashCommands.dateFormat', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('body font saved through saveSettings persists across closing and reopening the panel', async function () {
    this.timeout(30000);
    const file = makeFixture('font.md', '# Font\n');
    const config = vscode.workspace.getConfiguration('mikedown');
    try {
      const doc = await openInMikeDown(file);
      await api.dispatchMessage(doc, api.getActivePanel()!, { type: 'saveSettings', settings: { fontFamily: 'Georgia, serif' } });
      await waitFor(() => readConfig('fontFamily')?.globalValue === 'Georgia, serif', 5000, 'fontFamily to be written');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await sleep(300);
      await openInMikeDown(file);
      assert.strictEqual(
        vscode.workspace.getConfiguration('mikedown').get('fontFamily'),
        'Georgia, serif',
        'the font survives a panel reload'
      );
    } finally {
      await config.update('fontFamily', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('sidebar toggle command runs and the pin persists mikedown.sidebar.visibility', async function () {
    this.timeout(30000);
    const config = vscode.workspace.getConfiguration('mikedown');
    const before = readConfig('sidebar.visibility')?.globalValue;
    try {
      await config.update('sidebar.visibility', 'never', vscode.ConfigurationTarget.Global);
      const doc = await openInMikeDown(makeFixture('sidebar.md', '# One\n\n## Two\n'));
      await vscode.commands.executeCommand('mikedown.toggleSidebar');
      await sleep(300);
      assert.strictEqual(doc.isDirty, false, 'toggling the sidebar is not a document change');
      // The pin button posts sidebarSetPref; the host persists it globally.
      // Retry because the click is lost if the sidebar is not mounted yet.
      for (let i = 0; i < 5 && readConfig('sidebar.visibility')?.globalValue !== 'always'; i++) {
        await op('click', { selector: '.outline-pin' });
        await sleep(600);
      }
      assert.strictEqual(readConfig('sidebar.visibility')?.globalValue, 'always', 'pin click persists "always"');
      await op('click', { selector: '.outline-pin' });
      await waitFor(() => readConfig('sidebar.visibility')?.globalValue === 'never', 5000, 'unpin to persist "never"');
    } finally {
      await config.update('sidebar.visibility', before, vscode.ConfigurationTarget.Global);
    }
  });

  test('close and reopen keeps edited content and the document is not dirty after save', async function () {
    this.timeout(30000);
    const file = makeFixture('reopen.md', 'reopen me\n');
    const doc = await openInMikeDown(file);
    await actUntil(
      doc,
      async () => { await op('selectAll'); await vscode.commands.executeCommand('mikedown.toggleBold'); },
      (t) => t.includes('**')
    );
    const edited = doc.getText();
    await doc.save();
    assert.strictEqual(doc.isDirty, false);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await sleep(300);
    const reopened = await openInMikeDown(file);
    assert.strictEqual(reopened.getText(), edited, 'content intact after reopen');
    assert.strictEqual(reopened.isDirty, false, 'reopening does not dirty the document');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), edited, 'content on disk matches');
  });

  test('diff path: a second panel for the same file redirects to the source diff, and the editor is editable after it closes', async function () {
    this.timeout(40000);
    const file = makeFixture('diff.md', 'diff target\n');
    const doc = await openInMikeDown(file);
    // Opening the same file as both sides of a diff makes VS Code resolve the
    // custom editor twice for one fsPath, which is what a Git diff does.
    const uri = vscode.Uri.file(file);
    const diffTabs = () =>
      vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputTextDiff);
    await vscode.commands.executeCommand('vscode.diff', uri, uri, 'diff target');
    // The provider redirects the duplicate panel to the plain-text diff.
    await waitFor(() => diffTabs().length > 0, 10000, 'the source text diff tab');
    await sleep(1000);
    const textDiff = diffTabs()[0].input as vscode.TabInputTextDiff;
    assert.strictEqual(textDiff.modified.scheme, 'file', 'the diff shows the real file in the built-in text editor');
    assert.ok(
      !vscode.window.tabGroups.all.flatMap((g) => g.tabs).some(
        (t) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.toString() !== uri.toString()
      ),
      'no other diff tab is left open'
    );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await sleep(500);
    const reopened = await openInMikeDown(file);
    assert.strictEqual(reopened.getText(), doc.getText());
    const text = await actUntil(
      reopened,
      async () => { await op('selectAll'); await vscode.commands.executeCommand('mikedown.toggleBold'); },
      (t) => t.includes('**')
    );
    assert.ok(/\*\*diff target\*\*/.test(text), `edit after the diff closes lands in the document: ${JSON.stringify(text)}`);
  });

  test('exportHtml writes a standalone HTML file', async function () {
    this.timeout(30000);
    const out = path.join(tempDir, 'exported.html');
    const original = vscode.window.showSaveDialog;
    (vscode.window as any).showSaveDialog = async () => vscode.Uri.file(out);
    try {
      await openInMikeDown(makeFixture('export.md', '# Exported\n\nSome **bold** text.\n'));
      const deadline = Date.now() + 15000;
      while (!fs.existsSync(out) && Date.now() < deadline) {
        await vscode.commands.executeCommand('mikedown.exportHtml');
        await sleep(500);
      }
      assert.ok(fs.existsSync(out), 'exportHtml should write the chosen file');
      const html = fs.readFileSync(out, 'utf8');
      assert.ok(html.startsWith('<!DOCTYPE html>'), 'standalone document');
      assert.ok(html.includes('Exported'), 'heading rendered');
      assert.ok(html.includes('<strong>bold</strong>'), 'inline formatting rendered');
    } finally {
      (vscode.window as any).showSaveDialog = original;
    }
  });
});
