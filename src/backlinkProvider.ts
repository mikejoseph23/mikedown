import * as vscode from 'vscode';
import * as path from 'path';

export interface BacklinkEntry {
  sourceFile: vscode.Uri;
  lineNumber: number;
  lineText: string;
  targetFile: string;
}

export class BacklinkProvider implements vscode.TreeDataProvider<BacklinkItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BacklinkItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private backlinks: BacklinkEntry[] = [];
  private currentFile: vscode.Uri | null = null;

  // In-memory backlink index: targetFilePath -> BacklinkEntry[]
  private index: Map<string, BacklinkEntry[]> = new Map();
  private indexBuilt = false;

  /** Call on extension activate or when active editor changes */
  setCurrentFile(uri: vscode.Uri): void {
    this.currentFile = uri;
    this.backlinks = this.index.get(uri.fsPath) || [];
    this._onDidChangeTreeData.fire();
  }

  /** Build the full workspace backlink index */
  async buildIndex(): Promise<void> {
    this.index.clear();
    const files = await vscode.workspace.findFiles('**/*.{md,markdown}', '**/node_modules/**', 500);
    await Promise.all(files.map(file => this.indexFile(file)));
    this.indexBuilt = true;
    if (this.currentFile) this.setCurrentFile(this.currentFile);
  }

  /** Update index for a single saved file */
  async updateFile(uri: vscode.Uri): Promise<void> {
    // Remove old entries for this source file
    for (const [target, entries] of this.index.entries()) {
      const filtered = entries.filter(e => e.sourceFile.fsPath !== uri.fsPath);
      if (filtered.length === 0) this.index.delete(target);
      else this.index.set(target, filtered);
    }
    await this.indexFile(uri);
    if (this.currentFile) this.setCurrentFile(this.currentFile);
  }

  private async indexFile(uri: vscode.Uri): Promise<void> {
    try {
      const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      const lines = content.split('\n');
      const linkRegex = /\[([^\]]*)\]\(([^)#]+)(#[^)]*)?\)/g;
      const dir = path.dirname(uri.fsPath);

      lines.forEach((line, lineIdx) => {
        let m: RegExpExecArray | null;
        while ((m = linkRegex.exec(line)) !== null) {
          const href = m[2].trim();
          if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) continue;
          const absTarget = path.resolve(dir, href);
          const existing = this.index.get(absTarget) || [];
          existing.push({
            sourceFile: uri,
            lineNumber: lineIdx + 1,
            lineText: line.trim().slice(0, 120),
            targetFile: absTarget,
          });
          this.index.set(absTarget, existing);
        }
      });
    } catch { /* ignore unreadable files */ }
  }

  getBacklinkCount(): number {
    return this.backlinks.length;
  }

  // ---- TreeDataProvider implementation ----

  getTreeItem(element: BacklinkItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BacklinkItem): BacklinkItem[] {
    if (element) return [];
    if (!this.currentFile || this.backlinks.length === 0) {
      return [new BacklinkItem('No backlinks found', '', 0, vscode.TreeItemCollapsibleState.None)];
    }
    return this.backlinks.map(bl =>
      new BacklinkItem(
        path.basename(bl.sourceFile.fsPath),
        bl.lineText,
        bl.lineNumber,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'vscode.open',
          title: 'Open file',
          arguments: [bl.sourceFile, { selection: new vscode.Range(bl.lineNumber - 1, 0, bl.lineNumber - 1, 0) }],
        }
      )
    );
  }
}

class BacklinkItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    public readonly lineNumber: number,
    collapsibleState: vscode.TreeItemCollapsibleState,
    command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.description = description ? `Line ${lineNumber}: ${description}` : '';
    this.tooltip = description;
    this.command = command;
  }
}
