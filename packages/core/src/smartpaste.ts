import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { DOMParser as PMDOMParser, Fragment, Slice as PMSlice } from '@tiptap/pm/model';
import { handlePaste as handleTablePaste, isInTable } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import { detectTextTable, tableCopyPlugin, textTableToNode } from './table-clipboard';

export const SmartPasteExtension = Extension.create({
  name: 'smartPaste',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('smartPaste'),
        props: {
          handlePaste: (view, event, _slice) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData) {return false;}

            const htmlData = clipboardData.getData('text/html');

            // A pipe table or TSV in the plain-text flavour becomes a table,
            // unless the HTML flavour carries a real table (spreadsheets),
            // which the HTML path below handles with formatting.
            if (!/<table[\s>]/i.test(htmlData) && pasteTextTable(editor, view, event)) {return true;}

            // Task 7: Guard against empty clipboard content
            if (!htmlData || !htmlData.trim()) {return false;}

            // Don't process very large pastes — fallback to plain text
            if (htmlData.length > 500_000) {return false;}

            // Use TipTap's existing HTML-to-ProseMirror parsing
            // but strip noisy markup first
            const cleaned = cleanHtml(htmlData);

            // Task 7: Guard against empty/trivial cleaned output
            if (!cleaned.trim() || cleaned === '<br>' || cleaned === '<p></p>') {return false;}

            // Parse with DOMParser, then use ProseMirror's DOMParser
            const domParser = new DOMParser();
            const htmlDoc = domParser.parseFromString(cleaned, 'text/html');

            // Use ProseMirror's DOMParser to convert to PM Slice
            const pmParser = PMDOMParser.fromSchema(view.state.schema);
            const slice = pmParser.parseSlice(htmlDoc.body, {
              preserveWhitespace: false,
            });

            if (!slice || slice.content.childCount === 0) {return false;}

            // A table pasted with the cursor in a table fills cells from the
            // cursor, spreadsheet style (prosemirror-tables), instead of
            // nesting a table inside the cell.
            if (slice.content.firstChild?.type.name === 'table' && isInTable(view.state)) {
              return pasteTableIntoTable(view, event, slice);
            }

            const { tr } = view.state;
            tr.replaceSelection(slice);
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
      // Copied tables get a markdown pipe table as their plain-text flavour.
      tableCopyPlugin(editor),
    ];
  },
});

// ---------------------------------------------------------------------------
// Plain-text tables (pipe tables and TSV)
// ---------------------------------------------------------------------------

/**
 * Paste `text/plain` that is a whole pipe table or TSV block as a table: fills
 * cells from the cursor inside a table, inserts a table elsewhere. Not in code
 * blocks, and not on a shift paste (paste without formatting stays verbatim).
 */
export function pasteTextTable(editor: Editor, view: EditorView, event: ClipboardEvent): boolean {
  const { $from } = view.state.selection;
  if ($from.parent.type.spec.code) {return false;}
  if ((view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey) {return false;}
  const inTable = isInTable(view.state);
  const table = detectTextTable(event.clipboardData?.getData('text/plain') ?? '', { singleRow: inTable });
  if (!table) {return false;}
  const node = textTableToNode(editor, table);
  if (!node) {return false;}
  const slice = new PMSlice(Fragment.from(node), 0, 0);
  if (inTable) {return pasteTableIntoTable(view, event, slice);}
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  return true;
}

// ---------------------------------------------------------------------------
// Table into table
// ---------------------------------------------------------------------------

type Slice = Parameters<typeof handleTablePaste>[2];

function tablePosAround(state: EditorState): number {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') {return $from.before(d);}
  }
  return -1;
}

/**
 * Hand the pasted table to prosemirror-tables, then make the target table GFM
 * again: the pasted cells keep their own header/body type, so header cells can
 * land in body rows (and the reverse), which would save as an HTML table.
 */
function pasteTableIntoTable(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
  const tablePos = tablePosAround(view.state);
  const proxy = {
    get state() { return view.state; },
    dispatch: (tr: Transaction) => {
      if (tablePos >= 0) {normalizeHeaderRow(tr, tr.mapping.map(tablePos));}
      view.dispatch(tr.scrollIntoView());
    },
  } as unknown as EditorView;
  return handleTablePaste(proxy, event, slice);
}

/** First row header cells, every other row body cells. */
export function normalizeHeaderRow(tr: Transaction, tablePos: number): void {
  const table = tr.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') {return;}
  const { tableHeader, tableCell } = tr.doc.type.schema.nodes;
  if (!tableHeader || !tableCell) {return;}
  let rowPos = tablePos + 1;
  table.forEach((row, _offset, rowIndex) => {
    let cellPos = rowPos + 1;
    row.forEach((cell) => {
      const want = rowIndex === 0 ? tableHeader : tableCell;
      if (cell.type !== want) {tr.setNodeMarkup(cellPos, want, cell.attrs);}
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });
}

// ---------------------------------------------------------------------------
// HTML Cleaning — strips noise before PM parsing
// ---------------------------------------------------------------------------

function cleanHtml(html: string): string {
  // Task 1: Strip Word StartFragment/EndFragment comment markers before DOM parsing
  html = html.replace(/<!--\[if[^>]*>[\s\S]*?<!\[endif\]-->/gi, '');
  html = html.replace(/<!--StartFragment-->|<!--EndFragment-->/gi, '');

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  // Strip remaining comment nodes
  stripComments(body);

  // Task 4: Remove non-content structural elements (web browser content)
  ['nav', 'aside', 'header', 'footer', 'script', 'style', 'noscript', 'iframe', 'form', 'button', 'input', 'select', 'textarea'].forEach(tag => {
    doc.querySelectorAll(tag).forEach(el => el.remove());
  });

  // Remove meta, link, head elements
  ['meta', 'link', 'head'].forEach(tag => {
    doc.querySelectorAll(tag).forEach(el => el.remove());
  });

  // Remove Word namespace elements
  try {
    body.querySelectorAll('o\\:p').forEach(el => el.remove());
  } catch (_) { /* ignore invalid selectors */ }

  // Task 1: Remove mso-* inline styles from all elements
  doc.querySelectorAll('[style]').forEach(el => {
    const style = el.getAttribute('style') || '';
    const cleaned = style.split(';')
      .filter(s => !s.trim().startsWith('mso-'))
      .join(';');
    if (cleaned.trim()) {
      el.setAttribute('style', cleaned);
    } else {
      el.removeAttribute('style');
    }
  });

  // Task 1: Strip Word XML namespaced tags — extract their text content
  doc.querySelectorAll('w\\:sdt, w\\:sdtContent').forEach(el => {
    el.replaceWith(...Array.from(el.childNodes));
  });

  // Task 1: Remove empty MsoNormal/MsoBodyText paragraphs
  doc.querySelectorAll('p.MsoNormal, p.MsoBodyText').forEach(el => {
    if (!el.textContent?.trim()) {el.remove();}
  });

  // Strip Mso* wrapper elements (keep children)
  unwrapElements(body, '[class^="Mso"]');

  // Strip google-sheets wrapper elements (keep children)
  try {
    doc.querySelectorAll('google-sheets-html-origin').forEach(el => {
      el.replaceWith(...Array.from(el.childNodes));
    });
  } catch (_) { /* ignore */ }

  // Unwrap Google Docs bold wrapper
  unwrapElements(body, 'b[style*="font-weight:normal"]');

  // Task 2: Google Docs list items with style-based type detection
  doc.querySelectorAll('li[style*="list-style-type"]').forEach(el => {
    const style = (el as HTMLElement).style.listStyleType;
    if (style === 'disc' || style === 'circle' || style === 'square') {
      const parent = el.parentElement;
      if (parent && parent.tagName === 'OL') {
        const ul = doc.createElement('ul');
        parent.replaceWith(ul);
        ul.append(...Array.from(parent.children));
      }
    }
  });

  // Task 2: Google Docs internal anchor links — strip heading anchors
  doc.querySelectorAll('a[href]').forEach(el => {
    const href = el.getAttribute('href') || '';
    if (href.includes('docs.google.com') && href.includes('#heading=')) {
      el.setAttribute('href', href.split('#')[0]);
    }
  });

  // Task 3: Slack @mentions → plain text
  doc.querySelectorAll('ts-mention').forEach(el => {
    const text = doc.createTextNode(el.textContent || '');
    el.replaceWith(text);
  });

  // Task 3: Slack emoji → text
  doc.querySelectorAll('ts-emoji').forEach(el => {
    const text = doc.createTextNode(el.textContent || el.getAttribute('data-name') || '');
    el.replaceWith(text);
  });

  // Task 4: Handle <figure><img><figcaption> → img + italic caption paragraph
  doc.querySelectorAll('figure').forEach(fig => {
    const img = fig.querySelector('img');
    const caption = fig.querySelector('figcaption');
    if (img) {
      const fragment = doc.createDocumentFragment();
      fragment.appendChild(img.cloneNode(true));
      if (caption) {
        const p = doc.createElement('p');
        const em = doc.createElement('em');
        em.textContent = caption.textContent || '';
        p.appendChild(em);
        fragment.appendChild(p);
      }
      fig.replaceWith(fragment);
    }
  });

  // Task 4: Handle <dl><dt><dd> → bold term + paragraph description
  doc.querySelectorAll('dl').forEach(dl => {
    const fragment = doc.createDocumentFragment();
    dl.querySelectorAll('dt, dd').forEach(item => {
      const p = doc.createElement('p');
      if (item.tagName === 'DT') {
        const strong = doc.createElement('strong');
        strong.innerHTML = item.innerHTML;
        p.appendChild(strong);
      } else {
        p.innerHTML = item.innerHTML;
      }
      fragment.appendChild(p);
    });
    dl.replaceWith(fragment);
  });

  // Task 4: Unwrap <article> — preserve children, strip wrapper
  doc.querySelectorAll('article').forEach(el => {
    el.replaceWith(...Array.from(el.childNodes));
  });

  // Convert style-based bold/italic (Google Docs)
  convertStyleBasedFormatting(body);

  // Normalize &nbsp; and common HTML entities
  normalizeEntities(body);

  // Task 5: Normalize table HTML before PM parsing
  normalizeTableHtml(doc);

  // Task 6: Normalize nested lists
  normalizeNestedLists(doc);

  // Remove empty block elements
  removeEmptyBlocks(body);

  return body.innerHTML;
}

// ---------------------------------------------------------------------------
// Task 5: Table normalization
// ---------------------------------------------------------------------------

function normalizeTableHtml(doc: Document): void {
  // Innermost first, so an outer table sees its nested tables already settled.
  Array.from(doc.querySelectorAll('table')).reverse().forEach(table => {
    // Merged cells first, while the rows still sit where the source put them.
    expandSpans(doc, table);

    // Ensure there is always a thead with the first row
    let thead = table.querySelector('thead');
    let tbody = table.querySelector('tbody');

    if (!thead) {
      // No thead — promote the first row to a header
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        thead = doc.createElement('thead');
        // Convert all td in the first row to th, keeping their attributes
        // (alignment lives in `style` / `align`).
        firstRow.querySelectorAll('td').forEach(td => {
          td.replaceWith(renameCell(doc, td, 'th'));
        });
        thead.appendChild(firstRow.cloneNode(true));
        firstRow.remove();
        table.insertBefore(thead, table.firstChild);
      }
    }

    // Ensure tbody exists for remaining rows
    if (!tbody) {
      tbody = doc.createElement('tbody');
      const rows = table.querySelectorAll('tr');
      rows.forEach(row => {
        // Skip the header row already in thead
        if (row.parentElement !== thead) {
          tbody!.appendChild(row);
        }
      });
      table.appendChild(tbody);
    }

    // Ensure all rows have the same number of cells
    const allRows = Array.from(table.rows);
    const maxCols = allRows.length > 0 ? Math.max(...allRows.map(r => r.cells.length)) : 0;
    allRows.forEach(row => {
      for (let i = row.cells.length; i < maxCols; i++) {
        row.appendChild(doc.createElement(row.parentElement?.tagName === 'THEAD' ? 'th' : 'td'));
      }
    });

    applyColumnAlignment(table);
  });
}

/** A copy of `cell` as a `th` or `td`, attributes and children kept. */
function renameCell(doc: Document, cell: Element, tag: 'th' | 'td'): Element {
  const out = doc.createElement(tag);
  Array.from(cell.attributes).forEach(a => out.setAttribute(a.name, a.value));
  out.innerHTML = cell.innerHTML;
  return out;
}

/**
 * Turn merged cells into a rectangular grid: a `colspan` cell keeps its
 * content in its first column and gets empty cells after it; a `rowspan` cell
 * gets empty cells at the same columns in the rows below. GFM has no spans, so
 * nothing would otherwise save as markdown.
 */
function expandSpans(doc: Document, table: HTMLTableElement): void {
  const rows = Array.from(table.rows);
  // Column index -> rows still covered by a rowspan from above.
  const pending = new Map<number, number>();
  rows.forEach(row => {
    const tag = (cell: Element | undefined) => (cell?.tagName === 'TH' ? 'th' : 'td');
    const cells = Array.from(row.cells);
    const out: Element[] = [];
    const fillPending = () => {
      let n = pending.get(out.length) ?? 0;
      while (n > 0) {
        pending.set(out.length, n - 1);
        out.push(doc.createElement(tag(cells[0])));
        n = pending.get(out.length) ?? 0;
      }
    };
    cells.forEach(cell => {
      fillPending();
      const col = out.length;
      const colspan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
      const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10) || 1);
      cell.removeAttribute('colspan');
      cell.removeAttribute('rowspan');
      if (colspan > 1) {cell.setAttribute('data-mikedown-spanned', '');}
      out.push(cell);
      for (let i = 1; i < colspan; i++) {out.push(doc.createElement(tag(cell)));}
      if (rowspan > 1) {
        for (let c = col; c < col + colspan; c++) {pending.set(c, rowspan - 1);}
      }
    });
    // Rowspans reaching past the row's last cell.
    const lastPending = Math.max(-1, ...Array.from(pending.entries()).filter(([, n]) => n > 0).map(([c]) => c));
    while (out.length <= lastPending) {
      const n = pending.get(out.length) ?? 0;
      if (n > 0) {pending.set(out.length, n - 1);}
      out.push(doc.createElement(tag(cells[0])));
    }
    if (out.length !== cells.length || out.some((c, i) => c !== cells[i])) {
      cells.forEach(c => c.remove());
      out.forEach(c => row.appendChild(c));
    }
  });
}

function cellAlign(cell: Element): string | null {
  const raw = ((cell as HTMLElement).style?.textAlign || cell.getAttribute('align') || '').toLowerCase();
  if (raw === 'center' || raw === '-webkit-center') {return 'center';}
  if (raw === 'right' || raw === 'end' || raw === '-webkit-right') {return 'right';}
  if (raw === 'left' || raw === 'start' || raw === '-webkit-left') {return 'left';}
  return null;
}

/**
 * Markdown aligns whole columns (the delimiter row, read from the header
 * cells), while pasted HTML aligns cells. Give each column one alignment: the
 * header cell's center or right, else the most common among its body cells
 * (merged cells don't vote; a left header is the default, not a vote). Every cell of the column gets it, so the editor shows what the
 * file will say.
 */
function applyColumnAlignment(table: HTMLTableElement): void {
  const rows = Array.from(table.rows);
  const width = rows.length ? Math.max(...rows.map(r => r.cells.length)) : 0;
  for (let c = 0; c < width; c++) {
    const header = rows[0]?.cells[c];
    let align = header && !header.hasAttribute('data-mikedown-spanned') ? cellAlign(header) : null;
    if (align === 'left') {align = null;}
    if (!align) {
      const votes = new Map<string, number>();
      rows.slice(1).forEach(row => {
        const cell = row.cells[c];
        if (!cell || cell.hasAttribute('data-mikedown-spanned')) {return;}
        const a = cellAlign(cell);
        if (a) {votes.set(a, (votes.get(a) ?? 0) + 1);}
      });
      let best = 0;
      votes.forEach((n, a) => { if (n > best) {best = n; align = a;} });
    }
    const value = align === 'left' ? null : align;
    rows.forEach(row => {
      const cell = row.cells[c] as HTMLElement | undefined;
      if (!cell) {return;}
      cell.style.textAlign = value ?? '';
      if (!cell.getAttribute('style')?.trim()) {cell.removeAttribute('style');}
      if (value) {cell.setAttribute('align', value);} else {cell.removeAttribute('align');}
    });
  }
  table.querySelectorAll('[data-mikedown-spanned]').forEach(cell => cell.removeAttribute('data-mikedown-spanned'));
}

// ---------------------------------------------------------------------------
// Task 6: Nested list normalization
// ---------------------------------------------------------------------------

function normalizeNestedLists(doc: Document): void {
  // Ensure nested lists are proper children of <li> elements
  // Some apps (Google Docs) may put nested lists as siblings of <li>
  doc.querySelectorAll('ul, ol').forEach(list => {
    const children = Array.from(list.childNodes);
    let lastLi: Element | null = null;
    children.forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (el.tagName === 'LI') {
          lastLi = el;
        } else if ((el.tagName === 'UL' || el.tagName === 'OL') && lastLi) {
          // Nested list outside an <li> — move it inside the previous <li>
          lastLi.appendChild(el);
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripComments(node: Element): void {
  const iter = document.createNodeIterator(node, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  let current: Node | null;
  while ((current = iter.nextNode())) {
    comments.push(current);
  }
  comments.forEach(c => c.parentNode?.removeChild(c));
}

function unwrapElements(root: Element, selector: string): void {
  try {
    root.querySelectorAll(selector).forEach(el => {
      const parent = el.parentNode;
      if (!parent) {return;}
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
    });
  } catch (_) { /* ignore */ }
}

function convertStyleBasedFormatting(root: Element): void {
  // Google Docs: <span style="font-weight: 700"> → <strong>
  root.querySelectorAll<HTMLElement>('span[style*="font-weight"]').forEach(el => {
    const fw = el.style.fontWeight;
    if (fw === 'bold' || fw === '700' || parseInt(fw) >= 700) {
      const strong = document.createElement('strong');
      while (el.firstChild) {strong.appendChild(el.firstChild);}
      el.parentNode?.replaceChild(strong, el);
    }
  });

  // Google Docs: <span style="font-style: italic"> → <em>
  root.querySelectorAll<HTMLElement>('span[style*="font-style"]').forEach(el => {
    if (el.style.fontStyle === 'italic') {
      const em = document.createElement('em');
      while (el.firstChild) {em.appendChild(el.firstChild);}
      el.parentNode?.replaceChild(em, el);
    }
  });
}

function normalizeEntities(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }
  nodes.forEach(node => {
    node.textContent = (node.textContent || '')
      .replace(/\u00a0/g, ' ') // &nbsp; → space
      .replace(/\u200b/g, ''); // zero-width space
  });
}

function removeEmptyBlocks(root: Element): void {
  const blockEls = root.querySelectorAll('p, div, span');
  blockEls.forEach(el => {
    if (!el.textContent?.trim() && !el.querySelector('img, table, br, hr')) {
      el.remove();
    }
  });
}
