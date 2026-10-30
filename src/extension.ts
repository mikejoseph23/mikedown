import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { StatusBarManager } from './statusBar';
import { exportViaPrint, setExportExtensionPath } from './export';
import { disposeExportServer } from './exportServer';
import { BacklinkProvider } from './backlinkProvider';
import { TagProvider } from './tagProvider';
import { MarkdownOutlineSymbolProvider } from './outlineProvider';
import { maybeOfferDefaultEditorPrompt, setAsDefaultEditorCommand } from './defaultEditorPrompt';
import { getSettings } from './settings';
import { AiStatusBar } from './ai/statusBar';
import { createVsCodeAiService, writeBackEngineIds } from './ai/vscodeAi';

/**
 * One-shot migration: rename `mikedown.outline.*` settings + globalState key
 * to `mikedown.sidebar.*`. Runs on every activation but no-ops once the old
 * keys are cleared. Cheap enough to leave in place.
 */
async function migrateOutlineSettings(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('mikedown');
  const keys = [
    ['outline.visibility', 'sidebar.visibility'],
    ['outline.width', 'sidebar.width'],
    ['outline.position', 'sidebar.position'],
  ] as const;
  for (const [oldKey, newKey] of keys) {
    const inspected = config.inspect(oldKey);
    if (!inspected) {continue;}
    const newInspected = config.inspect(newKey);
    const writeIfUnset = async (scope: vscode.ConfigurationTarget, oldVal: unknown, newVal: unknown): Promise<void> => {
      if (oldVal !== undefined && newVal === undefined) {
        await config.update(newKey, oldVal, scope);
      }
      if (oldVal !== undefined) {
        await config.update(oldKey, undefined, scope);
      }
    };
    await writeIfUnset(vscode.ConfigurationTarget.Global, inspected.globalValue, newInspected?.globalValue);
    await writeIfUnset(vscode.ConfigurationTarget.Workspace, inspected.workspaceValue, newInspected?.workspaceValue);
    await writeIfUnset(vscode.ConfigurationTarget.WorkspaceFolder, inspected.workspaceFolderValue, newInspected?.workspaceFolderValue);
  }
  // GlobalState key rename
  const oldRem = context.globalState.get<Record<string, boolean>>('mikedown.outline.rememberedVisible');
  const newRem = context.globalState.get<Record<string, boolean>>('mikedown.sidebar.rememberedVisible');
  if (oldRem && !newRem) {
    await context.globalState.update('mikedown.sidebar.rememberedVisible', oldRem);
    await context.globalState.update('mikedown.outline.rememberedVisible', undefined);
  }

  // 2.4.x — visibility went binary (pin on/off). Drop the orphaned per-doc
  // visibility map, and collapse any leftover 'remember' value to 'never'.
  if (context.globalState.get('mikedown.sidebar.rememberedVisible') !== undefined) {
    await context.globalState.update('mikedown.sidebar.rememberedVisible', undefined);
  }
  const visInspect = config.inspect('sidebar.visibility');
  const fixIfRemember = async (scope: vscode.ConfigurationTarget, val: unknown): Promise<void> => {
    if (val === 'remember') {
      await config.update('sidebar.visibility', 'never', scope);
    }
  };
  if (visInspect) {
    await fixIfRemember(vscode.ConfigurationTarget.Global, visInspect.globalValue);
    await fixIfRemember(vscode.ConfigurationTarget.Workspace, visInspect.workspaceValue);
    await fixIfRemember(vscode.ConfigurationTarget.WorkspaceFolder, visInspect.workspaceFolderValue);
  }
}

/**
 * Called when the extension is activated.
 * Registers the MikeDown custom text editor provider.
 */
export function activate(context: vscode.ExtensionContext) {
  // Fire-and-forget — runs every activation but no-ops once migrated.
  migrateOutlineSettings(context).catch(() => {});
  setExportExtensionPath(context.extensionPath);

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


  // M3 — Register formatting commands for VS Code keybindings.
  // Each command posts a message to the active webview panel so TipTap
  // can handle the formatting action directly inside the editor.
  const formattingCommands = ['toggleBold', 'toggleItalic', 'toggleStrike', 'toggleHighlight', 'toggleCode', 'pasteWithoutFormatting', 'openEmojiPicker', 'undo', 'redo', 'toggleBulletList', 'toggleOrderedList', 'toggleTaskList', 'toggleSidebar'];
  for (const cmd of formattingCommands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`mikedown.${cmd}`, () => {
        const panel = MarkdownEditorProvider.activePanel;
        if (panel) {
          void panel.webview.postMessage({ type: 'command', command: cmd });
        }
      })
    );
  }

  // M3 — Register toggleSourceMode command (placeholder — toggle logic in M4).
  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.toggleSourceMode', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        void panel.webview.postMessage({ type: 'toggleSource' });
      }
    })
  );

  // M11 — Export commands
  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.exportHtml', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        void panel.webview.postMessage({ type: 'requestExportHtml' });
      } else {
        void vscode.window.showWarningMessage('Open a markdown file in MikeDown to export.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.print', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        exportViaPrint(panel);
      } else {
        void vscode.window.showWarningMessage('Open a markdown file in MikeDown to print.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.viewInBrowser', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        void panel.webview.postMessage({ type: 'requestViewInBrowser' });
      } else {
        void vscode.window.showWarningMessage('Open a markdown file in MikeDown to view in browser.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.copyAsRichText', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        void panel.webview.postMessage({ type: 'copyAsRichText' });
      }
    })
  );

  // Make MikeDown the default `.md` editor — writes workbench.editorAssociations.
  // Also reachable via the first-run prompt below (see src/defaultEditorPrompt.ts).
  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.setAsDefaultEditor', () => setAsDefaultEditorCommand(context))
  );

  // "Open with MikeDown" command — works from explorer, editor tab, and command palette
  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.openWithMikeDown', async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        void vscode.window.showWarningMessage('No markdown file selected.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', targetUri, MarkdownEditorProvider.viewType);
    })
  );

  // "Show Git Diff" — virtual document provider + diff command.
  // Uses a custom URI scheme so VS Code opens both sides with the built-in
  // text editor (not MikeDown), giving proper green/red line-level highlighting.
  const diffContents = new Map<string, string>();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('mikedown-diff', {
      provideTextDocumentContent(uri: vscode.Uri): string {
        return diffContents.get(uri.query) ?? '';
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.showDiff', async (fileUri?: vscode.Uri) => {
      const uri = fileUri ?? MarkdownEditorProvider.activeDocument?.uri;
      if (!uri) {
        void vscode.window.showWarningMessage('No MikeDown editor is active.');
        return;
      }

      const cwd = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? path.dirname(uri.fsPath);
      const relativePath = path.relative(cwd, uri.fsPath);

      let headContent: string;
      try {
        headContent = cp.execSync(`git show HEAD:"${relativePath}"`, { cwd, encoding: 'utf-8' });
      } catch {
        void vscode.window.showWarningMessage('No git history found for this file.');
        return;
      }

      // Read current working copy from disk (not from TipTap which may normalize)
      let workingContent: string;
      try {
        workingContent = fs.readFileSync(uri.fsPath, 'utf-8');
      } catch {
        workingContent = '';
      }

      const ts = Date.now();
      const leftKey = `head-${ts}`;
      const rightKey = `working-${ts}`;
      diffContents.set(leftKey, headContent);
      diffContents.set(rightKey, workingContent);

      // Use .md.diff extension so VS Code's custom editor selector (*.md) does NOT match
      const diffPath = uri.path + '.diff';
      const leftUri = vscode.Uri.from({ scheme: 'mikedown-diff', path: diffPath, query: leftKey });
      const rightUri = vscode.Uri.from({ scheme: 'mikedown-diff', path: diffPath, query: rightKey });
      const title = `${vscode.workspace.asRelativePath(uri)} (Git Diff)`;

      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

      // Clean up snapshot data after a delay
      setTimeout(() => { diffContents.delete(leftKey); diffContents.delete(rightKey); }, 60000);
    })
  );

  // Status bar — shows document word/char/read-time + selection counts for
  // markdown documents. Driven by 'stats' messages from MikeDown webviews and
  // by direct watchers for plain-text markdown editors.
  const statusBar = new StatusBarManager();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });
  MarkdownEditorProvider.statusBar = statusBar;

  const isMarkdownDoc = (doc: vscode.TextDocument): boolean =>
    doc.languageId === 'markdown' || doc.fileName.endsWith('.md') || doc.fileName.endsWith('.markdown');

  // Plain-text markdown editor path — MikeDown webviews drive the status bar
  // via 'stats' messages; this branch covers .md files opened in the standard
  // text editor (e.g. via "Open With… → Text Editor").
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && isMarkdownDoc(editor.document)) {
      statusBar.hideSelection();
      statusBar.showDocument(editor.document.getText());
      return;
    }
    // No plain-text markdown editor active — let the custom-editor provider's
    // onDidChangeViewState handler decide whether to keep stats showing.
    if (!MarkdownEditorProvider.activePanel) {
      statusBar.hide();
    }
  }, null, context.subscriptions);

  // Debounce per-keystroke updates on large docs.
  let plainTextDebounce: NodeJS.Timeout | undefined;
  vscode.workspace.onDidChangeTextDocument((event) => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || event.document !== activeEditor.document) {return;}
    if (!isMarkdownDoc(event.document)) {return;}
    if (plainTextDebounce) {clearTimeout(plainTextDebounce);}
    plainTextDebounce = setTimeout(() => {
      statusBar.showDocument(event.document.getText());
    }, 250);
  }, null, context.subscriptions);

  // Backlink index — backs the in-editor sidebar's Backlinks section.
  // Previously also registered as a TreeDataProvider for the (now-removed)
  // MikeDown activity-bar icon; the index itself stays, just headless now.
  const backlinkProvider = new BacklinkProvider();
  MarkdownEditorProvider.backlinkProvider = backlinkProvider;

  // Tag index — backs tag click → QuickPick, the sidebar Tags section, and `#`
  // autocomplete. Same lifecycle as the backlink index (build on activate,
  // refresh on save/create/delete).
  const tagProvider = new TagProvider();
  MarkdownEditorProvider.tagProvider = tagProvider;

  // Build backlink index on activate (in background). Re-broadcast when the
  // scan finishes — a webview that became ready mid-build got an empty index
  // and would otherwise show no backlinks until the next save (notably after a
  // window reload, where the doc reopens before the scan completes).
  backlinkProvider.buildIndex()
    .then(() => MarkdownEditorProvider.broadcastBacklinks())
    .catch(() => {});

  tagProvider.buildIndex()
    .then(() => MarkdownEditorProvider.broadcastTags())
    .catch(() => {});

  // Update indexes when files are saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.languageId === 'markdown' || doc.fileName.endsWith('.md') || doc.fileName.endsWith('.markdown')) {
        backlinkProvider.updateFile(doc.uri).then(() => {
          MarkdownEditorProvider.broadcastBacklinks();
        }).catch(() => {});
        tagProvider.updateFile(doc.uri).then(() => {
          MarkdownEditorProvider.broadcastTags();
        }).catch(() => {});
      }
    })
  );

  // Update indexes on file create/delete
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(e => Promise.all(e.files.map(f => backlinkProvider.updateFile(f))).then(() => MarkdownEditorProvider.broadcastBacklinks()).catch(() => {})),
    vscode.workspace.onDidDeleteFiles(e => Promise.all(e.files.map(f => backlinkProvider.updateFile(f))).then(() => MarkdownEditorProvider.broadcastBacklinks()).catch(() => {})),
    vscode.workspace.onDidCreateFiles(e => Promise.all(e.files.map(f => tagProvider.updateFile(f))).then(() => MarkdownEditorProvider.broadcastTags()).catch(() => {})),
    vscode.workspace.onDidDeleteFiles(e => Promise.all(e.files.map(f => tagProvider.updateFile(f))).then(() => MarkdownEditorProvider.broadcastTags()).catch(() => {}))
  );

  // DocumentSymbolProvider — populates VS Code's built-in Outline panel for
  // markdown files opened in the plain-text editor (the built-in pane is
  // unreachable from custom editors, so this only benefits non-MikeDown views).
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'markdown', scheme: 'file' },
      new MarkdownOutlineSymbolProvider(),
      { label: 'MikeDown Headings' }
    )
  );

  registerAi(context);

  // Support appeal — "A note from Mike" card, shown in the webview after a
  // save that follows a meaningful editing session (no more startup toast,
  // Q2 resolved). Persisted state, eligibility, and side effects live in
  // provider.supportPrompt (src/supportPrompt.ts); this just wires the two
  // activation-time engagement signals it needs.
  provider.supportPrompt.recordActivation();
  MarkdownEditorProvider.onDocOpen = () => provider.supportPrompt.recordDocOpen();

  // "MikeDown: Support MikeDown" — always available in the palette (no
  // `when` gating) so it works from anywhere. Posts the card to whichever
  // MikeDown panel is available, or falls back to a single native notice
  // (the only one left) if no MikeDown editor is open at all.
  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.support', () => {
      const panel = MarkdownEditorProvider.activePanel ?? MarkdownEditorProvider.findVisiblePanel();
      if (panel) {
        provider.supportPrompt.showManual(panel);
      } else {
        provider.supportPrompt.showFallbackNotice();
      }
    })
  );

  // Dev-only: reset support-prompt state for manual testing. Never
  // registered (or shown in the palette — see contributes.commands.when in
  // package.json) outside a dev/debug host.
  if (context.extensionMode !== vscode.ExtensionMode.Production) {
    void vscode.commands.executeCommand('setContext', 'mikedown.isDevelopment', true);

    context.subscriptions.push(
      vscode.commands.registerCommand('mikedown.dev.resetSupportPrompt', async () => {
        const pick = await vscode.window.showQuickPick(
          [
            { label: 'Clear all support prompt state', action: 'clear' as const },
            { label: 'Make eligible now', action: 'eligible' as const },
          ],
          { placeHolder: 'MikeDown (Dev): Reset Support Prompt State' }
        );
        if (!pick) {
          return;
        }
        if (pick.action === 'clear') {
          provider.supportPrompt.devResetAll();
          void vscode.window.showInformationMessage('MikeDown (Dev): support prompt state cleared.');
        } else {
          provider.supportPrompt.devMakeEligibleNow();
          void vscode.window.showInformationMessage('MikeDown (Dev): support prompt is eligible. The next qualifying save shows the card.');
        }
      })
    );
  }

  // First-run "make MikeDown the default .md editor?" prompt. Shown once,
  // shortly after activation — short delay so it doesn't compete with other
  // startup toasts, but well before the nag prompt above. See
  // src/defaultEditorPrompt.ts for the full gating logic.
  setTimeout(() => maybeOfferDefaultEditorPrompt(context), 5_000);

  // T2 test seam: `vscode.extensions.getExtension(id).exports` is the only
  // reliable way for an integration test to reach the LIVE provider/panel —
  // this `activate()` call and its `provider` are the ones VS Code actually
  // runs, whereas a test file importing `./markdownEditorProvider` directly
  // gets a second, separately-loaded module instance (this one is bundled
  // by webpack into dist/extension.js) whose statics are never populated.
  // Not a documented/public API; for test use only.
  return {
    __test: {
      dispatchMessage: (document: vscode.TextDocument, panel: vscode.WebviewPanel, message: unknown) =>
        provider.dispatchTestMessage(document, panel, message as never),
      getActivePanel: () => MarkdownEditorProvider.activePanel,
      // Post a message straight to the active webview (used for __testOp).
      postToActivePanel: (message: unknown) =>
        MarkdownEditorProvider.activePanel?.webview.postMessage(message),
    },
  };
}

/**
 * AI layer: the engine service (adapters, secrets, cloud gate), the
 * "MikeDown AI" output channel, the `AI: …` status bar item and the two AI
 * commands. Everything stays inert while `mikedown.ai.enabled` is false,
 * apart from the AI tab, Test connection and Discover models.
 */
function registerAi(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('MikeDown AI');
  const service = createVsCodeAiService(context, output);
  const statusBar = new AiStatusBar();
  statusBar.setEnabled(getSettings().ai.enabled);
  context.subscriptions.push(output, statusBar, { dispose: () => service.dispose() });
  MarkdownEditorProvider.aiService = service;
  MarkdownEditorProvider.aiStatusBar = statusBar;

  // Probe results, discoveries and stored keys change what the AI tab shows;
  // coalesce bursts (Test all engines) into one push.
  let broadcastTimer: NodeJS.Timeout | undefined;
  const scheduleBroadcast = (): void => {
    if (broadcastTimer) {clearTimeout(broadcastTimer);}
    broadcastTimer = setTimeout(() => { void MarkdownEditorProvider.broadcastAiEngines(); }, 100);
  };
  context.subscriptions.push(service.onStatusesChanged(scheduleBroadcast));

  void writeBackEngineIds().catch(() => {});
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('mikedown.ai')) {return;}
      const ai = getSettings().ai;
      statusBar.setEnabled(ai.enabled);
      // A new default engine or routing shows at once, not after the next request (Q7).
      statusBar.showRoute(ai, service.cachedStatuses(ai));
      void writeBackEngineIds()
        .catch(() => false)
        // Deletes the keys of engines that are gone, then pushes statuses.
        .then(() => service.settingsChanged())
        .then(() => { const now = getSettings().ai; statusBar.showRoute(now, service.cachedStatuses(now)); })
        .catch(() => {});
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mikedown.openAiSettings', () => {
      const panel = MarkdownEditorProvider.activePanel ?? MarkdownEditorProvider.findVisiblePanel();
      if (panel) {
        panel.reveal(undefined, false);
        // Straight to the AI Engines page; the gear's AI tab is the summary.
        void panel.webview.postMessage({ type: 'command', command: 'openAiSettings', page: true });
      } else {
        void vscode.window.showInformationMessage('Open a markdown file in MikeDown to change its AI settings (toolbar gear, AI tab).');
      }
    }),
    // Opens the webview's rewrite popover on the selection (Cmd/Ctrl+Alt+K).
    vscode.commands.registerCommand('mikedown.ai.rewrite', () => {
      const panel = MarkdownEditorProvider.activePanel;
      if (panel) {
        void panel.webview.postMessage({ type: 'command', command: 'aiRewrite' });
      }
    }),
    // The other AI commands forward the same way; each opens its popover in the webview.
    vscode.commands.registerCommand('mikedown.ai.explain', () => {
      MarkdownEditorProvider.activePanel?.webview.postMessage({ type: 'command', command: 'aiExplain' });
    }),
    vscode.commands.registerCommand('mikedown.ai.translate', () => {
      MarkdownEditorProvider.activePanel?.webview.postMessage({ type: 'command', command: 'aiTranslate' });
    }),
    vscode.commands.registerCommand('mikedown.ai.summarize', () => {
      MarkdownEditorProvider.activePanel?.webview.postMessage({ type: 'command', command: 'aiSummarize' });
    }),
    vscode.commands.registerCommand('mikedown.ai.suggestTitle', () => {
      MarkdownEditorProvider.activePanel?.webview.postMessage({ type: 'command', command: 'aiSuggestTitle' });
    }),
    vscode.commands.registerCommand('mikedown.ai.suggestProperties', () => {
      MarkdownEditorProvider.activePanel?.webview.postMessage({ type: 'command', command: 'aiSuggestProperties' });
    }),
    vscode.commands.registerCommand('mikedown.ai.testAllEngines', async () => {
      output.show(true);
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'MikeDown: testing AI engines' },
        () => service.testAllEngines()
      );
    })
  );
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Subscriptions are disposed automatically; the export server is not one of
  // them (it's started lazily from export.ts), so close it here.
  disposeExportServer();
}
