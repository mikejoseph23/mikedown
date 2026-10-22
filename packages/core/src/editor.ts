/**
 * createMikeDownEditor — the editor factory.
 *
 * Builds the editor's DOM inside `container` (toolbar, WYSIWYG surface,
 * source view, sidebar) with no ids, so several editors can share a page,
 * and wires it to the host adapter passed in `options.host`.
 */

import type { MikeDownEditorHandle, MikeDownFeatures, MikeDownOptions } from './types';
import { DEFAULT_FEATURES } from './types';

/** The structural elements every editor instance owns. */
export interface EditorShell {
  root: HTMLElement;
  toolbar: HTMLElement | null;
  sidebar: HTMLElement | null;
  sidebarToggle: HTMLButtonElement | null;
  editorContainer: HTMLElement;
  sourceContainer: HTMLElement;
}

/** Resolve feature flags against the defaults. */
export function resolveFeatures(partial?: Partial<MikeDownFeatures>): MikeDownFeatures {
  return { ...DEFAULT_FEATURES, ...(partial ?? {}) };
}

/**
 * Build the editor DOM inside `container`. Elements are found again by class
 * (`.mikedown-toolbar`, `.mikedown-editor-container`, ...) scoped to the root,
 * never by id.
 */
export function buildEditorShell(container: HTMLElement, features: MikeDownFeatures): EditorShell {
  const root = document.createElement('div');
  root.className = 'mikedown-root';
  root.setAttribute('data-mikedown-root', '');

  let toolbar: HTMLElement | null = null;
  if (features.toolbar) {
    toolbar = document.createElement('div');
    toolbar.className = 'mikedown-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Formatting toolbar');
    root.appendChild(toolbar);
  } else {
    root.classList.add('mikedown-no-toolbar');
  }

  let sidebar: HTMLElement | null = null;
  let sidebarToggle: HTMLButtonElement | null = null;
  if (features.sidebar) {
    sidebar = document.createElement('aside');
    sidebar.className = 'mikedown-outline-sidebar';
    sidebar.setAttribute('aria-label', 'Document sidebar');
    sidebar.hidden = true;
    sidebarToggle = document.createElement('button');
    sidebarToggle.type = 'button';
    sidebarToggle.className = 'mikedown-outline-toggle';
    sidebarToggle.setAttribute('aria-label', 'Show sidebar');
    sidebarToggle.title = 'Show sidebar';
    sidebarToggle.setAttribute('aria-expanded', 'false');
    root.append(sidebar, sidebarToggle);
  }

  const editorContainer = document.createElement('div');
  editorContainer.className = 'mikedown-editor-container';
  editorContainer.setAttribute('role', 'main');
  editorContainer.setAttribute('aria-label', 'Markdown editor');

  const sourceContainer = document.createElement('div');
  sourceContainer.className = 'mikedown-source-container';
  sourceContainer.style.display = 'none';

  root.append(editorContainer, sourceContainer);
  container.appendChild(root);

  return { root, toolbar, sidebar, sidebarToggle, editorContainer, sourceContainer };
}

export function createMikeDownEditor(container: HTMLElement, options: MikeDownOptions): MikeDownEditorHandle {
  void container;
  void options;
  throw new Error('createMikeDownEditor: not wired yet');
}
