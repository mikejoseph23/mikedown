import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { StatusBarManager } from './statusBar';
import { exportViaPrint } from './export';
import { BacklinkProvider } from './backlinkProvider';

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
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Nothing to clean up — subscriptions are disposed automatically.
}
