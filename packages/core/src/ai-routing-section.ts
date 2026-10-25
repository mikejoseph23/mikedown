/**
 * Routing (M3, moved onto the AI Engines page in M3c): the default model,
 * the fallback mode and one route per task. Built from the Settings modal's
 * own rows (`MikeDownSettingsSectionContext`) so it sits flush with them.
 *
 * Reads and writes the draft only through `RoutingDeps`; the host of the
 * section re-renders whatever else depends on the routes.
 *
 * Modal UI only: nothing here touches the editor document or its DOM.
 */

import { AI_FALLBACK_MODES, AI_TASKS } from './ai';
import type { AiEngineStatus, AiFallbackMode, AiRoute, AiSettings } from './ai';
import {
  DEFAULT_ROUTE_REQUIREMENTS,
  parseRouteKey,
  routeKey,
  routeLabel,
  routePairs,
  taskRequirements,
  taskRouteNote,
  unknownRoutedTasks,
} from './ai-settings-model';
import type { RouteRequirements } from './ai-settings-model';
import { el, keepFocus, note } from './ai-settings-dom';
import type { MikeDownSettingsSectionContext } from './types';

export interface RoutingDeps {
  getDraft(): AiSettings;
  /** The routes changed; `defaultChanged` when the default model did. */
  setDraft(next: AiSettings, change: { defaultChanged: boolean }): void;
  statusList(): AiEngineStatus[];
}

export interface RoutingSection {
  element: HTMLElement;
  /** Rebuild from the draft, keeping focus. */
  render(): void;
}

export const FALLBACK_LABELS: Record<AiFallbackMode, string> = {
  none: 'Nothing (the feature is unavailable)',
  default: 'Use the default model',
  anyLocal: 'Default, then any local model',
  any: 'Default, any local, then cloud',
};

export function createRoutingSection(ctx: MikeDownSettingsSectionContext, deps: RoutingDeps): RoutingSection {
  const body = el('div', 'ai-routing');

  function buildRouteSelect(current: AiRoute | null | undefined, req: RouteRequirements, o: { fk: string; ariaLabel: string; defaultText?: string }): HTMLSelectElement {
    const draft = deps.getDraft();
    const select = el('select', 'settings-input ai-route-select');
    select.dataset.fk = o.fk;
    select.setAttribute('aria-label', o.ariaLabel);
    const pairs = routePairs(draft, deps.statusList(), req);
    const first = el('option', '', o.defaultText ?? (pairs.some((p) => p.selectable) ? 'Choose a model…' : draft.engines.length === 0 ? 'Add an engine first' : 'No model can serve this'));
    first.value = '';
    select.append(first);

    const currentKey = routeKey(current);
    if (current && !pairs.some((p) => routeKey(p) === currentKey)) {
      const gone = el('option', '', `${routeLabel(draft, current)} (not found)`);
      gone.value = currentKey;
      select.append(gone);
    }
    const byEngine = new Map<string, typeof pairs>();
    for (const p of pairs) {
      const list = byEngine.get(p.engineId) ?? [];
      list.push(p);
      byEngine.set(p.engineId, list);
    }
    for (const list of byEngine.values()) {
      const group = el('optgroup');
      group.label = `${list[0].engineName} (${list[0].isLocal ? 'local' : 'cloud'})`;
      for (const p of list) {
        // The engine repeats in the text because a closed select shows only the option.
        const o2 = el('option', '', `${p.engineName} · ${p.modelName}${p.note ? ` (${p.note})` : ''}`);
        o2.value = routeKey(p);
        o2.disabled = !p.selectable && routeKey(p) !== currentKey;
        group.append(o2);
      }
      select.append(group);
    }
    select.value = currentKey;
    if (select.value !== currentKey) {select.value = '';}
    return select;
  }

  function render(): void {
    keepFocus(body, () => {
      body.replaceChildren();
      const draft = deps.getDraft();

      // Default route and fallback.
      const defRow = ctx.makeRow('Default model', 'Serves every task without its own route. Needs chat.', 'inline');
      const defSelect = buildRouteSelect(draft.routing.default, DEFAULT_ROUTE_REQUIREMENTS, { fk: 'route:default', ariaLabel: 'Default model' });
      defSelect.addEventListener('change', () => {
        const d = deps.getDraft();
        deps.setDraft({ ...d, routing: { ...d.routing, default: parseRouteKey(defSelect.value) } }, { defaultChanged: true });
        render();
      });
      defRow.append(defSelect);
      const defNote = taskRouteNote({ ...draft, routing: { ...draft.routing, tasks: {} } }, deps.statusList(), 'chat');
      if (draft.routing.default && defNote) {defRow.append(note(defNote.level, defNote.text, 'ai-row-note'));}

      const fbField = ctx.makeSelectRow<AiFallbackMode>(
        'When a route is unavailable',
        'What to try when a task’s model is off, unreachable or lacks what the task needs. Fallback never moves a local route to a cloud engine unless you pick the last option.',
        draft.routing.fallback,
        AI_FALLBACK_MODES.map((m) => ({ value: m, label: FALLBACK_LABELS[m] })),
      );
      fbField.select.dataset.fk = 'route:fallback';
      fbField.select.addEventListener('change', () => {
        const d = deps.getDraft();
        deps.setDraft({ ...d, routing: { ...d.routing, fallback: fbField.select.value as AiFallbackMode } }, { defaultChanged: false });
        render();
      });
      const top = ctx.makeGroup(defRow, fbField.row);

      // One row per task, plus tasks a newer version saved.
      const defaultText = draft.routing.default ? `Default: ${routeLabel(draft, draft.routing.default)}` : 'Default (none set)';
      const taskRows: HTMLElement[] = [];
      const taskRow = (taskId: string, label: string, description: string, req: RouteRequirements, hostOnly: boolean) => {
        const row = ctx.makeRow(label, description, 'inline');
        row.classList.add('ai-task-row');
        if (hostOnly) {
          row.append(el('span', 'ai-muted', 'Handled by the app'));
          taskRows.push(row);
          return;
        }
        const select = buildRouteSelect(draft.routing.tasks[taskId], req, { fk: `route:task:${taskId}`, ariaLabel: `Model for ${label}`, defaultText });
        select.addEventListener('change', () => {
          const d = deps.getDraft();
          const tasks = { ...d.routing.tasks };
          const route = parseRouteKey(select.value);
          // Spread the saved route so keys a newer version added survive.
          if (route) {tasks[taskId] = { ...(tasks[taskId] ?? {}), ...route };} else {delete tasks[taskId];}
          deps.setDraft({ ...d, routing: { ...d.routing, tasks } }, { defaultChanged: false });
          render();
        });
        row.append(select);
        const n = taskRouteNote(draft, deps.statusList(), taskId);
        if (n) {row.append(note(n.level, n.text, 'ai-row-note'));}
        taskRows.push(row);
      };
      for (const task of AI_TASKS) {
        taskRow(task.id, task.label, task.description, taskRequirements(task.id), task.hostMethod === 'transcribe');
      }
      for (const taskId of unknownRoutedTasks(draft)) {
        taskRow(taskId, taskId, 'Saved by a newer version of MikeDown. Kept as is.', { requires: {} }, false);
      }
      const tasksHead = el('div', 'ai-subhead', 'Tasks');
      body.append(top, tasksHead, ctx.makeGroup(...taskRows));
    });
  }

  return { element: body, render };
}
