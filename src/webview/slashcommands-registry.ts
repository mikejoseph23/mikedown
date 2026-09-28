// Pure slash-command registry and matcher for the Notion-style "/" menu.
//
// This module has NO DOM, NO TipTap, and NO `vscode` imports. It is safe to
// import from both the webview bundle and from plain vitest (node) tests.
// The action each command performs (inserting a heading, opening a picker,
// etc.) is intentionally NOT defined here — M3 (existing-block commands) and
// M6 (properties/date/datetime) map `id` to an action elsewhere, so this
// registry stays pure data plus pure matching logic.

export type SlashCommandGroup = 'basic' | 'lists' | 'callouts' | 'insert';

export interface SlashCommand {
  /** Stable identifier. Also the primary matchable "name" for ranking. */
  id: string;
  /** Human-readable label shown in the popup. */
  title: string;
  /** One-line description shown under/next to the title. */
  description: string;
  /** Additional matchable strings (case-insensitive), ranked below `id`. */
  aliases: string[];
  /** Which section of the popup this command is grouped under. */
  group: SlashCommandGroup;
  /** Icon key; M2 maps this to the existing toolbar icon set. */
  icon: string;
  /** Optional extra search terms. Not used by matchCommands' ranking. */
  keywords?: string[];
  /** When true, only offered when the current document has no frontmatter. */
  requiresNoFrontmatter?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Big section heading',
    aliases: ['heading1', 'title'],
    group: 'basic',
    icon: 'heading-1',
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading',
    aliases: ['heading2'],
    group: 'basic',
    icon: 'heading-2',
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading',
    aliases: ['heading3'],
    group: 'basic',
    icon: 'heading-3',
  },
  {
    id: 'h4',
    title: 'Heading 4',
    description: 'Smaller section heading',
    aliases: ['heading4'],
    group: 'basic',
    icon: 'heading-4',
  },
  {
    id: 'h5',
    title: 'Heading 5',
    description: 'Smaller section heading',
    aliases: ['heading5'],
    group: 'basic',
    icon: 'heading-5',
  },
  {
    id: 'h6',
    title: 'Heading 6',
    description: 'Smallest section heading',
    aliases: ['heading6'],
    group: 'basic',
    icon: 'heading-6',
  },
  {
    id: 'text',
    title: 'Paragraph',
    description: 'Plain body text',
    aliases: ['p', 'paragraph'],
    group: 'basic',
    icon: 'paragraph',
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Wrap the block in a blockquote',
    aliases: ['blockquote'],
    group: 'basic',
    icon: 'quote',
  },
  {
    id: 'bullet',
    title: 'Bullet list',
    description: 'Unordered list of items',
    aliases: ['ul', 'list'],
    group: 'lists',
    icon: 'list-unordered',
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    description: 'Ordered list of items',
    aliases: ['ol', '1.'],
    group: 'lists',
    icon: 'list-ordered',
  },
  {
    id: 'todo',
    title: 'Task list',
    description: 'Checkbox list of tasks',
    aliases: ['task', 'checkbox'],
    group: 'lists',
    icon: 'checklist',
  },
  {
    id: 'code',
    title: 'Code block',
    description: 'Fenced code block with a language picker',
    aliases: ['codeblock', '```'],
    group: 'insert',
    icon: 'code',
  },
  {
    id: 'mermaid',
    title: 'Mermaid',
    description: 'Diagram block with a starter flowchart',
    aliases: ['diagram', 'chart'],
    group: 'insert',
    icon: 'type-hierarchy',
  },
  {
    id: 'math',
    title: 'Math Block',
    description: 'Display formula ($$ LaTeX $$)',
    aliases: ['equation', 'latex', 'katex', 'formula'],
    group: 'insert',
    icon: 'math',
  },
  {
    id: 'inline-math',
    title: 'Inline Math',
    description: 'Formula inside the line ($ LaTeX $)',
    aliases: ['equation', 'latex'],
    group: 'insert',
    icon: 'math',
  },
  {
    id: 'table',
    title: 'Table',
    description: 'Insert a table with a size picker',
    aliases: ['grid'],
    group: 'insert',
    icon: 'table',
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Horizontal rule',
    aliases: ['hr', '---'],
    group: 'basic',
    icon: 'horizontal-rule',
  },
  {
    id: 'note',
    title: 'Note callout',
    description: 'GFM note admonition',
    aliases: ['callout'],
    group: 'callouts',
    icon: 'note',
  },
  {
    id: 'tip',
    title: 'Tip callout',
    description: 'GFM tip admonition',
    aliases: [],
    group: 'callouts',
    icon: 'lightbulb',
  },
  {
    id: 'important',
    title: 'Important callout',
    description: 'GFM important admonition',
    aliases: [],
    group: 'callouts',
    icon: 'report',
  },
  {
    id: 'warning',
    title: 'Warning callout',
    description: 'GFM warning admonition',
    aliases: ['warn'],
    group: 'callouts',
    icon: 'warning',
  },
  {
    id: 'caution',
    title: 'Caution callout',
    description: 'GFM caution admonition',
    aliases: ['danger'],
    group: 'callouts',
    icon: 'error',
  },
  {
    id: 'link',
    title: 'Link',
    description: 'Insert a link',
    aliases: ['url'],
    group: 'insert',
    icon: 'link',
  },
  {
    id: 'wikilink',
    title: 'Wikilink',
    description: 'Insert a [[wikilink]] and search pages',
    aliases: ['[[', 'page'],
    group: 'insert',
    icon: 'symbol-file',
  },
  {
    id: 'image',
    title: 'Image',
    description: 'Insert an image from a file',
    aliases: ['img', 'picture'],
    group: 'insert',
    icon: 'file-media',
  },
  {
    id: 'emoji',
    title: 'Emoji',
    description: 'Insert an emoji',
    aliases: [':'],
    group: 'insert',
    icon: 'smiley',
  },
  {
    id: 'properties',
    title: 'Properties',
    description: 'Insert frontmatter and open Properties',
    aliases: ['frontmatter', 'yaml'],
    group: 'insert',
    icon: 'settings-gear',
    requiresNoFrontmatter: true,
  },
  {
    id: 'date',
    title: 'Date',
    description: "Insert today's date",
    aliases: ['today'],
    group: 'insert',
    icon: 'calendar',
  },
  {
    id: 'datetime',
    title: 'Date and time',
    description: 'Insert the current date and time',
    aliases: ['timestamp', 'now'],
    group: 'insert',
    icon: 'clock',
  },
];

/** Starter content for a freshly inserted `/mermaid` code block. */
export const MERMAID_STARTER_DIAGRAM = `flowchart TD
    A[Start] --> B[Process]
    B --> C[End]
`;

export interface MatchContext {
  hasFrontmatter: boolean;
}

/**
 * Filters and ranks commands for a slash-menu query.
 *
 * Ranking tiers (each command appears in exactly one, the highest it
 * qualifies for): exact match on `id` or an alias, then prefix match on
 * `id`, then prefix match on an alias. Ties within a tier keep registry
 * order. Matching is case-insensitive. An empty query returns every
 * available command in registry order.
 *
 * Commands with `requiresNoFrontmatter` are excluded entirely when
 * `ctx.hasFrontmatter` is true.
 */
export function matchCommands(
  query: string,
  ctx: MatchContext,
  commands: readonly SlashCommand[] = SLASH_COMMANDS
): SlashCommand[] {
  const available = commands.filter((cmd) => !(cmd.requiresNoFrontmatter && ctx.hasFrontmatter));

  const q = query.toLowerCase();
  if (q.length === 0) {
    return available.slice();
  }

  const exact: SlashCommand[] = [];
  const namePrefix: SlashCommand[] = [];
  const aliasPrefix: SlashCommand[] = [];

  for (const cmd of available) {
    const name = cmd.id.toLowerCase();
    const aliases = cmd.aliases.map((a) => a.toLowerCase());

    if (name === q || aliases.includes(q)) {
      exact.push(cmd);
    } else if (name.startsWith(q)) {
      namePrefix.push(cmd);
    } else if (aliases.some((a) => a.startsWith(q))) {
      aliasPrefix.push(cmd);
    }
  }

  return [...exact, ...namePrefix, ...aliasPrefix];
}

export interface SlashQueryMatch {
  /** Index within `textBefore` where the triggering `/` character sits. */
  offset: number;
  /** The non-whitespace text typed after `/`, possibly empty. */
  query: string;
}

/**
 * Finds a triggering `/query` ending at the cursor within `textBefore`
 * (the plain text of the current textblock up to the cursor).
 *
 * Trigger rules: the `/` must sit at the start of the textblock (only
 * possible when `atBlockStart` is true) or immediately after a whitespace
 * character, and everything after the `/` up to the cursor must be
 * non-whitespace. This deliberately rejects `and/or`, `path/to`, and
 * `https://x.com/a/b`, where the `/` is preceded by a non-whitespace
 * character.
 */
export function extractSlashQuery(textBefore: string, atBlockStart: boolean): SlashQueryMatch | null {
  if (textBefore.length === 0) {
    return null;
  }

  // Walk back from the end to find the start of the trailing run of
  // non-whitespace characters ending at the cursor.
  let i = textBefore.length;
  while (i > 0 && !/\s/.test(textBefore[i - 1])) {
    i--;
  }
  const slashIdx = i;

  if (textBefore[slashIdx] !== '/') {
    return null;
  }

  // If the run starts at index 0, that only counts as a valid trigger
  // position when index 0 is genuinely the start of the textblock; a
  // whitespace character always precedes the run otherwise, by construction
  // of the backward scan above.
  if (slashIdx === 0 && !atBlockStart) {
    return null;
  }

  return { offset: slashIdx, query: textBefore.slice(slashIdx + 1) };
}
