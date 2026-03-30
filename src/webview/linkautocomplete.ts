// Link autocomplete dropdown for the link dialog URL input

export interface LinkSuggestion {
  label: string;
  href: string;
  type: 'file' | 'anchor' | 'inDoc' | 'external';
  /** Heading level (1-6) for anchor items, used for hierarchical indentation. */
  level?: number;
}

interface Section {
  id: string;
  label: string;
  items: LinkSuggestion[];
}

interface GroupedResults {
  sections: Section[];
  externalEntry: LinkSuggestion | null;
}

let dropdownEl: HTMLElement | null = null;
let suggestions: LinkSuggestion[] = [];
let docLinks: LinkSuggestion[] = [];
let flatItems: LinkSuggestion[] = [];
let activeIndex = -1;
let inputEl: HTMLInputElement | null = null;
let onSelectCallback: ((href: string) => void) | null = null;

/** Collect deduplicated links already present in the ProseMirror document. */
export function collectDocLinks(): LinkSuggestion[] {
  const seen = new Set<string>();
  const results: LinkSuggestion[] = [];
  document.querySelectorAll('.ProseMirror a[href]').forEach(el => {
    const href = el.getAttribute('href') || '';
    if (!href || seen.has(href)) return;
    seen.add(href);
    const label = href.startsWith('http') ? href.replace(/^https?:\/\//, '').split('/')[0] : href;
    results.push({ label: el.textContent?.trim() || label, href, type: 'inDoc' });
  });
  return results;
}

export function initLinkAutocomplete(
  input: HTMLInputElement,
  onSelect: (href: string) => void,
  existingDocLinks?: LinkSuggestion[]
): void {
  inputEl = input;
  onSelectCallback = onSelect;
  activeIndex = -1;
  docLinks = existingDocLinks ?? collectDocLinks();

  // Request suggestions from host
  (window as any).__vscode?.postMessage({ type: 'getLinkSuggestions' });

  input.addEventListener('input', onInputChange);
  input.addEventListener('keydown', onInputKeydown);
  input.addEventListener('focus', onInputFocus);
  input.addEventListener('blur', () => setTimeout(hideDropdown, 150));
}

export function receiveSuggestions(newSuggestions: LinkSuggestion[]): void {
  suggestions = newSuggestions;
  if (inputEl) updateDropdown(inputEl.value);
}

export function receiveFileHeadings(anchors: LinkSuggestion[]): void {
  suggestions = suggestions.filter(s => s.type !== 'anchor');
  suggestions.push(...anchors);
  if (inputEl) updateDropdown(inputEl.value);
}

export function destroyLinkAutocomplete(): void {
  hideDropdown();
  inputEl?.removeEventListener('input', onInputChange);
  inputEl?.removeEventListener('keydown', onInputKeydown);
  inputEl?.removeEventListener('focus', onInputFocus);
  inputEl = null;
  onSelectCallback = null;
  suggestions = [];
  docLinks = [];
}

/** Returns true when the dropdown is visible and has a selected item. */
export function isDropdownActive(): boolean {
  return dropdownEl !== null && flatItems.length > 0 && activeIndex >= 0;
}

function onInputFocus(): void {
  if (!inputEl) return;
  updateDropdown(inputEl.value);
}

function onInputChange(): void {
  if (!inputEl) return;
  const val = inputEl.value;

  // If user typed a file path and pressed '#', request headings for that file
  const hashIdx = val.indexOf('#');
  if (hashIdx > 0) {
    const filePath = val.slice(0, hashIdx);
    if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
      (window as any).__vscode?.postMessage({ type: 'getFileHeadings', filePath });
    }
  }

  updateDropdown(val);
}

function onInputKeydown(e: KeyboardEvent): void {
  if (!dropdownEl || flatItems.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, flatItems.length - 1);
    renderDropdown();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    renderDropdown();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (activeIndex >= 0 && flatItems[activeIndex]) {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectSuggestion(flatItems[activeIndex]);
    }
  } else if (e.key === 'Escape') {
    e.stopImmediatePropagation();
    hideDropdown();
  }
}

function looksLikeUrl(query: string): boolean {
  return /^(https?:\/\/|mailto:|ftp:\/\/)/.test(query) || query.includes('://');
}

function buildGroupedResults(query: string): GroupedResults {
  const q = query.trim();
  const sections: Section[] = [];
  let externalEntry: LinkSuggestion | null = null;

  // External URL entry (pinned at top when query looks like a URL)
  if (q && looksLikeUrl(q)) {
    externalEntry = { label: q, href: q, type: 'external' };
  }

  // Separate suggestions by type
  const anchors = suggestions.filter(s => s.type === 'anchor');
  const files = suggestions.filter(s => s.type === 'file');

  // If query starts with #, only show headings
  if (q.startsWith('#')) {
    const filtered = fuzzyMatch(anchors, q);
    if (filtered.length > 0) {
      sections.push({ id: 'headings', label: 'Headings', items: filtered.slice(0, 10) });
    }
    return { sections, externalEntry };
  }

  // Headings
  const filteredAnchors = fuzzyMatch(anchors, q).slice(0, 20);
  if (filteredAnchors.length > 0) {
    sections.push({ id: 'headings', label: 'Headings', items: filteredAnchors });
  }

  // Used in Document — non-anchor links only (headings already covered above)
  const nonAnchorDocLinks = docLinks.filter(s => !s.href.startsWith('#'));
  const filteredDoc = fuzzyMatch(nonAnchorDocLinks, q).slice(0, 8);
  if (filteredDoc.length > 0) {
    sections.push({ id: 'inDoc', label: 'Used in Document', items: filteredDoc });
  }

  // Workspace Files
  const filteredFiles = fuzzyMatch(files, q).slice(0, 10);
  if (filteredFiles.length > 0) {
    sections.push({ id: 'files', label: 'Workspace Files', items: filteredFiles });
  }

  return { sections, externalEntry };
}

function fuzzyMatch(items: LinkSuggestion[], query: string): LinkSuggestion[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter(item => {
    const text = (item.label + ' ' + item.href).toLowerCase();
    let qi = 0;
    for (let i = 0; i < text.length && qi < q.length; i++) {
      if (text[i] === q[qi]) qi++;
    }
    return qi === q.length;
  });
}

function updateDropdown(query: string): void {
  const { sections, externalEntry } = buildGroupedResults(query);

  // Build flat item list for keyboard navigation
  flatItems = [];
  if (externalEntry) flatItems.push(externalEntry);
  for (const section of sections) {
    flatItems.push(...section.items);
  }

  activeIndex = flatItems.length > 0 ? 0 : -1;

  if (flatItems.length > 0) {
    showDropdown(sections, externalEntry);
  } else {
    hideDropdown();
  }
}

function showDropdown(sections: Section[], externalEntry: LinkSuggestion | null): void {
  if (!inputEl) return;
  if (!dropdownEl) {
    dropdownEl = document.createElement('div');
    dropdownEl.id = 'mikedown-link-ac';
    dropdownEl.setAttribute('role', 'listbox');
    document.body.appendChild(dropdownEl);
  }
  renderGrouped(sections, externalEntry);

  const rect = inputEl.getBoundingClientRect();
  dropdownEl.style.top = `${rect.bottom + 4}px`;
  dropdownEl.style.left = `${rect.left}px`;
  dropdownEl.style.minWidth = `${rect.width}px`;
}

let _lastSections: Section[] = [];
let _lastExternal: LinkSuggestion | null = null;

function renderDropdown(): void {
  renderGrouped(_lastSections, _lastExternal);
}

function renderGrouped(sections: Section[], externalEntry: LinkSuggestion | null): void {
  if (!dropdownEl) return;
  _lastSections = sections;
  _lastExternal = externalEntry;
  dropdownEl.innerHTML = '';

  let flatIdx = 0;

  // External URL entry (pinned at top)
  if (externalEntry) {
    dropdownEl.appendChild(makeItem(externalEntry, flatIdx, true));
    flatIdx++;
  }

  // Grouped sections
  for (const section of sections) {
    const header = document.createElement('div');
    header.className = 'lac-section-header';
    header.textContent = section.label;
    dropdownEl.appendChild(header);

    for (const item of section.items) {
      dropdownEl.appendChild(makeItem(item, flatIdx, false));
      flatIdx++;
    }
  }
}

function makeItem(s: LinkSuggestion, idx: number, isExternal: boolean): HTMLElement {
  const item = document.createElement('div');
  const classes = ['lac-item'];
  if (idx === activeIndex) classes.push('lac-active');
  if (isExternal) classes.push('lac-external');
  item.className = classes.join(' ');
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(idx === activeIndex));

  // Indent subheadings: level 1 = no indent, level 2 = 12px, level 3 = 24px, etc.
  if (s.type === 'anchor' && s.level && s.level > 1) {
    item.style.paddingLeft = `${10 + (s.level - 1) * 12}px`;
  }

  const icon = document.createElement('span');
  icon.className = 'lac-icon';
  if (isExternal) {
    icon.textContent = '🔗';
  } else if (s.type === 'anchor') {
    icon.textContent = s.level && s.level > 1 ? '└' : '#';
  } else if (s.type === 'inDoc') {
    icon.textContent = '↩';
  } else {
    icon.textContent = '📄';
  }

  const label = document.createElement('span');
  label.className = 'lac-label';
  label.textContent = isExternal ? `Use ${s.label}` : s.label;

  const href = document.createElement('span');
  href.className = 'lac-href';
  href.textContent = isExternal ? '' : s.href;

  item.appendChild(icon);
  item.appendChild(label);
  if (!isExternal) item.appendChild(href);
  item.addEventListener('mousedown', (e) => {
    e.preventDefault();
    selectSuggestion(s);
  });

  if (idx === activeIndex) {
    requestAnimationFrame(() => item.scrollIntoView({ block: 'nearest' }));
  }

  return item;
}

function selectSuggestion(s: LinkSuggestion): void {
  if (inputEl) inputEl.value = s.href;
  hideDropdown();
  onSelectCallback?.(s.href);
}

function hideDropdown(): void {
  dropdownEl?.remove();
  dropdownEl = null;
  flatItems = [];
  activeIndex = -1;
}
