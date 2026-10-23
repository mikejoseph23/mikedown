/**
 * Print / PDF through a `print-N` window (see `src-tauri/src/commands/print.rs`
 * and `printPage.ts`). First attempt is hidden; the print page reports
 * `printing` once `window.print()` has been called. If that never arrives
 * (a webview that refuses to print from a hidden window) or the page reports
 * a failure, the hidden window is closed and the document opens in a visible
 * print preview with its own Print button.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface PrintResult {
  label: string;
  state: 'printing' | 'failed' | 'closed' | 'preview';
  error: string | null;
}

export interface PrintApi {
  open(html: string, title: string, preview: boolean): Promise<string>;
  close(label: string): Promise<void>;
  onResult(handler: (r: PrintResult) => void): Promise<() => void>;
}

export const printApi: PrintApi = {
  open: (html, title, preview) => invoke<string>('print_open', { html, title, preview }),
  close: (label) => invoke<void>('print_close', { label }),
  onResult: (handler) => listen<PrintResult>('mikedown:print-result', (e) => handler(e.payload)),
};

/** How long a hidden window gets to start printing before the preview opens. */
export const HIDDEN_TIMEOUT_MS = 8000;

export type PrintOutcome = 'printing' | 'preview';

/** Hidden first, visible preview as the fallback. */
export async function printHtml(
  html: string,
  title: string,
  api: PrintApi = printApi,
  timeoutMs = HIDDEN_TIMEOUT_MS,
): Promise<PrintOutcome> {
  // Results can arrive before `open` returns its label, so keep them by label.
  const seen = new Map<string, PrintResult>();
  const waiters = new Map<string, (r: PrintResult) => void>();
  const unlisten = await api.onResult((r) => {
    if (r.state !== 'printing' && r.state !== 'failed') {return;}
    seen.set(r.label, r);
    waiters.get(r.label)?.(r);
  });
  try {
    const label = await api.open(html, title, false);
    const hidden = await new Promise<PrintResult | null>((resolve) => {
      const early = seen.get(label);
      if (early) {resolve(early); return;}
      const timer = setTimeout(() => resolve(null), timeoutMs);
      waiters.set(label, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
    });
    if (hidden?.state === 'printing') {return 'printing';}
    await api.close(label);
    await api.open(html, title, true);
    return 'preview';
  } finally {
    unlisten();
  }
}
