/**
 * The Documentation bases manager (ai-docs-page.ts) against a fake `host.docs`:
 * every health state, the validation messages, the clamps, the cloud switch,
 * the save queue and hostile text. `ai-bases-page.test.ts` is the smoke test
 * for the wiring (add, remove, switch, Done); this file does not repeat it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_DOCS_MAX_HOPS_MAX, AI_DOCS_MAX_HOPS_MIN, AI_DOCS_SOURCE_SHARE_MAX, AI_DOCS_SOURCE_SHARE_MIN, DOCS_NO_HOME_TEXT, parseAiSettings,
} from '../src/ai';
import type { AiDocBase, AiDocBaseStatus, AiDocRootStatus, AiSettings, MikeDownAiHost, MikeDownDocsHost } from '../src/ai';
import {
  DOCS_CLOUD_LABEL, DOCS_CLOUD_LINE, DOCS_NOT_CHECKED_TEXT, DOCS_ROOT_MISSING_TEXT, checkBaseRoot, checkDocBaseForm, docsBaseChips, docsRootChips, withDocsOptions,
} from '../src/ai-docs-page';
import { mountAiEnginesPage } from '../src/ai-engines-page';
import type { AiEnginesPageOptions } from '../src/ai-engines-page';
import { settingsSectionContext } from '../src/settings-rows';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const quiet = { onWarning: () => {} };

function settings(): AiSettings {
  return parseAiSettings({
    enabled: true,
    engines: [{ id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: { chat: true, stream: true } }] }],
    routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'anyLocal', tasks: {} },
  }, quiet);
}

const mkBase = (id: string, over: Partial<AiDocBase> = {}): AiDocBase => ({ id, name: id.toUpperCase(), roots: [`/docs/${id}`], allowCloud: false, enabled: true, ...over });

const root = (path: string, over: Partial<AiDocRootStatus> = {}): AiDocRootStatus => ({
  root: path, label: path.split('/').pop() ?? '', found: true, home: 'index', homePath: 'INDEX.md', fileCount: 4, oversizeSkipped: 0, capReached: false, ...over,
});

function mkStatus(base: AiDocBase, over: Partial<AiDocBaseStatus> = {}): AiDocBaseStatus {
  const roots = over.roots ?? base.roots.map((r) => root(r));
  return {
    base,
    active: base.enabled,
    roots,
    fileCount: roots.reduce((n, r) => n + r.fileCount, 0),
    oversizeSkipped: 0,
    rootsMissing: roots.filter((r) => !r.found).length,
    capReached: false,
    ...over,
  };
}

function fakeDocs(list: AiDocBaseStatus[] = [], over: Partial<MikeDownDocsHost> = {}): MikeDownDocsHost {
  return {
    listBases: vi.fn(async () => list),
    index: vi.fn(),
    readSections: vi.fn(),
    keywordSearch: vi.fn(),
    saveBases: vi.fn(async () => {}),
    ...over,
  } as unknown as MikeDownDocsHost;
}

function options(over: Partial<AiEnginesPageOptions> = {}): AiEnginesPageOptions {
  const s = settings();
  return {
    ai: { complete: vi.fn(), listEngines: vi.fn(async () => []), testEngine: vi.fn(), discoverModels: vi.fn(), setSecret: vi.fn(async () => {}) } as unknown as MikeDownAiHost,
    settings: s,
    statuses: [],
    getHostSettings: () => s,
    waitForSettings: async () => null,
    onStatuses: vi.fn(),
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
}

const containers: HTMLElement[] = [];
const fk = (c: HTMLElement, key: string) => Array.from(c.querySelectorAll<HTMLElement>('[data-fk]')).find((n) => n.dataset.fk === key) as HTMLElement & HTMLInputElement;
const settle = () => new Promise((r) => setTimeout(r, 0));
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function change(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
async function open(docs: MikeDownDocsHost | undefined, over: Partial<AiEnginesPageOptions> = {}) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  containers.push(c);
  const opts = options({ initial: { section: 'bases' }, ...(docs ? { docs } : {}), ...over });
  const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), opts);
  await settle();
  return { c, page, opts };
}
const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.ai-docs-base'));
const saved = (docs: MikeDownDocsHost, call = 0) => (docs.saveBases as ReturnType<typeof vi.fn>).mock.calls[call][0] as AiDocBase[];
const fieldError = (c: HTMLElement) => c.querySelector('.ai-docs-form .ai-field-error')?.textContent ?? '';

afterEach(() => {
  while (containers.length) {containers.pop()!.remove();}
  vi.restoreAllMocks();
});

// ── Health states ───────────────────────────────────────────────────────────

describe('health chips', () => {
  const texts = (r: AiDocRootStatus) => docsRootChips(r).map((c) => c.text);

  it('a found root says where its home is and how many files it has', () => {
    expect(texts(root('/a'))).toEqual(['Home: INDEX.md', '4 files']);
    expect(texts(root('/a', { fileCount: 1 }))).toEqual(['Home: INDEX.md', '1 file']);
    expect(texts(root('/a', { fileCount: 0 }))).toEqual(['Home: INDEX.md', '0 files']);
  });

  it('no home, or only a map, says there is no home document', () => {
    expect(texts(root('/a', { home: undefined, homePath: undefined }))).toContain(DOCS_NO_HOME_TEXT);
    expect(texts(root('/a', { home: 'map', homePath: 'INDEX.md' }))).toContain(DOCS_NO_HOME_TEXT);
    expect(texts(root('/a', { home: 'index', homePath: undefined }))).toContain(DOCS_NO_HOME_TEXT);
  });

  it('too-large files and the file limit are warnings of their own', () => {
    expect(docsRootChips(root('/a', { oversizeSkipped: 3 }))).toContainEqual({ text: '3 too large, skipped', tone: 'quiet' });
    expect(docsRootChips(root('/a', { capReached: true }))).toContainEqual({ text: 'File limit reached', tone: 'warn' });
    expect(texts(root('/a'))).not.toContain('File limit reached');
  });

  it('a missing root shows only that, whatever else the status holds', () => {
    expect(docsRootChips(root('/a', { found: false, fileCount: 9, capReached: true }))).toEqual([{ text: DOCS_ROOT_MISSING_TEXT, tone: 'warn' }]);
  });

  it('broken links are the base\'s, singular and plural, and nothing when there are none', () => {
    const base = mkBase('a');
    expect(docsBaseChips(mkStatus(base, { brokenLinks: 1 }))).toEqual([{ text: '1 broken link', tone: 'warn' }]);
    expect(docsBaseChips(mkStatus(base, { brokenLinks: 7 }))).toEqual([{ text: '7 broken links', tone: 'warn' }]);
    expect(docsBaseChips(mkStatus(base, { brokenLinks: 0 }))).toEqual([]);
    expect(docsBaseChips(mkStatus(base))).toEqual([]);
  });
});

describe('the list', () => {
  it('draws each state on its own base and root, with warnings marked', async () => {
    const healthy = mkBase('ok', { name: 'Healthy', roots: ['/docs/ok'] });
    const gone = mkBase('gone', { name: 'Gone', roots: ['/docs/gone'] });
    const big = mkBase('big', { name: 'Big', roots: ['/docs/big'] });
    const { c } = await open(fakeDocs([
      mkStatus(healthy, { brokenLinks: 2 }),
      mkStatus(gone, { roots: [root('/docs/gone', { found: false, fileCount: 0 })] }),
      mkStatus(big, { roots: [root('/docs/big', { fileCount: 5000, capReached: true, oversizeSkipped: 1, home: undefined, homePath: undefined })] }),
    ]));
    const [a, b, d] = rows(c);
    expect(a.textContent).toContain('Home: INDEX.md');
    expect(a.textContent).toContain('2 broken links');
    expect(a.querySelectorAll('.ai-docs-chip--warn')).toHaveLength(1);
    expect(b.textContent).toContain(DOCS_ROOT_MISSING_TEXT);
    expect(b.textContent).not.toContain('files');
    expect(b.querySelectorAll('.ai-docs-chip--warn')).toHaveLength(1);
    expect(d.textContent).toContain(DOCS_NO_HOME_TEXT);
    expect(d.textContent).toContain('5000 files');
    expect(d.textContent).toContain('1 too large, skipped');
    expect(d.textContent).toContain('File limit reached');
    expect(c.querySelector('.ai-nav-btn--bases .ai-nav-sub')?.textContent).toBe('3 bases');
  });

  it('shows two roots of one base, each with its own health', async () => {
    const base = mkBase('two', { roots: ['/docs/a', '/docs/b'] });
    const { c } = await open(fakeDocs([mkStatus(base, { roots: [root('/docs/a', { fileCount: 3 }), root('/docs/b', { found: false })] })]));
    const items = Array.from(c.querySelectorAll('.ai-docs-root')).map((n) => n.textContent ?? '');
    expect(items[0]).toContain('/docs/a');
    expect(items[0]).toContain('3 files');
    expect(items[1]).toContain('/docs/b');
    expect(items[1]).toContain(DOCS_ROOT_MISSING_TEXT);
  });

  it('a disabled base is dimmed with its switch off, and a cloud base says so', async () => {
    const off = mkBase('off', { enabled: false });
    const cloud = mkBase('cloud', { allowCloud: true });
    const { c } = await open(fakeDocs([mkStatus(off), mkStatus(cloud)]));
    const [a, b] = rows(c);
    expect(a.classList.contains('is-disabled')).toBe(true);
    expect(fk(a, 'base:off:enabled').checked).toBe(false);
    expect(b.classList.contains('is-disabled')).toBe(false);
    expect(b.textContent).toContain('May go to cloud');
    expect(a.textContent).not.toContain('May go to cloud');
  });

  it('a root the host did not report has no health line, not a wrong one', async () => {
    const base = mkBase('x', { roots: ['/docs/x', '/docs/y'] });
    const { c } = await open(fakeDocs([mkStatus(base, { roots: [root('/docs/x')] })]));
    const items = c.querySelectorAll('.ai-docs-root');
    expect(items[1].querySelector('.ai-docs-chips')).toBeNull();
    expect(items[1].textContent).toBe('/docs/y');
  });

  it('matches a root to its health by the root key: Windows paths ignore case, POSIX ones do not', async () => {
    const win = mkBase('w', { roots: ['C:\\Docs'] });
    const posix = mkBase('p', { roots: ['/docs/P'] });
    const { c } = await open(fakeDocs([
      mkStatus(win, { roots: [root('c:\\docs')] }),
      mkStatus(posix, { roots: [root('/docs/p')] }),
    ]));
    const [a, b] = rows(c);
    expect(a.textContent).toContain('4 files');
    expect(b.textContent).not.toContain('4 files');
  });

  it('a failed read says why, offers Refresh, and a later success clears it', async () => {
    const base = mkBase('a');
    const listBases = vi.fn()
      .mockRejectedValueOnce(new Error('walker crashed'))
      .mockResolvedValue([mkStatus(base)]);
    const { c } = await open(fakeDocs([], { listBases }));
    expect(c.querySelector('.ai-note--error')?.textContent).toContain('Could not read your bases: walker crashed');
    expect(rows(c)).toHaveLength(0);
    expect(c.querySelector('.ai-summary-empty')).toBeNull();
    expect(fk(c, 'docs:add').getAttribute('aria-disabled')).toBe('true');
    fk(c, 'docs:refresh').click();
    await settle();
    expect(c.querySelector('.ai-note--error')).toBeNull();
    expect(rows(c)).toHaveLength(1);
    expect(fk(c, 'docs:add').getAttribute('aria-disabled')).toBeNull();
  });

  it('Refresh is not run over itself, and says so while it works', async () => {
    let release: (v: AiDocBaseStatus[]) => void = () => {};
    const listBases = vi.fn(() => new Promise<AiDocBaseStatus[]>((r) => { release = r; }));
    const { c } = await open(fakeDocs([], { listBases }));
    expect(c.querySelector('.ai-docs-status')?.textContent).toBe('Checking bases…');
    fk(c, 'docs:refresh').click();
    fk(c, 'docs:refresh').click();
    expect(listBases).toHaveBeenCalledTimes(1);
    release([mkStatus(mkBase('a'))]);
    await settle();
    expect(c.querySelector('.ai-docs-status')?.textContent).toBe('');
    expect(rows(c)).toHaveLength(1);
  });

  it('is not there without host.docs: no nav entry, no section, even when asked for', async () => {
    const { c } = await open(undefined);
    expect(fk(c, 'nav:bases')).toBeUndefined();
    expect(c.querySelector('.ai-docs')).toBeNull();
    expect(c.querySelector('.ai-nav-btn--bases')).toBeNull();
    // Another section opens instead.
    expect(fk(c, 'nav:routing')).toBeDefined();
  });

  it('is there with host.docs, and the list entry shows the count only once it is known', async () => {
    let release: (v: AiDocBaseStatus[]) => void = () => {};
    const { c } = await open(fakeDocs([], { listBases: vi.fn(() => new Promise<AiDocBaseStatus[]>((r) => { release = r; })) }));
    expect(fk(c, 'nav:bases')).toBeDefined();
    expect(c.querySelector('.ai-nav-btn--bases .ai-nav-sub')?.textContent ?? '').not.toMatch(/\d base/);
    release([mkStatus(mkBase('a'))]);
    await settle();
    expect(c.querySelector('.ai-nav-btn--bases .ai-nav-sub')?.textContent).toBe('1 base');
  });
});

// ── Hostile text ────────────────────────────────────────────────────────────

describe('base names and paths are text', () => {
  it('markup in a name, a path or the confirm text never becomes an element', async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    const base = mkBase('evil', { name: evil, roots: [`/docs/${evil}`] });
    const { c } = await open(fakeDocs([mkStatus(base)]));
    const row = rows(c)[0];
    expect(row.querySelector('img, script, iframe, svg[onload], [onerror]')).toBeNull();
    expect(row.querySelector('.ai-docs-base-name')?.textContent).toBe(evil);
    expect(row.querySelector('.ai-docs-path')?.textContent).toBe(`/docs/${evil}`);
    expect(fk(row, 'base:evil:edit').getAttribute('aria-label')).toBe(`Edit ${evil}`);
    fk(c, 'base:evil:remove').click();
    const confirm = rows(c)[0].querySelector('.ai-confirm')!;
    expect(confirm.querySelector('img, script')).toBeNull();
    expect(confirm.querySelector('.ai-confirm-text')?.textContent).toContain(evil);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('a host error message with markup shows as text', async () => {
    const docs = fakeDocs([mkStatus(mkBase('a'))], { saveBases: vi.fn(async () => { throw new Error('<img src=x onerror=alert(1)>'); }) });
    const { c } = await open(docs);
    const toggle = fk(c, 'base:a:enabled');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await settle();
    expect(c.querySelector('.ai-note--error img')).toBeNull();
    expect(c.querySelector('.ai-note--error')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

// ── Validation ──────────────────────────────────────────────────────────────

describe('validation', () => {
  const openForm = async (list: AiDocBaseStatus[] = [mkStatus(mkBase('team', { name: 'Team docs', roots: ['/docs/team'] }))], over: Partial<MikeDownDocsHost> = {}) => {
    const docs = fakeDocs(list, over);
    const page = await open(docs);
    fk(page.c, 'docs:add').click();
    return { ...page, docs };
  };

  it.each([
    ['relative/docs', 'This path is not an absolute path.'],
    ['', 'This path is empty.'],
    ['/', 'This path is a filesystem root, not a documentation folder.'],
    ['/a/${HOME}/b', 'This path'],
    ['/a/b/*.md', 'This path'],
  ])('refuses the typed path %j with the schema\'s reason', async (path, message) => {
    const { c, docs } = await openForm();
    type(fk(c, 'form:path'), path);
    fk(c, 'form:add-path').click();
    expect(fieldError(c)).toContain(message);
    expect(fk(c, 'form:path').getAttribute('aria-invalid')).toBe('true');
    expect(c.querySelectorAll('.ai-docs-form-root')).toHaveLength(0);
    expect(docs.saveBases).not.toHaveBeenCalled();
  });

  it('a folder that another base has names that base', async () => {
    const { c } = await openForm();
    type(fk(c, 'form:path'), '/docs/team/');
    fk(c, 'form:add-path').click();
    expect(fieldError(c)).toBe('That folder is already in “Team docs”.');
  });

  it('a folder twice in one base is refused, and the error clears when typing resumes', async () => {
    const { c } = await openForm();
    type(fk(c, 'form:path'), '/work/a');
    fk(c, 'form:add-path').click();
    expect(c.querySelectorAll('.ai-docs-form-root')).toHaveLength(1);
    expect(fk(c, 'form:path').value).toBe('');
    type(fk(c, 'form:path'), '/work/a');
    fk(c, 'form:add-path').click();
    expect(fieldError(c)).toBe('This base already has that folder.');
    type(fk(c, 'form:path'), '/work/b');
    expect(fieldError(c)).toBe('');
    expect(fk(c, 'form:path').getAttribute('aria-invalid')).toBeNull();
  });

  it('Enter in the path field adds it, and a folder can be taken out again', async () => {
    const { c } = await openForm();
    const input = fk(c, 'form:path');
    type(input, '/work/a');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(c.querySelectorAll('.ai-docs-form-root')).toHaveLength(1);
    fk(c, 'form:root-remove:/work/a').click();
    expect(c.querySelectorAll('.ai-docs-form-root')).toHaveLength(0);
  });

  it('saving with no folder says to add one, and sends nothing', async () => {
    const { c, docs } = await openForm();
    fk(c, 'form:save').click();
    await settle();
    expect(fieldError(c)).toBe('Add at least one folder.');
    expect(docs.saveBases).not.toHaveBeenCalled();
  });

  it.each(['../HOME.md', '/etc/HOME.md', 'notes.txt', 'a/../../x.md', 'C:\\x.md', 'x/'])('refuses the home file %j', async (home) => {
    const { c, docs } = await openForm();
    type(fk(c, 'form:path'), '/work/a');
    fk(c, 'form:add-path').click();
    type(fk(c, 'form:home'), home);
    fk(c, 'form:save').click();
    await settle();
    expect(Array.from(c.querySelectorAll('.ai-docs-form .ai-field-error')).map((n) => n.textContent)).toContain('The home file must be a markdown file name or a path inside the folder, such as HOME.md.');
    expect(fk(c, 'form:home').getAttribute('aria-invalid')).toBe('true');
    expect(docs.saveBases).not.toHaveBeenCalled();
  });

  it('an accepted home file is saved normalised, and a blank one leaves it out', async () => {
    const { c, docs } = await openForm();
    type(fk(c, 'form:path'), '/work/a');
    fk(c, 'form:add-path').click();
    type(fk(c, 'form:home'), ' docs/HOME.md ');
    fk(c, 'form:save').click();
    await settle();
    const added = saved(docs)[1];
    expect(added.homeFile).toBe('docs/HOME.md');
    expect('homeFile' in saved(docs)[0]).toBe(false);
  });

  it('a blank name takes the first folder\'s last part', async () => {
    const { c, docs } = await openForm();
    type(fk(c, 'form:path'), '/work/Handbook/');
    fk(c, 'form:add-path').click();
    expect(fk(c, 'form:name').value).toBe('Handbook');
    fk(c, 'form:save').click();
    await settle();
    expect(saved(docs)[1].name).toBe('Handbook');
  });

  it('a name the user typed is not overwritten by a folder', async () => {
    const { c } = await openForm();
    type(fk(c, 'form:name'), 'My notes');
    type(fk(c, 'form:path'), '/work/Handbook');
    fk(c, 'form:add-path').click();
    expect(fk(c, 'form:name').value).toBe('My notes');
  });

  it('a host that refuses the save keeps the form open with its message, and Save works again', async () => {
    const saveBases = vi.fn().mockRejectedValueOnce(new Error('settings file is read-only')).mockResolvedValue(undefined);
    const { c } = await openForm([], { saveBases });
    type(fk(c, 'form:path'), '/work/a');
    fk(c, 'form:add-path').click();
    fk(c, 'form:save').click();
    await settle();
    expect(c.querySelector('.ai-docs-form-error')?.textContent).toContain('Not saved: settings file is read-only');
    expect(c.querySelector('.ai-docs-form')).not.toBeNull();
    expect(fk(c, 'form:save').getAttribute('aria-disabled')).toBeNull();
    fk(c, 'form:save').click();
    await settle();
    expect(c.querySelector('.ai-docs-form')).toBeNull();
    expect(rows(c)).toHaveLength(1);
  });

  it('a second click on Save while it saves sends one list', async () => {
    let release: () => void = () => {};
    const saveBases = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const { c } = await openForm([], { saveBases });
    type(fk(c, 'form:path'), '/work/a');
    fk(c, 'form:add-path').click();
    fk(c, 'form:save').click();
    fk(c, 'form:save').click();
    await settle();
    expect(saveBases).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(rows(c)).toHaveLength(1);
  });

  it('the pure checks match: relative, duplicate and shared roots, then the home file', () => {
    const other = mkBase('o', { name: 'Other', roots: ['/docs/o'] });
    expect(checkBaseRoot('/docs/o', [], [other])).toEqual({ ok: false, message: 'That folder is already in “Other”.' });
    expect(checkBaseRoot('/docs/mine', ['/docs/mine'], [])).toEqual({ ok: false, message: 'This base already has that folder.' });
    expect(checkDocBaseForm({ name: 'x', roots: [], homeFile: '', allowCloud: false }, [])).toEqual({ ok: false, errors: { roots: 'Add at least one folder.' } });
    const bad = checkDocBaseForm({ name: 'x', roots: ['/a', 'rel'], homeFile: '../h.md', allowCloud: false }, []);
    expect(bad).toMatchObject({ ok: false, errors: { roots: 'rel: This path is not an absolute path.' } });
    expect(bad.ok === false && bad.errors.homeFile).toBeTruthy();
  });
});

// ── Pickers ─────────────────────────────────────────────────────────────────

describe('adding a folder through the host', () => {
  it('Desktop has a picker and no typed path; VS Code has both', async () => {
    const desktop = await open(fakeDocs([], { pickFolder: vi.fn(async () => '/picked') }));
    fk(desktop.c, 'docs:add').click();
    expect(fk(desktop.c, 'form:pick')).toBeDefined();
    expect(fk(desktop.c, 'form:path')).toBeUndefined();
    expect(fk(desktop.c, 'form:workspace')).toBeUndefined();

    const vscode = await open(fakeDocs([], { addWorkspaceFolder: vi.fn(async () => '/ws') }));
    fk(vscode.c, 'docs:add').click();
    expect(fk(vscode.c, 'form:workspace')).toBeDefined();
    expect(fk(vscode.c, 'form:path')).toBeDefined();
  });

  it('a picked path still goes through the checks', async () => {
    const pickFolder = vi.fn(async () => 'not/absolute');
    const { c } = await open(fakeDocs([], { pickFolder }));
    fk(c, 'docs:add').click();
    fk(c, 'form:pick').click();
    await settle();
    expect(fieldError(c)).toBe('This path is not an absolute path.');
    expect(c.querySelectorAll('.ai-docs-form-root')).toHaveLength(0);
  });

  it('cancelling the picker, or a picker that throws, adds nothing and says why only for the throw', async () => {
    const pickFolder = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('dialog failed'));
    const { c } = await open(fakeDocs([], { pickFolder }));
    fk(c, 'docs:add').click();
    fk(c, 'form:pick').click();
    await settle();
    expect(fieldError(c)).toBe('');
    fk(c, 'form:pick').click();
    await settle();
    expect(fieldError(c)).toBe('dialog failed');
    expect(c.querySelectorAll('.ai-docs-form-root')).toHaveLength(0);
  });

  it('a path that arrives after the form was cancelled is dropped', async () => {
    let answer: (p: string | null) => void = () => {};
    const pickFolder = vi.fn(() => new Promise<string | null>((r) => { answer = r; }));
    const { c } = await open(fakeDocs([], { pickFolder }));
    fk(c, 'docs:add').click();
    fk(c, 'form:pick').click();
    fk(c, 'form:cancel').click();
    answer('/late');
    await settle();
    expect(c.querySelector('.ai-docs-form')).toBeNull();
    fk(c, 'docs:add').click();
    expect(c.querySelectorAll('.ai-docs-form-root')).toHaveLength(0);
  });
});

// ── The cloud switch ────────────────────────────────────────────────────────

describe('the cloud switch', () => {
  it('is off for a new base, with its sentence, and a base saved that way is local-only', async () => {
    const docs = fakeDocs([], { pickFolder: vi.fn(async () => '/work/a') });
    const { c } = await open(docs);
    fk(c, 'docs:add').click();
    const sw = fk(c, 'form:cloud');
    expect(sw.checked).toBe(false);
    expect(c.querySelector('.ai-docs-form')?.textContent).toContain(DOCS_CLOUD_LABEL);
    expect(c.querySelector('.ai-docs-form')?.textContent).toContain(DOCS_CLOUD_LINE);
    fk(c, 'form:pick').click();
    await settle();
    fk(c, 'form:save').click();
    await settle();
    expect(saved(docs)[0].allowCloud).toBe(false);
  });

  it('turning it on is saved on, and editing shows what was saved', async () => {
    const docs = fakeDocs([mkStatus(mkBase('a', { allowCloud: true }))]);
    const { c } = await open(docs);
    fk(c, 'base:a:edit').click();
    expect(fk(c, 'form:cloud').checked).toBe(true);
    const sw = fk(c, 'form:cloud');
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    fk(c, 'form:save').click();
    await settle();
    expect(saved(docs)[0].allowCloud).toBe(false);
    expect(rows(c)[0].textContent).not.toContain('May go to cloud');
  });

  it('a new form does not inherit the last one\'s switch', async () => {
    const docs = fakeDocs([], { pickFolder: vi.fn(async () => '/work/a') });
    const { c } = await open(docs);
    fk(c, 'docs:add').click();
    const sw = fk(c, 'form:cloud');
    sw.checked = true;
    sw.dispatchEvent(new Event('change'));
    fk(c, 'form:cancel').click();
    fk(c, 'docs:add').click();
    expect(fk(c, 'form:cloud').checked).toBe(false);
  });
});

// ── Saves ───────────────────────────────────────────────────────────────────

describe('saving', () => {
  it('two quick switches both land, each from the result of the one before', async () => {
    const docs = fakeDocs([mkStatus(mkBase('a')), mkStatus(mkBase('b'))]);
    const { c } = await open(docs);
    const a = fk(c, 'base:a:enabled');
    const b = fk(c, 'base:b:enabled');
    a.checked = false;
    a.dispatchEvent(new Event('change'));
    b.checked = false;
    b.dispatchEvent(new Event('change'));
    await settle();
    await settle();
    expect(saved(docs, 1).map((x) => [x.id, x.enabled])).toEqual([['a', false], ['b', false]]);
  });

  it('nothing is saved when the list is not known, and the page says to Refresh', async () => {
    const saveBases = vi.fn(async () => {});
    const docs = fakeDocs([], { saveBases, listBases: vi.fn(async () => { throw new Error('nope'); }) });
    const { c } = await open(docs);
    expect(fk(c, 'docs:add').getAttribute('aria-disabled')).toBe('true');
    fk(c, 'docs:add').click();
    expect(c.querySelector('.ai-docs-form')).toBeNull();
    expect(saveBases).not.toHaveBeenCalled();
  });

  it('a list the host would shorten is refused here with the schema\'s reason', async () => {
    // Two bases that the parser would merge: the page refuses before the host is asked.
    const a = mkBase('a', { roots: ['/docs/x'] });
    const b = mkBase('b', { roots: ['/docs/x'] });
    const docs = fakeDocs([mkStatus(a), mkStatus(b)]);
    const { c } = await open(docs);
    const sw = fk(c, 'base:a:enabled');
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    await settle();
    expect(docs.saveBases).not.toHaveBeenCalled();
    expect(c.querySelector('.ai-note--error')?.textContent).toMatch(/^Not saved: /);
    expect(fk(c, 'base:a:enabled').checked).toBe(true);
  });

  it('editing the folders makes the base "Not checked yet"; editing only the name keeps its health', async () => {
    const docs = fakeDocs([mkStatus(mkBase('a', { name: 'A' }))], { pickFolder: vi.fn(async () => '/docs/more') });
    const { c } = await open(docs);
    fk(c, 'base:a:edit').click();
    type(fk(c, 'form:name'), 'Renamed');
    fk(c, 'form:save').click();
    await settle();
    expect(rows(c)[0].textContent).toContain('Renamed');
    expect(rows(c)[0].textContent).toContain('4 files');
    expect(rows(c)[0].textContent).not.toContain(DOCS_NOT_CHECKED_TEXT);

    fk(c, 'base:a:edit').click();
    type(fk(c, 'form:home'), 'HOME.md');
    fk(c, 'form:save').click();
    await settle();
    expect(rows(c)[0].textContent).toContain(DOCS_NOT_CHECKED_TEXT);
    expect(rows(c)[0].textContent).not.toContain('4 files');
    expect(saved(docs, 1)[0]).toMatchObject({ id: 'a', name: 'Renamed', homeFile: 'HOME.md' });
  });

  it('cancel on the remove confirmation, and Escape, leave the base alone', async () => {
    const docs = fakeDocs([mkStatus(mkBase('a'))]);
    const { c } = await open(docs);
    fk(c, 'base:a:remove').click();
    fk(c, 'base:a:confirm-cancel').click();
    expect(c.querySelector('.ai-confirm')).toBeNull();
    fk(c, 'base:a:remove').click();
    expect(c.querySelector('.ai-confirm')).not.toBeNull();
    fk(c, 'base:a:confirm-remove').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(c.querySelector('.ai-confirm')).toBeNull();
    expect(docs.saveBases).not.toHaveBeenCalled();
    expect(rows(c)).toHaveLength(1);
  });

  it('a failed remove keeps the base and says why', async () => {
    const docs = fakeDocs([mkStatus(mkBase('a'))], { saveBases: vi.fn(async () => { throw new Error('locked'); }) });
    const { c } = await open(docs);
    fk(c, 'base:a:remove').click();
    fk(c, 'base:a:confirm-remove').click();
    await settle();
    expect(rows(c)).toHaveLength(1);
    expect(c.querySelector('.ai-note--error')?.textContent).toContain('Not saved: locked');
  });
});

// ── Advanced options: hops, share, navigate by ──────────────────────────────

describe('the clamps', () => {
  it('hops: below the minimum, above the maximum, fractions and nonsense', async () => {
    const { c } = await open(fakeDocs());
    const hops = fk(c, 'docs:hops');
    expect(hops.min).toBe(String(AI_DOCS_MAX_HOPS_MIN));
    expect(hops.max).toBe(String(AI_DOCS_MAX_HOPS_MAX));
    expect(hops.value).toBe('3');
    for (const [typed, shown] of [['0', '1'], ['-4', '1'], ['9', '5'], ['99999', '5'], ['2.4', '2'], ['2.6', '3'], ['4', '4']]) {
      change(hops, typed);
      expect(hops.value, typed).toBe(shown);
    }
  });

  it('hops: blank or text keeps what was there', async () => {
    const { c } = await open(fakeDocs());
    const hops = fk(c, 'docs:hops');
    change(hops, '4');
    for (const junk of ['', '  ', 'abc']) {
      change(hops, junk);
      expect(hops.value, junk).toBe('4');
    }
  });

  it('share: below the minimum, above the maximum, fractions and nonsense', async () => {
    const { c } = await open(fakeDocs());
    const share = fk(c, 'docs:share');
    expect(share.min).toBe(String(AI_DOCS_SOURCE_SHARE_MIN));
    expect(share.max).toBe(String(AI_DOCS_SOURCE_SHARE_MAX));
    expect(share.value).toBe('60');
    for (const [typed, shown] of [['0', '30'], ['5', '30'], ['29', '30'], ['81', '80'], ['100', '80'], ['1e9', '80'], ['45.4', '45'], ['70', '70']]) {
      change(share, typed);
      expect(share.value, typed).toBe(shown);
    }
    change(share, '55');
    change(share, '');
    expect(share.value).toBe('55');
    change(share, 'lots');
    expect(share.value).toBe('55');
  });

  it('Done carries the clamped values, and only the options, in the patch', async () => {
    const onDone = vi.fn();
    const { c } = await open(fakeDocs(), { onDone });
    change(fk(c, 'docs:hops'), '12');
    change(fk(c, 'docs:share'), '3');
    change(fk(c, 'docs:navigate-by'), 'page');
    (c.querySelector('.ai-page-done') as HTMLElement).click();
    const patch = onDone.mock.calls[0][0] as Record<string, unknown>;
    expect(patch['ai.docs']).toEqual({ maxHops: 5, sourceShare: 30, navigateBy: 'page' });
    expect(Object.keys(patch).filter((k) => k.startsWith('ai.docB'))).toEqual([]);
  });

  it('the model clamps whatever the control sent, and a bad navigate-by is the default', () => {
    const s = settings();
    expect(withDocsOptions(s, { maxHops: 0, sourceShare: 81 }).docs).toMatchObject({ maxHops: 1, sourceShare: 80 });
    expect(withDocsOptions(s, { maxHops: Number.NaN, sourceShare: Number.POSITIVE_INFINITY }).docs).toMatchObject({ maxHops: 3, sourceShare: 60 });
    expect(withDocsOptions(s, { navigateBy: 'x' as never }).docs.navigateBy).toBe('section');
    expect(withDocsOptions(s, {}).docs).toEqual(s.docs);
  });

  it('the Advanced group is closed to start, opens on its button, and closes under the add form', async () => {
    const { c } = await open(fakeDocs([], { pickFolder: vi.fn() }));
    const panel = c.querySelector<HTMLElement>('.ai-docs-advanced')!;
    expect(panel.hidden).toBe(true);
    fk(c, 'docs:advanced').click();
    expect(panel.hidden).toBe(false);
    expect(fk(c, 'docs:advanced').getAttribute('aria-expanded')).toBe('true');
    fk(c, 'docs:add').click();
    expect(panel.hidden).toBe(true);
    expect(fk(c, 'docs:advanced').hidden).toBe(true);
  });
});
