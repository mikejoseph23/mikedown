import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './markdownEditorProvider';

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
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Nothing to clean up — subscriptions are disposed automatically.
}
