/** Inline suggestions on the AI tab: the options under the switch, the privacy line, and what Save sends. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { parseAiSettings } from '../src/ai';
import type { AiSettings, MikeDownAiHost } from '../src/ai';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

function settings(ghost: Record<string, unknown> = {}): AiSettings {
  return parseAiSettings({
    enabled: true,
    engines: [{ id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }] }],
    routing: { default: { engineId: 'omlx', modelId: 'm' }, fallback: 'anyLocal', tasks: {} },
    features: { ghostText: ghost },
  }, { onWarning: () => {} });
}

const tier2 = (): MikeDownAiHost => ({
  complete: vi.fn(),
  listEngines: vi.fn(async () => []),
  testEngine: vi.fn(),
  discoverModels: vi.fn(),
  setSecret: vi.fn(async () => {}),
}) as unknown as MikeDownAiHost;

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function open(host: MikeDownHost, ai?: AiSettings): MikeDownEditorHandle {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, features: { sidebar: true }, settings: ai ? { ai } : undefined });
  mounted.push({ handle, el });
  handle.command('openAiSettings');
  return handle;
}

const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
const field = <T extends HTMLElement>(key: string) => q<T>(`[data-fk="feature:ghostText:${key}"]`)!;
const box = () => q<HTMLElement>('.ai-ghost-options-box')!;
const line = () => document.querySelector<HTMLElement>('.settings-panel--ai .ai-feature .ai-privacy-line');

function change(input: HTMLInputElement | HTMLSelectElement, value?: string): void {
  if (value !== undefined) {input.value = value;}
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function flip(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  change(input);
}

function save(): void {
  Array.from(document.querySelectorAll<HTMLElement>('.settings-btn--primary')).find((n) => n.textContent?.trim() === 'Save to Settings')!.click();
}

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('#mikedown-settings-overlay, #mikedown-ai-page-overlay').forEach((n) => n.remove());
});

describe('Inline suggestions options', () => {
  class Host extends NoopHost { ai = tier2(); saveSettings = vi.fn(); }

  it('are hidden while the feature is off and fold under its row once it is on', () => {
    open(new Host(), settings());
    expect(box().hidden).toBe(true);
    flip(field<HTMLInputElement>('enabled'), true);
    expect(box().hidden).toBe(false);

    const toggle = field<HTMLButtonElement>('options');
    const panel = q<HTMLElement>('.ai-ghost-options')!;
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('show the saved values, or the defaults, and the ranges', () => {
    open(new Host(), settings({ enabled: true, delayMs: 900, maxTokens: 64, trigger: 'manual', localOnly: false }));
    expect(field<HTMLInputElement>('delayMs').value).toBe('900');
    expect(field<HTMLInputElement>('maxTokens').value).toBe('64');
    expect(field<HTMLSelectElement>('trigger').value).toBe('manual');
    expect(field<HTMLInputElement>('localOnly').checked).toBe(false);
    expect([field<HTMLInputElement>('delayMs').min, field<HTMLInputElement>('delayMs').max]).toEqual(['100', '5000']);
    expect([field<HTMLInputElement>('maxTokens').min, field<HTMLInputElement>('maxTokens').max]).toEqual(['8', '256']);
    mounted.pop()!.handle.destroy();
    document.querySelectorAll('#mikedown-settings-overlay').forEach((n) => n.remove());

    open(new Host(), settings({ enabled: true }));
    expect(field<HTMLInputElement>('delayMs').value).toBe('400');
    expect(field<HTMLInputElement>('maxTokens').value).toBe('48');
    expect(field<HTMLSelectElement>('trigger').value).toBe('auto');
    expect(field<HTMLInputElement>('localOnly').checked).toBe(true);
  });

  it('save into features.ghostText beside the switch, and clamp what is typed', () => {
    const host = new Host();
    open(host, settings({ enabled: true, task: 'chat' }));
    change(field<HTMLInputElement>('delayMs'), '99999');
    expect(field<HTMLInputElement>('delayMs').value).toBe('5000');
    change(field<HTMLInputElement>('maxTokens'), '2');
    expect(field<HTMLInputElement>('maxTokens').value).toBe('8');
    change(field<HTMLSelectElement>('trigger'), 'manual');
    flip(field<HTMLInputElement>('localOnly'), false);
    save();
    const features = (host.saveSettings.mock.calls[0][0] as Record<string, any>)['ai.features'];
    expect(features.ghostText).toEqual({ enabled: true, task: 'chat', delayMs: 5000, maxTokens: 8, trigger: 'manual', localOnly: false });
  });

  it('a blank number goes back to the default and saves no key', () => {
    const host = new Host();
    open(host, settings({ enabled: true, delayMs: 900 }));
    change(field<HTMLInputElement>('delayMs'), '');
    expect(field<HTMLInputElement>('delayMs').value).toBe('400');
    save();
    expect((host.saveSettings.mock.calls[0][0] as Record<string, any>)['ai.features'].ghostText).toEqual({ enabled: true });
  });

  it('turning the feature off keeps the knobs', () => {
    const host = new Host();
    open(host, settings({ enabled: true, delayMs: 900 }));
    flip(field<HTMLInputElement>('enabled'), false);
    save();
    expect((host.saveSettings.mock.calls[0][0] as Record<string, any>)['ai.features'].ghostText).toEqual({ enabled: false, delayMs: 900 });
  });

  it('the privacy line shows only with the feature on and Local engines only off', () => {
    open(new Host(), settings({ enabled: true }));
    expect(line()!.hidden).toBe(true);
    flip(field<HTMLInputElement>('localOnly'), false);
    expect(line()!.hidden).toBe(false);
    expect(line()!.textContent).toContain('A cloud engine sends text to the provider.');
    flip(field<HTMLInputElement>('enabled'), false);
    expect(line()!.hidden).toBe(true);
  });

  it('the row carries the description that says what is sent', () => {
    open(new Host(), settings());
    expect(document.querySelector('.settings-panel--ai')!.textContent).toContain('Dim continuation text while you write. Sends the text around the cursor as you pause.');
  });

  it('a tier-1 host gets the timing knobs but no Local engines only, since it routes by itself', () => {
    class Tier1 extends NoopHost { ai = { complete: vi.fn() } as unknown as MikeDownAiHost; }
    open(new Tier1(), settings({ enabled: true }));
    expect(field<HTMLInputElement>('delayMs')).not.toBeNull();
    expect(q('[data-fk="feature:ghostText:localOnly"]')).toBeNull();
    expect(line()).toBeNull();
  });
});
