/**
 * Non-modal banner under the window top for settings problems (a corrupt
 * file, a rejected folder override). It never blocks the editor; each item
 * can be dismissed and brings its own actions.
 */
import type { BannerItem, SettingsBanner } from './store';

export function createSettingsBanner(app: HTMLElement): SettingsBanner & { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'mdapp-banner';
  el.setAttribute('role', 'status');
  el.hidden = true;
  app.prepend(el);

  function clear(): void {
    el.replaceChildren();
    el.hidden = true;
  }

  function show(items: BannerItem[]): void {
    el.replaceChildren();
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'mdapp-banner__row';
      row.dataset.banner = item.id;
      const text = document.createElement('span');
      text.className = 'mdapp-banner__text';
      text.textContent = item.message;
      row.append(text);
      for (const action of item.actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mdapp-btn mdapp-banner__btn';
        btn.textContent = action.label;
        btn.addEventListener('click', () => action.run());
        row.append(btn);
      }
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'mdapp-btn mdapp-btn--quiet mdapp-banner__close';
      close.setAttribute('aria-label', 'Dismiss');
      close.textContent = '×';
      close.addEventListener('click', () => {
        row.remove();
        if (!el.childElementCount) {el.hidden = true;}
      });
      row.append(close);
      el.append(row);
    }
    el.hidden = items.length === 0;
  }

  return { el, show, clear };
}
