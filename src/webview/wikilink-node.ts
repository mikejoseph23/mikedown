import { Node, mergeAttributes, InputRule } from '@tiptap/core';


// Obsidian-style `[[wikilink]]` support.
//
//   [[Note]]            → links to Note.md anywhere in the workspace
//   [[Note|alias]]      → renders "alias", links to Note.md
//   [[Note#Heading]]    → links to Note.md and scrolls to #heading
//   [[Note#Heading|x]]  → combination of the above
//
// Unlike standard `[text](path.md)` links, wikilinks are **name-based**: the
// target is a bare basename resolved against every markdown file in the
// workspace (host-side, by `path.basename`), so the link survives files being
// moved or scattered across repos. This is what makes MikeDown usable as an
// editor over an Obsidian-style "vault" spread across many git repos.
//
// Implemented as an inline atomic node (a single, non-editable unit), mirroring
// the custom-node pattern in `callout-node.ts`: a markdown-it inline parse rule
// + a `state.write` serializer + a `parseHTML`/`renderHTML` HTML bridge.
//
// Resolution is display-only: `href`/`resolved` are runtime attrs set from the
// host's `wikilinksResolved` response via a `addToHistory:false` transaction —
// they never round-trip to markdown, so resolving a link never dirties the doc
// or pushes an undo step.

/** Inner-form matcher: `[[target(#anchor)?(|alias)?]]`. Target excludes the
 *  `]`, `|` and `#` delimiters; anchor stops at `]`/`|`; alias runs to `]]`. */
export const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/;

export interface ParsedWikilink {
  target: string;
  anchor: string | null;
  alias: string | null;
}

/** Parse a single `[[...]]` string (anchored at position 0) into its parts.
 *  Returns null when the input is not a wikilink. Shared by the markdown-it
 *  rule and unit tests. */
export function parseWikilink(raw: string): ParsedWikilink | null {
  const m = new RegExp('^' + WIKILINK_REGEX.source).exec(raw);
  if (!m) return null;
  return {
    target: m[1].trim(),
    anchor: m[2] != null ? m[2].trim() : null,
    alias: m[3] != null ? m[3].trim() : null,
  };
}

/** Serialize node attrs back to canonical `[[target(#anchor)?(|alias)?]]`. */
export function serializeWikilink(attrs: { target: string; anchor?: string | null; alias?: string | null }): string {
  const target = attrs.target ?? '';
  const anchor = attrs.anchor ? '#' + attrs.anchor : '';
  const alias = attrs.alias ? '|' + attrs.alias : '';
  return `[[${target}${anchor}${alias}]]`;
}

function escAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-target') || el.textContent || '',
        renderHTML: (attrs) => ({ 'data-target': attrs.target }),
      },
      anchor: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-anchor') || null,
        renderHTML: (attrs) => (attrs.anchor ? { 'data-anchor': attrs.anchor } : {}),
      },
      alias: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-alias') || null,
        renderHTML: (attrs) => (attrs.alias ? { 'data-alias': attrs.alias } : {}),
      },
      // ── Display-only, NOT serialized to markdown ──────────────────────────
      // href: the resolved relative path (with anchor appended) supplied by the
      // host. Present → the existing openLink mousedown handler can navigate it.
      href: {
        default: null,
        parseHTML: () => null, // never restored from HTML — always re-resolved
        renderHTML: (attrs) => (attrs.href ? { href: attrs.href } : {}),
      },
      // resolved: null = pending (neutral), true = target found, false = unresolved.
      resolved: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
      // ambiguous: true when several workspace files share this basename, so
      // the link resolved to the *nearest* one but the name is not unique.
      // Display-only; surfaced as a subtle marker + hover hint.
      ambiguous: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-wikilink]' }];
  },

  // Convert a `[[...]]` typed live in the editor into a wikilink node the
  // moment the closing `]]` is entered — otherwise it would stay raw text
  // until the next save/reload round-trip re-parses the markdown.
  addInputRules() {
    return [
      new InputRule({
        find: new RegExp(WIKILINK_REGEX.source + '$'),
        handler: ({ state, range, match }) => {
          const target = (match[1] || '').trim();
          if (!target) return;
          const attrs = {
            target,
            anchor: match[2] != null ? match[2].trim() : null,
            alias: match[3] != null ? match[3].trim() : null,
          };
          state.tr.replaceWith(range.from, range.to, this.type.create(attrs));
        },
      }),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { target, alias, resolved, ambiguous } = node.attrs as {
      target: string; anchor: string | null; alias: string | null; href: string | null; resolved: boolean | null; ambiguous: boolean | null;
    };
    const label = (alias && alias.length ? alias : target) || '';
    let cls = 'mikedown-wikilink';
    if (resolved === false) cls += ' mikedown-unresolved';
    if (ambiguous) cls += ' mikedown-wikilink-ambiguous';
    return [
      'a',
      mergeAttributes(HTMLAttributes, { 'data-wikilink': '', class: cls }),
      label,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(serializeWikilink(node.attrs));
        },
        parse: {
          setup(md: any) {
            // Inline rule: match `[[...]]` before markdown-it's own `link` rule
            // so the double-bracket form wins over `[text](url)` parsing.
            md.inline.ruler.before('link', 'wikilink', (state: any, silent: boolean) => {
              const src: string = state.src;
              const pos: number = state.pos;
              // Fast bail: must start with `[[`.
              if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) {
                return false;
              }
              const m = new RegExp('^' + WIKILINK_REGEX.source).exec(src.slice(pos));
              if (!m) return false;
              if (!silent) {
                const token = state.push('wikilink', '', 0);
                token.meta = {
                  target: m[1].trim(),
                  anchor: m[2] != null ? m[2].trim() : '',
                  alias: m[3] != null ? m[3].trim() : '',
                };
              }
              state.pos += m[0].length;
              return true;
            });

            // Renderer: markdown-it → HTML that `parseHTML` (a[data-wikilink])
            // picks up. `resolved`/`href` are intentionally omitted here — they
            // are filled in later by the host resolution round-trip.
            md.renderer.rules.wikilink = (tokens: any[], idx: number) => {
              const meta = tokens[idx].meta || {};
              const target: string = meta.target || '';
              const anchor: string = meta.anchor || '';
              const alias: string = meta.alias || '';
              const label = alias || target;
              let out = `<a data-wikilink data-target="${escAttr(target)}"`;
              if (anchor) out += ` data-anchor="${escAttr(anchor)}"`;
              if (alias) out += ` data-alias="${escAttr(alias)}"`;
              out += ` class="mikedown-wikilink">${escHtml(label)}</a>`;
              return out;
            };
          },
        },
      },
    };
  },
});
