import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { StatusBarManager } from './statusBar';
import { exportViaPrint } from './export';
import { BacklinkProvider } from './backlinkProvider';
import { MarkdownOutlineSymbolProvider, DocumentOutlineProvider, parseHeadings } from './outlineProvider';

/**
 * Called when the extension is activated.
 * Registers the MikeDown custom text editor provider.
 */
export function activate(context: vscode.ExtensionContext): void {
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
  const formattingCommands = ['toggleBold', 'toggleItalic', 'toggleStrike', 'toggleCode', 'undo', 'redo'];
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

  // M14: Document stats status bar
  const statusBar = new StatusBarManager();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // Show/hide stats when the active editor changes
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) {
      statusBar.hide();
      return;
    }
    // Show only for .md/.markdown files
    const doc = editor.document;
    if (doc.languageId === 'markdown' || doc.fileName.endsWith('.md') || doc.fileName.endsWith('.markdown')) {
      statusBar.update(doc.getText());
    } else {
      statusBar.hide();
    }
  }, null, context.subscriptions);

  // Update stats in real-time as the document changes (debounced for performance)
  vscode.workspace.onDidChangeTextDocument((event) => {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && event.document === activeEditor.document) {
      const doc = event.document;
      if (doc.languageId === 'markdown' || doc.fileName.endsWith('.md') || doc.fileName.endsWith('.markdown')) {
        statusBar.updateDebounced(doc.getText());
      }
    }
  }, null, context.subscriptions);

  // M6c: Backlink panel
  const backlinkProvider = new BacklinkProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('mikedown.backlinks', backlinkProvider)
  );

  // Build backlink index on activate (in background)
  backlinkProvider.buildIndex().catch(() => {});

  // Update index when files are saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.languageId === 'markdown' || doc.fileName.endsWith('.md') || doc.fileName.endsWith('.markdown')) {
        backlinkProvider.updateFile(doc.uri);
      }
    })
  );

  // Update backlinks when active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && (editor.document.languageId === 'markdown' || editor.document.fileName.endsWith('.md'))) {
        backlinkProvider.setCurrentFile(editor.document.uri);
      }
    })
  );

  // Update index on file create/delete
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(e => e.files.forEach(f => backlinkProvider.updateFile(f))),
    vscode.workspace.onDidDeleteFiles(e => e.files.forEach(f => backlinkProvider.updateFile(f)))
  );

  // Expose backlinkProvider on MarkdownEditorProvider for checkLinks handler
  (MarkdownEditorProvider as any)._backlinkProvider = backlinkProvider;

  // Document Outline — custom TreeView with click-to-navigate
  const outlineProvider = new DocumentOutlineProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('mikedown.outline', outlineProvider)
  );

  // DocumentSymbolProvider — populates VS Code's built-in Outline panel
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'markdown', scheme: 'file' },
      new MarkdownOutlineSymbolProvider(),
      { label: 'MikeDown Headings' }
    )
  );

  // Reveal heading command — used by the Document Outline tree items
  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.revealHeading', (anchor: string) => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        panel.webview.postMessage({ type: 'scrollToAnchor', anchor });
      }
    })
  );

  // Expose outlineProvider so MarkdownEditorProvider can update it
  (MarkdownEditorProvider as any)._outlineProvider = outlineProvider;
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Nothing to clean up — subscriptions are disposed automatically.
}
