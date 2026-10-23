/**
 * Tauri IPC mock for unit tests. Wraps `@tauri-apps/api/mocks` so every
 * `invoke` (the app's own commands and the plugins' `plugin:*|*` ones) is
 * recorded with its arguments and request headers, and answered by `handler`.
 * Raw byte payloads (write_bytes) are recorded as plain arrays so snapshots
 * stay readable.
 */
import { clearMocks, mockConvertFileSrc, mockIPC, mockWindows } from '@tauri-apps/api/mocks';

export interface IpcCall {
  cmd: string;
  args: unknown;
  headers?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IpcHandler = (cmd: string, args: any) => unknown;

interface Internals {
  invoke(cmd: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown>;
}

function plain(args: unknown): unknown {
  if (args instanceof Uint8Array) {return { bytes: Array.from(args) };}
  if (args instanceof ArrayBuffer) {return { bytes: Array.from(new Uint8Array(args)) };}
  return args === undefined ? undefined : JSON.parse(JSON.stringify(args));
}

/** Install the mock; returns the live call log. */
export function installIpc(handler: IpcHandler, os: 'macos' | 'windows' = 'macos'): IpcCall[] {
  const calls: IpcCall[] = [];
  mockWindows('main');
  mockConvertFileSrc(os);
  mockIPC((cmd, args) => handler(cmd, args));
  const internals = (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;
  const inner = internals.invoke.bind(internals);
  internals.invoke = (cmd, args, options) => {
    const call: IpcCall = { cmd, args: plain(args) };
    if (options?.headers) {call.headers = { ...options.headers };}
    calls.push(call);
    return inner(cmd, args, options);
  };
  return calls;
}

export function uninstallIpc(): void {
  clearMocks();
}

/**
 * Answer for `plugin:dialog|message`: the label of the button the user
 * "clicked". `ask` in plugin-dialog resolves true when this equals its okLabel.
 */
export function buttonLabel(args: { buttons?: unknown }, which: 'ok' | 'cancel'): string {
  const b = args.buttons as { OkCancelCustom?: [string, string] } | undefined;
  if (b && Array.isArray(b.OkCancelCustom)) {return which === 'ok' ? b.OkCancelCustom[0] : b.OkCancelCustom[1];}
  return which === 'ok' ? 'Ok' : 'Cancel';
}
