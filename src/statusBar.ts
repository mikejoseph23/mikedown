import * as vscode from 'vscode';
import { countWords, readingMinutes } from './wordCount';

/**
 * Status bar items for a MikeDown document:
 *   word count · char count · reading time   (always-visible while a markdown doc is active)
 *   N words · M chars selected                (only when a non-empty selection exists)
 *
 * The sidebar footer also shows the document-level numbers, but the sidebar
 * is per-instance and can be hidden — the status bar is the always-on fallback.
 */
export class StatusBarManager {
  private wordCountItem: vscode.StatusBarItem;
  private charCountItem: vscode.StatusBarItem;
  private readingTimeItem: vscode.StatusBarItem;
  private selectionItem: vscode.StatusBarItem;

  constructor() {
    // Higher priority renders further left in the right-aligned group. Group
    // doc stats together (102/101/100) and put the selection item just left of
    // them when present (103) so it sits adjacent rather than far apart.
    this.selectionItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 103);
    this.wordCountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
    this.charCountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    this.readingTimeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

    this.selectionItem.tooltip = 'Selection word / character count';
    this.wordCountItem.tooltip = 'Document word count';
    this.charCountItem.tooltip = 'Document character count';
    this.readingTimeItem.tooltip = 'Estimated reading time';
  }

  /**
   * Show whole-document stats for the active markdown editor.
   * Pass the rendered text — counts are derived from the shared `wordCount.ts`
   * helpers so the status bar and sidebar footer always agree.
   */
  showDocument(plainText: string): void {
    const words = countWords(plainText);
    const chars = plainText.length;
    const minutes = readingMinutes(words);
    this.wordCountItem.text = `$(symbol-string) ${words.toLocaleString()} words`;
    this.charCountItem.text = `${chars.toLocaleString()} chars`;
    this.readingTimeItem.text = `$(clock) ${minutes} min read`;
    this.wordCountItem.show();
    this.charCountItem.show();
    this.readingTimeItem.show();
  }

  showSelection(words: number, chars: number): void {
    if (words === 0 && chars === 0) {
      this.selectionItem.hide();
      return;
    }
    const wordsLabel = words === 1 ? 'word' : 'words';
    const charsLabel = chars === 1 ? 'char' : 'chars';
    this.selectionItem.text = `$(list-selection) ${words.toLocaleString()} ${wordsLabel} · ${chars.toLocaleString()} ${charsLabel} selected`;
    this.selectionItem.show();
  }

  hideSelection(): void {
    this.selectionItem.hide();
  }

  /** Hide all items — used when no markdown editor is active. */
  hide(): void {
    this.selectionItem.hide();
    this.wordCountItem.hide();
    this.charCountItem.hide();
    this.readingTimeItem.hide();
  }

  dispose(): void {
    this.selectionItem.dispose();
    this.wordCountItem.dispose();
    this.charCountItem.dispose();
    this.readingTimeItem.dispose();
  }
}
