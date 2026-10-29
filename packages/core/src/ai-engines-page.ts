/**
 * The AI Engines page (M3c): engines and routing on a full-size page of
 * their own, laid out like VS Code's Settings editor or the Network pane of
 * Apple's System Settings. A header with Back and Done; on the left a quiet
 * list of engines, then Tasks (which model does what), then Add engine; on
 * the right the selected engine's Express form (`ai-engine-form.ts`), the
 * Tasks section (`ai-routing-section.ts`) or the quick-start cards. Under 720 px the page
 * is one column: the list first, and picking an entry pushes its detail,
 * with Back returning to the list.
 *
 * Standalone and mountable: it renders into the container it is given and
 * touches nothing outside it (no modal, no editor, no `document.body`), so a
 * host can show it as an overlay (`editor.ts#showAiEnginesPage`) or, later,
 * in its own editor tab or window. Dialog semantics, the focus trap and
 * focus restore belong to whoever hosts it.
 *
 * Edits run in an `AiSettingsSession` (`ai-settings-session.ts`): Done hands
 * the changed `ai.*` keys to `onDone`; Back with unsaved changes asks
 * "Discard changes?" in the page, and discarding takes back engines added
 * here and their keys before `onCancel`. Opened by the first-run panel's
 * "Set up" (`turnOnWhenDone`), the header says AI turns on at Done, and Done
 * adds `ai.enabled: true` when the result has a usable default route; Back
 * leaves AI off.
 *
 * On a host that can look for local servers (`host.ai.detectLocalServers`),
 * the quick-start cards look when they first show and on "Look again": a
 * local card says Running · 3 models (and leads), Not running, or Added
 * (it opens the engine already set up there). Without the method the cards
 * are the plain list.
 *
 * The cloud cards carry the **Allow cloud engines** switch, one line on what
 * it means and the privacy card folded under "What this means"; it edits the
 * page's draft, so Done saves it with the rest. A cloud engine's head, while
 * the switch is off, says so with a "Turn on cloud engines" button (F4). On
 * VS Code, a "Built into VS Code" group offers GitHub Copilot when the host
 * reports a Copilot model (`detectHostEngines`).
 *
 * Opened on the `'wizard'` section (the first-run panel's "Set up" with no
 * engines yet, tier 2 only), the page shows the setup wizard
 * (`ai-setup-wizard.ts`) instead of the list and detail: the header says
 * "Set up AI" with the step dots and Skip, Back walks back through the
 * steps, and the wizard's Done is the page's Done. "Change settings in AI Engines"
 * leaves the wizard for the full page, in the same session.
 *
 * Modal UI only: nothing here touches the editor document or its DOM.
 */

import { AI_ENGINE_PRESETS, AI_HOST_PRESET_FAMILY, AI_PRESET_FAMILIES, aiProviderPolicy, modelSizeHint, presetForEngine } from './ai';
import { AI_DETECT_LOOKING, AI_DETECT_NONE, detectLocalServers, hostEngineAvailability, setupHardware } from './ai-local-setup';
import type { AiEngineConfig, AiEnginePreset, AiEngineStatus, AiHardwareInfo, AiLocalServerProbe, AiPresetFamilyInfo, AiRoute, AiSettings, AiSettingsPatch } from './ai';
import {
  defaultRouteForEngine,
  engineDisplayName,
  engineLocalityInfo,
  engineFromPreset,
  engineIssues,
  engineKindLabel,
  groupPresets,
  hasUsableDefaultRoute,
  rankLocalCandidates,
  routeLabel,
  shortUrl,
  type LocalServerCard,
} from './ai-settings-model';
import { createEngineFormController } from './ai-engine-form';
import type { EngineFormRefresh } from './ai-engine-form';
import { createRoutingSection } from './ai-routing-section';
import { createAiSettingsSession } from './ai-settings-session';
import type { AiSettingsSessionOptions } from './ai-settings-session';
import { ICONS, button, cloudAccessBox, el, experimentalBadge, experimentalDisclaimer, keepFocus, kindGlyphHtml, localityPills, nextId, note, statusBadge, switchInput } from './ai-settings-dom';
import { AI_WIZARD_STEPS, createSetupWizard, subscriptionNote, wizardStepNumber, type AiWizardStep, type SetupWizard } from './ai-setup-wizard';
import type { MikeDownSettingsSectionContext } from './types';

export type AiEnginesPageSection = 'engines' | 'routing' | 'wizard';

export interface AiEnginesPageOptions extends AiSettingsSessionOptions {
  /**
   * What to show first: an engine, the routing section, or the setup wizard
   * (tier 2 only). Default: the first engine (the cards when there is none).
   */
  initial?: { engineId?: string; section?: AiEnginesPageSection };
  /** Shared with the session that opened the page (stored-key knowledge). */
  keyOverride?: Map<string, boolean>;
  /** Shared with the session that opened the page (engine statuses). */
  statusMap?: Map<string, AiEngineStatus>;
  /** Done: the `ai.*` keys that changed (possibly none) and the settings they lead to. */
  onDone(patch: AiSettingsPatch, settings: AiSettings): void;
  /** Back without saving; the page already took back what it added. */
  onCancel(): void;
  /**
   * Opened to set AI up while it is off: Done also turns AI on (`ai.enabled`
   * in the patch) when the result has a usable default route.
   */
  turnOnWhenDone?: boolean;
}

export interface AiEnginesPageHandle {
  /** Tear down (timers, listeners) and leave the container empty. Unresolved changes are discarded. */
  dispose(): void;
  /** Focus where a keyboard user should land: the selected list entry, or the detail when it was pushed. */
  focus(): void;
}

/** Narrower than this and the page is one column. */
const NARROW_PX = 720;

type Selection = { kind: 'engine'; id: string } | { kind: 'routing' } | { kind: 'add' };

export function mountAiEnginesPage(container: HTMLElement, ctx: MikeDownSettingsSectionContext, opts: AiEnginesPageOptions): AiEnginesPageHandle {
  const session = createAiSettingsSession(opts);
  const { ai } = session;
  const getEngine = (id: string) => session.getEngine(id);
  /** The setup wizard while it shows; the list and detail wait underneath, unrendered. */
  let wizard: SetupWizard | null = null;
  /** This machine, once the host said (the models picker's size groups). */
  let hardware: AiHardwareInfo | null = null;

  let selection: Selection = initialSelection();
  let narrow = false;
  /** Narrow layout only: which pane shows. */
  let view: 'list' | 'detail' = opts.initial?.engineId || opts.initial?.section === 'routing' ? 'detail' : 'list';
  let confirmDeleteId: string | null = null;
  let confirmDiscard = false;
  let finished = false;
  /** One-line notes under an engine's header (the star found no model to make the default). */
  const headNotes = new Map<string, { level: 'info' | 'warning'; text: string }>();

  function initialSelection(): Selection {
    const engines = session.draft.engines;
    if (opts.initial?.section === 'routing') {return { kind: 'routing' };}
    const wanted = opts.initial?.engineId && engines.find((e) => e.id === opts.initial?.engineId);
    if (wanted) {return { kind: 'engine', id: wanted.id };}
    return engines[0] ? { kind: 'engine', id: engines[0].id } : { kind: 'add' };
  }
  const selectedEngineId = () => (selection.kind === 'engine' ? selection.id : null);

  // ── Shell ─────────────────────────────────────────────────────────────────

  const root = el('div', 'ai-page');
  const titleId = nextId('ai-page-title');

  const header = el('div', 'ai-page-header');
  const backBtn = button('ai-page-back', 'Back', { html: ICONS.back, fk: 'page:back' });
  backBtn.addEventListener('click', () => back());
  const title = el('h2', 'ai-page-title', 'AI Engines');
  title.id = titleId;
  const doneBtn = button('settings-btn settings-btn--primary ai-page-done', 'Done', { fk: 'page:done' });
  doneBtn.addEventListener('click', () => done());
  // The wizard's way out at any step: AI stays off (Back asks first when something changed).
  const skipBtn = button('settings-btn ai-page-done ai-page-skip', 'Skip', { fk: 'page:skip', title: 'Leave setup; AI stays off' });
  skipBtn.addEventListener('click', () => leave());
  skipBtn.hidden = true;
  const titleLine = el('div', 'ai-page-title-line');
  const titleNote = opts.turnOnWhenDone ? el('span', 'ai-page-title-note', 'AI turns on when you choose Done') : null;
  const stepper = el('span', 'ai-wizard-steps');
  stepper.hidden = true;
  titleLine.append(title, experimentalBadge(), stepper);
  if (titleNote) {titleLine.append(titleNote);}
  header.append(backBtn, titleLine, doneBtn, skipBtn);
  const disclaimer = experimentalDisclaimer('ai-page-disclaimer');

  const body = el('div', 'ai-page-body');
  const nav = el('nav', 'ai-page-nav');
  nav.setAttribute('aria-label', 'Engines and tasks');
  const detail = el('section', 'ai-page-detail');
  const detailId = nextId('ai-page-detail');
  detail.id = detailId;
  body.append(nav, detail);

  // Screen reader announcements for probe results and key changes.
  const live = el('div', 'ai-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  let liveTimer: number | undefined;
  function announce(text: string): void {
    window.clearTimeout(liveTimer);
    live.textContent = '';
    // A fresh text node after a tick, so repeating the same message is read again.
    liveTimer = window.setTimeout(() => { live.textContent = text; }, 40);
  }

  const confirmHost = el('div', 'ai-page-confirm-host');
  root.append(header, disclaimer, body, confirmHost, live);

  // ── The engine form and routing ───────────────────────────────────────────

  const form = createEngineFormController({
    ai,
    getDraft: () => session.draft,
    setDraft: (next, refresh) => {
      session.draft = next;
      applyRefresh(wizard ? wizard.engineId() : selectedEngineId(), refresh);
    },
    refresh: (engineId, refresh) => applyRefresh(engineId, refresh),
    statuses: session.statuses,
    onStatuses: () => opts.onStatuses(session.statusList()),
    hasKey: (id) => session.hasKey(id),
    keySource: (id) => session.keySource(id),
    setKey,
    ensureSaved: (id) => session.ensureSaved(id),
    savesFirst: (id) => session.savesFirst(id),
    announce,
    focusKey,
    openLink: ctx.openLink,
    // The subscription vs API key note sits over a cloud key field. The wizard always shows it; the full form shows it until a key is stored.
    keyNote: (engine, preset) => (preset.family === 'cloud' && (wizard || !session.hasKey(engine.id)) ? subscriptionNote(preset, ctx.openLink, aiProviderPolicy(engine)) : null),
    modelSize: (modelId, sizeBytes) => (hardware ? modelSizeHint(modelId, hardware, sizeBytes) : undefined),
    hardware: () => hardware,
  });

  const routing = createRoutingSection(ctx, {
    getDraft: () => session.draft,
    setDraft: (next, change) => {
      session.draft = next;
      if (change.defaultChanged) {renderNav();}
      else {refreshRoutingEntry();}
    },
    statusList: () => session.statusList(),
  });

  async function setKey(id: string, value: string | null): Promise<string | null> {
    const engine = getEngine(id);
    const error = await session.setKey(id, value);
    if (engine) {
      const name = engineDisplayName(engine);
      announce(error
        ? `The key for ${name} could not be ${value !== null ? 'stored' : 'cleared'}.`
        : value !== null ? `API key stored for ${name}.` : `API key cleared for ${name}.`);
      refreshHead(id);
    }
    return error;
  }

  function applyRefresh(engineId: string | null, refresh: EngineFormRefresh): void {
    if (wizard) {
      wizard.refresh(engineId, refresh);
      return;
    }
    if (refresh.list) {
      renderNav();
      renderDetailHead();
    } else if (refresh.head) {
      // A default model change moves the star; every row may need it.
      for (const e of session.draft.engines) {refreshNavItem(e.id);}
      refreshRoutingEntry();
      renderDetailHead();
    }
    if (refresh.form && engineId) {rerenderForm(engineId);}
    if (refresh.routing || refresh.list) {scheduleRouting();}
  }

  let routingQueued = false;
  function scheduleRouting(): void {
    if (routingQueued) {return;}
    routingQueued = true;
    queueMicrotask(() => {
      routingQueued = false;
      if (finished || wizard) {return;}
      refreshRoutingEntry();
      if (selection.kind === 'routing') {routing.render();}
    });
  }

  function refreshHead(engineId: string): void {
    refreshNavItem(engineId);
    if (selectedEngineId() === engineId) {renderDetailHead();}
  }

  function focusKey(key: string): void {
    const n = Array.from(root.querySelectorAll<HTMLElement>('[data-fk]')).find((x) => x.dataset.fk === key);
    n?.focus({ preventScroll: true });
  }

  // ── Left list ─────────────────────────────────────────────────────────────

  const navList = el('div', 'ai-nav-list');
  navList.setAttribute('role', 'list');
  navList.setAttribute('aria-label', 'Engines');
  const navEngines = el('div', 'ai-nav-group');
  const routingEntry = el('div', 'ai-nav-group ai-nav-group--tools');
  nav.append(navEngines, routingEntry);
  nav.addEventListener('keydown', onNavKeydown);

  function navButton(fk: string, selected: boolean): HTMLButtonElement {
    const b = button('ai-nav-btn', '', { fk });
    b.setAttribute('aria-controls', detailId);
    if (selected) {b.setAttribute('aria-current', 'true');}
    return b;
  }

  function renderNav(): void {
    if (wizard) {return;}
    keepFocus(nav, () => {
      navEngines.replaceChildren();
      const heading = el('div', 'ai-nav-heading', 'Engines');
      heading.setAttribute('aria-hidden', 'true');
      navEngines.append(heading);
      navList.replaceChildren();
      if (session.draft.engines.length === 0) {
        navEngines.append(el('div', 'ai-nav-empty', 'No engines yet'));
      } else {
        for (const engine of session.draft.engines) {navList.append(buildNavItem(engine));}
        navEngines.append(navList);
      }
      routingEntry.replaceChildren(buildRoutingEntry(), buildAddEntry());
    });
  }

  function buildNavItem(engine: AiEngineConfig): HTMLElement {
    const item = el('div', 'ai-nav-item');
    item.setAttribute('role', 'listitem');
    item.dataset.engineId = engine.id;
    fillNavItem(item, engine);
    return item;
  }

  function fillNavItem(item: HTMLElement, engine: AiEngineConfig): void {
    item.replaceChildren();
    const selected = selection.kind === 'engine' && selection.id === engine.id;
    const name = engineDisplayName(engine);
    item.classList.toggle('is-selected', selected);
    item.classList.toggle('is-disabled', !engine.enabled);

    const btn = navButton(`nav:eng:${engine.id}`, selected);
    btn.setAttribute('aria-label', `${name}, ${engineKindLabel(engine.kind)}`);
    btn.title = name;
    btn.innerHTML = kindGlyphHtml(engine.kind);
    const text = el('span', 'ai-nav-text');
    const line = el('span', 'ai-nav-name-line');
    line.append(el('span', 'ai-nav-name', name));
    const isDefault = session.draft.routing.default?.engineId === engine.id;
    if (isDefault) {
      const star = el('span', 'ai-nav-star');
      star.innerHTML = ICONS.starOn;
      star.title = 'Default engine';
      line.append(star);
    }
    // The pill sits on the second line so the name keeps its room.
    const subLine = el('span', 'ai-nav-sub-line');
    subLine.append(...localityPills(engine, session.draft).slice(0, 1), el('span', 'ai-nav-sub', shortUrl(engine.baseUrl) || 'no address'));
    text.append(line, subLine);
    btn.append(text, statusBadge(session.statuses.get(engine.id), form.busy(engine.id), { compact: true }));
    btn.addEventListener('click', () => select({ kind: 'engine', id: engine.id }));

    const enabled = switchInput(engine.enabled, `Enable ${name}`, `nav:eng:${engine.id}:enabled`);
    enabled.addEventListener('change', () => {
      session.updateEngine(engine.id, { enabled: enabled.checked });
      applyRefresh(engine.id, { list: true, form: true, routing: true });
    });
    item.append(btn, enabled);
  }

  function refreshNavItem(engineId: string): void {
    if (wizard) {return;}
    const engine = getEngine(engineId);
    const item = Array.from(navList.querySelectorAll<HTMLElement>('.ai-nav-item')).find((n) => n.dataset.engineId === engineId);
    if (!engine || !item) {return;}
    keepFocus(item, () => fillNavItem(item, engine));
  }

  function routingSubline(): string {
    const d = session.draft.routing.default;
    return d ? routeLabel(session.draft, d) : 'No default model';
  }

  function buildRoutingEntry(): HTMLElement {
    const btn = navButton('nav:routing', selection.kind === 'routing');
    btn.classList.add('ai-nav-btn--routing');
    const icon = el('span', 'ai-nav-icon');
    icon.innerHTML = ICONS.routing;
    const text = el('span', 'ai-nav-text');
    text.append(el('span', 'ai-nav-name', 'Tasks'), el('span', 'ai-nav-sub', routingSubline()));
    btn.append(icon, text);
    btn.addEventListener('click', () => select({ kind: 'routing' }));
    return btn;
  }

  function refreshRoutingEntry(): void {
    const sub = routingEntry.querySelector('.ai-nav-btn--routing .ai-nav-sub');
    if (sub) {sub.textContent = routingSubline();}
  }

  function buildAddEntry(): HTMLElement {
    const btn = navButton('nav:add', selection.kind === 'add');
    btn.classList.add('ai-nav-btn--add');
    const icon = el('span', 'ai-nav-icon');
    icon.innerHTML = ICONS.plus;
    btn.append(icon, el('span', 'ai-nav-name', 'Add engine'));
    btn.addEventListener('click', () => select({ kind: 'add' }));
    return btn;
  }

  /** Up and Down move between list entries, Home and End jump. */
  function onNavKeydown(e: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {return;}
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('.ai-nav-btn'));
    const at = buttons.indexOf(e.target as HTMLButtonElement);
    if (at < 0) {return;}
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
    buttons[next]?.focus();
  }

  // ── Detail pane ───────────────────────────────────────────────────────────

  const detailHead = el('div', 'ai-detail-head');
  const detailBody = el('div', 'ai-detail-body');
  detail.append(detailHead, detailBody);

  function select(next: Selection, o: { isNew?: boolean } = {}): void {
    const sameEngine = next.kind === 'engine' && selection.kind === 'engine' && selection.id === next.id;
    selection = next;
    confirmDeleteId = null;
    if (next.kind === 'engine') {headNotes.delete(next.id);}
    if (narrow) {view = 'detail';}
    applyLayout();
    renderNav();
    if (!sameEngine || o.isNew) {renderDetail();}
    let first: string | null = null;
    if (next.kind === 'engine' && (!sameEngine || o.isNew)) {first = form.opened(next.id, o);}
    if (o.isNew && first) {
      // A new engine lands on its first empty required field (design call 2).
      focusKey(first);
      if (first.endsWith(':url')) {
        const input = root.querySelector<HTMLInputElement>(`[data-fk="${first}"]`);
        input?.select();
      }
    } else if (o.isNew || narrow) {
      // A new local server (nothing to type) or the narrow list going away: land on the heading.
      focusDetailTitle();
    }
    detail.scrollTop = 0;
  }

  function focusDetailTitle(): void {
    detailHead.querySelector<HTMLElement>('.ai-detail-title')?.focus({ preventScroll: true });
  }

  function renderDetail(): void {
    if (wizard) {return;}
    renderDetailHead();
    detailBody.replaceChildren();
    detail.dataset.kind = selection.kind;
    if (selection.kind === 'engine') {
      const engine = getEngine(selection.id);
      if (engine) {detailBody.append(form.build(engine.id));}
    } else if (selection.kind === 'routing') {
      routing.render();
      detailBody.append(routing.element);
    } else {
      detailBody.append(buildPresetCards());
      // The cards look once per page; "Look again" asks again.
      if (canDetect && !detectedOnce) {lookForLocalServers();}
      if (ai.detectHostEngines && hostAvailable === null) {lookForHostEngines();}
    }
  }

  function detailTitle(text: string): HTMLElement {
    const h = el('h3', 'ai-detail-title', text);
    h.id = nextId('ai-detail-title');
    // Focus target when the narrow layout pushes the detail.
    h.tabIndex = -1;
    detail.setAttribute('aria-labelledby', h.id);
    return h;
  }

  function renderDetailHead(): void {
    if (wizard) {return;}
    keepFocus(detailHead, () => {
      detailHead.replaceChildren();
      if (selection.kind === 'routing') {
        const icon = el('span', 'ai-detail-icon');
        icon.innerHTML = ICONS.routing;
        const main = el('div', 'ai-detail-main');
        main.append(detailTitle('Tasks'), el('div', 'ai-detail-sub', 'Which model does what. Tasks on Default use the default model.'));
        detailHead.append(icon, main);
        return;
      }
      if (selection.kind === 'add') {
        const icon = el('span', 'ai-detail-icon');
        icon.innerHTML = ICONS.plus;
        const main = el('div', 'ai-detail-main');
        const empty = session.draft.engines.length === 0;
        main.append(
          detailTitle(empty ? 'No engines yet' : 'Add an engine'),
          el('div', 'ai-detail-sub', `Two ways to connect: paste a cloud API key, or run models on your own machine.${session.draft.enabled ? '' : ' Nothing is sent until AI is on.'}`),
        );
        detailHead.append(icon, main);
        return;
      }
      const engine = getEngine(selection.id);
      if (!engine) {return;}
      fillEngineHead(engine);
    });
  }

  function fillEngineHead(engine: AiEngineConfig): void {
    const name = engineDisplayName(engine);
    const glyph = el('span', 'ai-detail-glyph');
    glyph.innerHTML = kindGlyphHtml(engine.kind);

    const main = el('div', 'ai-detail-main');
    const titleLine = el('div', 'ai-detail-title-line');
    // The head says "blocked" with a way out (below) instead of the bare pill.
    titleLine.append(detailTitle(name), ...localityPills(engine, session.draft, { blocked: false }));
    const models = engine.models.filter((m) => !m.missing).length;
    const picked = engine.models.filter((m) => !m.missing && m.enabled).length;
    const subParts = [engineKindLabel(engine.kind), shortUrl(engine.baseUrl) || 'no address'];
    if (engine.models.length > 0) {subParts.push(picked === models ? `${models} ${models === 1 ? 'model' : 'models'}` : `${picked} of ${models} models`);}
    main.append(titleLine, el('div', 'ai-detail-sub', subParts.join(' · ')));

    const isDefault = session.draft.routing.default?.engineId === engine.id;
    const star = button(`settings-btn ai-default-btn${isDefault ? ' is-on' : ''}`, isDefault ? 'Default' : 'Use by default', {
      html: isDefault ? ICONS.starOn : ICONS.starOff,
      title: isDefault ? `Default: ${routeLabel(session.draft, session.draft.routing.default as AiRoute)}` : 'Use this engine by default',
      fk: `eng:${engine.id}:star`,
    });
    star.setAttribute('aria-pressed', String(isDefault));
    star.setAttribute('aria-label', `Default engine: ${name}`);
    star.addEventListener('click', () => toggleDefault(engine.id));

    const del = button('ai-icon-btn ai-delete-btn', '', { html: ICONS.trash, ariaLabel: `Delete ${name}`, title: 'Delete engine', fk: `eng:${engine.id}:delete` });
    del.addEventListener('click', () => {
      confirmDeleteId = engine.id;
      renderDetailHead();
      focusKey(`eng:${engine.id}:confirm-cancel`);
    });

    const actions = el('div', 'ai-detail-actions');
    actions.append(statusBadge(session.statuses.get(engine.id), form.busy(engine.id)), star, del);
    const top = el('div', 'ai-detail-top');
    top.append(glyph, main, actions);
    detailHead.append(top);

    // The form shows key, URL and locality problems at their fields; the pill says "blocked".
    const issues = engineIssues(engine, session.draft, session.hasKey(engine.id))
      .filter((i) => !['cloudBlocked', 'badUrl', 'localityMismatch', 'noKey'].includes(i.code));
    const headNote = headNotes.get(engine.id);
    if (issues.length > 0 || headNote) {
      const box = el('div', 'ai-engine-issues');
      for (const i of issues) {box.append(note(i.level, i.text));}
      if (headNote) {box.append(note(headNote.level, headNote.text, 'ai-result'));}
      detailHead.append(box);
    }
    if (cloudBlocked(engine)) {detailHead.append(buildCloudOffNote(engine));}
    if (confirmDeleteId === engine.id) {detailHead.append(buildDeleteConfirm(engine));}
  }

  function cloudBlocked(engine: AiEngineConfig): boolean {
    return !session.draft.allowCloud && engineLocalityInfo(engine, session.draft.localNetworks).locality === 'cloud';
  }

  /** A cloud engine while Allow cloud is off: say so, with the switch one click away (F4). */
  function buildCloudOffNote(engine: AiEngineConfig): HTMLElement {
    const box = el('div', 'ai-cloud-off');
    box.append(note('info', `Cloud engines are off, so nothing is sent to ${engineDisplayName(engine)} yet.`));
    const on = button('settings-btn ai-cloud-off-btn', 'Turn on cloud engines', { fk: `eng:${engine.id}:allow-cloud` });
    on.addEventListener('click', () => {
      setAllowCloud(true);
      headNotes.set(engine.id, { level: 'info', text: 'Cloud engines are on. Choose Done to save.' });
      renderDetailHead();
      focusKey(`eng:${engine.id}:star`);
    });
    box.append(on);
    return box;
  }

  /** Flip Allow cloud in the draft (Done saves it with the rest); the AI tab reads the same draft once the page is done. */
  function setAllowCloud(on: boolean): void {
    if (session.draft.allowCloud === on) {return;}
    session.draft = { ...session.draft, allowCloud: on };
    renderNav();
    const formEngine = wizard ? wizard.engineId() : selectedEngineId();
    if (formEngine) {rerenderForm(formEngine);}
    scheduleRouting();
    announce(on ? 'Cloud engines turned on. Choose Done to save.' : 'Cloud engines turned off. Choose Done to save.');
  }

  function rerenderForm(engineId: string): void {
    if (wizard) {
      wizard.refresh(engineId, { form: true });
      return;
    }
    if (selectedEngineId() !== engineId) {return;}
    const current = detailBody.querySelector<HTMLElement>('.ai-form');
    if (!current) {return;}
    keepFocus(current, () => {
      const fresh = form.build(engineId);
      current.replaceWith(fresh);
      return fresh;
    });
  }

  function buildDeleteConfirm(engine: AiEngineConfig): HTMLElement {
    const box = el('div', 'ai-confirm');
    box.setAttribute('role', 'group');
    const name = engineDisplayName(engine);
    box.setAttribute('aria-label', `Delete ${name}?`);
    const msg = el('span', 'ai-confirm-text', `Delete ${name}? Routes to it are cleared${ai.setSecret ? ' and its stored API key is removed' : ''} when you choose Done.`);
    const yes = button('settings-btn ai-btn--danger', 'Delete', { fk: `eng:${engine.id}:confirm-delete` });
    const no = button('settings-btn', 'Cancel', { fk: `eng:${engine.id}:confirm-cancel` });
    yes.addEventListener('click', () => deleteEngine(engine.id));
    no.addEventListener('click', () => {
      confirmDeleteId = null;
      renderDetailHead();
      focusKey(`eng:${engine.id}:delete`);
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Cancel the confirmation, not the page.
        e.preventDefault();
        e.stopPropagation();
        no.click();
      }
    });
    box.append(msg, yes, no);
    return box;
  }

  // ── Quick-start cards and local server detection ──────────────────────────

  /** The last detection while this page is open: null before it ran, when it failed, or on a host without it. */
  let probes: AiLocalServerProbe[] | null = null;
  let detectedOnce = false;
  let detecting = false;
  let detectAbort: AbortController | null = null;
  const canDetect = typeof ai.detectLocalServers === 'function';

  /** Look for local servers, then redraw the local cards and say what was found. */
  function lookForLocalServers(): void {
    if (!canDetect || finished) {return;}
    detectAbort?.abort();
    const controller = new AbortController();
    detectAbort = controller;
    detectedOnce = true;
    detecting = true;
    refreshLocalCards();
    announce(AI_DETECT_LOOKING);
    void detectLocalServers(ai, controller.signal).then((found) => {
      if (finished || controller.signal.aborted) {return;}
      detecting = false;
      detectAbort = null;
      probes = found;
      refreshLocalCards();
      announce(detectionSummary(localCards()));
    });
  }

  /** The probes ranked against the engines as they are now (an engine added here makes its card Added). */
  function localCards(): LocalServerCard[] | null {
    return probes ? rankLocalCandidates(probes, session.draft.engines) : null;
  }

  function detectionSummary(cards: LocalServerCard[] | null): string {
    if (!cards) {return 'Could not look for local AI servers.';}
    const running = cards.filter((c) => c.running);
    if (running.length === 0) {return AI_DETECT_NONE;}
    return `Running on this computer: ${running.map((c) => `${presetName(c.presetId)}${c.models !== undefined ? `, ${countText(c.models)}` : ''}${c.alreadyAdded ? ', added' : ''}`).join('; ')}.`;
  }

  function presetName(id: string): string {
    return AI_ENGINE_PRESETS.find((p) => p.id === id)?.name ?? id;
  }

  function countText(models: number): string {
    return `${models} ${models === 1 ? 'model' : 'models'}`;
  }

  /** VS Code offers a Copilot model: null before the page asked (or on a host that cannot say). */
  let hostAvailable: boolean | null = null;

  /** Ask once whether VS Code offers a Copilot model; the "Built into VS Code" group shows when it does. */
  function lookForHostEngines(): void {
    hostAvailable = false;
    void hostEngineAvailability(ai).then((found) => {
      if (finished || !found?.available) {return;}
      hostAvailable = true;
      if (selection.kind === 'add' && !wizard) {keepFocus(detailBody, () => { detailBody.replaceChildren(buildPresetCards()); });}
    });
  }

  /** The cards in two groups (three with Copilot), with the "two ways to connect" line over each (design call 2). */
  function buildPresetCards(): HTMLElement {
    const groups = groupPresets(AI_ENGINE_PRESETS);
    const box = el('div', 'ai-cards');
    const families: AiPresetFamilyInfo[] = hostAvailable ? [AI_HOST_PRESET_FAMILY, ...AI_PRESET_FAMILIES] : [...AI_PRESET_FAMILIES];
    for (const family of families) {
      const presets = groups[family.family];
      if (presets.length === 0) {continue;}
      const section = el('section', 'ai-cards-group');
      section.dataset.family = family.family;
      const headingId = nextId('ai-cards-heading');
      const heading = el('div', 'ai-cards-heading');
      heading.id = headingId;
      heading.innerHTML = family.family === 'local' ? ICONS.local : ICONS.cloud;
      heading.append(el('span', '', family.label));
      section.setAttribute('aria-labelledby', headingId);
      const grid = el('div', 'ai-cards-grid');
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-labelledby', headingId);
      section.append(heading, el('div', 'ai-cards-explainer', family.explainer));
      if (family.family === 'local') {
        section.append(grid);
        fillLocalGrid(grid, presets);
        if (canDetect) {section.append(buildDetectLine());}
      } else if (family.family === 'host') {
        section.append(grid);
        for (const preset of presets) {grid.append(buildCard(preset));}
      } else {
        // The switch and what it means sit where a cloud engine is added (F4, OQ5).
        section.append(buildCloudAccess(presets), grid);
        for (const preset of presets) {grid.append(buildCard(preset));}
      }
      box.append(section);
    }
    placeGroups(box);
    return box;
  }

  /**
   * Cloud leads, as in the setup wizard; a local server that is running and not
   * yet added leads instead (the wizard leads with it too). Copilot, when
   * offered, stays on top.
   */
  function placeGroups(box: HTMLElement): void {
    const localLeads = !!localCards()?.some((c) => c.running && !c.alreadyAdded);
    const order = localLeads ? ['host', 'local', 'cloud'] : ['host', 'cloud', 'local'];
    for (const family of order) {
      const section = box.querySelector(`:scope > .ai-cards-group[data-family="${family}"]`);
      if (section) {box.append(section);}
    }
  }

  /** The "What this means" disclosure stays open across redraws while the page is open. */
  let cloudPrivacyOpen = false;

  /** Allow cloud engines over the cloud cards: the switch, one line, and the privacy card folded. */
  function buildCloudAccess(presets: AiEnginePreset[]): HTMLElement {
    return cloudAccessBox({
      allowed: session.draft.allowCloud,
      onChange: (on) => setAllowCloud(on),
      presets,
      hostAsks: !!ai.requestCloudConsent,
      open: cloudPrivacyOpen,
      onToggle: (open) => { cloudPrivacyOpen = open; },
      openLink: ctx.openLink,
      fk: 'cards:allow-cloud',
    });
  }

  /** Local cards in detection order (running first), Custom last; the preset order before a detection. */
  function fillLocalGrid(grid: HTMLElement, presets: AiEnginePreset[]): void {
    grid.replaceChildren();
    const cards = localCards();
    const byId = new Map(cards?.map((c) => [c.presetId, c]) ?? []);
    const ordered = cards
      ? [...cards.map((c) => presets.find((p) => p.id === c.presetId)).filter((p): p is AiEnginePreset => !!p), ...presets.filter((p) => !byId.has(p.id))]
      : presets;
    for (const preset of ordered) {grid.append(buildCard(preset, byId.get(preset.id)));}
  }

  function buildCard(preset: AiEnginePreset, found?: LocalServerCard): HTMLButtonElement {
    const card = button('ai-card', '', { fk: `card:${preset.id}`, ariaLabel: `Add ${preset.name}` });
    card.innerHTML = kindGlyphHtml(preset.kind);
    const text = el('span', 'ai-card-text');
    text.append(el('span', 'ai-card-name', preset.name), el('span', 'ai-card-caption', preset.caption));
    card.append(text);
    card.title = preset.caption;
    // A local card is added when its server's engine exists; a cloud card when an engine for that provider does.
    const cloudEngine = preset.family === 'cloud' ? session.draft.engines.find((e) => presetForEngine(e)?.id === preset.id) : undefined;
    const added = cloudEngine ? cloudEngine.id : found?.alreadyAdded && found.engineId && getEngine(found.engineId) ? found.engineId : null;
    if (cloudEngine) {
      card.dataset.state = 'added';
      text.append(el('span', 'ai-card-state', 'Added'));
      card.setAttribute('aria-label', `${preset.name}, added. Open it`);
      card.title = `${preset.name} is already set up. Open it.`;
    } else if (found) {
      const state = added ? 'added' : found.running ? 'running' : 'stopped';
      card.dataset.state = state;
      const label = state === 'added' ? 'Added'
        : state === 'running' ? `Running${found.models !== undefined ? ` · ${countText(found.models)}` : ''}`
          : 'Not running';
      const line = el('span', 'ai-card-state');
      if (state === 'running') {
        const dot = el('span', 'ai-card-dot');
        dot.setAttribute('aria-hidden', 'true');
        line.append(dot);
      }
      line.append(el('span', '', label));
      text.append(line);
      card.setAttribute('aria-label', added ? `${preset.name}, added. Open it` : `Add ${preset.name}, ${label.replace(' · ', ', ').toLowerCase()}`);
      if (added) {card.title = `${preset.name} is already set up. Open it.`;}
    }
    card.addEventListener('click', () => {
      if (added && getEngine(added)) {select({ kind: 'engine', id: added });} else {addEngine(preset);}
    });
    return card;
  }

  /** "Looking for local AI servers…" or what was found, then "Look again". */
  function buildDetectLine(): HTMLElement {
    const line = el('div', 'ai-cards-detect');
    const status = el('span', 'ai-cards-detect-text', detecting ? AI_DETECT_LOOKING
      : probes && !probes.some((p) => p.ok) ? AI_DETECT_NONE : '');
    const again = button('ai-link-btn ai-cards-again', 'Look again', { fk: 'cards:look-again' });
    // aria-disabled, not disabled: focus stays on it while it looks.
    if (detecting) {again.setAttribute('aria-disabled', 'true');}
    again.addEventListener('click', () => { if (!detecting) {lookForLocalServers();} });
    line.append(status, again);
    return line;
  }

  /** Redraw the local group in place, keeping focus on the same card. */
  function refreshLocalCards(): void {
    const section = detailBody.querySelector<HTMLElement>('.ai-cards-group[data-family="local"]');
    if (!section || selection.kind !== 'add') {return;}
    keepFocus(section, () => {
      const grid = section.querySelector<HTMLElement>('.ai-cards-grid');
      if (grid) {fillLocalGrid(grid, groupPresets(AI_ENGINE_PRESETS).local);}
      const line = section.querySelector('.ai-cards-detect');
      if (line) {line.replaceWith(buildDetectLine());}
    });
    // A server that answered moves the local group up; keep the focus where it was.
    const box = section.parentElement;
    if (box) {keepFocus(box, () => { placeGroups(box); });}
  }

  // ── Edits ─────────────────────────────────────────────────────────────────

  function addEngine(preset: AiEnginePreset): void {
    const engine = engineFromPreset(preset, session.draft.engines.map((e) => e.id));
    session.addEngine(engine);
    select({ kind: 'engine', id: engine.id }, { isNew: true });
    scheduleRouting();
    announce(preset.family === 'cloud' ? `Added ${engine.name}. Paste your API key.`
      : preset.family === 'host' ? `Added ${engine.name}. Fetching its models.`
        : `Added ${engine.name}. Check the address; models are fetched from it.`);
  }

  function deleteEngine(id: string): void {
    const engine = getEngine(id);
    if (!engine) {return;}
    const index = session.draft.engines.findIndex((e) => e.id === id);
    session.deleteEngine(id);
    headNotes.delete(id);
    form.forget(id);
    confirmDeleteId = null;
    const next = session.draft.engines[Math.min(index, session.draft.engines.length - 1)];
    selection = next ? { kind: 'engine', id: next.id } : { kind: 'add' };
    renderNav();
    renderDetail();
    if (next) {form.opened(next.id);}
    announce(`Deleted ${engineDisplayName(engine)}. Choose Done to apply.`);
    focusKey(next ? `nav:eng:${next.id}` : 'nav:add');
  }

  function toggleDefault(engineId: string): void {
    const engine = getEngine(engineId);
    if (!engine) {return;}
    const name = engineDisplayName(engine);
    const draft = session.draft;
    if (draft.routing.default?.engineId === engineId) {
      session.draft = { ...draft, routing: { ...draft.routing, default: null } };
      announce(`${name} is no longer the default.`);
    } else {
      const route = defaultRouteForEngine(draft, session.statusList(), engineId);
      if (!route) {
        headNotes.set(engineId, { level: 'info', text: 'No model here can be the default yet. Pick or add a chat model first.' });
        announce(`${name} has no chat model to make the default yet.`);
        renderDetailHead();
        return;
      }
      session.draft = { ...draft, routing: { ...draft.routing, default: route } };
      announce(`Default model: ${routeLabel(session.draft, route)}.`);
    }
    headNotes.delete(engineId);
    renderNav();
    renderDetailHead();
    rerenderForm(engineId);
  }

  // ── Back, Done and the discard confirmation ───────────────────────────────

  function back(): void {
    if (confirmDiscard) {
      hideDiscard();
      return;
    }
    if (wizard) {
      wizard.back();
      return;
    }
    if (narrow && view === 'detail') {
      view = 'list';
      applyLayout();
      focusSelectedEntry();
      return;
    }
    if (session.dirty()) {
      showDiscard();
      return;
    }
    cancel();
  }

  /** Close without saving: ask first when something changed (the wizard's Skip, and Back from its first step). */
  function leave(): void {
    if (session.dirty()) {showDiscard();} else {cancel();}
  }

  function cancel(): void {
    if (finished) {return;}
    finished = true;
    session.discard();
    opts.onCancel();
  }

  function done(): void {
    if (finished) {return;}
    finished = true;
    const patch = session.collect();
    const saved = session.commit();
    // Set up from the first-run panel: AI turns on only with something to route to (B3).
    if (opts.turnOnWhenDone && !saved.enabled && hasUsableDefaultRoute(saved)) {
      patch['ai.enabled'] = true;
      saved.enabled = true;
    }
    opts.onDone(patch, saved);
  }

  function showDiscard(): void {
    confirmDiscard = true;
    const scrim = el('div', 'ai-page-confirm-scrim');
    const box = el('div', 'ai-page-confirm');
    box.setAttribute('role', 'alertdialog');
    const headId = nextId('ai-discard-title');
    const textId = nextId('ai-discard-text');
    box.setAttribute('aria-labelledby', headId);
    box.setAttribute('aria-describedby', textId);
    const head = el('div', 'ai-page-confirm-title', 'Discard changes?');
    head.id = headId;
    const text = el('div', 'ai-page-confirm-text', 'Your changes to engines and tasks have not been saved. Engines added here and their keys are removed.');
    text.id = textId;
    const keep = button('settings-btn', 'Keep editing', { fk: 'page:keep' });
    keep.addEventListener('click', () => hideDiscard());
    const discard = button('settings-btn ai-btn--danger', 'Discard', { fk: 'page:discard' });
    discard.addEventListener('click', () => cancel());
    const actions = el('div', 'ai-page-confirm-actions');
    actions.append(keep, discard);
    box.append(head, text, actions);
    scrim.append(box);
    confirmHost.replaceChildren(scrim);
    header.inert = true;
    body.inert = true;
    if (wizard) {wizard.element.inert = true;}
    keep.focus();
  }

  function hideDiscard(): void {
    confirmDiscard = false;
    confirmHost.replaceChildren();
    header.inert = false;
    body.inert = false;
    if (wizard) {wizard.element.inert = false;}
    backBtn.focus();
  }

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) {return;}
    // Escape is Back; nothing else (a modal under the page) should see it.
    e.preventDefault();
    e.stopPropagation();
    back();
  });

  // ── Layout ────────────────────────────────────────────────────────────────

  function applyLayout(): void {
    root.classList.toggle('is-narrow', narrow);
    root.dataset.view = narrow ? view : 'both';
    backBtn.setAttribute('aria-label', narrow && view === 'detail' ? 'Back to the list' : 'Back');
  }

  function measure(width: number): void {
    // Zero means "not laid out" (jsdom, a hidden host): keep two panes.
    const next = width > 0 && width < NARROW_PX;
    if (next === narrow) {return;}
    narrow = next;
    applyLayout();
  }

  function focusSelectedEntry(): void {
    const fk = selection.kind === 'engine' ? `nav:eng:${selection.id}` : selection.kind === 'routing' ? 'nav:routing' : 'nav:add';
    focusKey(fk);
  }

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) {measure(entry.contentRect.width);}
    });
    resizeObserver.observe(container);
  }

  // ── Statuses ──────────────────────────────────────────────────────────────

  // Statuses pushed while the page is open refresh the dots and pickers in
  // place (no full rebuild, so typing is never interrupted).
  const unsubscribe = opts.subscribeStatuses?.((list) => {
    if (finished) {return;}
    for (const s of list) {
      if (!form.busy(s.engineId)) {session.statuses.set(s.engineId, s);}
    }
    for (const engine of session.draft.engines) {refreshNavItem(engine.id);}
    renderDetailHead();
    scheduleRouting();
    wizard?.refresh(null, {});
  });

  // ── The setup wizard ──────────────────────────────────────────────────────

  function startWizard(): void {
    const w = createSetupWizard({
      session,
      form,
      ctx,
      announce,
      focusKey,
      setAllowCloud,
      onStatuses: () => opts.onStatuses(session.statusList()),
      onStep: (step) => wizardHeader(step),
      finish: () => done(),
      leave,
      openEngine: (id) => leaveWizardFor(id),
      turnsOn: !!opts.turnOnWhenDone,
    });
    wizard = w;
    root.classList.add('ai-page--wizard');
    // The toolbar panel already showed the experimental note, and step 1 has its own privacy disclosure.
    disclaimer.hidden = true;
    body.hidden = true;
    root.insertBefore(w.element, body);
    wizardHeader(w.step());
  }

  /** The header line for a step: "Set up AI", the step dots, Skip (Done is the last step's own button). */
  function wizardHeader(step: AiWizardStep): void {
    const n = wizardStepNumber(step);
    title.textContent = 'Set up AI';
    stepper.hidden = false;
    stepper.replaceChildren();
    stepper.setAttribute('role', 'img');
    stepper.setAttribute('aria-label', `Step ${n} of ${AI_WIZARD_STEPS}`);
    for (let i = 1; i <= AI_WIZARD_STEPS; i++) {
      const dot = el('span', `ai-wizard-dot${i === n ? ' is-current' : i < n ? ' is-done' : ''}`);
      stepper.append(dot);
    }
    stepper.append(el('span', 'ai-wizard-steps-text', `${n} of ${AI_WIZARD_STEPS}`));
    if (titleNote) {titleNote.hidden = true;}
    doneBtn.hidden = true;
    skipBtn.hidden = step === 'done';
    backBtn.setAttribute('aria-label', n === 1 ? 'Back' : 'Back to the previous step');
  }

  /** "Change settings in AI Engines": the full page on the wizard's engine, same session. */
  function leaveWizardFor(engineId: string): void {
    const w = wizard;
    if (!w) {return;}
    wizard = null;
    w.dispose();
    root.classList.remove('ai-page--wizard');
    disclaimer.hidden = false;
    body.hidden = false;
    title.textContent = 'AI Engines';
    stepper.hidden = true;
    if (titleNote) {titleNote.hidden = false;}
    doneBtn.hidden = false;
    skipBtn.hidden = true;
    selection = getEngine(engineId) ? { kind: 'engine', id: engineId } : initialSelection();
    view = 'detail';
    applyLayout();
    renderNav();
    renderDetail();
    if (selection.kind === 'engine') {form.opened(selection.id);}
    if (narrow) {focusDetailTitle();} else {focusSelectedEntry();}
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  container.replaceChildren(root);
  measure(container.getBoundingClientRect().width);
  applyLayout();
  // A tier-1 host routes by itself: it never sees the wizard (nor this page).
  if (opts.initial?.section === 'wizard' && session.tier === 2) {
    startWizard();
  } else {
    renderNav();
    renderDetail();
    if (selection.kind === 'engine') {form.opened(selection.id);}
  }
  if (ai.hardwareInfo) {
    void setupHardware(ai).then((info) => { hardware = info; });
  }

  // Fresh statuses as the page opens: the dots should not be stale.
  if (session.tier === 2) {
    void session.refreshStatuses().then((ok) => {
      if (!ok || finished) {return;}
      for (const engine of session.draft.engines) {refreshNavItem(engine.id);}
      renderDetailHead();
      scheduleRouting();
    });
  }

  return {
    dispose(): void {
      // Torn down without Done or Back (the host closed): nothing is kept.
      if (!finished) {
        finished = true;
        session.discard();
      }
      finished = true;
      detectAbort?.abort();
      wizard?.dispose();
      window.clearTimeout(liveTimer);
      unsubscribe?.();
      resizeObserver?.disconnect();
      form.dispose();
      container.replaceChildren();
    },
    focus(): void {
      if (confirmDiscard) {
        focusKey('page:keep');
      } else if (wizard) {
        wizard.focus();
      } else if (narrow && view === 'detail') {
        focusDetailTitle();
      } else if (!narrow && selection.kind === 'routing') {
        focusKey('route:default');
      } else if (!narrow && selection.kind === 'add' && session.draft.engines.length === 0) {
        detailBody.querySelector<HTMLElement>('.ai-card')?.focus({ preventScroll: true });
      } else {
        focusSelectedEntry();
      }
    },
  };
}
