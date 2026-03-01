import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { StatusBarManager } from './statusBar';

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
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Nothing to clean up — subscriptions are disposed automatically.
}
