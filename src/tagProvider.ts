import * as vscode from 'vscode';
import { normalizeTag } from './tagSyntax';
import { extractTags } from './tagExtract';

/**
 * Workspace-wide tag index. Tags come from two sources, merged into one
 * namespace (the same model popular note apps use):
 *   - frontmatter `tags:` (array or scalar)
 *   - inline `#tag` tokens in the body (excluding code + link targets)
 *
 * Mirrors `BacklinkProvider`'s lifecycle: built on activate, updated on
 * save/create/delete. Backs the in-editor tag click → QuickPick flow.
 */
export class TagProvider {
  private docTags = new Map<string, Set<string>>(); // fsPath -> normalized tags

  async buildIndex(): Promise<void> {
    this.docTags.clear();
    const files = await vscode.workspace.findFiles('**/*.{md,markdown}', '**/node_modules/**', 500);
    await Promise.all(files.map(f => this.indexFile(f)));
  }

  /** Re-index a single file (or drop it if it no longer reads). */
  async updateFile(uri: vscode.Uri): Promise<void> {
    await this.indexFile(uri);
  }

  /**
   * Documents carrying `tag` or any nested child (`tag/...`). Case-insensitive.
   * A query of `#project` also matches `#project/active`.
   */
  getDocsForTag(tag: string): string[] {
    const q = normalizeTag(tag);
    if (!q) return [];
    const prefix = q + '/';
    const out: string[] = [];
    for (const [fsPath, tags] of this.docTags) {
      for (const t of tags) {
        if (t === q || t.startsWith(prefix)) { out.push(fsPath); break; }
      }
    }
    return out.sort();
  }

  private async indexFile(uri: vscode.Uri): Promise<void> {
    try {
      const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      const tags = extractTags(content);
      if (tags.size > 0) this.docTags.set(uri.fsPath, tags);
      else this.docTags.delete(uri.fsPath);
    } catch {
      this.docTags.delete(uri.fsPath); // unreadable / deleted
    }
  }
}
