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
            if (!htmlData || !htmlData.trim()) return false;

            // Don't process very large pastes — fallback to plain text
            if (htmlData.length > 500_000) return false;

            // Use TipTap's existing HTML-to-ProseMirror parsing
            // but strip noisy markup first
            const cleaned = cleanHtml(htmlData);
            if (!cleaned.trim()) return false;

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
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  // Strip StartFragment/EndFragment comment markers (Word)
  stripComments(body);

  // Remove non-content elements
  const stripSelectors = [
    'script', 'style', 'meta', 'link', 'head',
    'nav', 'aside', 'header', 'footer',
    'o\\:p',   // Word namespace elements
  ];
  stripSelectors.forEach(sel => {
    try {
      body.querySelectorAll(sel).forEach(el => el.remove());
    } catch (_) { /* ignore invalid selectors */ }
  });

  // Strip Mso* and google-sheets wrapper elements (keep children)
  unwrapElements(body, '[class^="Mso"]');
  unwrapElements(body, 'google-sheets-html-origin');
  unwrapElements(body, 'b[style*="font-weight:normal"]'); // Google Docs wrapper

  // Convert style-based bold/italic (Google Docs)
  convertStyleBasedFormatting(body);

  // Normalize &nbsp; and common HTML entities
  normalizeEntities(body);

  // Remove empty block elements
  removeEmptyBlocks(body);

  return body.innerHTML;
}

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
