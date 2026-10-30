import * as vscode from 'vscode';
import { isRouteUsable, resolveRoute, type AiCompletionResult, type AiEngineStatus, type AiSettings } from '@mikedown/core/ai';

/**
 * The `AI: …` status bar item: who served the last request, mirroring the
 * sidebar footer chip. `$(home)` for a local engine, `$(cloud)` for a cloud
 * one. Shown while a MikeDown editor is active and AI is on; click opens the
 * AI tab of the Settings modal. When the AI settings change (a new default
 * engine, routing), it shows where the next request goes until one runs.
 */

/** Text and tooltip for a served result. Exported for unit testing. */
export function servedLabel(result: Pick<AiCompletionResult, 'served'>, settings?: AiSettings): { text: string; tooltip: string } {
  const { served } = result;
  const engine = settings?.engines.find((e) => e.id === served.engineId);
  const model = engine?.models.find((m) => m.id === served.modelId);
  const modelName = model?.label || served.modelId;
  const where = served.isLocal ? 'local' : 'cloud';
  return {
    text: `$(${served.isLocal ? 'home' : 'cloud'}) AI: ${where} · ${served.engineName} · ${modelName}`,
    tooltip: `Last AI request served by ${served.engineName} (${where}), model ${served.modelId}. Click for AI settings.`,
  };
}

/**
 * Text and tooltip for where the next request (a rewrite) goes, or null when
 * nothing can serve it. Exported for unit testing.
 */
export function routeLabel(settings: AiSettings, statuses: readonly AiEngineStatus[] = []): { text: string; tooltip: string; engineId: string; modelId: string } | null {
  const route = resolveRoute(settings, statuses, {}, { feature: 'rewrite' });
  if (!isRouteUsable(route)) {return null;}
  const engine = settings.engines.find((e) => e.id === route.engineId);
  const model = engine?.models.find((m) => m.id === route.modelId);
  const engineName = engine?.name || route.engineId;
  const where = route.isLocal ? 'local' : 'cloud';
  return {
    text: `$(${route.isLocal ? 'home' : 'cloud'}) AI: ${where} · ${engineName} · ${model?.label || route.modelId}`,
    tooltip: `Next AI request goes to ${engineName} (${where}), model ${route.modelId}. Click for AI settings.`,
    engineId: route.engineId,
    modelId: route.modelId,
  };
}

const IDLE_TEXT = '$(sparkle) AI';
const IDLE_TOOLTIP = 'MikeDown AI: no request yet. Click for AI settings.';

export class AiStatusBar {
  private readonly item: vscode.StatusBarItem;
  private enabled = false;
  private editorActive = false;
  /** The last request's result, so a settings change that keeps its route keeps the served label. */
  private lastServed: AiCompletionResult | undefined;

  constructor() {
    // Just right of the document stats (100 to 103).
    this.item = vscode.window.createStatusBarItem('mikedown.ai', vscode.StatusBarAlignment.Right, 99);
    this.item.name = 'MikeDown AI';
    this.item.command = 'mikedown.openAiSettings';
    this.item.text = IDLE_TEXT;
    this.item.tooltip = IDLE_TOOLTIP;
  }

  /** From the `mikedown.ai.enabled` setting. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.refresh();
  }

  /** A MikeDown editor became active (true) or none is (false). */
  setEditorActive(active: boolean): void {
    this.editorActive = active;
    this.refresh();
  }

  /** From `aiDone`. */
  showServed(result: AiCompletionResult, settings?: AiSettings): void {
    this.lastServed = result;
    const { text, tooltip } = servedLabel(result, settings);
    this.item.text = text;
    this.item.tooltip = tooltip;
    this.refresh();
  }

  /**
   * The AI settings changed (Engines page save, routing, a new default): show
   * where the next request goes. The last served label stays when it is
   * still the route (names refreshed); with no usable route, the idle badge.
   */
  showRoute(settings: AiSettings, statuses: readonly AiEngineStatus[] = []): void {
    const next = routeLabel(settings, statuses);
    const served = this.lastServed?.served;
    if (next && served && served.engineId === next.engineId && served.modelId === next.modelId) {
      const { text, tooltip } = servedLabel(this.lastServed!, settings);
      this.item.text = text;
      this.item.tooltip = tooltip;
    } else if (next) {
      this.item.text = next.text;
      this.item.tooltip = next.tooltip;
    } else {
      this.item.text = IDLE_TEXT;
      this.item.tooltip = IDLE_TOOLTIP;
    }
    this.refresh();
  }

  private refresh(): void {
    if (this.enabled && this.editorActive) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
