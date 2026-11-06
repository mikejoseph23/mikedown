/**
 * The Settings modal's AI tab: a summary. Built only when the host has an
 * `ai` group (see `editor.ts#showSettingsModal`), with the modal's own row
 * builders so it sits flush with the other tabs.
 *
 * Order (U8): the intro, the master switch, the Engines summary, the
 * Documentation bases row (with `host.docs`), Allow cloud with the cloud
 * consents, the toolbar button switch, the AI Activity switch, Features.
 * Tier 1 hosts (`complete` only, they route by themselves) get the master
 * switch, the toolbar and AI Activity switches and the feature toggles. Tier 2 hosts (an
 * engine registry) also get a compact engine list (name, local/cloud pill,
 * status dot, enabled switch), the default model with "Change…" (the Tasks
 * section), "Manage engines…", Allow cloud, and each feature's task under
 * "Advanced: task per feature".
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

import { AI_FEATURES, AI_NO_CONSENTS_TEXT, AI_TASKS, GHOST_DELAY_MS_DEFAULT, GHOST_DELAY_MS_MAX, GHOST_DELAY_MS_MIN, GHOST_MAX_TOKENS_DEFAULT, GHOST_MAX_TOKENS_MAX, GHOST_MAX_TOKENS_MIN, aiConsentStepNote, aiConsentSummary, aiProviderPolicy, getAiTask, ghostTextOptions, resolveAiFeature, toAiError } from './ai';
import type { AiConsentRecord, AiEngineConfig, AiFeatureSetting, AiSettings, AiSettingsPatch } from './ai';
import { engineDisplayName, engineKindLabel, parseLocalNetworksText, routeLabel, taskRouteNote } from './ai-settings-model';
import { createAiSettingsSession } from './ai-settings-session';
import type { AiSettingsSessionOptions } from './ai-settings-session';
import type { AiEnginesPageSection } from './ai-engines-page';
import { ICONS, button, el, experimentalBadge, experimentalDisclaimer, keepFocus, kindGlyphHtml, localityPills, nextId, note, privacyCard, privacyLine, statusBadge, switchInput } from './ai-settings-dom';
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
  /** The host has `host.docs`: a row opens the AI Engines page on its Documentation bases. */
  docsAvailable?: boolean;
  /** Open the AI Activity panel over the modal. Absent: no "Open" beside the switch. */
  openActivityPanel?(): void;
  /** A stored consent was forgotten: drop this session's copy of the answer so the next request asks again. */
  onConsentForgotten?(engineId: string): void;
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

  const toolbarField = ctx.makeCheckboxRow(
    'Show AI button on the toolbar',
    'Opens the AI actions. While AI is off, it offers to turn AI on and set it up.',
    session.draft.showToolbarButton,
  );
  toolbarField.input.dataset.fk = 'ai-toolbar-button';
  toolbarField.input.addEventListener('change', () => {
    session.draft = { ...session.draft, showToolbarButton: toolbarField.input.checked };
  });

  const activityField = ctx.makeCheckboxRow(
    'AI Activity',
    'Shows exactly what each AI request sent and received. Kept in memory for this window only; turning it off clears it.',
    session.draft.activityPanel,
  );
  activityField.row.classList.add('ai-activity-setting');
  activityField.input.dataset.fk = 'ai-activity-panel';
  // "Open" follows the switch at once, before Save. The panel says so if it is not recording yet.
  const activityOpen = button('ai-link-btn ai-activity-open', 'Open', { fk: 'ai-activity:open', ariaLabel: 'Open AI Activity' });
  activityOpen.hidden = !session.draft.activityPanel;
  activityOpen.addEventListener('click', () => opts.openActivityPanel?.());
  if (opts.openActivityPanel) {activityField.row.insertBefore(activityOpen, activityField.input);}
  activityField.input.addEventListener('change', () => {
    session.draft = { ...session.draft, activityPanel: activityField.input.checked };
    activityOpen.hidden = !activityField.input.checked;
  });

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
    extra: aiConsentStepNote(!!session.ai.requestCloudConsent),
    className: 'ai-row-note',
  }));
  cloudField.input.addEventListener('change', () => {
    session.draft = { ...session.draft, allowCloud: cloudField.input.checked };
    renderEngines();
  });

  // ── Cloud consents (only when the host stores answers it can list) ────────
  const listConsents = session.ai.listConsents?.bind(session.ai);
  const forgetConsent = session.ai.forgetConsent?.bind(session.ai);
  const consentsRow = ctx.makeRow('Cloud consents', 'Cloud engines you have allowed or refused here. Forget an answer to be asked again.');
  consentsRow.classList.add('ai-section');
  const consentsBody = el('div', 'ai-consents');
  consentsRow.append(consentsBody);

  function engineNameFor(engineId: string): string {
    const engine = session.draft.engines.find((e) => e.id === engineId);
    return engine ? engineDisplayName(engine) : engineId;
  }

  function renderConsents(records: AiConsentRecord[], problem?: string): void {
    keepFocus(consentsBody, () => {
      consentsBody.replaceChildren();
      if (problem) {consentsBody.append(note('error', problem));}
      if (records.length === 0) {
        if (!problem) {consentsBody.append(el('div', 'ai-consents-empty', AI_NO_CONSENTS_TEXT));}
        return;
      }
      const list = el('ul', 'ai-consents-list');
      list.setAttribute('aria-label', 'Cloud consents');
      for (const record of records) {
        const name = engineNameFor(record.engineId);
        const item = el('li', 'ai-consent');
        const forget = button('settings-btn settings-btn--secondary ai-consent-forget', 'Forget', { ariaLabel: `Forget the answer for ${name}`, fk: `consent-forget:${record.engineId}` });
        forget.addEventListener('click', () => {
          forget.disabled = true;
          void forgetConsent?.(record.engineId).then(
            () => {
              opts.onConsentForgotten?.(record.engineId);
              announce(`Forgot the answer for ${name}.`);
              return refreshConsents();
            },
            (err: unknown) => refreshConsents(toAiError(err).message),
          );
        });
        item.append(el('span', 'ai-consent-text', aiConsentSummary(record, name)), forget);
        list.append(item);
      }
      consentsBody.append(list);
    });
  }

  async function refreshConsents(problem?: string): Promise<void> {
    if (!listConsents) {return;}
    try {
      renderConsents(await listConsents(), problem);
    } catch (err) {
      renderConsents([], toAiError(err).message);
    }
  }

  // ── Engines (summary) ─────────────────────────────────────────────────────
  const enginesRow = ctx.makeRow('Engines', 'Servers that run the models. Local engines keep your text on this network.');
  enginesRow.classList.add('ai-section');
  const enginesBody = el('div', 'ai-engines-body');
  enginesRow.append(enginesBody);

  function openPage(initial?: AiEnginesPageRequest['initial']): void {
    // "Enable AI features" ticked but not saved yet: the page saves it with the engines (Q2).
    const pendingEnable = session.draft.enabled && !session.original.enabled;
    opts.openEnginesPage?.({
      initial,
      session: { ...session.fork(), pendingEnable },
      onDone: (patch, saved) => {
        session.absorb(saved, patch);
        cloudField.input.checked = session.draft.allowCloud;
        masterField.input.checked = session.draft.enabled;
        renderEngines();
        if (Object.keys(patch).length > 0) {announce('Engines and tasks saved.');}
      },
    });
  }

  // ── Documentation bases (the page has the list) ───────────────────────────
  const basesRow = ctx.makeRow('Documentation bases', 'Folders of markdown the AI can answer from.', 'inline');
  basesRow.classList.add('ai-section');
  const basesOpen = button('settings-btn settings-btn--secondary', 'Manage bases…', { fk: 'manage-bases' });
  basesOpen.addEventListener('click', () => openPage({ section: 'bases' }));
  basesRow.append(basesOpen);

  function renderEngines(): void {
    keepFocus(enginesBody, () => {
      enginesBody.replaceChildren();
      const draft = session.draft;
      if (draft.engines.length === 0) {
        const empty = el('div', 'ai-summary-empty');
        empty.append(
          el('div', 'ai-empty-title', 'No engines yet'),
          el('div', 'ai-empty-text', `Two ways to connect: paste a cloud API key, or run models on your own machine.${draft.enabled ? '' : ' Nothing is sent until AI is on.'}`),
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
  // One switch per feature. On tier 2 the task each feature routes through
  // is under "Advanced: task per feature" (U8): most people never change it.

  const featuresRow = ctx.makeRow('Features', 'Turn each feature on or off. A feature that is off disappears from the menus, and its commands and shortcuts say so instead of running.');
  featuresRow.classList.add('ai-section');
  const featureRows: HTMLElement[] = [];
  const taskRows: HTMLElement[] = [];
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
    const controls = el('div', 'ai-feature-controls');
    let options: HTMLElement | null = null;
    if (planned) {
      controls.append(el('span', 'ai-pill ai-pill--soon', 'Coming later'));
      row.setAttribute('aria-disabled', 'true');
    } else {
      if (tier === 2) {taskRows.push(buildTaskRow(def));}
      const toggle = switchInput(resolved.enabled, def.label, `feature:${def.id}:enabled`);
      toggle.setAttribute('aria-labelledby', labelId);
      toggle.removeAttribute('aria-label');
      toggle.addEventListener('change', () => {
        const draft = session.draft;
        session.draft = { ...draft, features: { ...draft.features, [def.id]: { ...(draft.features[def.id] ?? {}), enabled: toggle.checked } } };
      });
      controls.append(toggle);
      if (def.id === 'ghostText') {options = buildGhostOptions(toggle, text);}
    }
    row.append(text, controls);
    featureRows.push(row);
    if (options) {featureRows.push(options);}
  }
  featuresRow.append(ctx.makeGroup(...featureRows));
  if (taskRows.length > 0) {featuresRow.append(...buildTaskDisclosure(taskRows));}

  /** One feature's task picker: "Default task (Rewrite)" or another task's route. */
  function buildTaskRow(def: (typeof AI_FEATURES)[number]): HTMLElement {
    const defaultTask = getAiTask(def.defaultTask);
    const row = el('div', 'settings-row settings-row--inline ai-feature-task');
    const labelId = nextId('ai-feature-task');
    const lbl = el('span', 'settings-label', def.label);
    lbl.id = labelId;
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
    row.append(lbl, select);
    return row;
  }

  /**
   * Inline suggestions' own knobs, folded under its row while the feature is
   * on, saved into `features.ghostText` like the switch. Tier 1 hosts route by
   * themselves, so "Local engines only" could not be honoured there and is
   * left out, with the privacy line that goes with it.
   */
  function buildGhostOptions(enabled: HTMLInputElement, rowText: HTMLElement): HTMLElement {
    const saved = ghostTextOptions(session.draft.features);
    const patch = (change: (entry: AiFeatureSetting) => void): void => {
      const draft = session.draft;
      const entry = { ...(draft.features.ghostText ?? {}) };
      change(entry);
      session.draft = { ...draft, features: { ...draft.features, ghostText: entry } };
    };

    const numberRow = (label: string, hint: string, key: 'delayMs' | 'maxTokens', value: number, range: { min: number; max: number; step: number; dflt: number }): HTMLElement => {
      const row = ctx.makeRow(label, hint, 'inline');
      const input = el('input', 'settings-input settings-input--small settings-input--short');
      input.type = 'number';
      input.min = String(range.min);
      input.max = String(range.max);
      input.step = String(range.step);
      input.value = String(value);
      input.dataset.fk = `feature:ghostText:${key}`;
      input.setAttribute('aria-label', label);
      input.addEventListener('change', () => {
        const typed = Number(input.value);
        if (input.value.trim() === '' || !Number.isFinite(typed)) {
          // Blank: back to the default, with the key gone rather than saved.
          patch((entry) => { delete entry[key]; });
          input.value = String(range.dflt);
          return;
        }
        const next = Math.min(range.max, Math.max(range.min, Math.round(typed)));
        patch((entry) => { entry[key] = next; });
        input.value = String(next);
      });
      row.append(input);
      return row;
    };
    const delay = numberRow('Delay (ms)', 'How long you pause before a suggestion is requested.', 'delayMs', saved.delayMs, { min: GHOST_DELAY_MS_MIN, max: GHOST_DELAY_MS_MAX, step: 50, dflt: GHOST_DELAY_MS_DEFAULT });
    const tokens = numberRow('Max tokens', 'The longest suggestion a model may write.', 'maxTokens', saved.maxTokens, { min: GHOST_MAX_TOKENS_MIN, max: GHOST_MAX_TOKENS_MAX, step: 1, dflt: GHOST_MAX_TOKENS_DEFAULT });

    const triggerRow = ctx.makeRow('Trigger', 'Automatic suggests as you pause. Manual shortcut suggests only when you press the shortcut.', 'inline');
    const trigger = el('select', 'settings-input settings-input--small');
    trigger.dataset.fk = 'feature:ghostText:trigger';
    trigger.setAttribute('aria-label', 'Trigger');
    for (const [value, label] of [['auto', 'Automatic'], ['manual', 'Manual shortcut']] as const) {
      const o = el('option', '', label);
      o.value = value;
      trigger.append(o);
    }
    trigger.value = saved.trigger;
    trigger.addEventListener('change', () => {
      patch((entry) => { entry.trigger = trigger.value === 'manual' ? 'manual' : 'auto'; });
    });
    triggerRow.append(trigger);

    const panelId = nextId('ai-ghost-options');
    const toggle = button('ai-disclosure ai-ghost-options-toggle', 'Options', { html: ICONS.chevron, fk: 'feature:ghostText:options', ariaLabel: 'Inline suggestions options' });
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panelId);
    const panel = el('div', 'ai-advanced ai-ghost-options');
    panel.id = panelId;
    panel.hidden = true;
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    const group = ctx.makeGroup(delay, tokens, triggerRow);
    panel.append(group);

    let line: HTMLElement | null = null;
    let localOnly: HTMLInputElement | null = null;
    const syncVisible = (): void => {
      box.hidden = !enabled.checked;
      if (line) {line.hidden = !enabled.checked || !!localOnly?.checked;}
    };
    if (tier === 2) {
      const localRow = ctx.makeRow('Local engines only', 'Never sends suggestions to a cloud engine, even when one is set for this task.', 'inline');
      localOnly = switchInput(saved.localOnly, 'Local engines only', 'feature:ghostText:localOnly');
      const onlyLocal = localOnly;
      onlyLocal.addEventListener('change', () => {
        patch((entry) => { entry.localOnly = onlyLocal.checked; });
        syncVisible();
      });
      localRow.append(onlyLocal);
      group.append(localRow);

      line = privacyLine(() => openPage());
      // The fuller card is on the AI Engines page; a host without one has only the line.
      if (!canManage) {line.querySelector('button')?.remove();}
      rowText.append(line);
    }

    const box = el('div', 'settings-row ai-ghost-options-box');
    box.append(toggle, panel);
    enabled.addEventListener('change', syncVisible);
    syncVisible();
    return box;
  }

  /** "Advanced: task per feature", closed until opened; a feature can use another task's model. */
  function buildTaskDisclosure(taskRowsIn: HTMLElement[]): HTMLElement[] {
    const panelId = nextId('ai-feature-tasks');
    const toggle = button('ai-disclosure ai-feature-tasks-toggle', 'Advanced: task per feature', { html: ICONS.chevron, fk: 'features:advanced' });
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panelId);
    const panel = el('div', 'ai-advanced ai-feature-tasks');
    panel.id = panelId;
    panel.hidden = true;
    panel.append(el('div', 'settings-desc', 'Each feature uses its own task’s model (see Tasks on the AI Engines page). Pick another task to borrow its model.'), ctx.makeGroup(...taskRowsIn));
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    return [toggle, panel];
  }

  // ── Local networks ────────────────────────────────────────────────────────
  // A power-user list (tier 2 only): extra ranges and host-name suffixes that
  // count as local, so an engine there needs no Allow cloud. The host saves
  // it to user settings only; a repo cannot widen it.

  const localNetsRow = ctx.makeRow('Local networks', 'Networks and host names that count as local, so an engine there never needs Allow cloud.');
  localNetsRow.classList.add('ai-section');
  {
    const panelId = nextId('ai-local-networks');
    const toggle = button('ai-disclosure ai-local-networks-toggle', 'Advanced: local networks', { html: ICONS.chevron, fk: 'local-networks:advanced' });
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panelId);
    const panel = el('div', 'ai-advanced ai-local-networks');
    panel.id = panelId;
    panel.hidden = true;

    const area = el('textarea', 'settings-input ai-mono ai-overrides-text');
    area.rows = 4;
    area.spellcheck = false;
    area.dataset.fk = 'ai-local-networks';
    area.placeholder = '10.0.98.0/24\n.ts.net';
    area.value = session.draft.localNetworks.join('\n');
    area.setAttribute('aria-label', 'Local networks, one per line');
    const err = el('div', 'ai-field-error');
    err.id = nextId('ai-local-networks-error');
    err.setAttribute('aria-live', 'polite');
    area.setAttribute('aria-describedby', err.id);
    area.addEventListener('input', () => {
      const parsed = parseLocalNetworksText(area.value);
      if (!parsed.ok) {
        err.textContent = parsed.error;
        area.setAttribute('aria-invalid', 'true');
        return;
      }
      err.textContent = '';
      area.removeAttribute('aria-invalid');
      session.draft = { ...session.draft, localNetworks: parsed.value };
      if (canManage) {renderEngines();}
    });
    // Leaving the field shows what was kept: normalized, or the defaults when blank.
    area.addEventListener('blur', () => {
      if (area.getAttribute('aria-invalid') !== 'true') {area.value = session.draft.localNetworks.join('\n');}
    });
    panel.append(
      el('div', 'settings-desc', 'One per line. An IPv4 range such as 10.0.98.0/24 (a WireGuard network, say) or a host-name suffix such as .ts.net. Loopback, link-local, .local, .lan and .home.arpa always count. Leave it blank for the defaults (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Saved to your user settings only, never to a folder.'),
      area,
      err,
    );
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    localNetsRow.append(toggle, panel);
  }

  // ── Assemble ──────────────────────────────────────────────────────────────

  // Intro, master switch, Engines (with the default model), Allow cloud and
  // its consents, the toolbar button, AI Activity, Features (U8).
  rows.push(masterField.row);
  if (tier === 2) {
    if (canManage) {
      rows.push(enginesRow);
      renderEngines();
      if (opts.docsAvailable) {rows.push(basesRow);}
    }
    rows.push(cloudField.row);
    if (listConsents && forgetConsent) {
      rows.push(consentsRow);
      void refreshConsents();
    }
  }
  rows.push(toolbarField.row, activityField.row, featuresRow);
  if (tier === 2) {rows.push(localNetsRow);}
  rows.push(live);

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
