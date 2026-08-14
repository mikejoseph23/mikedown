import * as vscode from 'vscode';

/**
 * First-run "make MikeDown your default .md editor?" prompt, shown once on
 * activation as a native VS Code information toast. State lives in
 * `context.globalState` under keys prefixed with `mikedown.defaultEditorPrompt.`,
 * following the same globalState-backed dismissal pattern as `src/nagPrompt.ts`
 * (that file handles the periodic "enjoying MikeDown?" toast — this one is a
 * single first-run offer, so there's no backoff ladder, just an "already asked"
 * gate).
 *
 * Unlike the nag prompt, "Yes" here has a real programmatic effect: it writes
 * `workbench.editorAssociations["*.md"] = "mikedown.editor"` at global scope,
 * which is the same thing VS Code's own **Configure default editor for `.md`**
 * flow would write. Users can trigger that same action later via the
 * `mikedown.setAsDefaultEditor` command.
 */

const ASSOCIATIONS_KEY = 'workbench.editorAssociations';
const MD_PATTERN = '*.md';

const KEYS = {
  offeredAt: 'mikedown.defaultEditorPrompt.offeredAt',
  dismissal: 'mikedown.defaultEditorPrompt.dismissal',
} as const;

type Dismissal = 'notNow' | 'never' | 'accepted';

const MESSAGE = 'Make MikeDown the default editor for Markdown files? Clicking a .md file will open it in MikeDown\'s WYSIWYG view instead of the plain text editor.';

const YES  = 'Yes';
const NOT_NOW = 'Not now';
const NEVER = "Don't ask again";

/** True if `workbench.editorAssociations` already maps `*.md` to MikeDown. */
export function isMikeDownDefaultEditor(): boolean {
  const associations = vscode.workspace.getConfiguration().get<Record<string, string>>(ASSOCIATIONS_KEY) ?? {};
  return associations[MD_PATTERN] === 'mikedown.editor';
}

/** Writes `workbench.editorAssociations["*.md"] = "mikedown.editor"` at global scope. */
export async function applyMikeDownAsDefaultEditor(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const associations = { ...(config.get<Record<string, string>>(ASSOCIATIONS_KEY) ?? {}) };
  associations[MD_PATTERN] = 'mikedown.editor';
  await config.update(ASSOCIATIONS_KEY, associations, vscode.ConfigurationTarget.Global);
}

/**
 * The "should we prompt?" predicate: already-default → no; already asked
 * (accepted, "not now", or "don't ask again") → no; otherwise yes.
 */
export function shouldOfferDefaultEditorPrompt(context: vscode.ExtensionContext): boolean {
  if (isMikeDownDefaultEditor()) return false;
  if (context.globalState.get<number>(KEYS.offeredAt) !== undefined) return false;
  return true;
}

/** Runs the "Open with MikeDown" default-editor command, with a confirmation toast. */
export async function setAsDefaultEditorCommand(context: vscode.ExtensionContext): Promise<void> {
  if (isMikeDownDefaultEditor()) {
    void vscode.window.showInformationMessage('MikeDown is already your default editor for Markdown files.');
    return;
  }
  await applyMikeDownAsDefaultEditor();
  await context.globalState.update(KEYS.offeredAt, Date.now());
  await context.globalState.update(KEYS.dismissal, 'accepted' satisfies Dismissal);
  void vscode.window.showInformationMessage('MikeDown is now your default editor for Markdown files.');
}

/** Call once on activation. Shows the first-run toast if eligible. */
export function maybeOfferDefaultEditorPrompt(context: vscode.ExtensionContext): void {
  if (!shouldOfferDefaultEditorPrompt(context)) return;

  void vscode.window.showInformationMessage(MESSAGE, YES, NOT_NOW, NEVER).then(async choice => {
    // Any response (including dismissing via X / Esc, which resolves
    // `choice` to undefined) counts as "asked" — this is a one-time offer,
    // not a recurring nag, so we never re-show it automatically. Users can
    // always reach the same action via the `mikedown.setAsDefaultEditor`
    // command in the palette.
    await context.globalState.update(KEYS.offeredAt, Date.now());

    if (choice === YES) {
      await applyMikeDownAsDefaultEditor();
      await context.globalState.update(KEYS.dismissal, 'accepted' satisfies Dismissal);
    } else if (choice === NEVER) {
      await context.globalState.update(KEYS.dismissal, 'never' satisfies Dismissal);
    } else {
      await context.globalState.update(KEYS.dismissal, 'notNow' satisfies Dismissal);
    }
  });
}
