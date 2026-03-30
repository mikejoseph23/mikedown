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

// ── Custom TreeView (click-to-navigate, active heading tracking) ────────────

export class DocumentOutlineProvider implements vscode.TreeDataProvider<OutlineItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OutlineItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private headings: HeadingInfo[] = [];
  private activeAnchor: string = '';

  setHeadings(headings: HeadingInfo[]): void {
    this.headings = headings;
    this._onDidChangeTreeData.fire();
  }

  setActiveAnchor(anchor: string): void {
    if (anchor !== this.activeAnchor) {
      this.activeAnchor = anchor;
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: OutlineItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: OutlineItem): OutlineItem[] {
    if (element) {
      // Return children of this heading (next-level subheadings under it)
      return this.getChildHeadings(element.headingIndex);
    }

    if (this.headings.length === 0) {
      return [new OutlineItem('No headings', '', -1, false, vscode.TreeItemCollapsibleState.None)];
    }

    // Return top-level headings (those at the minimum level in the document)
    return this.getTopLevelHeadings();
  }

  private getTopLevelHeadings(): OutlineItem[] {
    if (this.headings.length === 0) return [];
    const minLevel = Math.min(...this.headings.map(h => h.level));
    const items: OutlineItem[] = [];

    for (let i = 0; i < this.headings.length; i++) {
      if (this.headings[i].level === minLevel) {
        const hasChildren = this.hasChildHeadings(i);
        const isActive = this.headings[i].anchor === this.activeAnchor;
        items.push(new OutlineItem(
          this.headings[i].text,
          this.headings[i].anchor,
          i,
          isActive,
          hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
          {
            command: 'mikedown.revealHeading',
            title: 'Go to heading',
            arguments: [this.headings[i].anchor],
          }
        ));
      }
    }
    return items;
  }

  private getChildHeadings(parentIndex: number): OutlineItem[] {
    if (parentIndex < 0 || parentIndex >= this.headings.length) return [];
    const parentLevel = this.headings[parentIndex].level;
    const childLevel = parentLevel + 1;
    const items: OutlineItem[] = [];

    for (let i = parentIndex + 1; i < this.headings.length; i++) {
      if (this.headings[i].level <= parentLevel) break; // Reached next sibling or higher
      if (this.headings[i].level === childLevel) {
        const hasChildren = this.hasChildHeadings(i);
        const isActive = this.headings[i].anchor === this.activeAnchor;
        items.push(new OutlineItem(
          this.headings[i].text,
          this.headings[i].anchor,
          i,
          isActive,
          hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
          {
            command: 'mikedown.revealHeading',
            title: 'Go to heading',
            arguments: [this.headings[i].anchor],
          }
        ));
      }
    }
    return items;
  }

  private hasChildHeadings(parentIndex: number): boolean {
    const parentLevel = this.headings[parentIndex].level;
    for (let i = parentIndex + 1; i < this.headings.length; i++) {
      if (this.headings[i].level <= parentLevel) return false;
      if (this.headings[i].level === parentLevel + 1) return true;
    }
    return false;
  }
}

class OutlineItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly anchor: string,
    public readonly headingIndex: number,
    isActive: boolean,
    collapsibleState: vscode.TreeItemCollapsibleState,
    command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.command = command;
    this.contextValue = isActive ? 'activeHeading' : 'heading';
    if (isActive) {
      this.iconPath = new vscode.ThemeIcon('arrow-right');
    }
    if (headingIndex < 0) {
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}
