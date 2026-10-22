/**
 * VS Code-only rows of the Settings modal, contributed to the core modal
 * through `extraSettingsSections` (decisions section 6): default-editor and
 * reload behavior, theme toggle scope, wikilink and heading-rename policy,
 * sidebar defaults, the support link, the Images tab (file-system policy for
 * pasted images) and the About tab.
 */

import type { MikeDownSettingsSection } from '../../packages/core/src/types';
import type { MikeDownHost } from '../../packages/core/src/host';

export interface ImagePasteSettings {
  enabled: boolean;
  folder: string;
  folderRelativeTo: 'document' | 'workspace';
  filenamePattern: string;
  pathStyle: 'relative' | 'workspace-absolute';
  altText: 'empty' | 'filename' | 'prompt';
  maxSizeMB: number;
  cleanupUnreferenced: boolean;
}

export interface ImageResizeSettings {
  overwrite: boolean;
}

/**
 * Support appeal entry copy (ENTRY_COPY in src/supportCopy.ts), delivered in
 * the `settings` broadcast. Null until the first broadcast arrives.
 */
export interface SupportEntryCopy {
  sidebarLink: string;
  dismissLabel: string;
  dismissConfirmation: string;
  settingsCheckbox: string;
  aboutHeading: string;
  aboutLeadIn: string;
  aboutButton: string;
}

/** Settings the VS Code shell owns, seeded from the `settings` broadcast. */
export interface VsCodeSettingsState {
  themeToggleScope: 'vscode' | 'editorOnly';
  extensionVersion: string;
  defaultEditor: boolean;
  autoReloadUnmodifiedFiles: boolean;
  wikilinkCreateOnClick: boolean;
  headingRenameUpdateLinks: 'ask' | 'always' | 'never';
  imagePaste: ImagePasteSettings;
  imageResize: ImageResizeSettings;
  // Sidebar defaults (persisted, seed-only for newly-opened documents).
  // Updated from the 'sidebarState' broadcast and editable in Settings →
  // Appearance. The currently-displayed sidebar's pin/position/width is
  // per-instance session state inside outlineSidebar.ts and intentionally
  // disconnected from these values.
  sidebarVisibilityDefault: 'always' | 'never';
  sidebarPositionDefault: 'left' | 'right';
  sidebarWidthDefault: number;
  supportShowSidebarLink: boolean;
  supportEntryCopy: SupportEntryCopy | null;
}

export function defaultVsCodeSettingsState(): VsCodeSettingsState {
  return {
    themeToggleScope: 'editorOnly',
    extensionVersion: '',
    defaultEditor: false,
    autoReloadUnmodifiedFiles: true,
    wikilinkCreateOnClick: false,
    headingRenameUpdateLinks: 'ask',
    imagePaste: {
      enabled: true,
      folder: 'images',
      folderRelativeTo: 'document',
      filenamePattern: '${docName}-${timestamp}',
      pathStyle: 'relative',
      altText: 'empty',
      maxSizeMB: 10,
      cleanupUnreferenced: true,
    },
    imageResize: { overwrite: true },
    sidebarVisibilityDefault: 'never',
    sidebarPositionDefault: 'right',
    sidebarWidthDefault: 200,
    supportShowSidebarLink: true,
    supportEntryCopy: null,
  };
}

export interface VsCodeSectionDeps {
  state: VsCodeSettingsState;
  host: MikeDownHost;
  /** Re-apply the sidebar support link after its checkbox changed. */
  applySupportLink(): void;
  /** Open the support card (the host replies with a manual showSupportCard). */
  requestSupportCard(): void;
  /** Push policy values the core reads (wikilink create, heading rename). */
  applyCorePolicy(patch: { wikilinkCreateOnClick?: boolean; headingRenameUpdateLinks?: 'ask' | 'always' | 'never' }): void;
}

export function buildVsCodeSettingsSections(deps: VsCodeSectionDeps): MikeDownSettingsSection[] {
  const { state, host } = deps;
  return [
    // ── Behavior, before the core rows ─────────────────────────────────────
    {
      tab: 'behavior',
      placement: 'start',
      build(ctx) {
        const defaultEditorField = ctx.makeCheckboxRow(
          'Use MikeDown as default markdown editor',
          'When on, opening a .md file uses MikeDown instead of the plain text editor.',
          state.defaultEditor,
        );
        const autoReloadField = ctx.makeCheckboxRow(
          'Auto-reload unmodified files',
          'When the file changes on disk and you have no unsaved edits, reload silently instead of showing a conflict prompt.',
          state.autoReloadUnmodifiedFiles,
        );
        return {
          rows: [defaultEditorField.row, autoReloadField.row],
          collect: () => ({
            defaultEditor: defaultEditorField.input.checked,
            autoReloadUnmodifiedFiles: autoReloadField.input.checked,
          }),
          onSaved: () => {
            state.defaultEditor = defaultEditorField.input.checked;
            state.autoReloadUnmodifiedFiles = autoReloadField.input.checked;
          },
        };
      },
    },
    // ── Behavior, after "Link click behavior" ──────────────────────────────
    {
      tab: 'behavior',
      placement: { after: 'linkClickBehavior' },
      build(ctx) {
        const wikilinkCreateField = ctx.makeCheckboxRow(
          'Create files from unresolved [[wikilinks]]',
          'Obsidian-style: Cmd/Ctrl+Click an unresolved [[Note]] to create Note.md in this document’s folder and open it.',
          state.wikilinkCreateOnClick,
        );
        const themeScopeField = ctx.makeSelectRow<'vscode' | 'editorOnly'>(
          'Theme toggle scope',
          'Whether the editor theme button flips just MikeDown’s editor, or all of VS Code.',
          state.themeToggleScope,
          [
            { value: 'editorOnly', label: 'Editor only (recommended)' },
            { value: 'vscode', label: 'Whole VS Code window' },
          ],
        );
        const headingRenameField = ctx.makeSelectRow<'ask' | 'always' | 'never'>(
          'Fix links on heading rename',
          'When you rename a heading, links pointing at its #anchor break. In-document links are always fixed; this controls cross-file links in other files.',
          state.headingRenameUpdateLinks,
          [
            { value: 'ask', label: 'Ask before fixing cross-file links' },
            { value: 'always', label: 'Fix all links automatically' },
            { value: 'never', label: 'Never fix links' },
          ],
        );
        return {
          rows: [wikilinkCreateField.row, themeScopeField.row, headingRenameField.row],
          collect: () => ({
            wikilinkCreateOnClick: wikilinkCreateField.input.checked,
            themeToggleScope: themeScopeField.select.value,
            headingRenameUpdateLinks: headingRenameField.select.value,
          }),
          onSaved: () => {
            state.wikilinkCreateOnClick = wikilinkCreateField.input.checked;
            state.themeToggleScope = themeScopeField.select.value as VsCodeSettingsState['themeToggleScope'];
            state.headingRenameUpdateLinks = headingRenameField.select.value as VsCodeSettingsState['headingRenameUpdateLinks'];
            deps.applyCorePolicy({ wikilinkCreateOnClick: state.wikilinkCreateOnClick });
          },
        };
      },
    },
    // ── Appearance: sidebar defaults + support link ────────────────────────
    {
      tab: 'appearance',
      placement: 'end',
      build(ctx) {
        // These are *defaults for newly-opened documents*. The pin / position /
        // resize controls in each open sidebar are per-instance session state and
        // intentionally don't write back here. The "Apply to open documents" button
        // below pushes these defaults onto every open panel on demand.
        const sidebarVisibilityField = ctx.makeSelectRow<'always' | 'never'>(
          'Default sidebar visibility',
          'Whether the sidebar starts pinned open or hidden when a document is first opened.',
          state.sidebarVisibilityDefault,
          [
            { value: 'never', label: 'Start hidden' },
            { value: 'always', label: 'Pinned open' },
          ],
        );
        const sidebarPositionField = ctx.makeSelectRow<'left' | 'right'>(
          'Default sidebar side',
          'Which side of the editor the sidebar appears on when a document is first opened.',
          state.sidebarPositionDefault,
          [
            { value: 'right', label: 'Right' },
            { value: 'left', label: 'Left' },
          ],
        );

        const sidebarWidthRow = ctx.makeRow(
          'Default sidebar width',
          'Width in pixels (160–360) for newly-opened sidebars. Drag the resize handle in an open sidebar to adjust just that instance.',
          'inline',
        );
        const sidebarWidthInput = document.createElement('input');
        sidebarWidthInput.type = 'number';
        sidebarWidthInput.min = '160';
        sidebarWidthInput.max = '360';
        sidebarWidthInput.step = '10';
        sidebarWidthInput.value = String(state.sidebarWidthDefault);
        sidebarWidthInput.className = 'settings-input settings-input--short';
        sidebarWidthRow.appendChild(sidebarWidthInput);

        // Support appeal footer link (M6) — not a seed default: applies live to
        // every open sidebar via the settings broadcast. The label is approved copy
        // from the host (ENTRY_COPY); the row is omitted until it has arrived.
        const supportCopy = state.supportEntryCopy;
        const supportSidebarLinkField = supportCopy
          ? ctx.makeCheckboxRow(supportCopy.settingsCheckbox, '', state.supportShowSidebarLink)
          : null;
        supportSidebarLinkField?.input.setAttribute('data-testid', 'setting-support-sidebar-link');

        // Note + Apply button — wires together below the sidebar default rows.
        const sidebarApplyRow = document.createElement('div');
        sidebarApplyRow.className = 'settings-row settings-row--inline';
        const sidebarApplyNote = document.createElement('span');
        sidebarApplyNote.textContent = 'Applies to documents opened after saving. Open documents keep their current sidebar state.';
        sidebarApplyNote.className = 'settings-row-text settings-desc';
        const sidebarApplyBtn = document.createElement('button');
        sidebarApplyBtn.type = 'button';
        sidebarApplyBtn.textContent = 'Apply to open documents';
        sidebarApplyBtn.className = 'settings-btn';
        sidebarApplyBtn.title = 'Reset every open sidebar to the saved defaults above.';
        sidebarApplyBtn.addEventListener('click', () => {
          host.sidebarPrefs?.applyDefaults();
          sidebarApplyBtn.textContent = 'Applied ✓';
          setTimeout(() => { sidebarApplyBtn.textContent = 'Apply to open documents'; }, 1400);
        });
        sidebarApplyRow.append(sidebarApplyNote, sidebarApplyBtn);

        const parsedWidth = (): number => Math.max(160, Math.min(360, Math.round(parseFloat(sidebarWidthInput.value) || 200)));
        return {
          rows: [
            sidebarVisibilityField.row,
            sidebarPositionField.row,
            sidebarWidthRow,
            sidebarApplyRow,
            ...(supportSidebarLinkField ? [supportSidebarLinkField.row] : []),
          ],
          collect: () => ({
            // Sidebar defaults (seed values for newly-opened documents)
            sidebarVisibility: sidebarVisibilityField.select.value,
            sidebarPosition: sidebarPositionField.select.value,
            sidebarWidth: parsedWidth(),
            ...(supportSidebarLinkField ? { supportShowSidebarLink: supportSidebarLinkField.input.checked } : {}),
          }),
          onSaved: () => {
            state.sidebarVisibilityDefault = sidebarVisibilityField.select.value as VsCodeSettingsState['sidebarVisibilityDefault'];
            state.sidebarPositionDefault = sidebarPositionField.select.value as VsCodeSettingsState['sidebarPositionDefault'];
            state.sidebarWidthDefault = parsedWidth();
            if (supportSidebarLinkField) {
              state.supportShowSidebarLink = supportSidebarLinkField.input.checked;
              deps.applySupportLink();
            }
          },
        };
      },
    },
    // ── Images tab: paste folder policy + resize ───────────────────────────
    {
      tab: 'images',
      tabLabel: 'Images',
      afterTab: 'spelling',
      build(ctx) {
        const ipState: ImagePasteSettings = { ...state.imagePaste };
        const ipSectionRow = ctx.makeRow('Image Paste', 'Save pasted or drag-dropped images automatically and insert a markdown link at the caret.');

        const ipGrid = ctx.makeGroup();

        // enabled
        const enabledField = ctx.makeCheckboxRow('Enable image paste & drop', '', ipState.enabled);
        const enabledInput = enabledField.input;
        enabledInput.id = 'mikedown-ip-enabled';
        enabledInput.addEventListener('change', () => { ipState.enabled = enabledInput.checked; });
        ipGrid.appendChild(enabledField.row);

        // folder (text)
        const folderField = ctx.makeFieldLabel('Folder', 'Where to save images, e.g. "images" or "assets/${docName}" for a folder per document.', 'stacked');
        const folderInput = document.createElement('input');
        folderInput.type = 'text';
        folderInput.value = ipState.folder;
        folderInput.className = 'settings-input';
        folderInput.addEventListener('input', () => { ipState.folder = folderInput.value; });
        folderField.appendChild(folderInput);
        ipGrid.appendChild(folderField);

        // folderRelativeTo (select)
        const relField = ctx.makeFieldLabel('Resolve folder against', 'Document directory or workspace root.');
        const relSelect = document.createElement('select');
        relSelect.className = 'settings-input';
        for (const [v, t] of [['document', 'Document folder'], ['workspace', 'Workspace root']] as const) {
          const o = document.createElement('option');
          o.value = v; o.textContent = t;
          if (ipState.folderRelativeTo === v) {o.selected = true;}
          relSelect.appendChild(o);
        }
        relSelect.addEventListener('change', () => {
          ipState.folderRelativeTo = relSelect.value as ImagePasteSettings['folderRelativeTo'];
        });
        relField.appendChild(relSelect);
        ipGrid.appendChild(relField);

        // filenamePattern (text)
        const patField = ctx.makeFieldLabel('Filename pattern', 'Tokens: ${docName} ${date} ${time} ${timestamp} ${hash} ${index}', 'stacked');
        const patInput = document.createElement('input');
        patInput.type = 'text';
        patInput.value = ipState.filenamePattern;
        patInput.className = 'settings-input';
        patInput.addEventListener('input', () => { ipState.filenamePattern = patInput.value; });
        patField.appendChild(patInput);
        ipGrid.appendChild(patField);

        // pathStyle (select)
        const psField = ctx.makeFieldLabel('Path style', 'Form of the path written into the markdown.');
        const psSelect = document.createElement('select');
        psSelect.className = 'settings-input';
        for (const [v, t] of [['relative', 'Relative to document'], ['workspace-absolute', 'Workspace-absolute (/...)']] as const) {
          const o = document.createElement('option');
          o.value = v; o.textContent = t;
          if (ipState.pathStyle === v) {o.selected = true;}
          psSelect.appendChild(o);
        }
        psSelect.addEventListener('change', () => {
          ipState.pathStyle = psSelect.value as ImagePasteSettings['pathStyle'];
        });
        psField.appendChild(psSelect);
        ipGrid.appendChild(psField);

        // altText (select)
        const altField = ctx.makeFieldLabel('Alt text', 'How alt text is populated on insert.');
        const altSelect = document.createElement('select');
        altSelect.className = 'settings-input';
        for (const [v, t] of [['empty', 'Empty'], ['filename', 'Filename'], ['prompt', 'Prompt on each paste']] as const) {
          const o = document.createElement('option');
          o.value = v; o.textContent = t;
          if (ipState.altText === v) {o.selected = true;}
          altSelect.appendChild(o);
        }
        altSelect.addEventListener('change', () => {
          ipState.altText = altSelect.value as ImagePasteSettings['altText'];
        });
        altField.appendChild(altSelect);
        ipGrid.appendChild(altField);

        // maxSizeMB (number)
        const sizeField = ctx.makeFieldLabel('Max size (MB)', 'Reject pastes larger than this.');
        const sizeInput = document.createElement('input');
        sizeInput.type = 'number';
        sizeInput.min = '1';
        sizeInput.max = '200';
        sizeInput.value = String(ipState.maxSizeMB);
        sizeInput.className = 'settings-input settings-input--short';
        sizeInput.addEventListener('input', () => {
          const n = parseFloat(sizeInput.value);
          if (Number.isFinite(n) && n > 0) {ipState.maxSizeMB = n;}
        });
        sizeField.appendChild(sizeInput);
        ipGrid.appendChild(sizeField);

        // cleanupUnreferenced
        const cleanupField = ctx.makeCheckboxRow(
          'Delete unreferenced images on save',
          'Only inside the configured images folder.',
          ipState.cleanupUnreferenced,
        );
        const cleanupInput = cleanupField.input;
        cleanupInput.id = 'mikedown-cleanup-unreferenced';
        cleanupInput.addEventListener('change', () => { ipState.cleanupUnreferenced = cleanupInput.checked; });
        ipGrid.appendChild(cleanupField.row);

        ipSectionRow.appendChild(ipGrid);

        // ── Image Resize
        const irState: ImageResizeSettings = { ...state.imageResize };
        const irSectionRow = ctx.makeRow('Image Resize', 'Right-click an image and use the popover to downscale it. Useful for trimming high-DPI screenshots.');
        const irOverwriteField = ctx.makeCheckboxRow('Overwrite original file when resizing', '', irState.overwrite);
        const irOverwriteInput = irOverwriteField.input;
        irOverwriteInput.id = 'mikedown-img-resize-overwrite';
        irOverwriteInput.addEventListener('change', () => { irState.overwrite = irOverwriteInput.checked; });
        irSectionRow.appendChild(ctx.makeGroup(irOverwriteField.row));

        return {
          rows: [ipSectionRow, irSectionRow],
          collect: () => ({ imagePaste: ipState, imageResize: irState }),
          onSaved: () => {
            state.imagePaste = { ...ipState };
            state.imageResize = { ...irState };
          },
        };
      },
    },
    // ── About tab ──────────────────────────────────────────────────────────
    {
      tab: 'about',
      tabLabel: 'About',
      afterTab: 'hotkeys',
      panelClassName: 'settings-panel--about',
      build(ctx) {
        return { rows: buildAboutRows(deps, () => ctx.close()) };
      },
    },
  ];
}

/**
 * The About tab. Static metadata + a few outbound links; opens external URLs
 * via the host's 'openLink' message so VS Code handles them in the user's
 * default browser.
 */
function buildAboutRows(deps: VsCodeSectionDeps, closeModal: () => void): HTMLElement[] {
  const { state, host } = deps;
  const titleRow = document.createElement('div');
  titleRow.className = 'settings-about-title';
  const name = document.createElement('div');
  name.textContent = 'MikeDown';
  name.className = 'settings-about-name';
  const tagline = document.createElement('div');
  tagline.textContent = 'A WYSIWYG markdown editor for VS Code.';
  tagline.className = 'settings-desc';
  titleRow.append(name, tagline);

  const meta = document.createElement('div');
  meta.className = 'settings-about-meta';
  const versionLine = document.createElement('div');
  versionLine.textContent = state.extensionVersion ? `Version ${state.extensionVersion}` : 'Version —';
  const licenseLine = document.createElement('div');
  licenseLine.textContent = 'License: MIT';
  meta.append(versionLine, licenseLine);

  const linksRow = document.createElement('div');
  linksRow.className = 'settings-about-links';

  function makeLink(label: string, href: string): HTMLAnchorElement {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      host.openLink?.(href, 'openNewTab');
    });
    return a;
  }

  linksRow.append(
    makeLink('GitHub repository →', 'https://github.com/mikejoseph23/mikedown'),
    makeLink('Changelog →', 'https://github.com/mikejoseph23/mikedown/blob/main/CHANGELOG.md'),
    makeLink('Report an issue →', 'https://github.com/mikejoseph23/mikedown/issues'),
  );

  const rows: HTMLElement[] = [titleRow, meta, linksRow];

  // Support appeal (M6): heading, one line lead in, and a button that closes
  // Settings and opens the "A note from Mike" card. Copy comes from the
  // host's ENTRY_COPY; the section is omitted until it has arrived.
  const supportCopy = state.supportEntryCopy;
  if (supportCopy) {
    const supportSection = document.createElement('div');
    supportSection.className = 'settings-about-support';
    const heading = document.createElement('div');
    heading.setAttribute('role', 'heading');
    heading.setAttribute('aria-level', '3');
    heading.textContent = supportCopy.aboutHeading;
    heading.className = 'settings-label';
    const leadIn = document.createElement('div');
    leadIn.textContent = supportCopy.aboutLeadIn;
    leadIn.className = 'settings-desc';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-testid', 'about-support-button');
    btn.textContent = supportCopy.aboutButton;
    btn.className = 'settings-btn settings-btn--secondary';
    btn.addEventListener('click', () => {
      closeModal();
      deps.requestSupportCard();
    });
    supportSection.append(heading, leadIn, btn);
    rows.push(supportSection);
  }
  return rows;
}
