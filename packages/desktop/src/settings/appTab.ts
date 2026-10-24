/**
 * The App tab of core's Settings modal (`extraSettingsSections`). It reuses
 * the modal's row builders so it matches core's styling, shows the effective
 * values (global merged with the folder override), and returns its values
 * from `collect()` as flat dotted keys for `host.saveSettings`. Two reserved
 * keys ride along: the "Save for this folder" toggle and the visual core
 * values read when the modal opened (the diff baseline, see store.ts).
 */
import type { MikeDownSettingsSection, MikeDownSettingsSectionContext } from '@mikedown/core';
import type { UpdaterStatus } from '../app/updaterApi';
import { lastCheckedText } from '../ui/updateView';
import type { DesktopSettings } from './desktopSettings';
import { SAVE_FOR_FOLDER_KEY } from './schema';
import { CORE_BASELINE_KEY } from './store';

export interface AppTabDeps {
  settings(): DesktopSettings;
  /** The window's open folder; the folder toggle is disabled without one. */
  folder(): string | null;
  /** The editor root of the pane that owns this modal, to read the visual baseline. */
  editorRoot(): HTMLElement | null;
  version(): Promise<string>;
  /** The updater's manual check; the "Last checked" line refreshes when it settles. */
  checkForUpdates(): Promise<void> | void;
  /** False on a store build (`MIKEDOWN_CHANNEL=store`): the store updates the app, so no Updates group. */
  updatesEnabled?(): boolean;
  /** For "Last checked" (`updater_status`). */
  updaterStatus?(): Promise<UpdaterStatus>;
  /** Unix ms; tests pin it. */
  now?(): number;
  setDefaultApp(): void;
}

function numberInput(value: number, min: number, max: number, step = 1): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'settings-input settings-input--short';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  return input;
}

function textInput(value: string, placeholder = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'settings-input settings-input--medium';
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  return input;
}

function buttonRow(ctx: MikeDownSettingsSectionContext, label: string, description: string, buttonText: string, run: () => void): { row: HTMLElement; button: HTMLButtonElement } {
  const row = ctx.makeRow(label, description, 'inline');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settings-btn';
  button.textContent = buttonText;
  button.addEventListener('click', run);
  row.appendChild(button);
  return { row, button };
}

/** A number the user typed, or undefined so the key is left out of the patch. */
function readNumber(input: HTMLInputElement): number | undefined {
  const n = Number(input.value);
  return input.value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
}

export function createAppTabSection(deps: AppTabDeps): MikeDownSettingsSection {
  return {
    tab: 'app',
    tabLabel: 'App',
    placement: 'end',
    build(ctx) {
      const s = deps.settings();
      const folder = deps.folder();
      // The modal shows these four from the editor's CSS variables, so read
      // the same source now, before the live preview moves them.
      const baseline: Record<string, unknown> = {};
      const root = deps.editorRoot();
      if (root) {
        const css = getComputedStyle(root);
        const size = parseInt(css.getPropertyValue('--mikedown-font-size'), 10);
        if (Number.isFinite(size)) {baseline.fontSize = size;}
        baseline.fontFamily = css.getPropertyValue('--mikedown-font-family').trim();
        baseline.headingFontFamily = css.getPropertyValue('--mikedown-heading-font-family').trim();
        baseline.contentWidth = css.getPropertyValue('--mikedown-content-width').trim() || '100%';
      }

      const folderToggle = ctx.makeCheckboxRow(
        'Save for this folder',
        folder
          ? 'Save the changes you make in this window to .mikedown/settings.json in the open folder instead of your global settings. Other folders are not affected.'
          : 'Open a folder to save settings for it. A single file has no folder of its own.',
        false,
      );
      folderToggle.input.disabled = !folder;
      folderToggle.input.dataset.setting = SAVE_FOR_FOLDER_KEY;

      // Versions
      const versioningEnabled = ctx.makeCheckboxRow('Keep earlier versions', 'Save a snapshot of each file in the open folder every time you save, so you can compare or go back.', s.versioning.enabled);
      const keepRow = ctx.makeRow('Versions to keep', 'How many snapshots to keep for each file. Older ones are removed.', 'inline');
      const keep = numberInput(s.versioning.keep, 1, 1000);
      keepRow.appendChild(keep);
      const maxSizeRow = ctx.makeRow('Skip versioning above (MB)', 'Files larger than this are saved without snapshots.', 'inline');
      const versionMax = numberInput(s.versioning.maxSizeMB, 0.1, 100, 0.5);
      maxSizeRow.appendChild(versionMax);

      // Updates (hidden on a store build). The key keeps its M10 name; the
      // check now runs every few hours, not only at launch.
      const updatesOn = deps.updatesEnabled?.() ?? true;
      const updates = ctx.makeCheckboxRow('Automatically check for updates', 'Look for a new version of MikeDown in the background. Nothing is installed until you choose Install and Relaunch.', s.updates.checkOnLaunch);
      const checkNow = buttonRow(ctx, 'Check for updates', '', 'Check Now', () => {
        checkNow.button.disabled = true;
        void Promise.resolve(deps.checkForUpdates())
          .catch(() => { /* the check reports its own outcome */ })
          .finally(() => {
            checkNow.button.disabled = false;
            refreshLastChecked();
          });
      });
      checkNow.button.dataset.action = 'check-updates';
      const lastChecked = checkNow.row.querySelector<HTMLElement>('.settings-desc') ?? checkNow.row;
      lastChecked.dataset.role = 'last-checked';
      const now = () => deps.now?.() ?? Date.now();
      const refreshLastChecked = () => {
        if (!deps.updaterStatus) {return;}
        void deps.updaterStatus().then(
          (st) => { lastChecked.textContent = lastCheckedText(st.lastCheckedAt, now()); },
          () => { lastChecked.textContent = ''; },
        );
      };
      refreshLastChecked();
      const updatesGroup = ctx.makeGroup(updates.row, checkNow.row);

      // Images (wording follows the VS Code extension)
      const imageFolderRow = ctx.makeRow('Image folder', 'Folder name (or relative path) where pasted images are saved. Created if it does not exist. Supports ${docName} for a folder per document, e.g. assets/${docName}.', 'stacked');
      const imageFolder = textInput(s.imagePaste.folder, 'images');
      imageFolderRow.appendChild(imageFolder);
      const relativeTo = ctx.makeSelectRow('Image folder is relative to', 'Where the image folder is resolved from.', s.imagePaste.folderRelativeTo, [
        { value: 'document', label: "The document's folder" },
        { value: 'workspace', label: 'The open folder' },
      ]);
      const patternRow = ctx.makeRow('Image file name', 'Pattern for generated image file names (the extension is added). Tokens: ${docName}, ${date}, ${time}, ${timestamp}, ${hash} (8-character content hash, enables dedupe), ${index}.', 'stacked');
      const pattern = textInput(s.imagePaste.filenamePattern, '${docName}-${timestamp}');
      patternRow.appendChild(pattern);
      const altText = ctx.makeSelectRow('Image alt text', 'How to fill in alt text for pasted images.', s.imagePaste.altText, [
        { value: 'empty', label: 'Leave empty' },
        { value: 'filename', label: 'Use the file name' },
        { value: 'prompt', label: 'Ask every time' },
      ]);
      const pathStyle = ctx.makeSelectRow('Image link style', 'Path style written into the inserted markdown image link.', s.imagePaste.pathStyle, [
        { value: 'relative', label: 'Relative to the document' },
        { value: 'workspace-absolute', label: 'From the open folder (starts with /)' },
      ]);
      const imageMaxRow = ctx.makeRow('Largest pasted image (MB)', 'Larger images are rejected with a message.', 'inline');
      const imageMax = numberInput(s.imagePaste.maxSizeMB, 1, 200);
      imageMaxRow.appendChild(imageMax);

      // Files
      const showHidden = ctx.makeCheckboxRow('Show hidden files', 'List dotfiles and folders such as .git in the folder sidebar.', s.tree.showHidden);
      const confirmDelete = ctx.makeCheckboxRow('Confirm before delete', 'Ask before moving a file or folder to the Trash.', s.tree.confirmDelete);
      const defaultApp = buttonRow(ctx, 'Default app for .md files', 'Open Markdown files with MikeDown when you double-click them.', 'Set MikeDown as default for .md', () => deps.setDefaultApp());

      // About
      const about = ctx.makeRow('About MikeDown', '', 'inline');
      const versionLabel = document.createElement('span');
      versionLabel.className = 'settings-desc';
      versionLabel.dataset.role = 'app-version';
      versionLabel.textContent = 'Version …';
      void deps.version().then((v) => { versionLabel.textContent = `Version ${v}`; }, () => { versionLabel.textContent = 'Version unknown'; });
      about.append(versionLabel);

      return {
        rows: [
          folderToggle.row,
          versioningEnabled.row,
          keepRow,
          maxSizeRow,
          ...(updatesOn ? [updatesGroup] : []),
          ctx.makeGroup(imageFolderRow, relativeTo.row, patternRow, altText.row, pathStyle.row, imageMaxRow),
          showHidden.row,
          confirmDelete.row,
          defaultApp.row,
          about,
        ],
        collect() {
          const out: Record<string, unknown> = {
            [SAVE_FOR_FOLDER_KEY]: folderToggle.input.checked && !folderToggle.input.disabled,
            [CORE_BASELINE_KEY]: baseline,
            'versioning.enabled': versioningEnabled.input.checked,
            ...(updatesOn ? { 'updates.checkOnLaunch': updates.input.checked } : {}),
            'imagePaste.folder': imageFolder.value.trim() || 'images',
            'imagePaste.folderRelativeTo': relativeTo.select.value,
            'imagePaste.filenamePattern': pattern.value.trim() || '${docName}-${timestamp}',
            'imagePaste.altText': altText.select.value,
            'imagePaste.pathStyle': pathStyle.select.value,
            'tree.showHidden': showHidden.input.checked,
            'tree.confirmDelete': confirmDelete.input.checked,
          };
          const numbers: Array<[string, number | undefined]> = [
            ['versioning.keep', Math.round(readNumber(keep) ?? NaN) || undefined],
            ['versioning.maxSizeMB', readNumber(versionMax)],
            ['imagePaste.maxSizeMB', readNumber(imageMax)],
          ];
          for (const [key, value] of numbers) {
            if (value !== undefined) {out[key] = value;}
          }
          return out;
        },
      };
    },
  };
}
