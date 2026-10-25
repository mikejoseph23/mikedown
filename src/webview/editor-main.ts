/**
 * MikeDown — VS Code webview shell.
 *
 * Compiled by webpack (web target) into out/webview/editor-main.js and loaded
 * by markdownEditorProvider.ts#getWebviewContent. The editor itself lives in
 * @mikedown/core (packages/core); this file is the VS Code side of it:
 *
 *   - acquireVsCodeApi() and VsCodeHost (vsCodeHost.ts), which implements
 *     MikeDownHost by posting the message shapes listed below. Request/reply
 *     pairs keep their requestId / reply-type correlation inside VsCodeHost.
 *   - the inbound message listener, which turns extension pushes into calls
 *     on the editor handle.
 *   - the VS Code-only Settings modal sections (vsCodeSettingsSections.ts)
 *     and the support appeal card (supportCard.ts).
 *
 * ── Message protocol (unchanged by the core extraction) ─────────────────────
 *
 * Extension → Webview messages:
 *   { type: 'update', content: string }  — full document markdown text to load
 *   { type: 'command', command: string } — formatting command from extension host
 *   { type: 'command', command: 'openSettings', tab?: 'general' | 'appearance' | 'markdown' | 'behavior' }
 *       — open the Settings modal on a specific tab (e.g. from the slash-menu
 *       "Turn off slash commands" toast's Open Settings action). Omitted tab
 *       falls back to the modal's normal last-used-tab behavior.
 *   { type: 'settings', slashCommandsEnabled, slashCommandsDateFormat, slashCommandsTimeZone, ... }
 *       — settings broadcast; slash-command fields apply live via
 *       setSlashCommandsConfig() and update the empty-doc placeholder text.
 *   { type: 'tags', tags: Array<{ tag, count }> } — workspace tag index (sidebar
 *       Tags section + `#` autocomplete); pushed on ready and on index changes.
 *
 * Webview → Extension messages:
 *   { type: 'ready' }                    — webview is ready to receive content
 *   { type: 'edit', content: string }    — new full markdown text after user edit
 *   { type: 'stats', selection: { words, chars } | null } — selection stats for status bar (null = no selection)
 *   { type: 'openTag', tag: string }     — tag click; host shows a QuickPick of tagged docs
 *   { type: 'getTags' }                  — ask the host to (re)send the `tags` list
 *   { type: 'openKeybindings' }          — Settings modal "Customize in VS Code…" button (Hotkeys tab);
 *       host opens VS Code's Keyboard Shortcuts UI filtered to mikedown.*
 *   { type: 'saveSettings', settings: {...}, source?: 'slashMenu' }
 *       — persist settings; `source: 'slashMenu'` marks a save that came from
 *       the slash-menu footer row's "Turn off slash commands" action, so the
 *       host shows a dedicated Open Settings / Undo toast instead of the
 *       generic "settings saved" one.
 *
 * Image paste (core imagepaste.ts → host.uploadImage):
 *   Webview → Extension:
 *     { type: 'savePastedImage', requestId, mime, dataBase64 } — clipboard/drop
 *         image bytes to write to disk per `mikedown.imagePaste.*` settings.
 *   Extension → Webview:
 *     { type: 'pastedImageResult', requestId, success?, insertPath?, webviewUri?,
 *       alt?, reused?, error? } — reply keyed by `requestId`; on success the
 *       webview inserts an image node with `src: webviewUri` (which the host
 *       resolves back to `insertPath` on serialize); `error` (no `success`)
 *       leaves the paste site untouched.
 *
 * Image file picker (core imagepick.ts → host.pickImage, slash command `/image`):
 *   Webview → Extension:
 *     { type: 'pickImage', requestId } — open a native file picker for the
 *         current document.
 *   Extension → Webview:
 *     { type: 'pickedImageResult', requestId, insertPath?, webviewUri?, alt?,
 *       cancelled?, error? } — reply keyed by `requestId`. `cancelled: true`
 *       means the user dismissed the dialog; `error` means the pick failed
 *       (e.g. document not saved yet); either way `/query` is left intact.
 *       On success the webview replaces `/query` with an image node exactly
 *       like a paste result. Files outside the doc folder/workspace are
 *       copied into the image-paste folder first (host-side), so
 *       `insertPath`/`webviewUri` always point at a servable location.
 *
 * Heading Rename → Fix Links (2.7.0):
 *   Webview → Extension:
 *     { type: 'headingRenamed', oldSlug, newSlug } — a heading's anchor slug
 *         changed; the webview has already fixed in-doc TOC links, the host
 *         should find + (per pref) fix cross-file backlinks targeting this file.
 *     { type: 'headingRenameAmbiguous', baseName } — the renamed heading's base
 *         slug is duplicated in the document; host shows a warning, no auto-fix.
 *
 * Support appeal — "A note from Mike" card (host wiring in src/supportPrompt.ts,
 * render in src/webview/supportCard.ts):
 *   Extension → Webview:
 *     { type: 'showSupportCard', reason: 'auto' | 'manual', copy } — render the
 *         card (copy is the full CARD_COPY payload from src/supportCopy.ts —
 *         title, body, avatar, button labels, copied confirmation — the
 *         webview never hardcodes support-appeal strings). `reason: 'auto'`
 *         fires ~1.5s after a qualifying save; `reason: 'manual'` comes from
 *         the `mikedown.support` command or another entry point (M6+). For
 *         `reason: 'auto'`, if the Settings modal or another card is already
 *         open, reply `{ type: 'busy' }` instead of rendering (host treats
 *         that as "not shown"). Otherwise render (a manual show replaces any
 *         open card) and reply `{ type: 'supportCardShown' }`.
 *     { type: 'supportCopied' } — the host finished writing the neutral share
 *         line to the clipboard after a `supportAction: 'share'`; the webview
 *         swaps the "Tell a colleague" label to the approved "Copied" text
 *         for ~2s.
 *   Webview → Extension:
 *     { type: 'supportCardShown' } — ack that the card actually rendered; the
 *         only place the host writes `lastPrompt`.
 *     { type: 'busy' } — the card could not render (see above); no `lastPrompt`
 *         write follows.
 *     { type: 'supportAction', action } — a card button was clicked. `action`
 *         is one of 'review' | 'share' | 'feedback' | 'later' | 'never' |
 *         'close' ('close' = dismissed without choosing). The host applies
 *         the corresponding state change, and for 'review'/'feedback' opens
 *         the Marketplace review / GitHub issue URL, or for 'share' writes
 *         the clipboard and replies `supportCopied`. `action: 'open'` comes
 *         from a persistent entry point (sidebar footer link, Settings About
 *         button; M6): no state change, the host replies with a
 *         `showSupportCard` `reason: 'manual'`.
 *     { type: 'saveSettings', settings: { supportShowSidebarLink: false } } —
 *         the sidebar footer link's × (dismiss forever). The `settings`
 *         broadcast carries `supportShowSidebarLink` and `supportEntryCopy`
 *         (ENTRY_COPY in src/supportCopy.ts) back; the link toggles live.
 *
 * AI (host.ai, tier 2; host side in src/ai/webviewBridge.ts). Off unless
 * `mikedown.ai.enabled`; the `settings` broadcast carries the parsed
 * `ai` settings (no secrets) and `saveSettings` takes `ai.*` patch keys.
 *   Webview → Extension:
 *     { type: 'aiComplete', request }  — AiCompletionRequest with image bytes
 *         as base64 (toWireCompletionRequest); streamed back as aiToken, then
 *         aiDone or aiError, all keyed by request.requestId.
 *     { type: 'aiCancel', requestId }  — abort that request (the panel's one
 *         in-flight request; a new aiComplete also aborts the previous one).
 *     { type: 'aiListEngines' }        — answered by aiEngines.
 *     { type: 'aiTestEngine' | 'aiDiscoverModels', requestId, engineId }
 *         — answered by aiEngineStatus; a discovery also merges the models
 *         into the saved engine (mikedown.ai.engines).
 *     { type: 'aiSetSecret', requestId, engineId, apiKey: string | null }
 *         — store or delete the key in SecretStorage; answered by aiEngineStatus.
 *     { type: 'aiRequestCloudConsent', requestId, engineId } — host modal;
 *         answered by aiConsent.
 *   Extension → Webview:
 *     { type: 'aiToken', requestId, delta }
 *     { type: 'aiDone', requestId, result: AiCompletionResult }
 *     { type: 'aiError', requestId, code: AiErrorCode, message } — also the
 *         failure reply to a test/discover/setSecret request.
 *     { type: 'aiEngines', engines: AiEngineStatus[] } — the listEngines reply,
 *         also pushed after a settings change, probe or discovery.
 *     { type: 'aiEngineStatus', requestId, status: AiEngineStatus }
 *     { type: 'aiConsent', requestId, engineId, granted }
 *     { type: 'command', command: 'openAiSettings' } — mikedown.openAiSettings
 *         (and the AI status bar item): open the Settings modal on the AI tab.
 *     { type: 'command', command: 'aiRewrite' } — mikedown.ai.rewrite: open the
 *         rewrite popover on the selection.
 *
 * Also handled here (pushes from the extension host):
 *   { type: 'theme', fontFamily, headingFontFamily, fontSize } — folded into updateSettings
 *   { type: 'saved', content }        — new pristine baseline after a save
 *   { type: 'setReadOnly', readOnly } — diff session ended (read-only off)
 *   { type: 'toggleSource' }          — mikedown.toggleSourceMode
 *   { type: 'requestExportHtml' | 'requestPrint' | 'requestViewInBrowser' }
 *       — answered with exportHtml / printDocument / viewInBrowser { html }
 *   { type: 'scrollToAnchor', anchor }, { type: 'revealLinkHref', href, occurrence }
 *   { type: 'imageFileMissing' | 'imageFileFound', uri, fsPath? }
 *   { type: 'backlinks', items }, { type: 'docMeta', mtimeMs },
 *   { type: 'sidebarState', pref, width, position, sectionPrefs }, { type: 'diffStatus', hasChanges }
 * Replies routed to VsCodeHost promises: pastedImageResult, pickedImageResult,
 * resizeImageResult, linkSuggestions, fileHeadings, wikilinksResolved,
 * brokenLinks, diffData, tags (tags and linkSuggestions also arrive as pushes),
 * and the ai* replies above (aiEngines also arrives as a push).
 */

import { createMikeDownEditor } from '../../packages/core/src/index';
import type { MikeDownSettings } from '../../packages/core/src/types';
import { VsCodeHost, type VsCodeApi } from './vsCodeHost';
import { showSupportCard, isSupportCardOpen, showSupportCopied, type SupportCardCopy } from './supportCard';
import {
  buildVsCodeSettingsSections,
  defaultVsCodeSettingsState,
  type SupportEntryCopy,
} from './vsCodeSettingsSections';

declare const acquireVsCodeApi: () => VsCodeApi;

// Only one acquireVsCodeApi() call is allowed per webview.
const vscode = acquireVsCodeApi();
const host = new VsCodeHost(vscode);
const state = defaultVsCodeSettingsState();

/** Ask the host to open the "A note from Mike" card (it replies with a manual `showSupportCard`). */
function requestSupportCard(): void {
  vscode.postMessage({ type: 'supportAction', action: 'open' });
}

const editorRoot = document.getElementById('editor-root');
if (!editorRoot) {
  throw new Error('MikeDown: #editor-root element not found.');
}

const handle = createMikeDownEditor(editorRoot, {
  host,
  features: { sidebar: true, supportCard: true },
  // The mikedown.toggleSourceMode keybinding owns Cmd/Ctrl+/ in VS Code.
  hostOwnsShortcuts: true,
  // 'auto' follows the VS Code theme; the editorTheme setting overrides it.
  theme: 'auto',
  // The extension stamps the dictionaries URL on <body> (the CSP allows no
  // inline script to pass it any other way).
  spellcheckDictionaryUrl: document.body.dataset.dictionaryBase ?? '',
  settingsFooterNote: 'Changes apply instantly. Use VS Code settings for persistence.',
  extraSettingsSections: buildVsCodeSettingsSections({
    state,
    host,
    applySupportLink,
    requestSupportCard,
    applyCorePolicy: (patch) => handle.updateSettings(patch),
  }),
});

// vscode-theme.css keys VS Code's forced light / dark palettes (and the
// support card's) off <body>, so mirror the editor root's theme attribute there.
const mikedownRoot = editorRoot.querySelector<HTMLElement>('.mikedown-root');
if (mikedownRoot) {
  const mirrorTheme = (): void => {
    const theme = mikedownRoot.getAttribute('data-mikedown-theme');
    if (theme) {document.body.setAttribute('data-mikedown-theme', theme);}
  };
  mirrorTheme();
  new MutationObserver(mirrorTheme).observe(mikedownRoot, { attributes: true, attributeFilter: ['data-mikedown-theme'] });
}

// Engine statuses the host pushes (after a probe, a discovery, a failed
// request) go straight to the router and the AI chip.
host.onAiEngines((engines) => handle.setAiEngineStatuses(engines));

// Test-only hook: gives the webview test harness (test/harness/webviewHarness.ts)
// direct access to the live TipTap editor/PM view so it can drive real
// transactions and keydown events rather than only posting host messages.
(window as any).__mikedownEditor = handle.tiptap;

/** Sidebar footer support link, from the broadcast's copy + toggle. */
function applySupportLink(): void {
  const copy = state.supportEntryCopy;
  handle.setSidebarFooterLink(state.supportShowSidebarLink && copy
    ? {
      label: copy.sidebarLink,
      dismissLabel: copy.dismissLabel,
      dismissConfirmation: copy.dismissConfirmation,
      onOpen: requestSupportCard,
      onDismiss: () => {
        state.supportShowSidebarLink = false;
        host.saveSettings({ supportShowSidebarLink: false });
      },
    }
    : null);
}

/**
 * The `settings` broadcast mixes core settings with VS Code-only ones. This
 * picks out the core subset, renaming the broadcast's keys to
 * MikeDownSettings names.
 */
function settingsBroadcastToCore(msg: any): Partial<MikeDownSettings> {
  const patch: Partial<MikeDownSettings> = {};
  const copy = <K extends keyof MikeDownSettings>(key: K, value: unknown): void => {
    if (value !== undefined && value !== null) {patch[key] = value as MikeDownSettings[K];}
  };
  copy('linkClickBehavior', msg.linkClickBehavior || undefined);
  copy('headingRenameUpdateLinks', msg.headingRenameUpdateLinks || undefined);
  copy('headingNumbering', msg.headingNumbering);
  copy('slashCommandsEnabled', msg.slashCommandsEnabled);
  copy('slashCommandsDateFormat', msg.slashCommandsDateFormat);
  copy('slashCommandsTimeZone', msg.slashCommandsTimeZone);
  copy('editorTheme', msg.editorTheme || undefined);
  copy('renderMermaidDiagrams', msg.renderMermaidDiagrams);
  copy('renderMath', msg.renderMath);
  copy('tagsEnabled', msg.tagsEnabled);
  copy('ctrlWheelZoom', msg.ctrlWheelZoom);
  copy('wikilinkCreateOnClick', msg.wikilinkCreateOnClick);
  copy('markdownNormalization', msg.markdownNormalization);
  copy('normalizationStyle', msg.normalizationStyle);
  copy('imagePathMappings', msg.imagePastePathMappings);
  copy('docDir', msg.docDirFs);
  copy('ai', msg.ai);
  host.setImagePaths(msg.imagePastePathMappings, msg.docDirFs);
  const sc = msg.spellCheck;
  if (sc && typeof sc === 'object') {
    copy('spellCheckEnabled', sc.enabled);
    copy('spellCheckLanguage', sc.language);
    copy('spellCheckIgnoreCodeBlocks', sc.ignoreCodeBlocks);
    copy('spellCheckUserWords', sc.userWords);
    copy('spellCheckExternalWords', sc.externalWords);
  }
  return patch;
}

/** VS Code-only fields of the `settings` broadcast. */
function applyVsCodeOnlySettings(msg: any): void {
  if (msg.themeToggleScope) {state.themeToggleScope = msg.themeToggleScope;}
  if (msg.headingRenameUpdateLinks) {state.headingRenameUpdateLinks = msg.headingRenameUpdateLinks;}
  if (typeof msg.wikilinkCreateOnClick === 'boolean') {state.wikilinkCreateOnClick = msg.wikilinkCreateOnClick;}
  if (typeof msg.extensionVersion === 'string') {state.extensionVersion = msg.extensionVersion;}
  if (typeof msg.defaultEditor === 'boolean') {state.defaultEditor = msg.defaultEditor;}
  if (typeof msg.autoReloadUnmodifiedFiles === 'boolean') {state.autoReloadUnmodifiedFiles = msg.autoReloadUnmodifiedFiles;}
  if (msg.supportEntryCopy && typeof msg.supportEntryCopy === 'object') {
    state.supportEntryCopy = msg.supportEntryCopy as SupportEntryCopy;
  }
  if (typeof msg.supportShowSidebarLink === 'boolean') {state.supportShowSidebarLink = msg.supportShowSidebarLink;}
  applySupportLink();
  if (msg.imagePaste && typeof msg.imagePaste === 'object') {
    state.imagePaste = { ...state.imagePaste, ...msg.imagePaste };
  }
  if (msg.imageResize && typeof msg.imageResize === 'object') {
    state.imageResize = { ...state.imageResize, ...msg.imageResize };
  }
}

/** True while source mode (CodeMirror) is the visible surface. */
function inSourceMode(): boolean {
  const wysiwyg = editorRoot?.querySelector<HTMLElement>('.mikedown-editor-container');
  return !!wysiwyg && wysiwyg.style.display === 'none';
}

window.addEventListener('message', (event: MessageEvent) => {
  const message: any = event.data;

  // Replies to host requests resolve their Promises inside VsCodeHost.
  if (host.handleReply(message)) {return;}

  switch (message?.type) {
    case 'update': handle.setMarkdown(message.content ?? '', { pristine: true }); break;
    case 'command': handle.command(message.command, { tab: message.tab }); break;
    case 'toggleSource': handle.command('toggleSource'); break;
    case 'copyAsRichText': handle.command('copyAsRichText'); break;
    case 'theme':
      handle.updateSettings({
        fontFamily: message.fontFamily || '',
        headingFontFamily: message.headingFontFamily || '',
        fontSize: message.fontSize || 15,
      });
      break;
    case 'settings':
      applyVsCodeOnlySettings(message);
      handle.updateSettings(settingsBroadcastToCore(message));
      break;
    case 'saved': handle.markSaved(message.content ?? ''); break;
    case 'setReadOnly': handle.setReadOnly(!!message.readOnly); break;
    case 'diffStatus': handle.setDiffAvailable(!!message.hasChanges); break;
    // M11 — Export / view / print: the host renders the editor's HTML.
    case 'requestExportHtml': host.exportHtml(handle.getHtml()); break;
    case 'requestViewInBrowser': host.viewInBrowser(handle.getHtml()); break;
    // VS Code webviews are sandboxed and cannot call window.print(), so the
    // host opens the HTML in the system browser with an auto-print script.
    case 'requestPrint': host.printDocument(handle.getHtml()); break;
    case 'scrollToAnchor': handle.scrollToAnchor(message.anchor); break;
    case 'revealLinkHref': handle.revealLink(message.href, message.occurrence); break;
    case 'linkSuggestions': handle.setLinkSuggestions(message.suggestions || []); break;
    case 'sidebarState':
      if (message.pref === 'always' || message.pref === 'never') {state.sidebarVisibilityDefault = message.pref;}
      if (message.position === 'left' || message.position === 'right') {state.sidebarPositionDefault = message.position;}
      if (typeof message.width === 'number') {state.sidebarWidthDefault = message.width;}
      handle.setSidebarState(message);
      break;
    case 'backlinks': handle.setBacklinks(message.items || []); break;
    case 'tags': handle.setTags(message.tags || []); break;
    case 'docMeta': handle.setDocMeta({ mtimeMs: message.mtimeMs }); break;
    case 'imageFileMissing': handle.setImageStatus(message.uri, 'missing', message.fsPath); break;
    case 'imageFileFound': handle.setImageStatus(message.uri, 'found'); break;
    // Support appeal: "A note from Mike" card. An auto card never stacks on
    // the Settings modal or on another card; it replies `busy` so the host
    // does not count it as shown.
    case 'showSupportCard': {
      const reason: 'auto' | 'manual' = message.reason === 'manual' ? 'manual' : 'auto';
      if (reason === 'auto' && (handle.isModalOpen() || isSupportCardOpen())) {
        vscode.postMessage({ type: 'busy' });
      } else if (message.copy && typeof message.copy === 'object') {
        showSupportCard({
          reason,
          copy: message.copy as SupportCardCopy,
          onAction: action => vscode.postMessage({ type: 'supportAction', action }),
          restoreFocus: () => {
            if (!inSourceMode()) {handle.focus();}
          },
        });
        vscode.postMessage({ type: 'supportCardShown' });
      }
      break;
    }
    case 'supportCopied': showSupportCopied(); break;
    // Integration-test hook. Honoured only when the host rendered the page
    // with data-test-hooks="1" (MIKEDOWN_TEST_HOOKS=1 in the extension host),
    // so it is inert for real users. Drives the same editor commands the
    // toolbar picker and slash menu run, since the real Electron webview
    // cannot be clicked or typed into from Mocha.
    case '__testOp': if (document.body.dataset.testHooks === '1') {runTestOp(message);} break;
  }
});

function runTestOp(message: any): void {
  const ed = handle.tiptap;
  switch (message.op) {
    case 'click': document.querySelector<HTMLElement>(String(message.selector))?.click(); break;
    case 'selectAll': ed.chain().focus().selectAll().run(); break;
    case 'endOfDoc': ed.chain().focus('end').run(); break;
    // Same call the toolbar table picker and the /table slash action make.
    case 'insertTable': ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
    case 'type': ed.chain().focus().insertContent(String(message.text ?? '')).run(); break;
    // Feeds a key through ProseMirror's handleKeyDown props (slash menu, etc).
    case 'key': {
      const view = ed.view;
      const ev = new KeyboardEvent('keydown', { key: String(message.key), bubbles: true, cancelable: true });
      view.someProp('handleKeyDown', (f: any) => f(view, ev));
      break;
    }
  }
}

// The provider answers `ready` with the document (`update`) and settings.
handle.on('ready', () => vscode.postMessage({ type: 'ready' }));
