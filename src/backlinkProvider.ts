import * as vscode from 'vscode';
import * as path from 'path';

export interface BacklinkEntry {
  sourceFile: vscode.Uri;
  lineNumber: number;
  lineText: string;
  targetFile: string;
  /** The href exactly as written in the source link (path + any #anchor). Lets
   *  the opened doc scroll its rendered body to this `<a>`. */
  linkHref: string;
}

/**
 * Workspace-wide backlink index. As of 2.3.0 this is just an indexer — the
 * UI lives inside each MikeDown editor's in-webview sidebar instead of a
 * VS Code TreeView. The host posts entries to the webview via
 * `MarkdownEditorProvider.broadcastBacklinks()`.
 */
export class BacklinkProvider {
  private index: Map<string, BacklinkEntry[]> = new Map();

  /** Build the full workspace backlink index */
  async buildIndex(): Promise<void> {
    this.index.clear();
    const files = await vscode.workspace.findFiles('**/*.{md,markdown}', '**/node_modules/**', 500);
    await Promise.all(files.map(file => this.indexFile(file)));
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
  }

  /** Look up backlinks pointing at a target file. */
  getBacklinksFor(targetUri: vscode.Uri): BacklinkEntry[] {
    return this.index.get(targetUri.fsPath) || [];
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
            linkHref: href + (m[3] ?? ''),
          });
          this.index.set(absTarget, existing);
        }
      });
    } catch { /* ignore unreadable files */ }
  }
}
