import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { getSettings } from '../../src/settings';
import { bootWebview, type Harness } from '../harness/webviewHarness';

// ── Host: src/settings.ts reader ────────────────────────────────────────────

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
  ConfigurationTarget: {
    Global: 1,
  },
}));

function mockConfig(values: Record<string, unknown>): void {
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: (key: string, defaultValue: unknown) =>
      key in values ? values[key] : defaultValue,
  } as any);
}

describe('getSettings().slashCommands', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to enabled, iso, local when unconfigured', () => {
    mockConfig({});
    expect(getSettings().slashCommands).toEqual({
      enabled: true,
      dateFormat: 'iso',
      timeZone: 'local',
    });
  });

  it('reads configured values through', () => {
    mockConfig({
      'slashCommands.enabled': false,
      'slashCommands.dateFormat': 'long',
      'slashCommands.timeZone': 'America/New_York',
    });
    expect(getSettings().slashCommands).toEqual({
      enabled: false,
      dateFormat: 'long',
      timeZone: 'America/New_York',
    });
  });

  it('falls back to iso for an unknown dateFormat value', () => {
    mockConfig({ 'slashCommands.dateFormat': 'bogus' });
    expect(getSettings().slashCommands.dateFormat).toBe('iso');
  });

  it('falls back to local for an empty or whitespace-only timeZone', () => {
    mockConfig({ 'slashCommands.timeZone': '   ' });
    expect(getSettings().slashCommands.timeZone).toBe('local');
    mockConfig({ 'slashCommands.timeZone': '' });
    expect(getSettings().slashCommands.timeZone).toBe('local');
  });
});

// ── Webview: placeholder + settings modal (M5) ──────────────────────────────

let harness: Harness | null = null;
const settle = () => new Promise(r => setTimeout(r, 30));

async function boot(content = ''): Promise<Harness> {
  harness = await bootWebview();
  harness.send({ type: 'update', content });
  await settle();
  harness.clear();
  return harness;
}

function placeholderText(): string | null {
  return document
    .getElementById('editor-container')
    ?.querySelector('[data-placeholder]')
    ?.getAttribute('data-placeholder') ?? null;
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe('slash-command placeholder (webview)', () => {
  it('shows "Type / for commands…" by default on an empty document', async () => {
    await boot('');
    expect(placeholderText()).toBe('Type / for commands…');
  });

  it('switches to "Start writing…" live when the settings broadcast disables the menu, and back', async () => {
    const h = await boot('');
    expect(placeholderText()).toBe('Type / for commands…');

    h.send({ type: 'settings', slashCommandsEnabled: false, slashCommandsDateFormat: 'iso', slashCommandsTimeZone: 'local' });
    await settle();
    expect(placeholderText()).toBe('Start writing…');

    h.send({ type: 'settings', slashCommandsEnabled: true, slashCommandsDateFormat: 'iso', slashCommandsTimeZone: 'local' });
    await settle();
    expect(placeholderText()).toBe('Type / for commands…');
  });
});

describe('slash-command settings modal (webview)', () => {
  function openModal(): void {
    (document.querySelector('[data-action="settings"]') as HTMLButtonElement).click();
  }

  function saveButton(): HTMLButtonElement {
    const overlay = document.getElementById('mikedown-settings-overlay')!;
    return Array.from(overlay.querySelectorAll('button')).find(
      b => b.textContent === 'Save to Settings'
    ) as HTMLButtonElement;
  }

  it('reflects the current settings and greys out date format / time zone when the menu is off', async () => {
    await boot('');
    // Start from a known "disabled" broadcast so the modal opens reflecting it.
    harness!.send({ type: 'settings', slashCommandsEnabled: false, slashCommandsDateFormat: 'long', slashCommandsTimeZone: 'UTC' });
    await settle();

    openModal();
    const enabledInput = document.getElementById('mikedown-slashcommands-enabled') as HTMLInputElement;
    const dateFormatSelect = document.getElementById('mikedown-slashcommands-dateformat') as HTMLSelectElement;
    const timeZoneInput = document.getElementById('mikedown-slashcommands-timezone') as HTMLInputElement;

    expect(enabledInput.checked).toBe(false);
    expect(dateFormatSelect.value).toBe('long');
    expect(timeZoneInput.value).toBe('UTC');
    expect(dateFormatSelect.disabled).toBe(true);
    expect(timeZoneInput.disabled).toBe(true);

    // Re-checking the box live re-enables the dependent controls.
    enabledInput.checked = true;
    enabledInput.dispatchEvent(new Event('change'));
    expect(dateFormatSelect.disabled).toBe(false);
    expect(timeZoneInput.disabled).toBe(false);
  });

  it('saves all three fields on Save to Settings', async () => {
    const h = await boot('');
    openModal();
    const enabledInput = document.getElementById('mikedown-slashcommands-enabled') as HTMLInputElement;
    const dateFormatSelect = document.getElementById('mikedown-slashcommands-dateformat') as HTMLSelectElement;
    const timeZoneInput = document.getElementById('mikedown-slashcommands-timezone') as HTMLInputElement;

    enabledInput.checked = true;
    enabledInput.dispatchEvent(new Event('change'));
    dateFormatSelect.value = 'long';
    timeZoneInput.value = 'Asia/Tokyo';

    saveButton().click();

    const saved = h.last('saveSettings');
    expect(saved?.settings.slashCommandsEnabled).toBe(true);
    expect(saved?.settings.slashCommandsDateFormat).toBe('long');
    expect(saved?.settings.slashCommandsTimeZone).toBe('Asia/Tokyo');
  });

  it('falls back to "local" when the time zone field is saved blank', async () => {
    const h = await boot('');
    openModal();
    const timeZoneInput = document.getElementById('mikedown-slashcommands-timezone') as HTMLInputElement;
    timeZoneInput.value = '   ';

    saveButton().click();

    expect(h.last('saveSettings')?.settings.slashCommandsTimeZone).toBe('local');
  });

  it('opens directly on the Behavior tab via the openSettings command', async () => {
    await boot('');
    harness!.send({ type: 'command', command: 'openSettings', tab: 'behavior' });
    await settle();

    const behaviorTabButton = document.querySelector('[data-tab-id="behavior"]') as HTMLButtonElement;
    expect(behaviorTabButton.getAttribute('aria-selected')).toBe('true');
    const panel = document.getElementById('mikedown-slashcommands-enabled')!.closest('[role="tabpanel"]') as HTMLElement;
    expect(panel.style.display).not.toBe('none');
  });
});
