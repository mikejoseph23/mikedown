/**
 * The update window (U2): a sheet that drops from the top of the window, in
 * the shape of macOS Software Update and Sparkle. App icon on the left; the
 * title, the version line, the major-update line and "What's new" on the
 * right; Skip This Version at the far left of the button row, Remind Me
 * Later and Install and Relaunch (the default) at the right.
 *
 * It follows the updater snapshot while open: Install and Relaunch swaps the
 * buttons for a quiet progress bar (downloading, verifying), the buttons come
 * back with "Update ready" after a cancelled quit dialog, installing shows
 * the reopen line, and a failure shows the website link. Wording lives in
 * `updateView.ts`.
 *
 * Keyboard: Tab cycles inside the sheet, Enter on anything but a button or a
 * link is Install and Relaunch, Escape is Remind Me Later (or Hide while a
 * download runs). Focus returns to where it was when the sheet closes.
 *
 * e2e hooks: `.mdapp-updwin` carries `data-mode` (offer | progress | ready |
 * installing | failed); buttons carry `data-action` (skip | later | install |
 * hide); the bar is `[role=progressbar]`.
 */
import appIconUrl from '../../src-tauri/icons/128x128@2x.png';
import type { UpdaterController } from '../app/updater';
import type { UpdateInfo } from '../app/updaterApi';
import { isSafeLink, renderReleaseNotes } from './releaseNotes';
import { isMajorUpdate, liveProgressText, UPDATE_TEXT, updateWindowView, WEBSITE_URL, type UpdateWindowView } from './updateView';

export interface UpdateWindowDeps {
  root?: HTMLElement;
  /** Late-bound: the controller takes the prompt, which takes this window. */
  controller(): UpdaterController;
  /** Open a link in the browser. */
  openExternal(url: string): void;
  /** Windows shows "MikeDown will reopen in a moment" while installing. */
  windows: boolean;
}

export interface UpdateWindow {
  /** Open on the controller's current update (no-op without one). */
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** True once Install and Relaunch was pressed here, until the window is dismissed. */
  installRequested(): boolean;
}

let seq = 0;

function button(text: string, action: string, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'mdapp-btn mdapp-btn--primary mdapp-updwin__btn' : 'mdapp-btn mdapp-updwin__btn';
  b.dataset.action = action;
  b.textContent = text;
  return b;
}

export function createUpdateWindow(deps: UpdateWindowDeps): UpdateWindow {
  const root = deps.root ?? document.body;
  let backdrop: HTMLDivElement | null = null;
  let previous: HTMLElement | null = null;
  let unsubscribe: (() => void) | null = null;
  let renderedVersion: string | null = null;
  let lastLive = '';
  let installAsked = false;

  // Parts updated on each render.
  let sheet!: HTMLDivElement;
  let subtitle!: HTMLParagraphElement;
  let major!: HTMLParagraphElement;
  let notes!: HTMLDivElement;
  let statusLine!: HTMLParagraphElement;
  let statusText!: HTMLSpanElement;
  let website!: HTMLAnchorElement;
  let statusTail!: HTMLSpanElement;
  let bar!: HTMLDivElement;
  let fill!: HTMLDivElement;
  let actions!: HTMLDivElement;
  let hideBtn!: HTMLButtonElement;
  let installBtn!: HTMLButtonElement;
  let live!: HTMLDivElement;

  const ctl = () => deps.controller();

  const close = () => {
    if (!backdrop) {return;}
    unsubscribe?.();
    unsubscribe = null;
    backdrop.remove();
    backdrop = null;
    renderedVersion = null;
    lastLive = '';
    const back = previous;
    previous = null;
    if (back && back.isConnected) {back.focus?.();}
  };

  const dismiss = (how: 'later' | 'skip') => {
    installAsked = false;
    close();
    void (how === 'skip' ? ctl().skip() : ctl().snooze());
  };

  const focusables = (): HTMLElement[] => {
    if (!sheet) {return [];}
    return [...sheet.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')]
      .filter((el) => !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled);
  };

  const fillNotes = (info: UpdateInfo) => {
    const html = renderReleaseNotes(info.notes);
    if (html) {
      notes.innerHTML = html;
      notes.classList.remove('mdapp-updwin__notes--empty');
    } else {
      notes.textContent = UPDATE_TEXT.noNotes;
      notes.classList.add('mdapp-updwin__notes--empty');
    }
    notes.scrollTop = 0;
  };

  const render = () => {
    if (!backdrop) {return;}
    const snap = ctl().getSnapshot();
    const info = snap.info;
    if (!info || snap.state === 'idle') {
      close();
      return;
    }
    if (renderedVersion !== info.version) {
      renderedVersion = info.version;
      subtitle.textContent = UPDATE_TEXT.subtitle(info.version, info.currentVersion);
      major.hidden = !isMajorUpdate(info.currentVersion, info.version);
      fillNotes(info);
    }
    const view: UpdateWindowView = updateWindowView(snap, { windows: deps.windows });
    sheet.dataset.mode = view.mode;

    statusLine.hidden = view.status === null;
    // The failure line links its own words "MikeDown website".
    const status = view.status ?? '';
    const at = view.websiteLink ? status.lastIndexOf(UPDATE_TEXT.websiteLink) : -1;
    statusText.textContent = at >= 0 ? status.slice(0, at) : status;
    statusTail.textContent = at >= 0 ? status.slice(at + UPDATE_TEXT.websiteLink.length) : '';
    statusLine.classList.toggle('mdapp-updwin__status--error', view.error);
    website.hidden = at < 0;

    const showBar = view.percent !== undefined;
    bar.hidden = !showBar;
    if (showBar) {
      if (view.percent === null) {
        bar.removeAttribute('aria-valuenow');
        bar.classList.add('mdapp-updwin__bar--indeterminate');
        fill.style.width = '';
      } else {
        bar.setAttribute('aria-valuenow', String(view.percent));
        bar.classList.remove('mdapp-updwin__bar--indeterminate');
        fill.style.width = `${view.percent}%`;
      }
      bar.setAttribute('aria-valuetext', view.status ?? '');
    }

    // Move focus only when the button row appears or goes away (or focus
    // left the sheet), never on a progress tick.
    const buttonsChanged = actions.hidden === view.buttons;
    actions.hidden = !view.buttons;
    hideBtn.hidden = view.mode !== 'progress';
    if (buttonsChanged || !sheet.contains(document.activeElement)) {
      if (view.buttons) {installBtn.focus();}
      else {(view.mode === 'progress' ? hideBtn : sheet).focus();}
    }

    const text = liveProgressText(view);
    if (text !== lastLive) {
      lastLive = text;
      live.textContent = text;
    }
  };

  const build = () => {
    const id = `mdapp-updwin-${++seq}`;
    backdrop = document.createElement('div');
    backdrop.className = 'mdapp-updwin-backdrop';

    sheet = document.createElement('div');
    sheet.className = 'mdapp-updwin';
    sheet.tabIndex = -1;
    sheet.setAttribute('role', 'alertdialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', `${id}-title`);
    sheet.setAttribute('aria-describedby', `${id}-subtitle`);

    const icon = document.createElement('img');
    icon.className = 'mdapp-updwin__icon';
    icon.src = appIconUrl;
    icon.alt = '';
    icon.width = 64;
    icon.height = 64;
    icon.draggable = false;

    const main = document.createElement('div');
    main.className = 'mdapp-updwin__main';

    const title = document.createElement('h2');
    title.className = 'mdapp-updwin__title';
    title.id = `${id}-title`;
    title.textContent = UPDATE_TEXT.title;

    subtitle = document.createElement('p');
    subtitle.className = 'mdapp-updwin__subtitle';
    subtitle.id = `${id}-subtitle`;

    major = document.createElement('p');
    major.className = 'mdapp-updwin__major';
    major.textContent = UPDATE_TEXT.major;
    major.hidden = true;

    const notesHeading = document.createElement('h3');
    notesHeading.className = 'mdapp-updwin__notes-heading';
    notesHeading.id = `${id}-notes`;
    notesHeading.textContent = UPDATE_TEXT.notesHeading;

    notes = document.createElement('div');
    notes.className = 'mdapp-updwin__notes';
    notes.tabIndex = 0;
    notes.setAttribute('role', 'region');
    notes.setAttribute('aria-labelledby', `${id}-notes`);

    main.append(title, subtitle, major, notesHeading, notes);

    const footer = document.createElement('div');
    footer.className = 'mdapp-updwin__footer';

    statusLine = document.createElement('p');
    statusLine.className = 'mdapp-updwin__status';
    statusText = document.createElement('span');
    statusTail = document.createElement('span');
    website = document.createElement('a');
    website.className = 'mdapp-updwin__website';
    website.href = WEBSITE_URL;
    website.textContent = UPDATE_TEXT.websiteLink;
    statusLine.append(statusText, website, statusTail);

    const progressRow = document.createElement('div');
    progressRow.className = 'mdapp-updwin__progress';
    bar = document.createElement('div');
    bar.className = 'mdapp-updwin__bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Update progress');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    fill = document.createElement('div');
    fill.className = 'mdapp-updwin__fill';
    bar.appendChild(fill);
    hideBtn = button(UPDATE_TEXT.hide, 'hide');
    progressRow.append(bar, hideBtn);

    actions = document.createElement('div');
    actions.className = 'mdapp-updwin__actions';
    const skip = button(UPDATE_TEXT.skip, 'skip');
    const spacer = document.createElement('span');
    spacer.className = 'mdapp-updwin__spacer';
    const later = button(UPDATE_TEXT.later, 'later');
    installBtn = button(UPDATE_TEXT.install, 'install', true);
    actions.append(skip, spacer, later, installBtn);

    footer.append(statusLine, progressRow, actions);

    live = document.createElement('div');
    live.className = 'mdapp-sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');

    sheet.append(icon, main, footer, live);
    backdrop.appendChild(sheet);

    skip.addEventListener('click', () => dismiss('skip'));
    later.addEventListener('click', () => dismiss('later'));
    hideBtn.addEventListener('click', () => close());
    installBtn.addEventListener('click', () => {
      installAsked = true;
      void ctl().restartNow();
    });

    // Links (notes and the website link) open in the browser, never here.
    sheet.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || !sheet.contains(a)) {return;}
      e.preventDefault();
      const href = a.getAttribute('href');
      if (isSafeLink(href)) {deps.openExternal(href as string);}
    });

    backdrop.addEventListener('keydown', (e) => {
      const mode = sheet.dataset.mode;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (mode === 'progress' || mode === 'installing') {close();}
        else {dismiss('later');}
      } else if (e.key === 'Enter') {
        const t = e.target as HTMLElement;
        if (t.closest('button, a')) {return;} // the native activation
        e.preventDefault();
        e.stopPropagation();
        if (!actions.hidden) {installBtn.click();}
      } else if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) {return;}
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = i < 0 ? (e.shiftKey ? items.length - 1 : 0) : (i + (e.shiftKey ? items.length - 1 : 1)) % items.length;
        items[next].focus();
      }
    });
  };

  return {
    open() {
      const snap = ctl().getSnapshot();
      if (!snap.info) {return;}
      if (backdrop) {
        render();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      previous = active && active !== document.body ? active : null;
      build();
      root.appendChild(backdrop!);
      unsubscribe = ctl().subscribe(() => render());
      render();
      // One frame later, so the entrance transition runs.
      requestAnimationFrame(() => backdrop?.classList.add('mdapp-updwin-backdrop--open'));
    },
    close,
    isOpen: () => backdrop !== null,
    installRequested: () => installAsked,
  };
}
