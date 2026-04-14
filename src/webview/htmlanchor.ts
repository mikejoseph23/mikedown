import { Node, mergeAttributes } from '@tiptap/core';

// Inline HTML anchor support: `<a id="foo"></a>` / `<a name="foo"></a>`.
//
// Narrow slice of raw-HTML passthrough — only matches *empty* `<a>` tags that
// carry `id` and/or `name` (and no `href`). These are the anchor-target pattern
// used for stable cross-refs and back-to-top links in CommonMark / GFM docs.
//
// Round-trip:
//   parse   — a markdown-it inline rule (registered via tiptap-markdown's
//             per-node parse.setup hook) pushes an `html_inline` token for the
//             matched anchor, which renders as real HTML even though the
//             parser's `html` option is off.
//   render  — emits `<a id="…" name="…">` in the editor DOM.
//   serialize — writes the original `<a id="…"></a>` / `<a name="…"></a>`
//             back to markdown.

const ATTR_ID_RE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const ATTR_NAME_RE = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const ANCHOR_RE = /^<a\s+([^>]*?)\s*\/?\s*>\s*(?:<\/a\s*>)?/i;

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function renderTokenHtml(id: string | null, name: string | null): string {
  let out = '<a';
  if (id) out += ` id="${escapeAttr(id)}"`;
  if (name) out += ` name="${escapeAttr(name)}"`;
  out += '></a>';
  return out;
}

export const HtmlAnchor = Node.create({
  name: 'htmlAnchor',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: { default: null },
      name: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a',
        // Higher than the default Link mark parseHTML so empty anchor-only
        // tags are picked up as this node rather than as an empty link.
        priority: 60,
        getAttrs: (dom) => {
          if (typeof dom === 'string') return false;
          const el = dom as HTMLElement;
          if (el.hasAttribute('href')) return false;
          const id = el.getAttribute('id');
          const name = el.getAttribute('name');
          if (!id && !name) return false;
          // Reject anchors that wrap content — those aren't the target pattern.
          if ((el.textContent || '').trim() !== '') return false;
          if (el.children.length > 0) return false;
          return { id, name };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs: Record<string, string> = {};
    if (node.attrs.id) attrs.id = node.attrs.id;
    if (node.attrs.name) attrs.name = node.attrs.name;
    attrs.class = 'mikedown-html-anchor';
    return ['a', mergeAttributes(HTMLAttributes, attrs)];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const id = node.attrs.id;
          const name = node.attrs.name;
          let out = '<a';
          if (id) out += ` id="${escapeAttr(id)}"`;
          if (name) out += ` name="${escapeAttr(name)}"`;
          out += '></a>';
          state.write(out);
        },
        parse: {
          setup(markdownit: any) {
            markdownit.inline.ruler.before('html_inline', 'mikedown_html_anchor', (state: any, silent: boolean) => {
              const src = state.src;
              const pos = state.pos;
              if (src.charCodeAt(pos) !== 0x3c /* < */) return false;
              if (pos + 2 >= state.posMax) return false;
              const ch1 = src.charCodeAt(pos + 1);
              if (ch1 !== 0x61 /* a */ && ch1 !== 0x41 /* A */) return false;
              const ch2 = src.charCodeAt(pos + 2);
              // Must be followed by whitespace — otherwise it's `<abbr>` etc.
              if (ch2 !== 0x20 && ch2 !== 0x09 && ch2 !== 0x0a && ch2 !== 0x0d) return false;

              const rest = src.slice(pos);
              const openMatch = rest.match(ANCHOR_RE);
              if (!openMatch) return false;
              const attrsStr = openMatch[1] || '';

              if (/\bhref\s*=/i.test(attrsStr)) return false;
              const idMatch = attrsStr.match(ATTR_ID_RE);
              const nameMatch = attrsStr.match(ATTR_NAME_RE);
              const id = idMatch ? (idMatch[1] ?? idMatch[2]) : null;
              const name = nameMatch ? (nameMatch[1] ?? nameMatch[2]) : null;
              if (!id && !name) return false;

              // If the opener wasn't self-closing, the regex already consumed
              // `</a>` (empty content only) — if content exists between the
              // tags, openMatch fails and we never reach here.
              let consumed = openMatch[0].length;

              // Handle the non-self-closing, no-close case: `<a id="x">` with
              // no following `</a>` — treat as an empty anchor as well.
              const selfClosing = /\/\s*>\s*$/.test(openMatch[0]);
              const hasClose = /<\/a\s*>\s*$/i.test(openMatch[0]);
              if (!selfClosing && !hasClose) {
                // Look ahead for `</a>` directly after (allow only whitespace).
                const after = src.slice(pos + consumed);
                const closeMatch = after.match(/^\s*<\/a\s*>/i);
                if (closeMatch) {
                  consumed += closeMatch[0].length;
                }
                // If no close tag and not self-closing, still accept as a
                // bare marker so users writing `<a id="x">` (no close) work.
              }

              if (!silent) {
                const token = state.push('html_inline', '', 0);
                token.content = renderTokenHtml(id, name);
              }
              state.pos += consumed;
              return true;
            });
          },
        },
      },
    };
  },
});
