/**
 * The Settings modal's AI tab: a summary. Built only when the host has an
 * `ai` group (see `editor.ts#showSettingsModal`), with the modal's own row
 * builders so it sits flush with the other tabs.
 *
 * Tier 1 hosts (`complete` only, they route by themselves) get the master
 * switch and the feature toggles. Tier 2 hosts (an engine registry) also get
 * Allow cloud, a compact engine list (name, local/cloud pill, status dot,
 * enabled switch), the default route with "Change…", and "Manage engines…".
 * Engines, their forms and routing live on the AI Engines page
 * (`ai-engines-page.ts`), which the tab opens over the modal.
 *
 * Edits run in an `AiSettingsSession` (`ai-settings-session.ts`); Save sends
 * only the `ai.*` keys that changed, through the modal's normal
 * `saveSettings` patch. The page starts from the tab's draft and saves on
 * Done; the tab then takes the saved result as its own.
 *
 * Modal UI only: nothing here touches the editor document or its DOM.
 */

import { AI_FEATURES, AI_TASKS, aiProviderPolicy, getAiTask, resolveAiFeature } from './ai';
import type { AiEngineConfig, AiSettings, AiSettingsPatch } from './ai';
import { engineDisplayName, engineKindLabel, routeLabel, taskRouteNote } from './ai-settings-model';
import { createAiSettingsSession } from './ai-settings-session';
import type { AiSettingsSessionOptions } from './ai-settings-session';
import type { AiEnginesPageSection } from './ai-engines-page';
import { button, el, experimentalBadge, experimentalDisclaimer, keepFocus, kindGlyphHtml, localityPills, nextId, note, privacyCard, statusBadge, switchInput } from './ai-settings-dom';
import type { MikeDownSettingsSectionBuild, MikeDownSettingsSectionContext } from './types';

/** The tab asks its host to open the AI Engines page over the modal. */
export interface AiEnginesPageRequest {
  initial?: { engineId?: string; section?: AiEnginesPageSection };
  /** Session options for the page: it starts from the tab's draft. */
  session: AiSettingsSessionOptions & { keyOverride: Map<string, boolean> };
  /** The page saved (Done) `patch`, ending at `settings`. */
  onDone(patch: AiSettingsPatch, settings: AiSettings): void;
}

export interface AiSettingsSectionOptions extends AiSettingsSessionOptions {
  /** The modal saved; the draft is the new settings. */
  onSaved(draft: AiSettings): void;
  /** Open the AI Engines page. Absent: no engine list and no Manage engines… button. */
  openEnginesPage?(request: AiEnginesPageRequest): void;
}

// ── The tab ─────────────────────────────────────────────────────────────────

export function buildAiSettingsSection(ctx: MikeDownSettingsSectionContext, opts: AiSettingsSectionOptions): MikeDownSettingsSectionBuild {
  const session = createAiSettingsSession(opts);
  const { tier } = session;
  const canManage = tier === 2 && !!opts.openEnginesPage;

  // Screen reader announcements (the page saved).
  const live = el('div', 'ai-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  let liveTimer: number | undefined;
  function announce(text: string): void {
    window.clearTimeout(liveTimer);
    live.textContent = '';
    liveTimer = window.setTimeout(() => { live.textContent = text; }, 40);
  }

  // ── Experimental notice, master switch and Allow cloud ────────────────────
  const rows: HTMLElement[] = [];

  const intro = el('div', 'ai-experimental-intro');
  const introHead = el('div', 'ai-experimental-head');
  introHead.append(el('span', 'ai-experimental-title', 'AI features'), experimentalBadge());
  intro.append(introHead, experimentalDisclaimer());
  rows.push(intro);

  const masterField = ctx.makeCheckboxRow(
    'Enable AI features',
    tier === 2
      ? 'Writing help from engines you choose. While this is off, nothing is sent anywhere.'
      : 'Writing help from the AI service this app provides. While this is off, nothing is sent anywhere.',
    session.draft.enabled,
  );
  masterField.row.classList.add('ai-master');
  masterField.input.dataset.fk = 'ai-enabled';
  masterField.input.addEventListener('change', () => {
    session.draft = { ...session.draft, enabled: masterField.input.checked };
  });
  rows.push(masterField.row);

  const toolbarField = ctx.makeCheckboxRow(
    'Show AI button on the toolbar',
    'Opens the AI actions. While AI is off, it offers to turn AI on and set it up.',
    session.draft.showToolbarButton,
  );
  toolbarField.input.dataset.fk = 'ai-toolbar-button';
  toolbarField.input.addEventListener('change', () => {
    session.draft = { ...session.draft, showToolbarButton: toolbarField.input.checked };
  });
  rows.push(toolbarField.row);

  const cloudField = ctx.makeCheckboxRow(
    'Allow cloud engines',
    'Lets tasks use engines outside this network, such as Anthropic or OpenAI. Local engines never need it.',
    session.draft.allowCloud,
  );
  cloudField.input.dataset.fk = 'ai-allow-cloud';
  // What happens to the text, with the policies of the cloud engines set up
  // so far. Only promise a consent step when the host asks for one (OQ9).
  cloudField.row.append(privacyCard(session.draft.engines.map((e) => ({ policy: aiProviderPolicy(e) })), {
    openLink: ctx.openLink,
    extra: session.ai.requestCloudConsent
      ? 'Even when allowed, each cloud engine asks for your OK before its first request in each workspace or folder.'
      : 'Once allowed, this app sends requests to cloud engines without asking again.',
    className: 'ai-row-note',
  }));
  cloudField.input.addEventListener('change', () => {
    session.draft = { ...session.draft, allowCloud: cloudField.input.checked };
    renderEngines();
  });

  // ── Engines (summary) ─────────────────────────────────────────────────────
  const enginesRow = ctx.makeRow('Engines', 'Servers that run the models. Local engines keep your text on this network.');
  enginesRow.classList.add('ai-section');
  const enginesBody = el('div', 'ai-engines-body');
  enginesRow.append(enginesBody);

  function openPage(initial?: AiEnginesPageRequest['initial']): void {
    opts.openEnginesPage?.({
      initial,
      session: session.fork(),
      onDone: (patch, saved) => {
        session.absorb(saved, patch);
        renderEngines();
        if (Object.keys(patch).length > 0) {announce('Engines and routing saved.');}
      },
    });
  }

  function renderEngines(): void {
    keepFocus(enginesBody, () => {
      enginesBody.replaceChildren();
      const draft = session.draft;
      if (draft.engines.length === 0) {
        const empty = el('div', 'ai-summary-empty');
        empty.append(
          el('div', 'ai-empty-title', 'No engines yet'),
          el('div', 'ai-empty-text', 'Two ways to connect: run models on your own machine, or paste a cloud API key. Nothing is sent until AI is on.'),
        );
        enginesBody.append(empty);
      } else {
        const list = el('div', 'ai-engines ai-engines--compact');
        list.setAttribute('role', 'list');
        list.setAttribute('aria-label', 'Engines');
        for (const engine of draft.engines) {list.append(buildEngineItem(engine));}
        enginesBody.append(list, buildRouteLine());
      }
      const manage = button('settings-btn settings-btn--secondary ai-manage-btn', draft.engines.length === 0 ? 'Add engine…' : 'Manage engines…', { fk: 'manage-engines' });
      manage.addEventListener('click', () => openPage());
      const actions = el('div', 'ai-summary-actions');
      actions.append(manage);
      enginesBody.append(actions);
    });
  }

  function buildEngineItem(engine: AiEngineConfig): HTMLElement {
    const item = el('div', 'ai-engine ai-engine--compact');
    item.setAttribute('role', 'listitem');
    item.dataset.engineId = engine.id;
    item.classList.toggle('is-disabled', !engine.enabled);
    const name = engineDisplayName(engine);

    const head = el('div', 'ai-engine-head');
    const glyph = el('span', 'ai-engine-glyph');
    glyph.innerHTML = kindGlyphHtml(engine.kind, 'ai-glyph--sm');
    // The name opens the page on this engine, like a list of services.
    const open = button('ai-engine-main ai-engine-open', '', { ariaLabel: `${name}: open in AI Engines`, fk: `eng:${engine.id}:open` });
    const titleLine = el('span', 'ai-engine-title');
    titleLine.append(el('span', 'ai-engine-name', name), ...localityPills(engine, session.draft));
    open.title = engineKindLabel(engine.kind);
    open.append(titleLine);
    open.addEventListener('click', () => openPage({ engineId: engine.id }));

    const enabled = switchInput(engine.enabled, `Enable ${name}`, `eng:${engine.id}:enabled-row`);
    enabled.addEventListener('change', () => {
      session.updateEngine(engine.id, { enabled: enabled.checked });
      renderEngines();
    });

    const actions = el('div', 'ai-engine-actions');
    actions.append(statusBadge(session.statuses.get(engine.id), undefined, { compact: true }), enabled);
    head.append(glyph, open, actions);
    item.append(head);
    return item;
  }

  /** "Default model: oMLX (Mac Studio) · Qwen 3.8 Flash Next   Change…" */
  function buildRouteLine(): HTMLElement {
    const draft = session.draft;
    const line = el('div', 'ai-route-line');
    const labelId = nextId('ai-route-line');
    const label = el('span', 'ai-route-line-label', 'Default model');
    label.id = labelId;
    const value = el('span', 'ai-route-line-value', draft.routing.default ? routeLabel(draft, draft.routing.default) : 'None set');
    value.classList.toggle('is-none', !draft.routing.default);
    const change = button('ai-link-btn', 'Change…', { fk: 'route:change', ariaLabel: 'Change the default model' });
    change.setAttribute('aria-describedby', labelId);
    change.addEventListener('click', () => openPage({ section: 'routing' }));
    line.append(label, value, change);
    const n = draft.routing.default
      ? taskRouteNote({ ...draft, routing: { ...draft.routing, tasks: {} } }, session.statusList(), 'chat')
      : { level: 'info' as const, text: 'Tasks have nowhere to go until a default model is set.' };
    if (n) {line.append(note(n.level, n.text, 'ai-row-note'));}
    return line;
  }

  // ── Features ──────────────────────────────────────────────────────────────

  const featuresRow = ctx.makeRow(
    'Features',
    tier === 2 ? 'Turn each feature on or off. A feature can use a different task’s route if you like.' : 'Turn each feature on or off.',
  );
  featuresRow.classList.add('ai-section');
  const featureRows: HTMLElement[] = [];
  for (const def of AI_FEATURES) {
    const planned = def.status === 'planned';
    const resolved = resolveAiFeature(session.draft.features, def.id);
    const row = el('div', 'settings-row settings-row--inline ai-feature');
    row.classList.toggle('is-planned', planned);
    const text = el('div', 'settings-row-text');
    const labelId = nextId('ai-feature');
    const lbl = el('span', 'settings-label', def.label);
    lbl.id = labelId;
    text.append(lbl, el('span', 'settings-desc', def.description));
    const defaultTask = getAiTask(def.defaultTask);
    const controls = el('div', 'ai-feature-controls');
    if (planned) {
      controls.append(el('span', 'ai-pill ai-pill--soon', 'Coming later'));
      row.setAttribute('aria-disabled', 'true');
    } else {
      if (tier === 2) {
        const select = el('select', 'settings-input settings-input--small');
        select.dataset.fk = `feature:${def.id}:task`;
        select.setAttribute('aria-label', `Task route for ${def.label}`);
        const dflt = el('option', '', `Default task (${defaultTask?.label ?? def.defaultTask})`);
        dflt.value = '';
        select.append(dflt);
        for (const task of AI_TASKS) {
          if (task.hostMethod) {continue;}
          const o = el('option', '', task.label);
          o.value = task.id;
          select.append(o);
        }
        const saved = session.draft.features[def.id]?.task;
        if (saved && !AI_TASKS.some((t) => t.id === saved)) {
          const o = el('option', '', saved);
          o.value = saved;
          select.append(o);
        }
        select.value = saved ?? '';
        select.addEventListener('change', () => {
          const draft = session.draft;
          const entry = { ...(draft.features[def.id] ?? {}) };
          if (select.value) {entry.task = select.value;} else {delete entry.task;}
          session.draft = { ...draft, features: { ...draft.features, [def.id]: entry } };
        });
        controls.append(select);
      }
      const toggle = switchInput(resolved.enabled, def.label, `feature:${def.id}:enabled`);
      toggle.setAttribute('aria-labelledby', labelId);
      toggle.removeAttribute('aria-label');
      toggle.addEventListener('change', () => {
        const draft = session.draft;
        session.draft = { ...draft, features: { ...draft.features, [def.id]: { ...(draft.features[def.id] ?? {}), enabled: toggle.checked } } };
      });
      controls.append(toggle);
    }
    row.append(text, controls);
    featureRows.push(row);
  }
  featuresRow.append(ctx.makeGroup(...featureRows));

  // ── Assemble ──────────────────────────────────────────────────────────────

  if (tier === 2) {
    rows.push(cloudField.row);
    if (canManage) {
      rows.push(enginesRow);
      renderEngines();
    }
  }
  rows.push(featuresRow, live);

  // Statuses pushed while the tab is open refresh the dots in place.
  const unsubscribe = canManage ? opts.subscribeStatuses?.((list) => {
    if (!enginesRow.isConnected) {return;}
    for (const s of list) {session.statuses.set(s.engineId, s);}
    renderEngines();
  }) : undefined;

  // Fresh statuses as the tab opens: the dots should not be stale.
  if (canManage) {
    void session.refreshStatuses().then((ok) => {
      if (ok && enginesRow.isConnected) {renderEngines();}
    });
  }

  const close = () => {
    window.clearTimeout(liveTimer);
    unsubscribe?.();
  };

  return {
    rows,
    collect: () => session.collect(),
    onDiscarded: () => {
      close();
      session.discard();
    },
    onSaved: () => {
      close();
      opts.onSaved(session.commit());
    },
  };
}
