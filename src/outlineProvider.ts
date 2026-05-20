import * as vscode from 'vscode';

// ── Shared heading parser ───────────────────────────────────────────────────

export interface HeadingInfo {
  level: number;
  text: string;
  anchor: string;
  line: number;
}

function githubAnchorId(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

export function parseHeadings(text: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  const lines = text.split('\n');
  while ((m = regex.exec(text)) !== null) {
    const line = text.slice(0, m.index).split('\n').length - 1;
    headings.push({
      level: m[1].length,
      text: m[2].trim(),
      anchor: githubAnchorId(m[2].trim()),
      line,
    });
  }
  return headings;
}

// ── DocumentSymbolProvider (populates VS Code Outline panel) ────────────────

export class MarkdownOutlineSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const headings = parseHeadings(document.getText());
    if (headings.length === 0) return [];

    // Build nested tree using a stack
    const root: vscode.DocumentSymbol[] = [];
    const stack: Array<{ level: number; symbol: vscode.DocumentSymbol }> = [];

    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const nextLine = i + 1 < headings.length ? headings[i + 1].line : document.lineCount;
      const range = new vscode.Range(h.line, 0, nextLine - 1, document.lineAt(Math.min(nextLine - 1, document.lineCount - 1)).text.length);
      const selectionRange = new vscode.Range(h.line, 0, h.line, document.lineAt(h.line).text.length);

      const symbol = new vscode.DocumentSymbol(
        h.text,
        '',
        vscode.SymbolKind.String,
        range,
        selectionRange
      );

      // Pop stack entries at same or deeper level
      while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
        stack.pop();
      }

      if (stack.length > 0) {
        stack[stack.length - 1].symbol.children.push(symbol);
      } else {
        root.push(symbol);
      }

      stack.push({ level: h.level, symbol });
    }

    return root;
  }
}

