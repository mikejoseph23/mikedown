import * as vscode from 'vscode';
import * as nodeFs from 'fs';
import type { AiDocBase } from '@mikedown/core/ai';
import { getSettings } from '../settings';
import { DocsHost, type DocsEntryKind, type DocsFs } from './docsHost';

/**
 * The VS Code wiring for `DocsHost` (docsHost.ts has none): the file system
 * (`vscode.workspace.fs` for walking and reading, Node's `realpath` for
 * canonicalizing), one `FileSystemWatcher` per root, the user-level settings
 * and the workspace folder picker. Read-only apart from `saveBases`, which
 * writes `mikedown.ai.docBases` at user level.
 */

/**
 * `vscode.FileType` is a bitmask: a symlinked folder is `Directory | SymbolicLink`.
 * Test with `&`, and let the link bit win, so the walker never sees a link as a folder or file (A9).
 */
export function entryKind(type: number): DocsEntryKind {
  if (type & vscode.FileType.SymbolicLink) {return 'symlink';}
  if (type & vscode.FileType.Directory) {return 'dir';}
  if (type & vscode.FileType.File) {return 'file';}
  return 'other';
}

export function createVsCodeDocsFs(): DocsFs {
  const decoder = new TextDecoder('utf-8');
  return {
    readDirectory: async (dir) => {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
      return entries.map(([name, type]) => ({ name, kind: entryKind(type) }));
    },
    stat: async (path) => {
      const s = await vscode.workspace.fs.stat(vscode.Uri.file(path));
      return { kind: entryKind(s.type), size: s.size };
    },
    readFile: async (path) => decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path))),
    realpath: (path) => nodeFs.promises.realpath(path),
  };
}

/** The open workspace folder to add as a base root: the only one, or the user's pick when there are several. */
export async function pickWorkspaceFolder(): Promise<string | null> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showInformationMessage('MikeDown: open a folder first, or type the path of the folder to add.');
    return null;
  }
  if (folders.length === 1) {return folders[0].uri.fsPath;}
  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, fsPath: f.uri.fsPath })),
    { title: 'Add a workspace folder as a documentation base', placeHolder: 'Choose a folder' },
  );
  return pick ? pick.fsPath : null;
}

/** Write `mikedown.ai.docBases` at user level, never a workspace value (S4). */
async function writeBases(bases: AiDocBase[]): Promise<void> {
  await vscode.workspace.getConfiguration('mikedown').update('ai.docBases', JSON.parse(JSON.stringify(bases)), vscode.ConfigurationTarget.Global);
}

/**
 * The host for this extension: bases from `getSettings().ai.docBases` (user
 * settings only, `effectiveAiRaw`), a watcher on each root's markdown files
 * and nothing wider (S9).
 */
export function createVsCodeDocsHost(output: vscode.OutputChannel): DocsHost {
  const log = (line: string): void => output.appendLine(`[docs] ${line}`);
  return new DocsHost({
    fs: createVsCodeDocsFs(),
    readBases: () => getSettings().ai.docBases,
    writeBases,
    pickWorkspaceFolder,
    createWatcher: (root, onChange) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*.{md,markdown}'));
      const subs = [watcher.onDidCreate(onChange), watcher.onDidChange(onChange), watcher.onDidDelete(onChange)];
      return { dispose: () => { for (const s of subs) {s.dispose();} watcher.dispose(); } };
    },
    log,
  });
}
