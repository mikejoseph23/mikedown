/**
 * Typed wrapper over the settings commands (`src-tauri/src/commands/settings.rs`)
 * and the cross-window change event. The manager takes this interface, so
 * tests swap in a fake.
 */
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

export type SettingsScope = 'global' | 'folder';

export interface SettingsFileInfo {
  /** Absolute path, present even when the file does not exist yet. */
  path: string;
  /** Null when the file does not exist. */
  text: string | null;
}

/** Payload of `mikedown:settings-changed`. */
export interface SettingsChangedEvent {
  /** Window label that wrote, so it can skip its own echo. */
  from: string;
  scope: SettingsScope;
  folder: string | null;
}

export const SETTINGS_CHANGED_EVENT = 'mikedown:settings-changed';

export interface SettingsApi {
  read(scope: SettingsScope, folder?: string | null): Promise<SettingsFileInfo>;
  /** Validates JSON object text, creates `.mikedown/` for the folder scope, writes atomically. */
  write(scope: SettingsScope, folder: string | null, text: string): Promise<SettingsFileInfo>;
  emitChanged(event: SettingsChangedEvent): Promise<void>;
  onChanged(handler: (event: SettingsChangedEvent) => void): Promise<UnlistenFn>;
  /** Windows opens Settings > Default apps and returns true; elsewhere false. */
  openDefaultAppsSettings(): Promise<boolean>;
}

export const settingsApi: SettingsApi = {
  read: (scope, folder) => invoke<SettingsFileInfo>('settings_read', { scope, folder: folder ?? null }),
  write: (scope, folder, text) => invoke<SettingsFileInfo>('settings_write', { scope, folder, text }),
  emitChanged: (event) => emit(SETTINGS_CHANGED_EVENT, event),
  onChanged: (handler) => listen<SettingsChangedEvent>(SETTINGS_CHANGED_EVENT, (e) => handler(e.payload)),
  openDefaultAppsSettings: () => invoke<boolean>('open_default_apps_settings'),
};
