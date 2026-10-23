/**
 * Dialogs and toasts. Native where the OS has one (ask, message, open, save,
 * through the dialog plugin); in-page for the text prompt and the transient
 * toast, which the webview has no native form of (`window.prompt` is not
 * implemented by WKWebView/WebView2 under Tauri).
 */
import { ask as tauriAsk, message as tauriMessage, open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog';

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Dialogs {
  /** Two-button question. Resolves true for the OK button. */
  ask(message: string, opts: { title?: string; okLabel: string; cancelLabel?: string; kind?: 'info' | 'warning' | 'error' }): Promise<boolean>;
  error(message: string, title?: string): Promise<void>;
  info(message: string, title?: string): Promise<void>;
  /** In-page single-line text prompt. Resolves undefined when cancelled. */
  prompt(message: string, opts?: { placeholder?: string; value?: string; okLabel?: string }): Promise<string | undefined>;
  toast(message: string, opts?: { error?: boolean; ms?: number }): void;
  saveFile(opts: { defaultPath?: string; filters?: FileFilter[]; title?: string }): Promise<string | null>;
  openFile(opts: { defaultPath?: string; filters?: FileFilter[]; title?: string }): Promise<string | null>;
}

const APP_TITLE = 'MikeDown';

export const MARKDOWN_FILTERS: FileFilter[] = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] },
];

export const IMAGE_FILTERS: FileFilter[] = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] },
];

export function createDialogs(root: HTMLElement = document.body): Dialogs {
  return {
    ask: (message, opts) =>
      tauriAsk(message, {
        title: opts.title ?? APP_TITLE,
        kind: opts.kind ?? 'warning',
        okLabel: opts.okLabel,
        cancelLabel: opts.cancelLabel ?? 'Cancel',
      }),
    error: async (message, title) => {
      await tauriMessage(message, { title: title ?? APP_TITLE, kind: 'error' });
    },
    info: async (message, title) => {
      await tauriMessage(message, { title: title ?? APP_TITLE, kind: 'info' });
    },
    prompt: (message, opts) => inPagePrompt(root, message, opts),
    toast: (message, opts) => showToast(root, message, opts),
    saveFile: async (opts) => {
      const picked = await tauriSave({ defaultPath: opts.defaultPath, filters: opts.filters, title: opts.title });
      return picked ?? null;
    },
    openFile: async (opts) => {
      const picked = await tauriOpen({
        multiple: false,
        directory: false,
        defaultPath: opts.defaultPath,
        filters: opts.filters,
        title: opts.title,
      });
      return typeof picked === 'string' ? picked : null;
    },
  };
}

function inPagePrompt(
  root: HTMLElement,
  message: string,
  opts?: { placeholder?: string; value?: string; okLabel?: string },
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'mdapp-modal-backdrop';
    backdrop.innerHTML = `
      <div class="mdapp-modal" role="dialog" aria-modal="true">
        <p class="mdapp-modal__message"></p>
        <input class="mdapp-modal__input" type="text" />
        <div class="mdapp-modal__actions">
          <button type="button" class="mdapp-btn" data-action="cancel">Cancel</button>
          <button type="button" class="mdapp-btn mdapp-btn--primary" data-action="ok"></button>
        </div>
      </div>`;
    const msg = backdrop.querySelector('.mdapp-modal__message') as HTMLParagraphElement;
    const input = backdrop.querySelector('.mdapp-modal__input') as HTMLInputElement;
    const ok = backdrop.querySelector('[data-action="ok"]') as HTMLButtonElement;
    const cancel = backdrop.querySelector('[data-action="cancel"]') as HTMLButtonElement;
    msg.textContent = message;
    input.placeholder = opts?.placeholder ?? '';
    input.value = opts?.value ?? '';
    ok.textContent = opts?.okLabel ?? 'OK';
    const finish = (value: string | undefined): void => {
      backdrop.remove();
      resolve(value);
    };
    ok.addEventListener('click', () => finish(input.value));
    cancel.addEventListener('click', () => finish(undefined));
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(undefined); }
    });
    root.appendChild(backdrop);
    input.focus();
    input.select();
  });
}

let toastTimer: number | undefined;
function showToast(root: HTMLElement, message: string, opts?: { error?: boolean; ms?: number }): void {
  let el = root.querySelector('.mdapp-toast') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'mdapp-toast';
    el.setAttribute('role', 'status');
    root.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('mdapp-toast--error', !!opts?.error);
  el.classList.add('mdapp-toast--visible');
  if (toastTimer) {window.clearTimeout(toastTimer);}
  toastTimer = window.setTimeout(() => el?.classList.remove('mdapp-toast--visible'), opts?.ms ?? 3500);
}
