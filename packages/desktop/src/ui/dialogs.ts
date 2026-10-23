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
  /** Native folder picker; the pick (recursively) joins the fs scope. */
  openFolder(opts: { defaultPath?: string; title?: string }): Promise<string | null>;
  /**
   * In-page confirmation with an optional checkbox ("Don't ask again"), which
   * the native message box cannot show. `danger` styles the OK button.
   */
  confirm(message: string, opts: { okLabel: string; cancelLabel?: string; checkboxLabel?: string; danger?: boolean; detail?: string }): Promise<{ ok: boolean; checked: boolean }>;
  /**
   * In-page question with any number of buttons (the native box stops at
   * two): Save All / Don't Save / Cancel. Resolves the index of the button
   * pressed; Escape resolves `cancelIndex`.
   */
  choose(message: string, opts: { buttons: string[]; defaultIndex?: number; cancelIndex?: number; detail?: string }): Promise<number>;
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
    openFolder: async (opts) => {
      const picked = await tauriOpen({
        multiple: false,
        directory: true,
        recursive: true,
        defaultPath: opts.defaultPath,
        title: opts.title,
      });
      return typeof picked === 'string' ? picked : null;
    },
    confirm: (message, opts) => inPageConfirm(root, message, opts),
    choose: (message, opts) => inPageChoose(root, message, opts),
  };
}

function inPageChoose(
  root: HTMLElement,
  message: string,
  opts: { buttons: string[]; defaultIndex?: number; cancelIndex?: number; detail?: string },
): Promise<number> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const backdrop = document.createElement('div');
    backdrop.className = 'mdapp-modal-backdrop';
    backdrop.innerHTML = `
      <div class="mdapp-modal mdapp-modal--choose" role="alertdialog" aria-modal="true" aria-labelledby="mdapp-choose-msg">
        <p class="mdapp-modal__message" id="mdapp-choose-msg"></p>
        <pre class="mdapp-modal__detail mdapp-modal__detail--list" hidden></pre>
        <div class="mdapp-modal__actions"></div>
      </div>`;
    (backdrop.querySelector('.mdapp-modal__message') as HTMLElement).textContent = message;
    const detail = backdrop.querySelector('.mdapp-modal__detail') as HTMLElement;
    if (opts.detail) { detail.hidden = false; detail.textContent = opts.detail; }
    const actions = backdrop.querySelector('.mdapp-modal__actions') as HTMLElement;
    const cancelIndex = opts.cancelIndex ?? 0;
    const defaultIndex = opts.defaultIndex ?? opts.buttons.length - 1;
    const buttons: HTMLButtonElement[] = opts.buttons.map((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = i === defaultIndex ? 'mdapp-btn mdapp-btn--primary' : 'mdapp-btn';
      b.dataset.index = String(i);
      b.textContent = text;
      actions.appendChild(b);
      return b;
    });
    const finish = (value: number): void => {
      backdrop.remove();
      previous?.focus?.();
      resolve(value);
    };
    buttons.forEach((b, i) => b.addEventListener('click', () => finish(i)));
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(cancelIndex); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        finish(i >= 0 ? i : defaultIndex);
      } else if (e.key === 'Tab') {
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
      }
    });
    root.appendChild(backdrop);
    buttons[defaultIndex]?.focus();
  });
}

function inPageConfirm(
  root: HTMLElement,
  message: string,
  opts: { okLabel: string; cancelLabel?: string; checkboxLabel?: string; danger?: boolean; detail?: string },
): Promise<{ ok: boolean; checked: boolean }> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const backdrop = document.createElement('div');
    backdrop.className = 'mdapp-modal-backdrop';
    backdrop.innerHTML = `
      <div class="mdapp-modal" role="alertdialog" aria-modal="true" aria-labelledby="mdapp-confirm-msg">
        <p class="mdapp-modal__message" id="mdapp-confirm-msg"></p>
        <p class="mdapp-modal__detail" hidden></p>
        <label class="mdapp-modal__check" hidden><input type="checkbox" /> <span></span></label>
        <div class="mdapp-modal__actions">
          <button type="button" class="mdapp-btn" data-action="cancel"></button>
          <button type="button" class="mdapp-btn mdapp-btn--primary" data-action="ok"></button>
        </div>
      </div>`;
    (backdrop.querySelector('.mdapp-modal__message') as HTMLElement).textContent = message;
    const detail = backdrop.querySelector('.mdapp-modal__detail') as HTMLElement;
    if (opts.detail) { detail.hidden = false; detail.textContent = opts.detail; }
    const check = backdrop.querySelector('.mdapp-modal__check') as HTMLLabelElement;
    const box = check.querySelector('input') as HTMLInputElement;
    if (opts.checkboxLabel) {
      check.hidden = false;
      (check.querySelector('span') as HTMLSpanElement).textContent = opts.checkboxLabel;
    }
    const ok = backdrop.querySelector('[data-action="ok"]') as HTMLButtonElement;
    const cancel = backdrop.querySelector('[data-action="cancel"]') as HTMLButtonElement;
    ok.textContent = opts.okLabel;
    if (opts.danger) {ok.classList.add('mdapp-btn--danger');}
    cancel.textContent = opts.cancelLabel ?? 'Cancel';
    const finish = (value: boolean): void => {
      backdrop.remove();
      previous?.focus?.();
      resolve({ ok: value, checked: box.checked });
    };
    ok.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter' && e.target !== cancel && e.target !== box) { e.preventDefault(); e.stopPropagation(); finish(true); }
      else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const items = [box, cancel, ok].filter((el) => !(el === box && check.hidden));
        const i = items.indexOf(document.activeElement as HTMLInputElement & HTMLButtonElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
      }
    });
    root.appendChild(backdrop);
    ok.focus();
  });
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
