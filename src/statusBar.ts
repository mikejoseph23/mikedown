import * as vscode from 'vscode';
import { countWords, readingMinutes } from './wordCount';

export class StatusBarManager {
  private wordCountItem: vscode.StatusBarItem;
  private charCountItem: vscode.StatusBarItem;
  private readingTimeItem: vscode.StatusBarItem;
  private updateTimer: NodeJS.Timeout | undefined;

  constructor() {
    this.wordCountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.charCountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.readingTimeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);

    this.wordCountItem.tooltip = 'Word count';
    this.charCountItem.tooltip = 'Character count';
    this.readingTimeItem.tooltip = 'Estimated reading time';
  }

  update(plainText: string): void {
    const wordCount = countWords(plainText);
    const charCount = plainText.length;
    const readingTime = readingMinutes(wordCount);

    this.wordCountItem.text = `$(symbol-string) ${wordCount} words`;
    this.charCountItem.text = `${charCount} chars`;
    this.readingTimeItem.text = `$(clock) ${readingTime} min read`;

    this.wordCountItem.show();
    this.charCountItem.show();
    this.readingTimeItem.show();
  }

  // Debounced update for use in real-time event listeners on large documents
  updateDebounced(text: string, delay = 300): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = setTimeout(() => this.update(text), delay);
  }

  hide(): void {
    this.wordCountItem.hide();
    this.charCountItem.hide();
    this.readingTimeItem.hide();
  }

  dispose(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.wordCountItem.dispose();
    this.charCountItem.dispose();
    this.readingTimeItem.dispose();
  }

}

// TODO (M2a): When the MikeDown webview sends a 'stats' message of the form
//   { type: 'stats', plainText: '...stripped content...' }
// the extension host (markdownEditorProvider.ts) should call:
//   statusBar.update(message.plainText)
// This wiring belongs in markdownEditorProvider.ts and should be implemented by M2a.
