import * as vscode from 'vscode';
import type { AiCompletionResult, AiSettings } from '@mikedown/core/ai';

/**
 * The `AI: …` status bar item: who served the last request, mirroring the
 * sidebar footer chip. `$(home)` for a local engine, `$(cloud)` for a cloud
 * one. Shown while a MikeDown editor is active and AI is on; click opens the
 * AI tab of the Settings modal.
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

export class AiStatusBar {
  private readonly item: vscode.StatusBarItem;
  private enabled = false;
  private editorActive = false;

  constructor() {
    // Just right of the document stats (100 to 103).
    this.item = vscode.window.createStatusBarItem('mikedown.ai', vscode.StatusBarAlignment.Right, 99);
    this.item.name = 'MikeDown AI';
    this.item.command = 'mikedown.openAiSettings';
    this.item.text = '$(sparkle) AI';
    this.item.tooltip = 'MikeDown AI: no request yet. Click for AI settings.';
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
    const { text, tooltip } = servedLabel(result, settings);
    this.item.text = text;
    this.item.tooltip = tooltip;
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
