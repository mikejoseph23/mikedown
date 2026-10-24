/**
 * Typed wrapper over the updater commands (`src-tauri/src/commands/updater.rs`).
 * The controller in `updater.ts` takes this interface, so tests swap in a fake.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export const UPDATE_AVAILABLE_EVENT = 'mikedown:update-available';

export interface UpdaterApi {
  /** True when this window should run the periodic check now (one per interval, app-wide). */
  claim(intervalMs: number): Promise<boolean>;
  /** Null when up to date; throws when the check failed (offline, bad signature, bad manifest). */
  check(manual: boolean): Promise<UpdateInfo | null>;
  /** The update a check found earlier in this session, if any. */
  pending(): Promise<UpdateInfo | null>;
  /** Download, verify, ask every window to close, install, restart. */
  install(): Promise<void>;
  log(line: string): Promise<void>;
  onAvailable(handler: (info: UpdateInfo) => void): Promise<UnlistenFn>;
}

export const updaterApi: UpdaterApi = {
  claim: (intervalMs) => invoke<boolean>('updater_claim', { intervalMs }),
  check: (manual) => invoke<UpdateInfo | null>('updater_check', { manual }),
  pending: () => invoke<UpdateInfo | null>('updater_pending'),
  install: () => invoke<void>('updater_install'),
  log: (line) => invoke<void>('updater_log', { line }),
  onAvailable: (handler) => listen<UpdateInfo>(UPDATE_AVAILABLE_EVENT, (e) => handler(e.payload)),
};
