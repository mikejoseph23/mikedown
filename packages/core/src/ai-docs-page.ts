/**
 * Documentation bases on the AI Engines page: the list with its health, the
 * add and edit form, remove and enable, and the advanced options. A section
 * of `ai-engines-page.ts` beside Tasks, loaded with it through `ai-ui.ts`, and
 * only there when the host has `host.docs`.
 *
 * Two save paths, on purpose:
 * - A base saves at once through `host.docs.saveBases`, like an API key. Its
 *   health comes from the host, so a base the host has not got has nothing to
 *   show. This file never writes `ai.docBases` into the settings draft, and
 *   Discard on the page does not undo a saved base.
 * - The advanced options are `ai.docs` in the page's draft, saved on Done with
 *   the rest of the page.
 *
 * The list comes from `listBases()` when the section first opens and on
 * Refresh, never otherwise (a walk of every root is not free). After a save,
 * a base keeps its health unless its folders or home file changed; then it
 * says "Not checked yet" until the next Refresh. While the list is unknown
 * (not loaded, or the load failed) nothing can be saved: a partial list would
 * overwrite the user's bases.
 *
 * Jobs (load, save) run one at a time in a queue, and each save computes its
 * list from the result of the job before it, so two quick switches both land
 * and a slow Refresh cannot bring back what a save just changed.
 *
 * Checks here are for the messages. The host re-validates everything it is
 * handed (`parseAiSettings`), and a repo can never add a base.
 *
 * Base names, paths and health text are data: set with `textContent` only.
 * Modal UI only: nothing here touches the editor document or its DOM.
 */

import {
  AI_DOCS_MAX_HOPS_MAX, AI_DOCS_MAX_HOPS_MIN, AI_DOCS_NAVIGATE_BY, AI_DOCS_SOURCE_SHARE_MAX, AI_DOCS_SOURCE_SHARE_MIN, DOCS_NO_HOME_TEXT,
  checkDocRoot, clampDocsHops, clampDocsSourceShare, docRootKey, normalizeDocHomeFile, parseAiSettings, toAiError,
} from './ai';
import type { AiDocBase, AiDocBaseStatus, AiDocRootStatus, AiDocsNavigateBy, AiDocsOptions, AiSettings, MikeDownDocsHost } from './ai';
import { uniqueEngineId } from './ai-settings-model';
import { ICONS, button, el, keepFocus, nextId, note, switchInput } from './ai-settings-dom';
import type { MikeDownSettingsSectionContext } from './types';

// ── The model ───────────────────────────────────────────────────────────────

export const DOCS_CLOUD_LABEL = 'May be sent to cloud engines';
export const DOCS_CLOUD_LINE = 'Pages from this base may go to the cloud engines you allow.';
export const DOCS_NOT_CHECKED_TEXT = 'Not checked yet';
export const DOCS_ROOT_MISSING_TEXT = 'Root not found';

const NAVIGATE_LABELS: Record<AiDocsNavigateBy, string> = { section: 'Section', page: 'Page' };

export interface DocsHealthChip {
  text: string;
  tone: 'quiet' | 'warn';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One root's health line: where its home is, and what the walk found. */
export function docsRootChips(root: AiDocRootStatus): DocsHealthChip[] {
  if (!root.found) {return [{ text: DOCS_ROOT_MISSING_TEXT, tone: 'warn' }];}
  const chips: DocsHealthChip[] = [];
  const hasHome = !!root.home && root.home !== 'map' && !!root.homePath;
  chips.push({ text: hasHome ? `Home: ${root.homePath}` : DOCS_NO_HOME_TEXT, tone: 'quiet' });
  chips.push({ text: plural(root.fileCount, 'file'), tone: 'quiet' });
  if (root.oversizeSkipped > 0) {chips.push({ text: `${root.oversizeSkipped} too large, skipped`, tone: 'quiet' });}
  if (root.capReached) {chips.push({ text: 'File limit reached', tone: 'warn' });}
  return chips;
}

/** What only the base as a whole knows. */
export function docsBaseChips(status: AiDocBaseStatus): DocsHealthChip[] {
  return status.brokenLinks ? [{ text: plural(status.brokenLinks, 'broken link'), tone: 'warn' }] : [];
}

/** The advanced options with `patch` applied, clamped here and not only by the controls. */
export function withDocsOptions(settings: AiSettings, patch: Partial<AiDocsOptions>): AiSettings {
  const next = { ...settings.docs, ...patch };
  return {
    ...settings,
    docs: {
      ...next,
      maxHops: clampDocsHops(next.maxHops),
      sourceShare: clampDocsSourceShare(next.sourceShare),
      navigateBy: AI_DOCS_NAVIGATE_BY.includes(next.navigateBy) ? next.navigateBy : 'section',
    },
  };
}

export type DocRootFieldCheck = { ok: true; path: string } | { ok: false; message: string };

/** Can `raw` join this base? The schema's reasons, then whether another root already has it. */
export function checkBaseRoot(raw: unknown, inThisBase: readonly string[], others: readonly AiDocBase[]): DocRootFieldCheck {
  const checked = checkDocRoot(raw);
  if (!checked.ok) {return { ok: false, message: `This path ${checked.reason}.` };}
  const key = docRootKey(checked.path);
  if (inThisBase.some((r) => docRootKey(r) === key)) {return { ok: false, message: 'This base already has that folder.' };}
  const holder = others.find((b) => b.roots.some((r) => docRootKey(r) === key));
  if (holder) {return { ok: false, message: `That folder is already in “${holder.name}”.` };}
  return { ok: true, path: checked.path };
}

export interface DocBaseFormValues {
  name: string;
  roots: string[];
  homeFile: string;
  allowCloud: boolean;
}

export interface DocBaseFormErrors {
  roots?: string;
  homeFile?: string;
}

export type DocBaseFormCheck = { ok: true; base: AiDocBase } | { ok: false; errors: DocBaseFormErrors };

/**
 * The form as a base, or what stops it. Editing keeps the base's id, its
 * enabled state and any keys a newer version saved. A blank name takes the
 * first folder's name, as the schema does.
 */
export function checkDocBaseForm(values: DocBaseFormValues, others: readonly AiDocBase[], existing?: AiDocBase): DocBaseFormCheck {
  const errors: DocBaseFormErrors = {};
  if (values.roots.length === 0) {errors.roots = 'Add at least one folder.';}
  for (const [i, root] of values.roots.entries()) {
    const checked = checkBaseRoot(root, values.roots.slice(0, i), others);
    if (!checked.ok) {
      errors.roots = `${root}: ${checked.message}`;
      break;
    }
  }
  const homeText = values.homeFile.trim();
  const home = homeText ? normalizeDocHomeFile(homeText) : null;
  if (homeText && !home) {errors.homeFile = 'The home file must be a markdown file name or a path inside the folder, such as HOME.md.';}
  if (errors.roots || errors.homeFile) {return { ok: false, errors };}

  const base: AiDocBase = {
    ...(existing ?? { enabled: true }),
    id: existing?.id ?? '',
    name: values.name.trim(),
    roots: values.roots,
    allowCloud: values.allowCloud,
  };
  if (home) {base.homeFile = home;} else {delete base.homeFile;}
  return { ok: true, base };
}

/**
 * The whole list through the same parser the host uses. Anything it would
 * drop stops the save, so the host is never handed a list it would shorten.
 * New bases get their id here. The result is what to send.
 */
export function revalidateDocBases(bases: readonly AiDocBase[]): { ok: true; bases: AiDocBase[] } | { ok: false; reason: string } {
  const warnings: string[] = [];
  const taken = bases.map((b) => b.id).filter(Boolean);
  const parsed = parseAiSettings({ docBases: bases }, {
    onWarning: (w) => warnings.push(w),
    generateId: (name) => {
      const id = uniqueEngineId(name, taken);
      taken.push(id);
      return id;
    },
  }).docBases;
  if (warnings.length > 0) {
    // The schema's reason, without its position in the array.
    return { ok: false, reason: `Not saved: ${warnings[0].replace(/^docBases\[\d+\](\.\w+(\[\d+\])?)?\s*/, '')}` };
  }
  return { ok: true, bases: parsed };
}

function lastPathSegment(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function sameRootsAndHome(a: AiDocBase, b: AiDocBase): boolean {
  return JSON.stringify(a.roots) === JSON.stringify(b.roots) && (a.homeFile ?? '') === (b.homeFile ?? '');
}

// ── The section ─────────────────────────────────────────────────────────────

export interface DocsBasesDeps {
  docs: MikeDownDocsHost;
  /** The page's settings draft, for the advanced options only. */
  getDraft(): AiSettings;
  setDraft(next: AiSettings): void;
  announce(text: string): void;
  /** How many bases there are changed (the list entry's second line). */
  onCountChanged(): void;
}

export interface DocsBasesSection {
  element: HTMLElement;
  /** The section is showing. The first call checks the bases' health. */
  opened(): void;
  /** Back or Escape: close the open form or confirmation. False when there was none. */
  back(): boolean;
  /** The form is open with something typed that Done would lose. */
  hasUnsavedForm(): boolean;
  /** Say so in the form and go there. */
  flagUnsavedForm(): void;
  focus(): void;
  /** Bases on the list, or null before the first answer. */
  count(): number | null;
  dispose(): void;
}

interface Entry {
  base: AiDocBase;
  /** Null: the folders changed since the host last looked. */
  health: AiDocBaseStatus | null;
}

interface FormState {
  existing?: AiDocBase;
  initial: DocBaseFormValues;
  values: DocBaseFormValues;
  saving: boolean;
  showError(text: string): void;
  focusFirst(): void;
}

export function createDocsBasesSection(ctx: MikeDownSettingsSectionContext, deps: DocsBasesDeps): DocsBasesSection {
  const { docs } = deps;
  const element = el('div', 'ai-docs');
  const listView = el('div', 'ai-docs-list-view');
  const formView = el('div', 'ai-docs-form-view');
  formView.hidden = true;

  let entries: Entry[] = [];
  /** The host answered at least once. Until then nothing can be saved. */
  let loaded = false;
  let checking = false;
  let openedOnce = false;
  let disposed = false;
  let problem: string | null = null;
  let confirmRemoveId: string | null = null;
  let form: FormState | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job);
    queue = run.catch(() => { /* jobs report their own errors */ });
    return run;
  }

  function focusFk(key: string): void {
    Array.from(element.querySelectorAll<HTMLElement>('[data-fk]')).find((n) => n.dataset.fk === key)?.focus({ preventScroll: true });
  }

  // ── Talking to the host ───────────────────────────────────────────────────

  function load(): void {
    if (checking || disposed) {return;}
    checking = true;
    problem = null;
    renderList();
    deps.announce('Checking bases…');
    void enqueue(async () => {
      if (disposed) {return;}
      try {
        const list = await docs.listBases();
        if (disposed) {return;}
        entries = list.map((status) => ({ base: status.base, health: status }));
        loaded = true;
        deps.announce(`Checked ${plural(entries.length, 'base')}.`);
      } catch (err) {
        if (disposed) {return;}
        problem = `Could not read your bases: ${toAiError(err).message}`;
        deps.announce(problem);
      }
      checking = false;
      if (confirmRemoveId && !entries.some((e) => e.base.id === confirmRemoveId)) {confirmRemoveId = null;}
      renderList();
      deps.onCountChanged();
    });
  }

  /** Save the list `change` makes of the current one. Resolves with what went wrong, or null. */
  function mutate(change: (bases: AiDocBase[]) => AiDocBase[]): Promise<string | null> {
    return enqueue(async () => {
      if (disposed) {return null;}
      if (!loaded) {return 'Your bases could not be read, so nothing was saved. Choose Refresh and try again.';}
      const checked = revalidateDocBases(change(entries.map((e) => e.base)));
      if (!checked.ok) {return checked.reason;}
      try {
        await docs.saveBases(checked.bases);
      } catch (err) {
        return `Not saved: ${toAiError(err).message}`;
      }
      if (disposed) {return null;}
      const before = new Map(entries.map((e) => [e.base.id, e]));
      entries = checked.bases.map((base) => {
        const prev = before.get(base.id);
        // The answer is still true unless the folders or the home file changed.
        if (!prev?.health || !sameRootsAndHome(prev.base, base)) {return { base, health: null };}
        return { base, health: { ...prev.health, base, active: base.enabled && prev.health.rootsMissing < base.roots.length } };
      });
      problem = null;
      deps.onCountChanged();
      return null;
    });
  }

  // ── The list ──────────────────────────────────────────────────────────────

  function chipNode(chip: DocsHealthChip): HTMLElement {
    const node = el('span', `ai-docs-chip${chip.tone === 'warn' ? ' ai-docs-chip--warn' : ''}`);
    if (chip.tone === 'warn') {node.innerHTML = ICONS.warn;}
    node.append(el('span', '', chip.text));
    return node;
  }

  function chipLine(chips: DocsHealthChip[]): HTMLElement {
    const line = el('span', 'ai-docs-chips');
    line.append(...chips.map(chipNode));
    return line;
  }

  function renderList(): void {
    keepFocus(listView, () => {
      listView.replaceChildren();
      listView.append(buildBar());
      if (problem) {listView.append(note('error', problem, 'ai-result'));}
      if (loaded && entries.length === 0) {
        const empty = el('div', 'ai-summary-empty');
        empty.append(
          el('div', 'ai-empty-title', 'No bases yet'),
          el('div', 'ai-empty-text', 'A base is a folder of markdown the AI can read to answer your questions.'),
          el('div', 'ai-empty-text', 'Add your docs folder, and chat can cite its pages.'),
        );
        listView.append(empty);
      } else if (entries.length > 0) {
        const group = ctx.makeGroup(...entries.map(buildRow));
        group.setAttribute('role', 'list');
        group.setAttribute('aria-label', 'Documentation bases');
        listView.append(group);
      }
    });
  }

  function buildBar(): HTMLElement {
    const bar = el('div', 'ai-docs-bar');
    bar.append(el('span', 'ai-docs-status', checking ? 'Checking bases…' : ''));
    if (entries.length > 0 || !loaded) {
      const refresh = button('settings-btn', 'Refresh', { html: ICONS.refresh, fk: 'docs:refresh', title: 'Check the folders again' });
      // aria-disabled, not disabled: focus stays on it while it looks.
      if (checking) {refresh.setAttribute('aria-disabled', 'true');}
      refresh.addEventListener('click', () => load());
      bar.append(refresh);
    }
    const add = button('settings-btn settings-btn--secondary', 'Add base', { html: ICONS.plus, fk: 'docs:add' });
    if (!loaded) {add.setAttribute('aria-disabled', 'true');}
    add.addEventListener('click', () => { if (loaded) {openForm();} });
    bar.append(add);
    return bar;
  }

  function buildRow({ base, health }: Entry): HTMLElement {
    const row = el('div', 'settings-row ai-docs-base');
    row.setAttribute('role', 'listitem');
    row.dataset.baseId = base.id;
    row.classList.toggle('is-disabled', !base.enabled);

    const head = el('div', 'ai-docs-base-head');
    const title = el('div', 'ai-docs-base-title');
    title.append(el('span', 'ai-docs-base-name', base.name));
    if (base.allowCloud) {title.append(chipNode({ text: 'May go to cloud', tone: 'quiet' }));}
    if (!health) {title.append(chipNode({ text: DOCS_NOT_CHECKED_TEXT, tone: 'quiet' }));}

    const actions = el('div', 'ai-docs-base-actions');
    const edit = button('ai-link-btn', 'Edit', { ariaLabel: `Edit ${base.name}`, fk: `base:${base.id}:edit` });
    edit.addEventListener('click', () => openForm(base));
    const remove = button('ai-icon-btn ai-delete-btn', '', { html: ICONS.trash, ariaLabel: `Remove ${base.name}`, title: 'Remove from this list', fk: `base:${base.id}:remove` });
    remove.addEventListener('click', () => {
      confirmRemoveId = base.id;
      renderList();
      focusFk(`base:${base.id}:confirm-cancel`);
    });
    const enabled = switchInput(base.enabled, `Use ${base.name}`, `base:${base.id}:enabled`);
    enabled.addEventListener('change', () => setEnabled(base, enabled.checked));
    actions.append(edit, remove, enabled);
    head.append(title, actions);

    const roots = el('ul', 'ai-docs-roots');
    for (const path of base.roots) {
      const item = el('li', 'ai-docs-root');
      const pathNode = el('span', 'ai-docs-path ai-mono', path);
      pathNode.title = path;
      item.append(pathNode);
      const status = health?.roots.find((r) => docRootKey(r.root) === docRootKey(path));
      if (status) {item.append(chipLine(docsRootChips(status)));}
      roots.append(item);
    }
    row.append(head, roots);
    const baseChips = health ? docsBaseChips(health) : [];
    if (baseChips.length > 0) {row.append(chipLine(baseChips));}
    if (confirmRemoveId === base.id) {row.append(buildRemoveConfirm(base));}
    return row;
  }

  function setEnabled(base: AiDocBase, on: boolean): void {
    void mutate((bases) => bases.map((b) => (b.id === base.id ? { ...b, enabled: on } : b))).then((error) => {
      if (disposed) {return;}
      problem = error;
      renderList();
      deps.announce(error ?? `${base.name} turned ${on ? 'on' : 'off'}.`);
    });
  }

  function buildRemoveConfirm(base: AiDocBase): HTMLElement {
    const box = el('div', 'ai-confirm');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `Remove ${base.name}?`);
    const yes = button('settings-btn ai-btn--danger', 'Remove', { fk: `base:${base.id}:confirm-remove` });
    const no = button('settings-btn', 'Cancel', { fk: `base:${base.id}:confirm-cancel` });
    yes.addEventListener('click', () => removeBase(base));
    no.addEventListener('click', () => closeConfirm());
    box.append(el('span', 'ai-confirm-text', `Remove ${base.name} from this list? The folders and files on disk are not touched.`), yes, no);
    return box;
  }

  function closeConfirm(): void {
    const id = confirmRemoveId;
    confirmRemoveId = null;
    renderList();
    if (id) {focusFk(`base:${id}:remove`);}
  }

  function removeBase(base: AiDocBase): void {
    const index = entries.findIndex((e) => e.base.id === base.id);
    void mutate((bases) => bases.filter((b) => b.id !== base.id)).then((error) => {
      if (disposed) {return;}
      problem = error;
      confirmRemoveId = null;
      renderList();
      if (error) {
        deps.announce(error);
        focusFk(`base:${base.id}:remove`);
        return;
      }
      deps.announce(`Removed ${base.name} from this list. No files were touched.`);
      const next = entries[Math.min(index, entries.length - 1)];
      focusFk(next ? `base:${next.base.id}:edit` : 'docs:add');
    });
  }

  // ── Advanced ──────────────────────────────────────────────────────────────

  const advancedPanelId = nextId('ai-docs-advanced');
  const advancedToggle = button('ai-disclosure ai-docs-advanced-toggle', 'Advanced', { html: ICONS.chevron, fk: 'docs:advanced' });
  advancedToggle.setAttribute('aria-expanded', 'false');
  advancedToggle.setAttribute('aria-controls', advancedPanelId);
  const advancedPanel = el('div', 'ai-advanced ai-docs-advanced');
  advancedPanel.id = advancedPanelId;
  advancedPanel.hidden = true;
  advancedToggle.addEventListener('click', () => {
    advancedPanel.hidden = !advancedPanel.hidden;
    advancedToggle.setAttribute('aria-expanded', String(!advancedPanel.hidden));
  });

  function numberRow(label: string, description: string, read: () => number, write: (n: number) => void, min: number, max: number, fk: string): HTMLElement {
    const row = ctx.makeRow(label, description, 'inline');
    const input = el('input', 'settings-input settings-input--small ai-docs-number');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(read());
    input.dataset.fk = fk;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      // Blank or nonsense keeps what was there; the field then shows what is kept, clamped.
      const value = input.value.trim() === '' ? NaN : Number(input.value);
      if (Number.isFinite(value)) {write(value);}
      input.value = String(read());
    });
    row.append(input);
    return row;
  }

  function buildAdvanced(): void {
    const draft = () => deps.getDraft();
    const hops = numberRow(
      'Max hops',
      `Rounds of picking pages before the answer, ${AI_DOCS_MAX_HOPS_MIN} to ${AI_DOCS_MAX_HOPS_MAX}.`,
      () => draft().docs.maxHops,
      (n) => deps.setDraft(withDocsOptions(draft(), { maxHops: n })),
      AI_DOCS_MAX_HOPS_MIN, AI_DOCS_MAX_HOPS_MAX, 'docs:hops',
    );
    const share = numberRow(
      'Source share',
      `How much of the model’s context the pages may take, ${AI_DOCS_SOURCE_SHARE_MIN} to ${AI_DOCS_SOURCE_SHARE_MAX}%.`,
      () => draft().docs.sourceShare,
      (n) => deps.setDraft(withDocsOptions(draft(), { sourceShare: n })),
      AI_DOCS_SOURCE_SHARE_MIN, AI_DOCS_SOURCE_SHARE_MAX, 'docs:share',
    );
    const by = ctx.makeSelectRow<AiDocsNavigateBy>(
      'Navigate by',
      'What the AI asks to read: one section, or a whole page.',
      draft().docs.navigateBy,
      AI_DOCS_NAVIGATE_BY.map((value) => ({ value, label: NAVIGATE_LABELS[value] })),
    );
    by.select.classList.add('settings-input--small', 'ai-docs-select');
    by.select.dataset.fk = 'docs:navigate-by';
    by.select.setAttribute('aria-label', 'Navigate by');
    by.select.addEventListener('change', () => deps.setDraft(withDocsOptions(draft(), { navigateBy: by.select.value as AiDocsNavigateBy })));
    advancedPanel.append(ctx.makeGroup(hops, share, by.row), el('div', 'settings-desc', 'These save when you choose Done.'));
  }

  // ── Add and edit ──────────────────────────────────────────────────────────

  const otherBases = (existing?: AiDocBase) => entries.map((e) => e.base).filter((b) => b.id !== existing?.id);

  function openForm(existing?: AiDocBase): void {
    confirmRemoveId = null;
    const values: DocBaseFormValues = {
      name: existing?.name ?? '',
      roots: [...(existing?.roots ?? [])],
      homeFile: existing?.homeFile ?? '',
      allowCloud: existing?.allowCloud ?? false,
    };
    const state: FormState = {
      existing,
      initial: { ...values, roots: [...values.roots] },
      values,
      saving: false,
      showError: () => {},
      focusFirst: () => {},
    };
    form = state;
    formView.replaceChildren(buildForm(state));
    showView();
    state.focusFirst();
  }

  function closeForm(focusKey?: string): void {
    form = null;
    formView.replaceChildren();
    showView();
    renderList();
    if (focusKey) {focusFk(focusKey);}
  }

  function showView(): void {
    const editing = !!form;
    formView.hidden = !editing;
    listView.hidden = editing;
    advancedToggle.hidden = editing;
    if (editing) {
      advancedPanel.hidden = true;
      advancedToggle.setAttribute('aria-expanded', 'false');
    }
  }

  function labelRow(label: string, description: string, layout: 'inline' | 'stacked', control?: HTMLElement): HTMLElement {
    const row = ctx.makeRow(label, description, layout);
    if (control) {
      control.id ||= nextId('ai-docs-field');
      const labelNode = row.querySelector('label');
      if (labelNode) {labelNode.htmlFor = control.id;}
    }
    return row;
  }

  function buildForm(state: FormState): HTMLElement {
    const { existing, values } = state;
    const box = el('div', 'ai-docs-form');
    box.setAttribute('role', 'group');
    const heading = el('div', 'ai-subhead', existing ? `Edit ${existing.name}` : 'Add a base');
    heading.id = nextId('ai-docs-form-title');
    box.setAttribute('aria-labelledby', heading.id);

    // Name
    const nameInput = el('input', 'settings-input');
    nameInput.type = 'text';
    nameInput.value = values.name;
    nameInput.dataset.fk = 'form:name';
    nameInput.spellcheck = false;
    nameInput.placeholder = 'Team docs';
    nameInput.addEventListener('input', () => { values.name = nameInput.value; });
    const nameRow = labelRow('Name', 'Shown in the chat and when asking before a cloud request.', 'inline', nameInput);
    nameRow.append(nameInput);

    // Folders
    const rootsError = el('div', 'ai-field-error');
    rootsError.id = nextId('ai-docs-roots-error');
    rootsError.setAttribute('aria-live', 'polite');
    const rootsList = el('ul', 'ai-docs-form-roots');
    rootsList.setAttribute('aria-label', 'Folders in this base');

    function setRootsError(text: string): void {
      rootsError.textContent = text;
    }

    function renderRoots(): void {
      keepFocus(rootsList, () => {
        rootsList.replaceChildren();
        for (const root of values.roots) {
          const item = el('li', 'ai-docs-form-root');
          const pathNode = el('span', 'ai-docs-path ai-mono', root);
          pathNode.title = root;
          const remove = button('ai-icon-btn', '', { html: ICONS.close, ariaLabel: `Take ${root} out of this base`, title: 'Take out of this base', fk: `form:root-remove:${root}` });
          remove.addEventListener('click', () => {
            const at = values.roots.indexOf(root);
            values.roots = values.roots.filter((r) => r !== root);
            renderRoots();
            const next = values.roots[Math.min(at, values.roots.length - 1)];
            focusFk(next ? `form:root-remove:${next}` : firstAddKey);
          });
          item.append(pathNode, remove);
          rootsList.append(item);
        }
      });
    }

    function addRoot(raw: string): boolean {
      const checked = checkBaseRoot(raw, values.roots, otherBases(existing));
      if (!checked.ok) {
        setRootsError(checked.message);
        return false;
      }
      setRootsError('');
      values.roots = [...values.roots, checked.path];
      if (!values.name.trim()) {
        values.name = lastPathSegment(checked.path);
        nameInput.value = values.name;
      }
      renderRoots();
      deps.announce(`Added ${checked.path}.`);
      return true;
    }

    /** A host's picker: the path it answers still goes through the same checks. */
    function pickerButton(label: string, fk: string, pick: () => Promise<string | null>): HTMLButtonElement {
      const b = button('settings-btn settings-btn--secondary', label, { fk });
      b.addEventListener('click', () => {
        void pick().then(
          (path) => { if (form === state && path) {addRoot(path);} },
          (err: unknown) => { if (form === state) {setRootsError(toAiError(err).message);} },
        );
      });
      return b;
    }

    const adders = el('div', 'ai-docs-form-adders');
    if (docs.addWorkspaceFolder) {adders.append(pickerButton('Add this workspace folder', 'form:workspace', () => docs.addWorkspaceFolder!()));}
    if (docs.pickFolder) {adders.append(pickerButton('Choose folder…', 'form:pick', () => docs.pickFolder!()));}
    // Desktop has to pick: the picker is what opens a folder to the app. Elsewhere a path can be typed, for a folder outside the workspace.
    let pathLine: HTMLElement | null = null;
    if (!docs.pickFolder) {
      pathLine = el('div', 'ai-docs-form-path');
      const pathInput = el('input', 'settings-input ai-mono');
      pathInput.type = 'text';
      pathInput.dataset.fk = 'form:path';
      pathInput.spellcheck = false;
      pathInput.placeholder = '/full/path/to/docs';
      pathInput.setAttribute('aria-label', 'Folder path');
      pathInput.setAttribute('aria-describedby', rootsError.id);
      const addPath = button('settings-btn settings-btn--secondary', 'Add', { ariaLabel: 'Add this path', fk: 'form:add-path' });
      const submitPath = () => {
        if (addRoot(pathInput.value)) {
          pathInput.value = '';
          pathInput.removeAttribute('aria-invalid');
        } else {
          pathInput.setAttribute('aria-invalid', 'true');
        }
      };
      addPath.addEventListener('click', submitPath);
      pathInput.addEventListener('input', () => {
        pathInput.removeAttribute('aria-invalid');
        setRootsError('');
      });
      pathInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') {return;}
        e.preventDefault();
        submitPath();
      });
      pathLine.append(pathInput, addPath);
    }
    const firstAddKey = docs.addWorkspaceFolder ? 'form:workspace' : docs.pickFolder ? 'form:pick' : 'form:path';
    const rootsRow = ctx.makeRow('Folders', 'Every markdown file under these folders can be read. Symlinks are skipped.');
    rootsRow.append(rootsList);
    if (adders.childElementCount > 0) {rootsRow.append(adders);}
    if (pathLine) {rootsRow.append(pathLine);}
    rootsRow.append(rootsError);
    renderRoots();

    // Home file
    const homeInput = el('input', 'settings-input ai-mono');
    homeInput.type = 'text';
    homeInput.value = values.homeFile;
    homeInput.dataset.fk = 'form:home';
    homeInput.spellcheck = false;
    homeInput.placeholder = 'HOME.md';
    const homeError = el('div', 'ai-field-error');
    homeError.id = nextId('ai-docs-home-error');
    homeError.setAttribute('aria-live', 'polite');
    homeInput.setAttribute('aria-describedby', homeError.id);
    homeInput.addEventListener('input', () => {
      values.homeFile = homeInput.value;
      homeError.textContent = '';
      homeInput.removeAttribute('aria-invalid');
    });
    const homeRow = labelRow('Home file', 'Optional. The page to start from in each folder. Otherwise INDEX.md, then README.md.', 'inline', homeInput);
    homeRow.append(homeInput, homeError);

    // Cloud
    const cloud = switchInput(values.allowCloud, DOCS_CLOUD_LABEL, 'form:cloud');
    cloud.addEventListener('change', () => { values.allowCloud = cloud.checked; });
    const cloudRow = labelRow(DOCS_CLOUD_LABEL, DOCS_CLOUD_LINE, 'inline', cloud);
    cloudRow.append(cloud);

    // Actions
    const formError = el('div', 'ai-docs-form-error');
    formError.setAttribute('aria-live', 'polite');
    state.showError = (text) => formError.replaceChildren(note('error', text, 'ai-result'));
    const save = button('settings-btn settings-btn--primary', existing ? 'Save' : 'Add base', { fk: 'form:save' });
    const cancel = button('settings-btn', 'Cancel', { fk: 'form:cancel' });
    save.addEventListener('click', () => submit());
    cancel.addEventListener('click', () => back());
    const actions = el('div', 'ai-docs-form-actions');
    actions.append(save, cancel);

    function submit(): void {
      if (state.saving) {return;}
      formError.replaceChildren();
      const checked = checkDocBaseForm(values, otherBases(existing), existing);
      setRootsError('');
      homeError.textContent = '';
      homeInput.removeAttribute('aria-invalid');
      if (!checked.ok) {
        setRootsError(checked.errors.roots ?? '');
        homeError.textContent = checked.errors.homeFile ?? '';
        if (checked.errors.homeFile) {homeInput.setAttribute('aria-invalid', 'true');}
        deps.announce(checked.errors.roots ?? checked.errors.homeFile ?? '');
        focusFk(checked.errors.roots ? firstAddKey : 'form:home');
        return;
      }
      state.saving = true;
      save.setAttribute('aria-disabled', 'true');
      const base = checked.base;
      void mutate((bases) => (existing ? bases.map((b) => (b.id === existing.id ? base : b)) : [...bases, base])).then((error) => {
        if (disposed) {return;}
        if (form !== state) {
          // Cancelled while it was saving: the save still happened, or it did not.
          problem = error;
          renderList();
          deps.announce(error ?? `Saved ${base.name || lastPathSegment(base.roots[0])}.`);
          return;
        }
        state.saving = false;
        save.removeAttribute('aria-disabled');
        if (error) {
          state.showError(error);
          deps.announce(error);
          save.focus();
          return;
        }
        const name = base.name || lastPathSegment(base.roots[0]);
        deps.announce(existing ? `Saved ${name}.` : `Added ${name}. Choose Refresh to check it.`);
        const saved = existing?.id ?? entries[entries.length - 1]?.base.id;
        closeForm(saved ? `base:${saved}:edit` : 'docs:add');
      });
    }

    for (const input of [nameInput, homeInput]) {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') {return;}
        e.preventDefault();
        submit();
      });
    }

    state.focusFirst = () => {
      if (existing || values.roots.length > 0) {nameInput.focus({ preventScroll: true });} else {focusFk(firstAddKey);}
    };

    box.append(heading, ctx.makeGroup(nameRow, rootsRow, homeRow, cloudRow), formError, actions);
    return box;
  }

  function formDirty(): boolean {
    return !!form && JSON.stringify(form.values) !== JSON.stringify(form.initial);
  }

  function back(): boolean {
    if (form) {
      const id = form.existing?.id;
      closeForm(id ? `base:${id}:edit` : 'docs:add');
      return true;
    }
    if (confirmRemoveId) {
      closeConfirm();
      return true;
    }
    return false;
  }

  // ── Assemble ──────────────────────────────────────────────────────────────

  buildAdvanced();
  element.append(listView, formView, advancedToggle, advancedPanel);
  renderList();

  return {
    element,
    opened() {
      if (openedOnce) {return;}
      openedOnce = true;
      load();
    },
    back,
    hasUnsavedForm: formDirty,
    flagUnsavedForm() {
      form?.showError('Save this base or cancel it before you choose Done.');
      deps.announce('Save this base or cancel it before you choose Done.');
      focusFk('form:save');
    },
    focus() {
      if (form) {form.focusFirst();} else {focusFk('docs:add');}
    },
    count: () => (loaded ? entries.length : null),
    dispose() {
      disposed = true;
      form = null;
    },
  };
}
