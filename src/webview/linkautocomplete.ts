// Link autocomplete dropdown for the link dialog URL input

export interface LinkSuggestion {
  label: string;
  href: string;
  type: 'file' | 'anchor';
}

let dropdownEl: HTMLElement | null = null;
let suggestions: LinkSuggestion[] = [];
let filteredSuggestions: LinkSuggestion[] = [];
let activeIndex = -1;
let inputEl: HTMLInputElement | null = null;
let onSelectCallback: ((href: string) => void) | null = null;

export function initLinkAutocomplete(
  input: HTMLInputElement,
  onSelect: (href: string) => void
): void {
  inputEl = input;
  onSelectCallback = onSelect;
  activeIndex = -1;

  // Request suggestions from host
  (window as any).__vscode?.postMessage({ type: 'getLinkSuggestions' });

  input.addEventListener('input', onInputChange);
  input.addEventListener('keydown', onInputKeydown);
  input.addEventListener('blur', () => setTimeout(hideDropdown, 150));
}

export function receiveSuggestions(newSuggestions: LinkSuggestion[]): void {
  suggestions = newSuggestions;
  if (inputEl) updateDropdown(inputEl.value);
}

export function receiveFileHeadings(anchors: LinkSuggestion[]): void {
  // Merge anchors into suggestions, replacing existing anchor entries
  suggestions = suggestions.filter(s => s.type !== 'anchor');
  suggestions.push(...anchors);
  if (inputEl) updateDropdown(inputEl.value);
}

export function destroyLinkAutocomplete(): void {
  hideDropdown();
  inputEl?.removeEventListener('input', onInputChange);
  inputEl?.removeEventListener('keydown', onInputKeydown);
  inputEl = null;
  onSelectCallback = null;
  suggestions = [];
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
  if (!dropdownEl || filteredSuggestions.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, filteredSuggestions.length - 1);
    renderDropdown();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    renderDropdown();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (activeIndex >= 0 && filteredSuggestions[activeIndex]) {
      e.preventDefault();
      selectSuggestion(filteredSuggestions[activeIndex]);
    }
  } else if (e.key === 'Escape') {
    hideDropdown();
  }
}

function updateDropdown(query: string): void {
  filteredSuggestions = fuzzyFilter(suggestions, query);
  activeIndex = filteredSuggestions.length > 0 ? 0 : -1;
  if (filteredSuggestions.length > 0) {
    showDropdown();
  } else {
    hideDropdown();
  }
}

function fuzzyFilter(items: LinkSuggestion[], query: string): LinkSuggestion[] {
  if (!query) return items.slice(0, 20);
  const q = query.toLowerCase();
  return items
    .filter(item => {
      const text = (item.label + ' ' + item.href).toLowerCase();
      let qi = 0;
      for (let i = 0; i < text.length && qi < q.length; i++) {
        if (text[i] === q[qi]) qi++;
      }
      return qi === q.length;
    })
    .slice(0, 15);
}

function showDropdown(): void {
  if (!inputEl) return;
  if (!dropdownEl) {
    dropdownEl = document.createElement('div');
    dropdownEl.id = 'mikedown-link-ac';
    dropdownEl.setAttribute('role', 'listbox');
    document.body.appendChild(dropdownEl);
  }
  renderDropdown();

  // Position below input
  const rect = inputEl.getBoundingClientRect();
  dropdownEl.style.top = `${rect.bottom + 4}px`;
  dropdownEl.style.left = `${rect.left}px`;
  dropdownEl.style.minWidth = `${rect.width}px`;
}

function renderDropdown(): void {
  if (!dropdownEl) return;
  dropdownEl.innerHTML = '';
  filteredSuggestions.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'lac-item' + (i === activeIndex ? ' lac-active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === activeIndex));

    const icon = document.createElement('span');
    icon.className = 'lac-icon';
    icon.textContent = s.type === 'anchor' ? '#' : '📄';

    const label = document.createElement('span');
    label.className = 'lac-label';
    label.textContent = s.label;

    const href = document.createElement('span');
    href.className = 'lac-href';
    href.textContent = s.href;

    item.appendChild(icon);
    item.appendChild(label);
    item.appendChild(href);
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSuggestion(s);
    });
    dropdownEl!.appendChild(item);
  });
}

function selectSuggestion(s: LinkSuggestion): void {
  if (inputEl) inputEl.value = s.href;
  hideDropdown();
  onSelectCallback?.(s.href);
}

function hideDropdown(): void {
  dropdownEl?.remove();
  dropdownEl = null;
  filteredSuggestions = [];
  activeIndex = -1;
}
