/**
 * The setup wizard (M1b): the AI Engines page's `'wizard'` section, opened by
 * the first-run panel's "Set up". Three steps, one decision each, like a
 * macOS "Add Account" sheet:
 *
 * 1. **Path.** What `recommendSetupPath` leads with: a running local server
 *    ("LM Studio is running on this Mac · 3 models") or VS Code's Copilot
 *    ("Use GitHub Copilot, no key needed") as one primary card, with
 *    "Connect a cloud provider" under it; otherwise the cloud provider cards
 *    lead, with Allow cloud and the privacy card. Local always sits under
 *    **Advanced: run models on this machine**, with the hardware line.
 * 2. **Connect.** Cloud: the provider cards and the Express form inline, with
 *    the subscription vs API key note above the key field. Local: the
 *    detected servers (Install links for the ones not running, Look again)
 *    and the form, whose picker groups models by size. Copilot: the form, when
 *    the one-click path could not finish.
 * 3. **Done.** "Ready: <engine> · <model> · <Local | Cloud>", the privacy
 *    line for where the text goes, and Done.
 *
 * The page owns the session, the header (Back, the step dots, Skip) and Done;
 * the wizard owns the steps. Back returns to the previous step; Back on the
 * first step, Skip and Escape leave the page as Back does (AI stays off).
 * Done is the page's: it turns AI on (`turnOnWhenDone`) only with a usable
 * default route, which Continue makes the wizard's engine.
 *
 * Modal UI only: nothing here touches the editor document or its DOM.
 */

import { AI_CLOUD_PRIVACY, AI_ENGINE_PRESETS, AI_HOST_PRIVACY, aiConsentHost, aiConsentStepNote, hostOfUrl, isKnownEngineKind, presetForEngine } from './ai';
import type { AiEngineConfig, AiEnginePreset } from './ai';
import {
  applyDiscoveryForFamily,
  defaultRouteForEngine,
  engineDefaultModelId,
  engineDisplayName,
  engineFromPreset,
  engineLocalityInfo,
  firstChatModelId,
  groupPresets,
  modelDisplayName,
  rankLocalCandidates,
  setEngineDefaultModel,
  withEngine,
  type EngineFormPreset,
  type LocalServerCard,
} from './ai-settings-model';
import type { EngineFormController, EngineFormRefresh } from './ai-engine-form';
import { AI_DETECT_LOOKING, AI_DETECT_NONE, canScanForSetup, lastSetupScan, plainSetupScan, scanForSetup, type AiSetupScan } from './ai-local-setup';
import type { AiSettingsSession } from './ai-settings-session';
import { ICONS, button, el, hostLink, keepFocus, kindGlyphHtml, nextId, note, privacyCard } from './ai-settings-dom';
import type { MikeDownSettingsSectionContext } from './types';

export type AiWizardStep = 'path' | 'cloud' | 'local' | 'copilot' | 'done';

/** Steps shown in the header: path, connect (cloud, local or Copilot), done. */
export const AI_WIZARD_STEPS = 3;

export function wizardStepNumber(step: AiWizardStep): number {
  return step === 'path' ? 1 : step === 'done' ? 3 : 2;
}

/**
 * Above a cloud key field: subscriptions are not API access. Generic on
 * purpose; the links carry the provider's current facts.
 */
export const AI_SUBSCRIPTION_NOTE =
  'Consumer subscriptions such as ChatGPT Plus or Claude Pro do not include API access. ' +
  'An API key is billed separately by the provider, per use.';

/** The subscription vs API key note with the preset's key and pricing links. */
export function subscriptionNote(preset: Pick<EngineFormPreset, 'name' | 'keyUrl' | 'pricingUrl'>, openLink?: (href: string) => void): HTMLElement {
  const box = el('div', 'ai-wizard-subscription');
  box.append(el('p', 'ai-wizard-subscription-text', AI_SUBSCRIPTION_NOTE));
  if (preset.keyUrl || preset.pricingUrl) {
    const links = el('p', 'ai-wizard-subscription-links');
    links.append('Get a key: ');
    if (preset.keyUrl) {links.append(hostLink(`${preset.name} API keys`, preset.keyUrl, openLink, 'ai-wizard-link'));}
    if (preset.keyUrl && preset.pricingUrl) {links.append(el('span', 'ai-wizard-sep', ' · '));}
    if (preset.pricingUrl) {links.append(hostLink('Pricing', preset.pricingUrl, openLink, 'ai-wizard-link'));}
    box.append(links);
  }
  return box;
}

export interface SetupWizardDeps {
  session: AiSettingsSession;
  form: EngineFormController;
  ctx: MikeDownSettingsSectionContext;
  announce(text: string): void;
  focusKey(key: string): void;
  /** Flip Allow cloud in the draft (the page's switch logic and announcement). */
  setAllowCloud(on: boolean): void;
  /** `session.statuses` changed. */
  onStatuses(): void;
  /** The step changed: the page redraws its header line. */
  onStep(step: AiWizardStep): void;
  /** Done on the last step (the page's Done). */
  finish(): void;
  /** Back from the first step (the page's Back: asks first when something changed). */
  leave(): void;
  /** Leave the wizard for the full page, on this engine. */
  openEngine(engineId: string): void;
  /** Done turns AI on (opened from the first-run panel). */
  turnsOn: boolean;
}

export interface SetupWizard {
  readonly element: HTMLElement;
  step(): AiWizardStep;
  /** The engine whose form shows, for the page's draft refreshes. */
  engineId(): string | null;
  back(): void;
  /** The form changed the draft or its own state (see `EngineFormRefresh`). */
  refresh(engineId: string | null, refresh: EngineFormRefresh): void;
  focus(): void;
  dispose(): void;
}

export function createSetupWizard(deps: SetupWizardDeps): SetupWizard {
  const { session, form, ctx } = deps;
  const { ai } = session;
  const groups = groupPresets(AI_ENGINE_PRESETS);

  let step: AiWizardStep = 'path';
  const history: AiWizardStep[] = [];
  let engineId: string | null = null;
  /** Engines this wizard added; one it moves away from is taken back. */
  const added = new Set<string>();
  let scan: AiSetupScan | null = canScanForSetup(ai) ? lastSetupScan(ai) : plainSetupScan();
  let scanning = false;
  let scanAbort: AbortController | null = null;
  /** The preset a one-click connect is working on. */
  let connecting: string | null = null;
  /** Why the one-click connect stopped, shown over the form it fell back to. */
  let connectError: string | null = null;
  let advancedOpen = false;
  let cloudPrivacyOpen = false;
  let disposed = false;

  const element = el('div', 'ai-wizard');
  const column = el('div', 'ai-wizard-column');
  element.append(column);

  // ── Scan ──────────────────────────────────────────────────────────────────

  function rescan(): void {
    if (!canScanForSetup(ai) || disposed) {return;}
    scanAbort?.abort();
    const controller = new AbortController();
    scanAbort = controller;
    scanning = true;
    if (step === 'local') {deps.announce(AI_DETECT_LOOKING);}
    redrawScanned();
    void scanForSetup(ai, controller.signal).then((fresh) => {
      if (disposed || controller.signal.aborted) {return;}
      scanAbort = null;
      scanning = false;
      scan = fresh;
      redrawScanned();
      if (step === 'local') {deps.announce(detectionSummary());}
    });
  }

  /** A scan started or landed: redraw the steps that show it, keeping focus. */
  function redrawScanned(): void {
    if (step === 'path' || step === 'local') {render();}
  }

  function localCards(): LocalServerCard[] | null {
    return scan?.probes ? rankLocalCandidates(scan.probes, session.draft.engines) : null;
  }

  function detectionSummary(): string {
    const cards = localCards();
    if (!cards) {return 'Could not look for local AI servers.';}
    const running = cards.filter((c) => c.running);
    return running.length === 0 ? AI_DETECT_NONE : `Running on this computer: ${running.map((c) => presetName(c.presetId)).join(', ')}.`;
  }

  // ── Engines ───────────────────────────────────────────────────────────────

  const presetById = (id: string) => AI_ENGINE_PRESETS.find((p) => p.id === id);
  const presetName = (id: string) => presetById(id)?.name ?? id;
  const machine = () => (scan?.hardware?.platform === 'darwin' ? 'Mac' : 'computer');

  /** The engine for a preset: one already set up from it, else a new one. */
  function engineFor(preset: AiEnginePreset): { id: string; isNew: boolean } {
    const card = preset.family === 'local' ? localCards()?.find((c) => c.presetId === preset.id && c.alreadyAdded && c.engineId) : undefined;
    const existing = card?.engineId && session.getEngine(card.engineId)
      ? session.getEngine(card.engineId)
      : preset.family !== 'local' ? session.draft.engines.find((e) => presetForEngine(e)?.id === preset.id) : undefined;
    if (existing) {return { id: existing.id, isNew: false };}
    const engine = engineFromPreset(preset, session.draft.engines.map((e) => e.id));
    session.addEngine(engine);
    added.add(engine.id);
    return { id: engine.id, isNew: true };
  }

  /** Make `id` the wizard's engine; one the wizard added before it is taken back. */
  function useEngine(id: string): void {
    if (engineId && engineId !== id && added.has(engineId)) {
      session.deleteEngine(engineId);
      form.forget(engineId);
      added.delete(engineId);
    }
    engineId = id;
    connectError = null;
  }

  const currentEngine = (): AiEngineConfig | undefined => (engineId ? session.getEngine(engineId) : undefined);

  /** The engine's default model when it can serve the default route as saved, else null. */
  function readyModel(engine: AiEngineConfig | undefined): string | null {
    if (!engine || !engine.enabled || !isKnownEngineKind(engine.kind)) {return null;}
    const usable = (m: AiEngineConfig['models'][number] | undefined) => !!m && m.enabled && !m.missing && m.capabilities.chat;
    const id = engineDefaultModelId(session.draft, engine.id);
    const model = id ? engine.models.find((m) => m.id === id) : undefined;
    // A local server lists embedding models too: the first chat model then.
    return usable(model) ? model!.id : engine.models.find(usable)?.id ?? null;
  }

  function cloudBlocked(engine: AiEngineConfig): boolean {
    return !session.draft.allowCloud && engineLocalityInfo(engine, session.draft.localNetworks).locality === 'cloud';
  }

  /** Route every task without its own route to the wizard's engine. */
  function makeDefault(id: string, modelId: string): void {
    const draft = setEngineDefaultModel(session.draft, id, modelId);
    session.draft = { ...draft, routing: { ...draft.routing, default: { engineId: id, modelId } } };
  }

  /** Cloud and Copilot need Allow cloud; choosing one says yes to it (the consent step still asks per engine). */
  function allowCloudFor(preset: AiEnginePreset): void {
    if (preset.family !== 'local' && !session.draft.allowCloud) {deps.setAllowCloud(true);}
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  function go(next: AiWizardStep, o: { push?: boolean } = {}): void {
    if (o.push !== false && next !== step) {history.push(step);}
    step = next;
    render({ fresh: true });
    deps.onStep(step);
  }

  /** One-click: a running server or Copilot, straight to Done when its models answer. */
  async function connect(preset: AiEnginePreset): Promise<void> {
    if (connecting) {return;}
    allowCloudFor(preset);
    const { id } = engineFor(preset);
    useEngine(id);
    const fallback: AiWizardStep = preset.family === 'host' ? 'copilot' : 'local';
    if (!ai.discoverModels) {
      go(fallback);
      return;
    }
    connecting = preset.id;
    render();
    deps.announce(`Setting up ${preset.name}…`);
    try {
      await session.ensureSaved(id);
      const status = await ai.discoverModels(id);
      if (disposed || engineId !== id) {return;}
      if (status && typeof status === 'object') {
        session.statuses.set(id, status);
        deps.onStatuses();
      }
      if (!status || status.ok === false) {throw new Error(status?.error || `Could not fetch the models from ${preset.name}.`);}
      const engine = session.getEngine(id);
      if (!engine) {return;}
      session.draft = withEngine(session.draft, applyDiscoveryForFamily(engine, status, preset.family));
      const fresh = session.getEngine(id)!;
      const modelId = preset.family === 'local'
        ? defaultRouteForEngine(session.draft, session.statusList(), id)?.modelId ?? null
        : firstChatModelId(fresh.models);
      if (!modelId) {
        throw new Error(preset.family === 'host' ? 'Copilot lists no chat model for this account yet.' : `${preset.name} has no chat model loaded or downloaded yet.`);
      }
      makeDefault(id, modelId);
      connecting = null;
      go('done');
    } catch (err) {
      if (disposed) {return;}
      connecting = null;
      connectError = err instanceof Error && err.message ? err.message : `${preset.name} could not be set up.`;
      deps.announce(connectError);
      go(fallback);
      form.opened(id);
    }
  }

  /** Step 2: a provider or server card picked; its form opens under the cards. */
  function pick(preset: AiEnginePreset): void {
    allowCloudFor(preset);
    const { id, isNew } = engineFor(preset);
    useEngine(id);
    const target: AiWizardStep = preset.family === 'local' ? 'local' : preset.family === 'host' ? 'copilot' : 'cloud';
    if (step !== target) {
      go(target);
    } else {
      render();
    }
    const first = form.opened(id, { isNew: isNew && preset.family === 'cloud' });
    // A new cloud engine lands on its key; anything else keeps focus on the card.
    if (isNew && preset.family === 'cloud') {deps.focusKey(first);}
    deps.announce(preset.family === 'cloud' ? `${preset.name}: paste your API key.` : `${preset.name}: fetching its models.`);
  }

  function continueToDone(): void {
    const engine = currentEngine();
    const modelId = readyModel(engine);
    if (!engine || !modelId || cloudBlocked(engine)) {return;}
    makeDefault(engine.id, modelId);
    go('done');
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /** Rebuild the current step. `fresh` (a new step) scrolls up and focuses its title; otherwise focus stays put. */
  function render(o: { fresh?: boolean } = {}): void {
    if (disposed) {return;}
    keepFocus(column, () => {
      column.replaceChildren(...buildStep());
    });
    element.dataset.step = step;
    if (o.fresh) {
      element.scrollTop = 0;
      column.querySelector<HTMLElement>('.ai-wizard-title')?.focus({ preventScroll: true });
    }
  }

  function buildStep(): HTMLElement[] {
    switch (step) {
      case 'path': return buildPath();
      case 'cloud': return buildCloud();
      case 'local': return buildLocal();
      case 'copilot': return buildCopilot();
      case 'done': return buildDone();
    }
  }

  function heading(text: string, lede?: string): HTMLElement {
    const head = el('div', 'ai-wizard-head');
    const h = el('h3', 'ai-wizard-title', text);
    h.id = nextId('ai-wizard-title');
    h.tabIndex = -1;
    element.setAttribute('aria-labelledby', h.id);
    head.append(h);
    if (lede) {head.append(el('p', 'ai-wizard-lede', lede));}
    return head;
  }

  /** A large choice: glyph, a name line, a caption, a chevron. */
  function option(o: { fk: string; glyph: string; name: string; caption: string; lead?: boolean; state?: 'running' | 'busy'; onClick(): void }): HTMLButtonElement {
    const b = button(`ai-wizard-option${o.lead ? ' is-lead' : ''}`, '', { fk: o.fk });
    if (o.state) {b.dataset.state = o.state;}
    const glyph = el('span', 'ai-wizard-option-glyph');
    glyph.innerHTML = o.glyph;
    const text = el('span', 'ai-wizard-option-text');
    const name = el('span', 'ai-wizard-option-name');
    if (o.state === 'running') {
      const dot = el('span', 'ai-card-dot');
      dot.setAttribute('aria-hidden', 'true');
      name.append(dot);
    }
    name.append(el('span', '', o.name));
    text.append(name, el('span', 'ai-wizard-option-caption', o.caption));
    const chevron = el('span', 'ai-wizard-option-chevron');
    if (o.state === 'busy') {
      chevron.append(el('span', 'ai-spinner'));
      b.setAttribute('aria-busy', 'true');
    } else {
      chevron.innerHTML = ICONS.chevron;
    }
    chevron.setAttribute('aria-hidden', 'true');
    b.append(glyph, text, chevron);
    b.addEventListener('click', () => { if (!connecting) {o.onClick();} });
    return b;
  }

  function cloudGlyph(): string {
    return `<span class="ai-glyph ai-wizard-glyph-cloud" aria-hidden="true">${ICONS.cloud}</span>`;
  }

  // Step 1 ─────────────────────────────────────────────────────────────────

  function buildPath(): HTMLElement[] {
    const out: HTMLElement[] = [heading('How should MikeDown reach a model?', 'You can change it later in AI Engines.')];
    if (!scan) {
      const wait = el('div', 'ai-wizard-scanning');
      wait.setAttribute('role', 'status');
      wait.append(el('span', 'ai-spinner'), el('span', '', 'Checking this machine…'));
      out.push(wait);
      return out;
    }
    const rec = scan.recommendation;
    const copilot = scan.vscodeLm?.available ? groups.host.find((p) => p.kind === 'vscode-lm') : undefined;
    const running = rec.path === 'runningLocal' && rec.running ? presetById(rec.running.presetId) : undefined;
    const options = el('div', 'ai-wizard-options');

    if (running && rec.running) {
      const models = rec.running.models;
      options.append(option({
        fk: `wiz:use:${running.id}`,
        glyph: kindGlyphHtml(running.kind),
        name: `${running.name} is running on this ${machine()}${models !== undefined ? ` · ${models} ${models === 1 ? 'model' : 'models'}` : ''}`,
        caption: connecting === running.id ? `Setting up ${running.name}…` : 'Use it. Text stays on this machine.',
        lead: true,
        state: connecting === running.id ? 'busy' : 'running',
        onClick: () => { void connect(running); },
      }));
    }
    if (copilot) {
      options.append(option({
        fk: 'wiz:use:copilot',
        glyph: kindGlyphHtml(copilot.kind),
        name: 'Use GitHub Copilot, no key needed',
        caption: connecting === copilot.id
          ? 'Fetching Copilot’s models…'
          : `Through your Copilot plan in VS Code. ${AI_HOST_PRIVACY.permission}`,
        lead: rec.path === 'vscodeLm',
        ...(connecting === copilot.id ? { state: 'busy' as const } : {}),
        onClick: () => { void connect(copilot); },
      }));
    }

    if (options.childElementCount > 0) {
      options.append(option({
        fk: 'wiz:cloud',
        glyph: cloudGlyph(),
        name: 'Connect a cloud provider',
        caption: 'Paste an API key from Anthropic, OpenAI or another provider.',
        onClick: () => go('cloud'),
      }));
      out.push(options);
    } else {
      out.push(buildCloudGroup());
    }
    out.push(buildAdvanced());
    if (scanning) {
      const line = el('div', 'ai-wizard-quiet', 'Checking this machine again…');
      line.setAttribute('role', 'status');
      out.push(line);
    }
    return out;
  }

  /** The cloud provider cards with the Allow cloud statement and the privacy card (cloud-first step 1, and step 2). */
  function buildCloudGroup(o: { title?: boolean } = {}): HTMLElement {
    const section = el('section', 'ai-wizard-group');
    const headingId = nextId('ai-wizard-group');
    if (o.title !== false) {
      const h = el('div', 'ai-cards-heading');
      h.id = headingId;
      h.innerHTML = ICONS.cloud;
      h.append(el('span', '', 'Connect a cloud provider'));
      section.append(h, el('div', 'ai-cards-explainer', 'Paste a key from the provider. It bills your account for what you use.'));
      section.setAttribute('aria-labelledby', headingId);
    }
    // Picking a provider turns Allow cloud on (pick()), so it is a statement here, not a switch.
    const access = el('div', 'ai-cloud-access ai-wizard-cloud-access');
    access.append(
      el('p', 'ai-wizard-cloud-line', ai.requestCloudConsent
        ? 'Choosing a provider turns on cloud engines; MikeDown still asks before the first request in each workspace.'
        : 'Choosing a provider turns on cloud engines.'),
      privacyCard(groups.cloud, {
        collapsed: 'What this means',
        open: cloudPrivacyOpen,
        onToggle: (open) => { cloudPrivacyOpen = open; },
        openLink: ctx.openLink,
        extra: aiConsentStepNote(!!ai.requestCloudConsent),
        className: 'ai-cloud-access-privacy',
      }),
    );
    section.append(access);
    const grid = el('div', 'ai-cards-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Cloud providers');
    const picked = currentEngine();
    const pickedPreset = picked ? presetForEngine(picked)?.id : undefined;
    for (const preset of groups.cloud) {
      const card = button('ai-card', '', { fk: `wiz:card:${preset.id}` });
      card.innerHTML = kindGlyphHtml(preset.kind);
      const text = el('span', 'ai-card-text');
      text.append(el('span', 'ai-card-name', preset.name), el('span', 'ai-card-caption', preset.caption));
      card.append(text);
      const on = step === 'cloud' && pickedPreset === preset.id;
      card.setAttribute('aria-pressed', String(on));
      card.classList.toggle('is-selected', on);
      card.addEventListener('click', () => pick(preset));
      grid.append(card);
    }
    section.append(grid);
    return section;
  }

  function buildAdvanced(): HTMLElement {
    const box = el('div', 'ai-wizard-advanced');
    const panelId = nextId('ai-wizard-advanced');
    const toggle = button('ai-disclosure', 'Advanced: run models on this machine', { html: ICONS.chevron, fk: 'wiz:advanced' });
    toggle.setAttribute('aria-expanded', String(advancedOpen));
    toggle.setAttribute('aria-controls', panelId);
    toggle.addEventListener('click', () => {
      advancedOpen = !advancedOpen;
      render();
    });
    const panel = el('div', 'ai-wizard-advanced-panel');
    panel.id = panelId;
    panel.hidden = !advancedOpen;
    const hw = scan?.recommendation.hardwareLine;
    if (hw) {panel.append(el('p', 'ai-wizard-hardware', hw));}
    panel.append(el('p', 'ai-wizard-quiet', 'Your own model server, such as LM Studio or Ollama. Text never leaves this machine.'));
    const choose = button('settings-btn', 'Choose a local server', { fk: 'wiz:local' });
    choose.addEventListener('click', () => go('local'));
    panel.append(choose);
    box.append(toggle, panel);
    return box;
  }

  // Step 2 ─────────────────────────────────────────────────────────────────

  function formHolder(): HTMLElement | null {
    const engine = currentEngine();
    if (!engine) {return null;}
    const holder = el('div', 'ai-wizard-form');
    if (connectError) {holder.append(note('error', connectError, 'ai-wizard-error'));}
    holder.append(buildForm(engine.id));
    return holder;
  }

  /** The engine form; on the cloud step "What this means" above already says what is sent, so the form's card is left out. */
  function buildForm(id: string): HTMLElement {
    return form.build(id, { privacy: step !== 'cloud' });
  }

  function footer(o: { label: string; fk: string; ready: boolean; hint?: string; onClick(): void }): HTMLElement {
    const bar = el('div', 'ai-wizard-footer');
    const hint = el('span', 'ai-wizard-hint', o.ready ? '' : o.hint ?? '');
    hint.id = nextId('ai-wizard-hint');
    const primary = button('settings-btn settings-btn--primary ai-wizard-next', o.label, { fk: o.fk });
    // aria-disabled, not disabled: focus stays on it while the form catches up.
    if (!o.ready) {
      primary.setAttribute('aria-disabled', 'true');
      primary.setAttribute('aria-describedby', hint.id);
    }
    primary.addEventListener('click', () => { if (o.ready) {o.onClick();} else if (o.hint) {deps.announce(o.hint);} });
    bar.append(hint, primary);
    return bar;
  }

  function continueFooter(): HTMLElement {
    const engine = currentEngine();
    const blocked = engine ? cloudBlocked(engine) : false;
    const ready = !!engine && !!readyModel(engine) && !blocked;
    const hint = !engine
      ? step === 'local' ? 'Pick a server to continue.' : 'Pick a provider to continue.'
      : blocked
        ? 'Turn on Allow cloud engines to use it.'
        : step === 'cloud' && !session.hasKey(engine.id)
          ? 'Paste your API key; the models appear, then Continue.'
          : 'Pick a chat model to continue.';
    return footer({ label: 'Continue', fk: 'wiz:continue', ready, hint, onClick: continueToDone });
  }

  function buildCloud(): HTMLElement[] {
    const out = [
      heading('Connect a cloud provider', 'Pick a provider and paste an API key. Text you ask about is sent to that provider.'),
      buildCloudGroup({ title: false }),
    ];
    const holder = formHolder();
    if (holder) {out.push(holder);}
    out.push(continueFooter());
    return out;
  }

  function buildLocal(): HTMLElement[] {
    const lede = scan?.recommendation.hardwareLine || 'Your own model server, on this computer or your network. Text never leaves it.';
    const out = [heading('Run models on this machine', lede)];
    const list = el('div', 'ai-wizard-servers');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Local servers');
    const cards = localCards();
    const byId = new Map(cards?.map((c) => [c.presetId, c]) ?? []);
    const ordered = cards
      ? [...cards.map((c) => presetById(c.presetId)).filter((p): p is AiEnginePreset => !!p && p.family === 'local'), ...groups.local.filter((p) => !byId.has(p.id))]
      : groups.local;
    for (const preset of ordered) {list.append(buildServer(preset, byId.get(preset.id)));}
    out.push(list);

    const detect = el('div', 'ai-cards-detect');
    const status = el('span', 'ai-cards-detect-text', scanning ? AI_DETECT_LOOKING : cards && !cards.some((c) => c.running) ? AI_DETECT_NONE : '');
    detect.append(status);
    if (ai.detectLocalServers) {
      const again = button('ai-link-btn ai-cards-again', 'Look again', { fk: 'wiz:look-again' });
      if (scanning) {again.setAttribute('aria-disabled', 'true');}
      again.addEventListener('click', () => { if (!scanning) {rescan();} });
      detect.append(again);
    }
    out.push(detect);
    const holder = formHolder();
    if (holder) {out.push(holder);}
    out.push(continueFooter());
    return out;
  }

  /** A local server: the card, and for one that is not running, where to get it. */
  function buildServer(preset: AiEnginePreset, found: LocalServerCard | undefined): HTMLElement {
    const row = el('div', 'ai-wizard-server');
    const card = button('ai-card', '', { fk: `wiz:card:${preset.id}` });
    card.innerHTML = kindGlyphHtml(preset.kind);
    const text = el('span', 'ai-card-text');
    text.append(el('span', 'ai-card-name', preset.name), el('span', 'ai-card-caption', preset.caption));
    const state = !found ? null : found.alreadyAdded && found.engineId && session.getEngine(found.engineId) ? 'added' : found.running ? 'running' : 'stopped';
    if (state) {
      card.dataset.state = state;
      const line = el('span', 'ai-card-state');
      if (state === 'running') {
        const dot = el('span', 'ai-card-dot');
        dot.setAttribute('aria-hidden', 'true');
        line.append(dot);
      }
      const count = found?.models !== undefined ? ` · ${found.models} ${found.models === 1 ? 'model' : 'models'}` : '';
      line.append(el('span', '', state === 'added' ? 'Added' : state === 'running' ? `Running${count}` : 'Not running'));
      text.append(line);
    }
    card.append(text);
    const picked = currentEngine();
    const on = !!picked && (picked.id === found?.engineId || (added.has(picked.id) && presetForEngine(picked)?.id === preset.id));
    card.setAttribute('aria-pressed', String(on));
    card.classList.toggle('is-selected', on);
    card.addEventListener('click', () => pick(preset));
    row.append(card);
    if (state === 'stopped' && preset.installUrl) {
      const help = el('div', 'ai-wizard-install');
      help.append(hostLink(`Install ${preset.name}`, preset.installUrl, ctx.openLink, 'ai-wizard-link'), el('span', '', ', then come back and choose Look again.'));
      row.append(help);
    }
    return row;
  }

  function buildCopilot(): HTMLElement[] {
    const out = [heading('GitHub Copilot', `Copilot’s models through your Copilot plan in VS Code. No key needed. ${AI_HOST_PRIVACY.permission}`)];
    const holder = formHolder();
    if (holder) {out.push(holder);}
    out.push(continueFooter());
    return out;
  }

  // Step 3 ─────────────────────────────────────────────────────────────────

  function buildDone(): HTMLElement[] {
    const engine = currentEngine();
    const modelId = readyModel(engine);
    if (!engine || !modelId) {
      // The engine changed under the wizard (deleted elsewhere): start again.
      return [heading('Set up AI', 'Something changed. Go back and choose again.')];
    }
    const local = engineLocalityInfo(engine, session.draft.localNetworks).locality === 'local';
    const model = engine.models.find((m) => m.id === modelId)!;
    const out: HTMLElement[] = [];
    const icon = el('span', 'ai-wizard-done-icon');
    icon.innerHTML = ICONS.check;
    icon.setAttribute('aria-hidden', 'true');
    const head = heading(`Ready: ${engineDisplayName(engine)} · ${modelDisplayName(model)} · ${local ? 'Local' : 'Cloud'}`);
    head.prepend(icon);
    out.push(head);

    // A choice of model when the engine offers more than one; the first is already picked.
    const chat = engine.models.filter((m) => m.enabled && !m.missing && m.capabilities.chat);
    if (chat.length > 1) {
      const row = el('div', 'ai-wizard-model');
      const select = el('select', 'settings-input ai-wizard-model-select');
      select.id = nextId('ai-wizard-model');
      select.dataset.fk = 'wiz:model';
      for (const m of chat) {
        const o = el('option', '', modelDisplayName(m));
        o.value = m.id;
        select.append(o);
      }
      select.value = modelId;
      select.addEventListener('change', () => {
        makeDefault(engine.id, select.value);
        render();
        const picked = engine.models.find((m) => m.id === select.value);
        if (picked) {deps.announce(`Default model: ${modelDisplayName(picked)}.`);}
      });
      const label = el('label', 'ai-wizard-model-label', 'Model');
      label.htmlFor = select.id;
      row.append(label, select);
      out.push(row);
    }

    const privacy = el('p', 'ai-wizard-privacy');
    const glyph = el('span', 'ai-privacy-glyph');
    glyph.innerHTML = local ? ICONS.local : ICONS.cloud;
    privacy.append(glyph, el('span', '', privacyText(engine, local)));
    out.push(privacy);

    const more = el('p', 'ai-wizard-quiet');
    if (!deps.turnsOn) {more.append('Choose Done to save. ');}
    const fine = button('ai-link-btn', 'Change settings in AI Engines', { fk: 'wiz:open-engine' });
    fine.addEventListener('click', () => deps.openEngine(engine.id));
    more.append(fine);
    out.push(more);
    out.push(footer({ label: deps.turnsOn ? 'Turn on AI' : 'Done', fk: 'wiz:done', ready: true, onClick: () => deps.finish() }));
    return out;
  }

  function privacyText(engine: AiEngineConfig, local: boolean): string {
    if (local) {return AI_CLOUD_PRIVACY.local;}
    if (presetForEngine(engine)?.family === 'host') {return `${AI_HOST_PRIVACY.leaves} ${aiConsentStepNote(!!ai.requestCloudConsent)}`;}
    const where = aiConsentHost(engine) || hostOfUrl(engine.baseUrl) || 'the provider';
    return `Text you ask about is sent over the internet to ${where}. ${aiConsentStepNote(!!ai.requestCloudConsent)}`;
  }

  // ── Handle ────────────────────────────────────────────────────────────────

  render();
  rescan();

  return {
    element,
    step: () => step,
    engineId: () => engineId,
    back() {
      if (connecting) {return;}
      const previous = history.pop();
      if (!previous) {
        deps.leave();
        return;
      }
      step = previous;
      connectError = null;
      render({ fresh: true });
      deps.onStep(step);
    },
    refresh(id, refresh) {
      if (disposed) {return;}
      if (refresh.form && id && id === engineId) {
        const current = column.querySelector<HTMLElement>('.ai-form');
        if (current) {
          keepFocus(current, () => {
            const fresh = buildForm(id);
            current.replaceWith(fresh);
            return fresh;
          });
        }
      }
      // Continue follows the form: a key stored, models fetched, a model picked.
      const bar = column.querySelector<HTMLElement>('.ai-wizard-footer');
      if (bar && step !== 'done' && step !== 'path') {keepFocus(bar, () => { const next = continueFooter(); bar.replaceWith(next); return next; });}
    },
    focus() {
      const target = column.querySelector<HTMLElement>('.ai-wizard-option.is-lead')
        ?? column.querySelector<HTMLElement>('.ai-wizard-option, .ai-card, .ai-wizard-next')
        ?? column.querySelector<HTMLElement>('.ai-wizard-title');
      target?.focus({ preventScroll: true });
    },
    dispose() {
      disposed = true;
      scanAbort?.abort();
      element.remove();
    },
  };
}
