/**
 * The Documentation bases section of the AI Engines page: a smoke test against
 * a fake `host.docs`. Thorough coverage of the states is in the UI tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAiSettings } from '../src/ai';
import type { AiDocBase, AiDocBaseStatus, AiSettings, MikeDownAiHost, MikeDownDocsHost } from '../src/ai';
import { checkBaseRoot, checkDocBaseForm, revalidateDocBases, withDocsOptions } from '../src/ai-docs-page';
import { mountAiEnginesPage } from '../src/ai-engines-page';
import type { AiEnginesPageOptions } from '../src/ai-engines-page';
import { buildAiSettingsSection } from '../src/ai-settings';
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

const team: AiDocBase = { id: 'team', name: 'Team docs', roots: ['/docs/team', '/docs/gone'], allowCloud: false, enabled: true };

function status(base: AiDocBase = team): AiDocBaseStatus {
  return {
    base,
    active: true,
    roots: [
      { root: '/docs/team', label: 'team', found: true, home: 'index', homePath: 'INDEX.md', fileCount: 12, oversizeSkipped: 2, capReached: false },
      { root: '/docs/gone', label: 'gone', found: false, fileCount: 0, oversizeSkipped: 0, capReached: false },
    ],
    fileCount: 12,
    oversizeSkipped: 2,
    rootsMissing: 1,
    capReached: false,
    brokenLinks: 3,
  };
}

function fakeDocs(list: AiDocBaseStatus[] = [status()], over: Partial<MikeDownDocsHost> = {}): MikeDownDocsHost {
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
function container(): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  containers.push(c);
  return c;
}
const fk = (c: HTMLElement, key: string) => Array.from(c.querySelectorAll<HTMLElement>('[data-fk]')).find((n) => n.dataset.fk === key) as HTMLElement & HTMLInputElement;
const settle = () => new Promise((r) => setTimeout(r, 0));
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const openBases = async (over: Partial<AiEnginesPageOptions> = {}) => {
  const c = container();
  const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ initial: { section: 'bases' }, ...over }));
  await settle();
  return { c, page };
};

afterEach(() => {
  while (containers.length) {containers.pop()!.remove();}
  vi.restoreAllMocks();
});

describe('Documentation bases on the AI Engines page', () => {
  it('is not there without host.docs, even when asked for', () => {
    const c = container();
    mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ initial: { section: 'bases' } }));
    expect(fk(c, 'nav:bases')).toBeUndefined();
    expect(c.querySelector('.ai-docs')).toBeNull();
  });

  it('shows health from one listBases call, and again only on Refresh', async () => {
    const docs = fakeDocs();
    const { c } = await openBases({ docs });
    const text = c.querySelector('.ai-docs-base')?.textContent ?? '';
    for (const part of ['Team docs', '/docs/team', 'Home: INDEX.md', '12 files', '2 too large, skipped', '/docs/gone', 'Root not found', '3 broken links']) {
      expect(text).toContain(part);
    }
    expect(c.querySelector('.ai-nav-btn--bases .ai-nav-sub')?.textContent).toBe('1 base');

    // Going away and back is not a Refresh.
    fk(c, 'nav:routing').click();
    fk(c, 'nav:bases').click();
    await settle();
    expect(docs.listBases).toHaveBeenCalledTimes(1);
    expect(docs.listBases).toHaveBeenLastCalledWith({ refresh: true });

    fk(c, 'docs:refresh').click();
    await settle();
    expect(docs.listBases).toHaveBeenCalledTimes(2);
    expect(docs.listBases).toHaveBeenLastCalledWith({ refresh: true });
  });

  it('explains a base when there are none, and never saves before the list is known', async () => {
    const { c } = await openBases({ docs: fakeDocs([]) });
    expect(c.querySelector('.ai-summary-empty')?.textContent).toContain('A base is a folder of markdown');

    const saveBases = vi.fn(async () => {});
    const failed = await openBases({ docs: fakeDocs([], { listBases: vi.fn(async () => { throw new Error('nope'); }), saveBases }) });
    expect(failed.c.querySelector('.ai-note--error')?.textContent).toContain('nope');
    fk(failed.c, 'docs:add').click();
    expect(failed.c.querySelector('.ai-docs-form')).toBeNull();
    expect(saveBases).not.toHaveBeenCalled();
  });

  it('adds a base through the host, with schema reasons and the cloud switch off', async () => {
    const docs = fakeDocs([status()], { addWorkspaceFolder: vi.fn(async () => '/work/handbook') });
    const { c } = await openBases({ docs });
    fk(c, 'docs:add').click();
    expect(fk(c, 'form:cloud').checked).toBe(false);
    expect(c.querySelector('.ai-docs-form')?.textContent).toContain('Pages from this base may go to the cloud engines you allow.');

    // Nothing yet, then a reason from the schema, then a folder another base has.
    fk(c, 'form:save').click();
    await settle();
    expect(c.querySelector('.ai-docs-form .ai-field-error')?.textContent).toBe('Add at least one folder.');
    type(fk(c, 'form:path'), 'relative/docs');
    fk(c, 'form:add-path').click();
    expect(c.querySelector('.ai-docs-form .ai-field-error')?.textContent).toBe('This path is not an absolute path.');
    type(fk(c, 'form:path'), '/docs/team');
    fk(c, 'form:add-path').click();
    expect(c.querySelector('.ai-docs-form .ai-field-error')?.textContent).toContain('Team docs');

    fk(c, 'form:workspace').click();
    await settle();
    expect(fk(c, 'form:name').value).toBe('handbook');
    type(fk(c, 'form:home'), '../HOME.md');
    fk(c, 'form:save').click();
    expect(docs.saveBases).not.toHaveBeenCalled();
    type(fk(c, 'form:home'), 'HOME.md');
    fk(c, 'form:save').click();
    await settle();

    const saved = (docs.saveBases as ReturnType<typeof vi.fn>).mock.calls[0][0] as AiDocBase[];
    expect(saved.map((b) => b.name)).toEqual(['Team docs', 'handbook']);
    expect(saved[1]).toMatchObject({ roots: ['/work/handbook'], homeFile: 'HOME.md', allowCloud: false, enabled: true });
    expect(saved[1].id).toBeTruthy();
    // No new listBases: the new base waits for Refresh.
    expect(docs.listBases).toHaveBeenCalledTimes(1);
    expect(c.querySelectorAll('.ai-docs-base')[1].textContent).toContain('Not checked yet');
  });

  it('removes after an in-page confirmation that says files stay', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const docs = fakeDocs();
    const { c } = await openBases({ docs });
    fk(c, 'base:team:remove').click();
    expect(c.querySelector('.ai-docs-base .ai-confirm')?.textContent).toContain('files on disk are not touched');
    expect(docs.saveBases).not.toHaveBeenCalled();
    fk(c, 'base:team:confirm-remove').click();
    await settle();
    expect(docs.saveBases).toHaveBeenCalledWith([]);
    expect(confirm).not.toHaveBeenCalled();
    expect(c.querySelector('.ai-summary-empty')).not.toBeNull();
  });

  it('turning a base off keeps its health; a failed save puts the switch back', async () => {
    const docs = fakeDocs();
    const { c } = await openBases({ docs });
    const off = fk(c, 'base:team:enabled');
    off.checked = false;
    off.dispatchEvent(new Event('change'));
    await settle();
    expect((docs.saveBases as ReturnType<typeof vi.fn>).mock.calls[0][0][0].enabled).toBe(false);
    expect(c.querySelector('.ai-docs-base')?.textContent).toContain('12 files');

    (docs.saveBases as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));
    const on = fk(c, 'base:team:enabled');
    on.checked = true;
    on.dispatchEvent(new Event('change'));
    await settle();
    expect(fk(c, 'base:team:enabled').checked).toBe(false);
    expect(c.querySelector('.ai-note--error')?.textContent).toContain('disk full');
  });

  it('Escape closes the form, not the page, and Done stops at an unsaved form', async () => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    const { c } = await openBases({ docs: fakeDocs(), onDone, onCancel });
    fk(c, 'docs:add').click();
    type(fk(c, 'form:name'), 'Half typed');
    (c.querySelector('.ai-page-done') as HTMLElement).click();
    expect(onDone).not.toHaveBeenCalled();
    expect(c.querySelector('.ai-docs-form-error')?.textContent).toContain('Save this base');
    fk(c, 'form:name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(c.querySelector('.ai-docs-form')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('advanced options save on Done, clamped, without touching docBases', async () => {
    const onDone = vi.fn();
    const docs = fakeDocs();
    const { c } = await openBases({ docs, onDone });
    const hops = fk(c, 'docs:hops');
    hops.value = '9';
    hops.dispatchEvent(new Event('change'));
    expect(hops.value).toBe('5');
    (c.querySelector('.ai-page-done') as HTMLElement).click();
    const patch = onDone.mock.calls[0][0] as Record<string, unknown>;
    expect(patch['ai.docs']).toMatchObject({ maxHops: 5, sourceShare: 60, navigateBy: 'section' });
    expect('ai.docBases' in patch).toBe(false);
  });

  it('the Tasks section has the docs row without any special case', () => {
    const c = container();
    mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ initial: { section: 'routing' } }));
    expect(fk(c, 'route:task:docs')).toBeDefined();
  });
});

describe('the AI tab row', () => {
  const build = (docsAvailable: boolean, openEnginesPage = vi.fn()) => {
    const s = settings();
    const section = buildAiSettingsSection(settingsSectionContext(() => {}), {
      ai: { complete: vi.fn(), listEngines: vi.fn(async () => []) } as unknown as MikeDownAiHost,
      settings: s, statuses: [], getHostSettings: () => s, waitForSettings: async () => null, onStatuses: vi.fn(), onSaved: vi.fn(),
      openEnginesPage, docsAvailable,
    });
    const c = container();
    c.append(...section.rows);
    return { c, openEnginesPage };
  };

  it('opens the page on the bases section, and is hidden without host.docs', () => {
    const { c, openEnginesPage } = build(true);
    fk(c, 'manage-bases').click();
    expect(openEnginesPage.mock.calls[0][0].initial).toEqual({ section: 'bases' });
    expect(fk(build(false).c, 'manage-bases')).toBeUndefined();
  });
});

describe('the model', () => {
  it('clamps options whatever the control sent', () => {
    expect(withDocsOptions(settings(), { maxHops: 99, sourceShare: 5 }).docs).toMatchObject({ maxHops: 5, sourceShare: 30 });
    expect(withDocsOptions(settings(), { navigateBy: 'bogus' as never }).docs.navigateBy).toBe('section');
  });

  it('gives schema reasons for a root', () => {
    expect(checkBaseRoot('/', [], [])).toEqual({ ok: false, message: 'This path is a filesystem root, not a documentation folder.' });
    expect(checkBaseRoot('/a/${HOME}', [], [])).toMatchObject({ ok: false });
    expect(checkBaseRoot('/a/b/', [], [])).toEqual({ ok: true, path: '/a/b' });
  });

  it('editing keeps the id, the enabled state and unknown keys', () => {
    const existing = { ...team, enabled: false, futureKey: 1 } as AiDocBase;
    const checked = checkDocBaseForm({ name: 'New', roots: ['/x'], homeFile: '', allowCloud: true }, [], existing);
    expect(checked).toMatchObject({ ok: true, base: { id: 'team', name: 'New', enabled: false, allowCloud: true, futureKey: 1 } });
  });

  it('refuses a list the host would shorten', () => {
    const dup = { ...team, id: 'b', roots: ['/docs/team'] };
    expect(revalidateDocBases([team, dup])).toMatchObject({ ok: false });
    expect(revalidateDocBases([{ ...team, id: '' }])).toMatchObject({ ok: true });
  });
});
