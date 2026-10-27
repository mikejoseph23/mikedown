import { Node } from '@tiptap/core';
import type { Node as PmNode, DOMOutputSpec } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Plugin } from '@tiptap/pm/state';
import {
  TOC_START_RE,
  TOC_END_RE,
  DEFAULT_TOC_OPEN,
  DEFAULT_TOC_CLOSE,
  buildTocEntries,
  isTocBody,
  parseTocBody,
  renderTocBody,
  tocBodyMatches,
  type TocEntry,
  type TocHeading,
} from './toc';

// Table of contents block: `<!-- toc -->` … `<!-- tocstop -->` around a nested
// list of heading links (see toc.ts for the format).
//
// One atom node, `tableOfContents`, holding the region verbatim: the two marker
// lines (so markers written by other tools are kept) and the body between them.
// Serializing writes those strings back untouched, so a file round-trips byte
// for byte; `syncTableOfContents` rewrites the body only when the headings no
// longer match what it lists.
//
// Same HTML bridge as footnote.ts / math.ts: a markdown-it block rule emits
// `<nav data-mikedown-toc>` which parseHTML picks up. The parser runs with
// `html: false`, so without this rule the markers are paragraph text.

const TOC_ATTR = 'data-mikedown-toc';

function configureMarkdownIt(md: any): void {
  if (md.__mikedownToc) {return;}
  md.__mikedownToc = true;

  md.block.ruler.before(
    'table',
    'mikedown_toc',
    (state: any, startLine: number, endLine: number, silent: boolean) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) {return false;}
      const lineText = (l: number): string =>
        state.src.slice(state.bMarks[l] + state.tShift[l], state.eMarks[l]).trim();
      const open = lineText(startLine);
      if (!TOC_START_RE.test(open)) {return false;}
      let closeLine = -1;
      for (let l = startLine + 1; l < endLine; l++) {
        if (TOC_END_RE.test(lineText(l))) {
          closeLine = l;
          break;
        }
      }
      if (closeLine < 0) {return false;}
      const body = state.src.slice(state.bMarks[startLine + 1], state.bMarks[closeLine]);
      // Only a list belongs between the markers. Anything else stays as
      // ordinary text rather than being owned (and later regenerated away).
      if (!isTocBody(body)) {return false;}
      if (silent) {return true;}
      const tok = state.push('mikedown_toc', 'nav', 0);
      tok.block = true;
      tok.map = [startLine, closeLine + 1];
      tok.meta = { open, close: lineText(closeLine), body };
      state.line = closeLine + 1;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );

  const attr = (s: string): string => (md.utils.escapeHtml(s) as string).replace(/\n/g, '&#10;');
  md.renderer.rules.mikedown_toc = (tokens: any[], idx: number) => {
    const { open, close, body } = tokens[idx].meta;
    return `<nav ${TOC_ATTR} data-open="${attr(open)}" data-close="${attr(close)}" data-body="${attr(body)}"></nav>\n`;
  };
}

/** Every heading in `doc`, in order. Only top-level ones are listed, like the outline. */
function collectHeadings(doc: PmNode): TocHeading[] {
  const headings: TocHeading[] = [];
  doc.descendants((node, _pos, parent) => {
    if (node.type.name !== 'heading') {return true;}
    headings.push({ level: node.attrs.level as number, text: node.textContent, listed: parent === doc });
    return false;
  });
  return headings;
}

export function tocEntriesFor(doc: PmNode): TocEntry[] {
  return buildTocEntries(collectHeadings(doc));
}

/**
 * A transaction that brings every TOC in the document up to date with its
 * headings, or null when they already match (nothing to dispatch, so an
 * unchanged document is never dirtied).
 */
export function syncTableOfContents(state: EditorState): Transaction | null {
  let tocs: Array<{ pos: number; node: PmNode }> | null = null;
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableOfContents') {(tocs ??= []).push({ pos, node });}
    return !node.isTextblock;
  });
  if (!tocs) {return null;}
  const entries = tocEntriesFor(state.doc);
  const body = renderTocBody(entries);
  const tr = state.tr;
  for (const { pos, node } of tocs as Array<{ pos: number; node: PmNode }>) {
    if (tocBodyMatches(node.attrs.body as string, entries)) {continue;}
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, body });
  }
  return tr.docChanged ? tr : null;
}

/** Nested `<ul>` for `entries`; a jump of more than one level gets empty items. */
function listSpec(entries: TocEntry[]): DOMOutputSpec {
  const root: any[] = ['ul', {}];
  const lists: any[][] = [root];
  const items: Array<any[] | null> = [null];
  for (const e of entries) {
    while (lists.length - 1 > e.depth) {
      lists.pop();
      items.pop();
    }
    while (lists.length - 1 < e.depth) {
      let li = items[items.length - 1];
      if (!li) {
        li = ['li', {}];
        lists[lists.length - 1].push(li);
        items[items.length - 1] = li;
      }
      const ul: any[] = ['ul', {}];
      li.push(ul);
      lists.push(ul);
      items.push(null);
    }
    const li: any[] = ['li', {}, ['a', { href: `#${e.anchor}` }, e.text]];
    lists[lists.length - 1].push(li);
    items[items.length - 1] = li;
  }
  return root as unknown as DOMOutputSpec;
}

export interface TableOfContentsOptions {
  /** Scroll to a heading anchor (no `#`) when a TOC link is clicked. */
  onNavigate: ((anchor: string) => void) | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** Insert a table of contents for the current headings at the cursor. */
      insertTableOfContents: () => ReturnType;
    };
  }
}

export const TableOfContents = Node.create<TableOfContentsOptions>({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { onNavigate: null };
  },

  addAttributes() {
    const fromData = (name: string, fallback: string) => ({
      default: fallback,
      parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) ?? fallback,
      renderHTML: () => ({}),
    });
    return {
      open: fromData('open', DEFAULT_TOC_OPEN),
      close: fromData('close', DEFAULT_TOC_CLOSE),
      body: fromData('body', '\n'),
    };
  },

  parseHTML() {
    return [{ tag: `nav[${TOC_ATTR}]` }];
  },

  renderHTML({ node }) {
    const entries = parseTocBody(node.attrs.body as string);
    const content: DOMOutputSpec = !entries
      ? ['pre', { class: 'mikedown-toc-raw' }, node.attrs.body as string]
      : entries.length
        ? listSpec(entries)
        : ['p', { class: 'mikedown-toc-empty' }, 'Add headings to fill the table of contents.'];
    return [
      'nav',
      { [TOC_ATTR]: '', class: 'mikedown-toc', 'aria-label': 'Table of contents' },
      ['div', { class: 'mikedown-toc-title' }, 'Contents'],
      content,
    ];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ state, commands }) =>
          commands.insertContent({ type: this.name, attrs: { body: renderTocBody(tocEntriesFor(state.doc)) } }),
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const tocLink = (event: Event): HTMLAnchorElement | null => {
      const target = event.target as HTMLElement | null;
      return target?.closest?.<HTMLAnchorElement>(`[${TOC_ATTR}] a[href^="#"]`) ?? null;
    };
    return [
      new Plugin({
        props: {
          // A plain click on an entry jumps to its heading. (Cmd/Ctrl+click
          // goes through the editor's normal link handling first.)
          handleDOMEvents: {
            mousedown: (_view, event) => {
              if (event.button !== 0 || !tocLink(event)) {return false;}
              event.preventDefault();
              return true;
            },
            click: (_view, event) => {
              const link = tocLink(event);
              if (!link) {return false;}
              event.preventDefault();
              options.onNavigate?.(link.getAttribute('href')!.slice(1));
              return true;
            },
          },
        },
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PmNode) {
          state.text(`${node.attrs.open}\n${node.attrs.body}${node.attrs.close}`, false);
          state.closeBlock(node);
        },
        parse: {
          setup(md: any) {
            configureMarkdownIt(md);
          },
        },
      },
    };
  },
});
