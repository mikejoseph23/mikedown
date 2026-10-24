/**
 * The found-notice (U2): "MikeDown X is available" in the bottom-right
 * corner with View and a close button, the shape of VS Code's own update
 * notification. Not modal and never takes focus. View opens the update
 * window; close (or Escape inside it) hides the notice for the session, which
 * is not Remind Me Later.
 *
 * `createUpdatePrompt` is the controller's `UpdatePrompt`: the notice for a
 * silent find, the window for a manual check, and the window again when it
 * is open or Install and Relaunch was pressed in it (so "Update ready" after
 * a cancelled quit dialog comes back in the window).
 *
 * e2e hooks: `.mdapp-update` with `data-version`; buttons `data-action`
 * (view | close).
 */
import type { UpdatePrompt } from '../app/updater';
import type { UpdateInfo } from '../app/updaterApi';
import { UPDATE_TEXT } from './updateView';
import type { UpdateWindow } from './updateWindow';

export interface FoundNotice {
  show(info: UpdateInfo, actions: { view(): void; close(): void }): void;
  hide(): void;
  isShown(): boolean;
}

const CLOSE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';
const UPDATE_ICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 5.75v7.5M6.75 10.25 10 13.5l3.25-3.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function createFoundNotice(root: HTMLElement = document.body): FoundNotice {
  let el: HTMLDivElement | null = null;

  const hide = () => {
    el?.remove();
    el = null;
  };

  return {
    show(info, actions) {
      hide();
      el = document.createElement('div');
      el.className = 'mdapp-update';
      el.dataset.version = info.version;
      // A polite status, not an alertdialog: it never takes focus.
      el.setAttribute('role', 'status');

      const icon = document.createElement('span');
      icon.className = 'mdapp-update__icon';
      icon.innerHTML = UPDATE_ICON;

      const title = document.createElement('span');
      title.className = 'mdapp-update__title';
      title.textContent = UPDATE_TEXT.noticeTitle(info.version);

      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'mdapp-btn mdapp-btn--primary mdapp-update__view';
      view.dataset.action = 'view';
      view.textContent = UPDATE_TEXT.noticeView;
      view.addEventListener('click', () => actions.view());

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'mdapp-update__close';
      close.dataset.action = 'close';
      close.setAttribute('aria-label', UPDATE_TEXT.noticeClose);
      close.title = UPDATE_TEXT.noticeClose;
      close.innerHTML = CLOSE_ICON;
      close.addEventListener('click', () => actions.close());

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          actions.close();
        }
      });
      el.append(icon, title, view, close);
      root.appendChild(el);
    },
    hide,
    isShown: () => el !== null,
  };
}

export function createUpdatePrompt(opts: { notice: FoundNotice; window: UpdateWindow }): UpdatePrompt {
  const { notice, window: win } = opts;
  return {
    show(info, actions, showOpts) {
      if (showOpts?.manual || win.isOpen() || win.installRequested()) {
        notice.hide();
        win.open();
        return;
      }
      notice.show(info, {
        view: () => {
          notice.hide();
          win.open();
        },
        close: () => actions.later(),
      });
    },
    hide: () => notice.hide(),
    showsProgress: () => win.isOpen(),
  };
}
