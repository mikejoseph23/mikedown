/**
 * The welcome screen (M8, edge case 18): what a window with no folder and no
 * open file shows. Open Folder, Open File and New File, then two lists, recent
 * folders and recent files. A recent entry whose path is gone stays listed,
 * greyed, with a remove "×" (the store prunes it after three launches), and a
 * one-paragraph hint. The window title reads `MikeDown` while it shows.
 *
 * Pure DOM over `RecentItemView`s; the store and the actions live in
 * `main.ts`.
 */
import type { RecentItemView, RecentKind } from '../app/recents';
import { tildify } from '../app/recents';
import { formatAccelerator, rowFor, type CommandId } from '../menu/shortcuts';

export interface WelcomeDeps {
  isMac: boolean;
  openFolder(): void;
  openFile(): void;
  newFile(): void;
  openRecent(kind: RecentKind, path: string): void;
  removeRecent(kind: RecentKind, path: string): void;
  /** For `~/…` display; null shows full paths. */
  home?: () => string | null;
}

export interface Welcome {
  el: HTMLElement;
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  render(view: { folders: RecentItemView[]; files: RecentItemView[] }): void;
  /** Focus the first action (keyboard users land somewhere useful). */
  focus(): void;
}

export const WELCOME_HINT =
  'MikeDown edits markdown as it will look and saves plain .md text. Open a folder to browse your notes in the sidebar, '
  + 'link them with [[wikilinks]] and search across them, or open a single file. Type / in a document for headings, '
  + 'tables, callouts and more. Help > Welcome Guide has the full cheat sheet.';

export function createWelcome(deps: WelcomeDeps): Welcome {
  const el = document.createElement('section');
  el.className = 'mdapp-welcome';
  el.setAttribute('aria-label', 'Welcome');
  el.hidden = true;

  const inner = document.createElement('div');
  inner.className = 'mdapp-welcome__inner';
  el.appendChild(inner);

  const title = document.createElement('h1');
  title.className = 'mdapp-welcome__title';
  title.textContent = 'MikeDown';
  inner.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'mdapp-welcome__actions';
  inner.appendChild(actions);

  const action = (label: string, command: CommandId, run: () => void, name: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mdapp-btn mdapp-welcome__action';
    b.dataset.action = name;
    const text = document.createElement('span');
    text.textContent = label;
    b.appendChild(text);
    const row = rowFor(command, deps.isMac);
    if (row?.accelerator) {
      const kbd = document.createElement('kbd');
      kbd.textContent = formatAccelerator(row.accelerator, deps.isMac);
      b.appendChild(kbd);
    }
    b.addEventListener('click', run);
    actions.appendChild(b);
    return b;
  };
  const first = action('Open Folder…', 'openFolder', () => deps.openFolder(), 'open-folder');
  action('Open File…', 'open', () => deps.openFile(), 'open-file');
  action('New File', 'newDocument', () => deps.newFile(), 'new-file');

  const lists = document.createElement('div');
  lists.className = 'mdapp-welcome__lists';
  inner.appendChild(lists);

  const makeList = (heading: string, kind: RecentKind) => {
    const box = document.createElement('div');
    box.className = 'mdapp-welcome__recent';
    box.dataset.kind = kind;
    const h = document.createElement('h2');
    h.textContent = heading;
    const id = `mdapp-welcome-${kind}s`;
    h.id = id;
    const ul = document.createElement('ul');
    ul.setAttribute('aria-labelledby', id);
    const empty = document.createElement('p');
    empty.className = 'mdapp-welcome__empty';
    empty.textContent = kind === 'folder' ? 'No recent folders yet.' : 'No recent files yet.';
    box.append(h, ul, empty);
    lists.appendChild(box);
    return { ul, empty };
  };
  const folderList = makeList('Recent folders', 'folder');
  const fileList = makeList('Recent files', 'file');

  const hint = document.createElement('p');
  hint.className = 'mdapp-welcome__hint';
  hint.textContent = WELCOME_HINT;
  inner.appendChild(hint);

  function fill(target: { ul: HTMLUListElement; empty: HTMLElement }, items: RecentItemView[]): void {
    target.ul.replaceChildren();
    target.empty.hidden = items.length > 0;
    const home = deps.home?.() ?? null;
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'mdapp-welcome__item';
      li.classList.toggle('is-missing', item.missing);
      li.dataset.path = item.path;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'mdapp-welcome__open';
      open.disabled = item.missing;
      open.title = item.missing ? `${item.path} (not found)` : item.path;
      const name = document.createElement('span');
      name.className = 'mdapp-welcome__name';
      name.textContent = item.name;
      const where = document.createElement('span');
      where.className = 'mdapp-welcome__where';
      where.textContent = item.missing ? `${tildify(item.parent, home)} (not found)` : tildify(item.parent, home);
      open.append(name, where);
      open.addEventListener('click', () => deps.openRecent(item.kind, item.path));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mdapp-welcome__remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${item.name} from recent ${item.kind === 'folder' ? 'folders' : 'files'}`);
      remove.title = 'Remove from this list';
      remove.addEventListener('click', () => deps.removeRecent(item.kind, item.path));
      li.append(open, remove);
      target.ul.appendChild(li);
    }
  }

  return {
    el,
    setVisible(visible) { el.hidden = !visible; },
    isVisible: () => !el.hidden,
    render(view) {
      fill(folderList, view.folders);
      fill(fileList, view.files);
    },
    focus() { first.focus(); },
  };
}
