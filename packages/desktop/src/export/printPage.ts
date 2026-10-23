/**
 * The print window's page (M9). Rust holds the finished HTML (`print_take`);
 * this page writes it into itself, waits for images and fonts, then:
 *
 *   - hidden mode: calls `window.print()` (the OS dialog, with Save as PDF),
 *     reports `printing`, and closes itself after `afterprint`;
 *   - preview mode (the fallback when hidden printing never starts): shows
 *     the document with a Print / Close bar that does not print.
 *
 * Failures are reported to the opener, which decides on the fallback.
 */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface Payload {
  html: string;
  preview: boolean;
}

const label = getCurrentWindow().label;
const report = (state: string, error?: string): Promise<void> =>
  invoke<void>('print_report', { state, error: error ?? null }).catch(() => undefined);
const close = (): Promise<void> => invoke<void>('print_close', { label }).catch(() => undefined);

async function settle(): Promise<void> {
  const imgs = Array.from(document.images).filter((i) => !i.complete);
  await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));
  await document.fonts?.ready;
  // One frame so layout reflects the loaded fonts and images.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

function addPreviewBar(): void {
  const style = document.createElement('style');
  style.textContent = `
    .mdprint-bar { position: sticky; top: 0; z-index: 10; display: flex; gap: 8px; justify-content: flex-end; padding: 8px 12px; background: #f3f3f5; border-bottom: 1px solid #d0d0d5; font: 13px system-ui, sans-serif; }
    .mdprint-bar button { font: inherit; padding: 4px 14px; }
    @media print { .mdprint-bar { display: none !important; } }`;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.className = 'mdprint-bar';
  const print = document.createElement('button');
  print.textContent = 'Print…';
  print.addEventListener('click', () => window.print());
  const done = document.createElement('button');
  done.textContent = 'Close';
  done.addEventListener('click', () => { void close(); });
  bar.append(print, done);
  document.body.prepend(bar);
}

async function main(): Promise<void> {
  const job = await invoke<Payload | null>('print_take');
  if (!job) {
    await report('failed', 'No document to print.');
    await close();
    return;
  }
  document.open();
  document.write(job.html);
  document.close();
  await settle();
  if (job.preview) {
    addPreviewBar();
    await report('preview');
    return;
  }
  window.addEventListener('afterprint', () => { void report('closed').then(close); });
  try {
    window.print();
    await report('printing');
  } catch (err) {
    await report('failed', String(err));
  }
}

void main().catch((err: unknown) => report('failed', String(err)));
