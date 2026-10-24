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

export type UpdateState = 'idle' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'failed';

export type UpdateChannel = 'direct' | 'store';

export interface UpdateProgress {
  downloaded: number;
  /** Null when the server sent no Content-Length. */
  total: number | null;
}

/** `mikedown:update-state`: the host's phase, emitted to every window. */
export interface UpdateStateEvent {
  state: UpdateState;
  version: string | null;
  error: string | null;
}

export interface UpdaterStatus {
  phase: UpdateState;
  /** The pending update's version, if any. */
  version: string | null;
  channel: UpdateChannel;
  /** Unix ms of the last completed check. */
  lastCheckedAt: number | null;
  /** `upToDate`, `available`, `suppressed` or `error`. */
  lastResult: string | null;
  skippedVersion: string | null;
  /** Unix ms; silent checks stay quiet until then. */
  snoozeUntil: number | null;
}

export const UPDATE_AVAILABLE_EVENT = 'mikedown:update-available';
export const UPDATE_PROGRESS_EVENT = 'mikedown:update-progress';
export const UPDATE_STATE_EVENT = 'mikedown:update-state';

export interface UpdaterApi {
  /** True when this window should run the periodic check now (one per interval, app-wide). */
  claim(intervalMs: number): Promise<boolean>;
  /** Null when up to date (or the update is skipped/snoozed on a silent check); throws when the check failed. */
  check(manual: boolean): Promise<UpdateInfo | null>;
  /** The update a check found earlier in this session, if any. */
  pending(): Promise<UpdateInfo | null>;
  /** Download and verify the pending update without installing it. */
  download(): Promise<void>;
  /** Download if needed, verify the OS signature, ask every window to close, install, restart. */
  install(): Promise<void>;
  /** Skip This Version: silent checks never announce it again. */
  skip(version: string): Promise<void>;
  /** Remind Me Later: silent checks stay quiet for `days` (host default 14). */
  snooze(days?: number): Promise<void>;
  status(): Promise<UpdaterStatus>;
  log(line: string): Promise<void>;
  onAvailable(handler: (info: UpdateInfo) => void): Promise<UnlistenFn>;
  onProgress(handler: (p: UpdateProgress) => void): Promise<UnlistenFn>;
  onState(handler: (e: UpdateStateEvent) => void): Promise<UnlistenFn>;
}

export const updaterApi: UpdaterApi = {
  claim: (intervalMs) => invoke<boolean>('updater_claim', { intervalMs }),
  check: (manual) => invoke<UpdateInfo | null>('updater_check', { manual }),
  pending: () => invoke<UpdateInfo | null>('updater_pending'),
  download: () => invoke<void>('updater_download'),
  install: () => invoke<void>('updater_install'),
  skip: (version) => invoke<void>('updater_skip', { version }),
  snooze: (days) => invoke<void>('updater_snooze', { days: days ?? null }),
  status: () => invoke<UpdaterStatus>('updater_status'),
  log: (line) => invoke<void>('updater_log', { line }),
  onAvailable: (handler) => listen<UpdateInfo>(UPDATE_AVAILABLE_EVENT, (e) => handler(e.payload)),
  onProgress: (handler) => listen<UpdateProgress>(UPDATE_PROGRESS_EVENT, (e) => handler(e.payload)),
  onState: (handler) => listen<UpdateStateEvent>(UPDATE_STATE_EVENT, (e) => handler(e.payload)),
};
