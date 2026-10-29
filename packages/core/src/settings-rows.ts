/**
 * Row builders of the Settings modal (`editor.ts#showSettingsModal`), shared
 * with host sections through `MikeDownSettingsSectionContext` and with the AI
 * Engines page, which can open without the modal. Styling lives in
 * settings-modal.css.
 */

import type { MikeDownSettingsSectionContext } from './types';

// 'inline' puts the control appended by the caller to the right of the
// label + hint (selects, short inputs); 'stacked' puts it underneath (long
// text inputs, lists, sections).
export function makeRow(label: string, description: string, layout: 'inline' | 'stacked' = 'stacked'): HTMLElement {
  const row = document.createElement('div');
  row.className = layout === 'inline' ? 'settings-row settings-row--inline' : 'settings-row';
  const text = document.createElement('div');
  text.className = 'settings-row-text';
  const lbl = document.createElement('label');
  lbl.className = 'settings-label';
  lbl.textContent = label;
  const desc = document.createElement('div');
  desc.className = 'settings-desc';
  desc.textContent = description;
  text.append(lbl, desc);
  row.appendChild(text);
  return row;
}

// Boxed list of sub-rows under a section row (Slash commands, Image Paste…).
export function makeGroup(...rows: HTMLElement[]): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'settings-group';
  group.append(...rows);
  return group;
}

// A sub-row whose <label> wraps both the text and the control the caller
// appends, so clicking the text focuses the control.
export function makeFieldLabel(text: string, hint: string, layout: 'inline' | 'stacked' = 'inline'): HTMLLabelElement {
  const l = document.createElement('label');
  l.className = layout === 'inline' ? 'settings-row settings-row--inline' : 'settings-row';
  const wrap = document.createElement('span');
  wrap.className = 'settings-row-text';
  const top = document.createElement('span');
  top.textContent = text;
  top.className = 'settings-label';
  const sub = document.createElement('span');
  sub.className = 'settings-desc';
  sub.textContent = hint;
  wrap.append(top, sub);
  l.appendChild(wrap);
  return l;
}

// A labeled <select> populated from a list of options. Returns the row
// element and the select element so callers can read its value on save and
// wire change listeners.
export function makeSelectRow<T extends string>(
  label: string,
  description: string,
  current: T,
  options: Array<{ value: T; label: string }>,
): { row: HTMLElement; select: HTMLSelectElement } {
  const row = makeRow(label, description, 'inline');
  const select = document.createElement('select');
  select.className = 'settings-input';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (current === opt.value) {o.selected = true;}
    select.appendChild(o);
  }
  row.appendChild(select);
  return { row, select };
}

export function makeCheckboxRow(label: string, description: string, current: boolean): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('div');
  row.className = 'settings-row settings-row--inline settings-row--check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = current;
  const labelWrap = document.createElement('label');
  labelWrap.className = 'settings-row-text';
  const lbl = document.createElement('span');
  lbl.className = 'settings-label';
  lbl.textContent = label;
  const desc = document.createElement('span');
  desc.className = 'settings-desc';
  desc.textContent = description;
  labelWrap.append(lbl);
  if (description) {labelWrap.append(desc);}
  labelWrap.addEventListener('click', (e) => {
    // Native label-for would be cleaner but we'd need unique ids; cheaper to
    // forward clicks manually (and we still want the entire row clickable).
    if (e.target !== input) {
      e.preventDefault();
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change'));
    }
  });
  row.append(labelWrap, input);
  return { row, input };
}

/**
 * The section context with these builders; `close` closes whatever hosts the
 * rows, `openLink` opens an external link through the host (policy links).
 */
export function settingsSectionContext(close: () => void, openLink?: (href: string) => void): MikeDownSettingsSectionContext {
  return { makeRow, makeGroup, makeFieldLabel, makeCheckboxRow, makeSelectRow, close, ...(openLink ? { openLink } : {}) };
}
