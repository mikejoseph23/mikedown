import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';

export const SmartPasteExtension = Extension.create({
  name: 'smartPaste',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('smartPaste'),
        props: {
          handlePaste: (view, event, _slice) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            const htmlData = clipboardData.getData('text/html');

            // Task 7: Guard against empty clipboard content
            if (!htmlData || !htmlData.trim()) return false;

            // Don't process very large pastes — fallback to plain text
            if (htmlData.length > 500_000) return false;

            // Use TipTap's existing HTML-to-ProseMirror parsing
            // but strip noisy markup first
            const cleaned = cleanHtml(htmlData);

            // Task 7: Guard against empty/trivial cleaned output
            if (!cleaned.trim() || cleaned === '<br>' || cleaned === '<p></p>') return false;

            // Parse with DOMParser, then use ProseMirror's DOMParser
            const domParser = new DOMParser();
            const htmlDoc = domParser.parseFromString(cleaned, 'text/html');

            // Use ProseMirror's DOMParser to convert to PM Slice
            const pmParser = PMDOMParser.fromSchema(view.state.schema);
            const slice = pmParser.parseSlice(htmlDoc.body, {
              preserveWhitespace: false,
            });

            if (!slice || slice.content.childCount === 0) return false;

            const { tr, selection } = view.state;
            tr.replaceSelection(slice);
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

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
    if (!el.textContent?.trim()) el.remove();
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
  doc.querySelectorAll('table').forEach(table => {
    // Ensure there is always a thead with the first row
    let thead = table.querySelector('thead');
    let tbody = table.querySelector('tbody');

    if (!thead) {
      // No thead — promote the first row to a header
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        thead = doc.createElement('thead');
        // Convert all td in the first row to th
        firstRow.querySelectorAll('td').forEach(td => {
          const th = doc.createElement('th');
          th.innerHTML = td.innerHTML;
          td.replaceWith(th);
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

    // Handle colspan/rowspan: expand merged cells by duplicating content
    table.querySelectorAll('[colspan], [rowspan]').forEach(cell => {
      const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
      const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
      if (colspan > 1) {
        // Add sibling cells for the extra columns
        for (let i = 1; i < colspan; i++) {
          const clone = doc.createElement(cell.tagName.toLowerCase());
          clone.innerHTML = cell.innerHTML;
          cell.parentElement?.insertBefore(clone, cell.nextSibling);
        }
        cell.removeAttribute('colspan');
      }
      if (rowspan > 1) {
        // Add cells in subsequent rows for the extra rows — simplified approach
        cell.removeAttribute('rowspan');
      }
    });

    // Ensure all rows have the same number of cells
    const allRows = Array.from(table.querySelectorAll('tr'));
    const maxCols = allRows.length > 0
      ? Math.max(...allRows.map(r => r.querySelectorAll('td, th').length))
      : 0;
    allRows.forEach(row => {
      const cells = row.querySelectorAll('td, th').length;
      for (let i = cells; i < maxCols; i++) {
        const td = doc.createElement(row.parentElement?.tagName === 'THEAD' ? 'th' : 'td');
        td.textContent = ' ';
        row.appendChild(td);
      }
    });

    // Extract text-align from inline styles and apply as align attribute
    table.querySelectorAll('td[style], th[style]').forEach(cell => {
      const style = (cell as HTMLElement).style.textAlign;
      if (style) {
        cell.setAttribute('align', style);
      }
    });
  });
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
      if (!parent) return;
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
      while (el.firstChild) strong.appendChild(el.firstChild);
      el.parentNode?.replaceChild(strong, el);
    }
  });

  // Google Docs: <span style="font-style: italic"> → <em>
  root.querySelectorAll<HTMLElement>('span[style*="font-style"]').forEach(el => {
    if (el.style.fontStyle === 'italic') {
      const em = document.createElement('em');
      while (el.firstChild) em.appendChild(el.firstChild);
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
