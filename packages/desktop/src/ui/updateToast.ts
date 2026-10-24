/**
 * The "Update available" toast (edge case 17): a persistent notice in the
 * bottom-right corner with Restart Now / Later. Not modal; Escape inside it
 * means Later.
 */
import type { UpdatePrompt } from '../app/updater';

export function createUpdatePrompt(root: HTMLElement = document.body): UpdatePrompt {
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
      el.setAttribute('role', 'alertdialog');
      el.setAttribute('aria-labelledby', 'mdapp-update-title');
      el.setAttribute('aria-describedby', 'mdapp-update-body');

      const title = document.createElement('div');
      title.id = 'mdapp-update-title';
      title.className = 'mdapp-update__title';
      title.textContent = 'Update available';

      const body = document.createElement('div');
      body.id = 'mdapp-update-body';
      body.className = 'mdapp-update__body';
      body.textContent = `MikeDown ${info.version} is ready to install (you have ${info.currentVersion}). Restarting asks about unsaved changes first.`;

      const buttons = document.createElement('div');
      buttons.className = 'mdapp-update__buttons';
      const later = document.createElement('button');
      later.type = 'button';
      later.className = 'mdapp-btn';
      later.textContent = 'Later';
      later.addEventListener('click', () => actions.later());
      const now = document.createElement('button');
      now.type = 'button';
      now.className = 'mdapp-btn mdapp-btn--primary';
      now.textContent = 'Restart Now';
      now.addEventListener('click', () => actions.restartNow());
      buttons.append(later, now);

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          actions.later();
        }
      });
      el.append(title, body, buttons);
      root.appendChild(el);
    },
    hide,
  };
}
