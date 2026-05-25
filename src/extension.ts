import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { StatusBarManager } from './statusBar';
import { exportViaPrint } from './export';
import { BacklinkProvider } from './backlinkProvider';
import { MarkdownOutlineSymbolProvider } from './outlineProvider';
import { NagPrompt } from './nagPrompt';

/**
 * One-shot migration: rename `mikedown.outline.*` settings + globalState key
 * to `mikedown.sidebar.*`. Runs on every activation but no-ops once the old
 * keys are cleared. Cheap enough to leave in place.
 */
async function migrateOutlineSettings(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('mikedown');
  const keys = [
    ['outline.visibility', 'sidebar.visibility'],
    ['outline.width', 'sidebar.width'],
    ['outline.position', 'sidebar.position'],
  ] as const;
  for (const [oldKey, newKey] of keys) {
    const inspected = config.inspect(oldKey);
    if (!inspected) continue;
    const newInspected = config.inspect(newKey);
    const writeIfUnset = async (scope: vscode.ConfigurationTarget, oldVal: unknown, newVal: unknown): Promise<void> => {
      if (oldVal !== undefined && newVal === undefined) {
        await config.update(newKey, oldVal, scope);
      }
      if (oldVal !== undefined) {
        await config.update(oldKey, undefined, scope);
      }
    };
    await writeIfUnset(vscode.ConfigurationTarget.Global, inspected.globalValue, newInspected?.globalValue);
    await writeIfUnset(vscode.ConfigurationTarget.Workspace, inspected.workspaceValue, newInspected?.workspaceValue);
    await writeIfUnset(vscode.ConfigurationTarget.WorkspaceFolder, inspected.workspaceFolderValue, newInspected?.workspaceFolderValue);
  }
  // GlobalState key rename
  const oldRem = context.globalState.get<Record<string, boolean>>('mikedown.outline.rememberedVisible');
  const newRem = context.globalState.get<Record<string, boolean>>('mikedown.sidebar.rememberedVisible');
  if (oldRem && !newRem) {
    await context.globalState.update('mikedown.sidebar.rememberedVisible', oldRem);
    await context.globalState.update('mikedown.outline.rememberedVisible', undefined);
  }

  // 2.4.x — visibility went binary (pin on/off). Drop the orphaned per-doc
  // visibility map, and collapse any leftover 'remember' value to 'never'.
  if (context.globalState.get('mikedown.sidebar.rememberedVisible') !== undefined) {
    await context.globalState.update('mikedown.sidebar.rememberedVisible', undefined);
  }
  const visInspect = config.inspect('sidebar.visibility');
  const fixIfRemember = async (scope: vscode.ConfigurationTarget, val: unknown): Promise<void> => {
    if (val === 'remember') {
      await config.update('sidebar.visibility', 'never', scope);
    }
  };
  if (visInspect) {
    await fixIfRemember(vscode.ConfigurationTarget.Global, visInspect.globalValue);
    await fixIfRemember(vscode.ConfigurationTarget.Workspace, visInspect.workspaceValue);
    await fixIfRemember(vscode.ConfigurationTarget.WorkspaceFolder, visInspect.workspaceFolderValue);
  }
}

/**
 * Called when the extension is activated.
 * Registers the MikeDown custom text editor provider.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Fire-and-forget — runs every activation but no-ops once migrated.
  migrateOutlineSettings(context).catch(() => {});

  const provider = new MarkdownEditorProvider(context);

  const registration = vscode.window.registerCustomEditorProvider(
    MarkdownEditorProvider.viewType,
    provider,
    {
      webviewOptions: {
        retainContextWhenHidden: true
      },
      supportsMultipleEditorsPerDocument: false
    }
  );

  context.subscriptions.push(registration);

  console.log('MikeDown Editor is now active.');

  // M3 — Register formatting commands for VS Code keybindings.
  // Each command posts a message to the active webview panel so TipTap
  // can handle the formatting action directly inside the editor.
  const formattingCommands = ['toggleBold', 'toggleItalic', 'toggleStrike', 'toggleHighlight', 'toggleCode', 'openEmojiPicker', 'undo', 'redo'];
  for (const cmd of formattingCommands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`mikedown.${cmd}`, () => {
        const panel = MarkdownEditorProvider.activePanel;
        if (panel) {
          panel.webview.postMessage({ type: 'command', command: cmd });
        }
      })
    );
  }

  // M3 — Register toggleSourceMode command (placeholder — toggle logic in M4).
  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.toggleSourceMode', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        panel.webview.postMessage({ type: 'toggleSource' });
      }
    })
  );

  // M11 — Export commands
  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.exportHtml', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        panel.webview.postMessage({ type: 'requestExportHtml' });
      } else {
        vscode.window.showWarningMessage('Open a markdown file in MikeDown to export.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.print', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        exportViaPrint(panel);
      } else {
        vscode.window.showWarningMessage('Open a markdown file in MikeDown to print.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.viewInBrowser', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        panel.webview.postMessage({ type: 'requestViewInBrowser' });
      } else {
        vscode.window.showWarningMessage('Open a markdown file in MikeDown to view in browser.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.copyAsRichText', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        panel.webview.postMessage({ type: 'copyAsRichText' });
      }
    })
  );

  // "Open with MikeDown" command — works from explorer, editor tab, and command palette
  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.openWithMikeDown', async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        vscode.window.showWarningMessage('No markdown file selected.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', targetUri, MarkdownEditorProvider.viewType);
    })
  );

  // "Show Git Diff" — virtual document provider + diff command.
  // Uses a custom URI scheme so VS Code opens both sides with the built-in
  // text editor (not MikeDown), giving proper green/red line-level highlighting.
  const diffContents = new Map<string, string>();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('mikedown-diff', {
      provideTextDocumentContent(uri: vscode.Uri): string {
        return diffContents.get(uri.query) ?? '';
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.showDiff', async (fileUri?: vscode.Uri) => {
      const uri = fileUri ?? MarkdownEditorProvider.activeDocument?.uri;
      if (!uri) {
        vscode.window.showWarningMessage('No MikeDown editor is active.');
        return;
      }

      const cwd = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? path.dirname(uri.fsPath);
      const relativePath = path.relative(cwd, uri.fsPath);

      let headContent: string;
      try {
        headContent = cp.execSync(`git show HEAD:"${relativePath}"`, { cwd, encoding: 'utf-8' });
      } catch {
        vscode.window.showWarningMessage('No git history found for this file.');
        return;
      }

      // Read current working copy from disk (not from TipTap which may normalize)
      let workingContent: string;
      try {
        workingContent = fs.readFileSync(uri.fsPath, 'utf-8');
      } catch {
        workingContent = '';
      }

      const ts = Date.now();
      const leftKey = `head-${ts}`;
      const rightKey = `working-${ts}`;
      diffContents.set(leftKey, headContent);
      diffContents.set(rightKey, workingContent);

      // Use .md.diff extension so VS Code's custom editor selector (*.md) does NOT match
      const diffPath = uri.path + '.diff';
      const leftUri = vscode.Uri.from({ scheme: 'mikedown-diff', path: diffPath, query: leftKey });
      const rightUri = vscode.Uri.from({ scheme: 'mikedown-diff', path: diffPath, query: rightKey });
      const title = `${vscode.workspace.asRelativePath(uri)} (Git Diff)`;

      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

      // Clean up snapshot data after a delay
      setTimeout(() => { diffContents.delete(leftKey); diffContents.delete(rightKey); }, 60000);
    })
  );

  // Status bar — shows document word/char/read-time + selection counts for
  // markdown documents. Driven by 'stats' messages from MikeDown webviews and
  // by direct watchers for plain-text markdown editors.
  const statusBar = new StatusBarManager();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });
  MarkdownEditorProvider.statusBar = statusBar;

  const isMarkdownDoc = (doc: vscode.TextDocument): boolean =>
    doc.languageId === 'markdown' || doc.fileName.endsWith('.md') || doc.fileName.endsWith('.markdown');

  // Plain-text markdown editor path — MikeDown webviews drive the status bar
  // via 'stats' messages; this branch covers .md files opened in the standard
  // text editor (e.g. via "Open With… → Text Editor").
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && isMarkdownDoc(editor.document)) {
      statusBar.hideSelection();
      statusBar.showDocument(editor.document.getText());
      return;
    }
    // No plain-text markdown editor active — let the custom-editor provider's
    // onDidChangeViewState handler decide whether to keep stats showing.
    if (!MarkdownEditorProvider.activePanel) {
      statusBar.hide();
    }
  }, null, context.subscriptions);

  // Debounce per-keystroke updates on large docs.
  let plainTextDebounce: NodeJS.Timeout | undefined;
  vscode.workspace.onDidChangeTextDocument((event) => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || event.document !== activeEditor.document) return;
    if (!isMarkdownDoc(event.document)) return;
    if (plainTextDebounce) clearTimeout(plainTextDebounce);
    plainTextDebounce = setTimeout(() => {
      statusBar.showDocument(event.document.getText());
    }, 250);
  }, null, context.subscriptions);

  // Backlink index — backs the in-editor sidebar's Backlinks section.
  // Previously also registered as a TreeDataProvider for the (now-removed)
  // MikeDown activity-bar icon; the index itself stays, just headless now.
  const backlinkProvider = new BacklinkProvider();
  MarkdownEditorProvider.backlinkProvider = backlinkProvider;

  // Build backlink index on activate (in background)
  backlinkProvider.buildIndex().catch(() => {});

  // Update index when files are saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.languageId === 'markdown' || doc.fileName.endsWith('.md') || doc.fileName.endsWith('.markdown')) {
        backlinkProvider.updateFile(doc.uri).then(() => {
          MarkdownEditorProvider.broadcastBacklinks();
        }).catch(() => {});
      }
    })
  );

  // Update index on file create/delete
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(e => Promise.all(e.files.map(f => backlinkProvider.updateFile(f))).then(() => MarkdownEditorProvider.broadcastBacklinks()).catch(() => {})),
    vscode.workspace.onDidDeleteFiles(e => Promise.all(e.files.map(f => backlinkProvider.updateFile(f))).then(() => MarkdownEditorProvider.broadcastBacklinks()).catch(() => {}))
  );

  // DocumentSymbolProvider — populates VS Code's built-in Outline panel for
  // markdown files opened in the plain-text editor (the built-in pane is
  // unreachable from custom editors, so this only benefits non-MikeDown views).
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'markdown', scheme: 'file' },
      new MarkdownOutlineSymbolProvider(),
      { label: 'MikeDown Headings' }
    )
  );

  // Periodic "enjoying MikeDown?" toast. Backed by globalState — fires only
  // after 7d install + ≥3 doc opens, then backs off 14→30→60→90d on dismiss
  // (30d after a CTA click). See src/nagPrompt.ts for the full schedule.
  const nag = new NagPrompt(context);
  nag.recordActivation();
  MarkdownEditorProvider.onDocOpen = () => nag.recordDocOpen();
  // Idle delay before first check — don't ambush the user during startup.
  setTimeout(() => nag.maybeShow(), 60_000);
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Nothing to clean up — subscriptions are disposed automatically.
}
