// Every MikeDown feature and what each edition does with it. One source for
// the Features page (features/: the list, then the comparison table) and the
// home page highlights. Pure data and string functions, no I/O; shared/vite-plugin.js
// fills the <!--features:...--> markers at dev and build.
//
//   <!--features:list-->        grouped feature list with edition chips
//   <!--features:matrix-->      the comparison table's <tbody>s
//   <!--features:highlights-->  the home page highlights (index.html)
//
// A cell is a mark ('yes' | 'partial' | 'host' | 'no' | 'na'), or
// [mark, noteHtml] or [mark, noteHtml, footnote]. Footnotes are the numbered
// notes under the table on the Features page (#note-N). Strings are HTML: escape <, > and &.

export const EDITIONS = [
  { id: 'desktop', label: 'Desktop', chip: 'Desktop' },
  { id: 'vscode', label: 'VS Code extension', chip: 'VS Code' },
  { id: 'wc', label: 'Web component', chip: 'Web component' },
  { id: 'wrappers', label: 'React / Vue / Angular', chip: 'React, Vue, Angular' },
];

export const MARKS = {
  yes: 'Yes',
  partial: 'Partial',
  host: 'Host must provide',
  no: 'No',
  na: 'n/a',
};

const keys = (mac, other) => `<span class="keys"><kbd>${mac}</kbd>+<kbd>/</kbd></span> (<span class="keys"><kbd>${other}</kbd>+<kbd>/</kbd></span> on Windows and Linux)`;
const ALL = { desktop: 'yes', vscode: 'yes', wc: 'yes', wrappers: 'yes' };
const APPS_ONLY = (vscodeNote) => ({ desktop: 'yes', vscode: ['host', vscodeNote, 2], wc: 'no', wrappers: 'no' });

export const GROUPS = [
  {
    id: 'writing',
    title: 'Writing',
    features: [
      {
        id: 'wysiwyg', name: 'WYSIWYG and source mode', highlight: true,
        description: `Write in a formatted view that reads like the finished document; the file stays plain markdown. ${keys('Cmd', 'Ctrl')} shows the raw source whenever you want it.`,
        editions: ALL,
      },
      {
        id: 'slash', name: 'Slash commands', highlight: true,
        description: 'Type <code>/</code> at the start of a line to insert a heading, list, table, callout, code block, image, footnote, formula or today’s date.',
        editions: {
          desktop: 'yes', vscode: 'yes',
          wc: ['partial', '<code>/image</code> shows only when your <code>host.pickImage</code> opens a file picker.'],
          wrappers: ['partial', '<code>/image</code> needs <code>host.pickImage</code> (React and Vue; Angular has no way to supply it yet).'],
        },
      },
      {
        id: 'smart-paste', name: 'Smart paste', highlight: true,
        description: 'Paste from Google Docs, Word, Slack or a web page and get clean markdown. Paste a URL over selected text to link it.',
        editions: ALL,
      },
      {
        id: 'images', name: 'Image paste and drop',
        note: 'Paste or drop an image and it is saved as a file next to the document.',
        description: 'Paste a screenshot or drop a file. MikeDown saves it next to the document and inserts the link; right-click to resize it.',
        editions: {
          desktop: 'yes', vscode: 'yes',
          wc: ['host', 'Your <code>host.uploadImage</code> stores it; without one, paste and drop are off.'],
          wrappers: ['host', 'Your <code>host.uploadImage</code> stores it (Angular: the <code>imageUpload</code> input).'],
        },
      },
      {
        id: 'tables', name: 'Tables', highlight: true,
        description: 'Insert one from a grid picker, drag rows and columns to reorder them, and select across cells.',
        editions: ALL,
      },
      {
        id: 'math', name: 'Math',
        note: 'The packages can switch it off (<code>features.math</code>).',
        description: 'Inline <code>$E = mc^2$</code> and display <code>$$ … $$</code> LaTeX render with KaTeX, the syntax GitHub uses. Click a formula to edit it.',
        editions: { ...ALL, wc: ['yes', 'The CDN bundle loads KaTeX from jsDelivr the first time a document needs it.'] },
      },
      {
        id: 'callouts', name: 'Callouts, highlights and emoji',
        description: 'GitHub <code>[!NOTE]</code> callouts, <code>==highlighted==</code> text, and <code>:shortcode:</code> emoji with autocomplete and a picker.',
        editions: ALL,
      },
      {
        id: 'code', name: 'Code and diagrams',
        note: 'The packages can switch Mermaid off (<code>features.mermaid</code>).',
        description: 'Syntax highlighting for 192 languages, a copy button on every block, and Mermaid diagrams drawn in place.',
        editions: { ...ALL, wc: ['yes', 'The CDN bundle loads Mermaid from jsDelivr the first time a document needs it.'] },
      },
      {
        id: 'footnotes', name: 'Footnotes',
        description: '<code>[^1]</code> references show as superscripts. Click one to jump to its note.',
        editions: ALL,
      },
      {
        id: 'spellcheck', name: 'Spell check',
        description: 'US or UK English, checked offline, with your own word list. Code and links are left alone.',
        editions: {
          desktop: ['yes', 'Dictionaries included.'],
          vscode: ['partial', 'Off by default; turn on <code>mikedown.spellCheck.enabled</code>.'],
          wc: ['host', 'Give it a dictionary with the <code>spellcheck-dictionary-url</code> attribute.'],
          wrappers: ['host', 'React and Angular: <code>spellcheckDictionaryUrl</code>. Vue: no option yet.'],
        },
      },
      {
        id: 'find', name: 'Find and replace',
        description: 'Search and replace inside the formatted view, without switching to source.',
        editions: ALL,
      },
    ],
  },
  {
    id: 'organizing',
    title: 'Organizing notes',
    features: [
      {
        id: 'sidebar', name: 'Document sidebar', highlight: true,
        note: 'Outline, Properties, Backlinks and Tags in one panel beside the document.',
        description: 'An outline that follows your cursor, backlinks, tags and properties in one panel beside the document, with word count and reading time at the bottom.',
        editions: {
          desktop: 'yes', vscode: 'yes',
          wc: ['partial', 'Off until you set <code>features: { sidebar: true }</code>. Outline and Properties work on their own; Backlinks and Tags need your app.'],
          wrappers: ['partial', 'Off until you set <code>features: { sidebar: true }</code>. Outline and Properties work on their own; Backlinks and Tags need your app.'],
        },
      },
      {
        id: 'link-complete', name: 'Links that know your files',
        description: 'Start a link and pick from matching files and headings. Cmd-click or Ctrl-click follows it.',
        editions: {
          desktop: ['partial', 'In a window with a folder open; a single file has no files to suggest.'],
          vscode: 'yes',
          wc: ['host', 'Your <code>host.getLinkSuggestions</code> and <code>host.getFileHeadings</code> supply files and headings; <code>host.openLink</code> follows relative links.'],
          wrappers: ['host', 'React and Vue: the same <code>host</code> methods. Angular: push files with <code>handle.setLinkSuggestions()</code>; no headings yet.'],
        },
      },
      {
        id: 'broken-links', name: 'Broken link detection',
        description: 'Links to missing files or headings get a red wavy underline before anyone else finds them.',
        editions: {
          desktop: ['partial', 'In a window with a folder open.'],
          vscode: 'yes',
          wc: ['host', 'Your <code>host.checkLinks</code> returns the broken ones.'],
          wrappers: ['host', 'React and Vue: <code>host.checkLinks</code>. Angular: no way to supply it yet.'],
        },
      },
      {
        id: 'backlinks', name: 'Backlinks',
        note: 'The documents that link to the one you are reading.',
        description: 'See every document that links to the one you are reading, and jump to it.',
        editions: {
          desktop: 'yes', vscode: 'yes',
          wc: ['host', 'Your app builds the index and pushes it with <code>handle.setBacklinks</code>.'],
          wrappers: ['host', 'Your app builds the index and pushes it with <code>handle.setBacklinks</code>.'],
        },
      },
      {
        id: 'wikilinks-tags', name: 'Wikilinks and tags',
        note: '<code>[[Wikilinks]]</code> and <code>#tags</code> are recognized everywhere.',
        description: '<code>[[Wikilinks]]</code>, inline <code>#tags</code> nested like <code>#project/active</code>, and frontmatter tags, indexed across your notes with autocomplete as you type.',
        editions: {
          desktop: ['partial', 'No tag autocomplete as you type.'],
          vscode: 'yes',
          wc: ['host', 'Resolving links and listing tags needs your app (<code>resolveWikilinks</code>, <code>getTags</code>).'],
          wrappers: ['host', 'React and Vue: <code>resolveWikilinks</code>, <code>getTags</code>. Angular: not yet.'],
        },
      },
      {
        id: 'properties', name: 'Properties and frontmatter',
        note: 'The frontmatter block works everywhere; the Properties panel lives in the sidebar.',
        description: 'YAML frontmatter shows as a tidy block and as editable properties in the sidebar.',
        editions: ALL,
      },
      {
        id: 'heading-numbers', name: 'Heading numbering',
        description: 'Optional section numbers (1, 1.1, 1.1.1) that stay in order as you move sections. They are plain text, so GitHub shows them too.',
        editions: { desktop: 'yes', vscode: 'yes', wc: ['yes', 'Kept across reloads only through <code>host.saveSettings</code> (Angular saves it for you).', 4], wrappers: ['yes', 'Kept across reloads only through <code>host.saveSettings</code> (Angular saves it for you).', 4] },
      },
    ],
  },
  {
    id: 'yours',
    title: 'Making it yours',
    features: [
      {
        id: 'toolbar', name: 'Your own toolbar',
        note: 'Rearrange the toolbar in place.',
        description: 'Drag buttons, separators and spacers into the order you like, or do it from the keyboard.',
        editions: {
          desktop: 'yes', vscode: 'yes',
          wc: ['partial', 'The layout is kept only through <code>host.saveSettings</code>.', 4],
          wrappers: ['partial', 'The layout is kept only through <code>host.saveSettings</code>.', 4],
        },
      },
      {
        id: 'settings', name: 'Settings inside the editor',
        note: 'The gear button opens the settings inside the editor.',
        description: 'The gear button opens every setting in a panel inside the editor, previewed as you change it.',
        editions: {
          desktop: 'yes', vscode: 'yes',
          wc: ['partial', 'The gear opens; changes are saved only through <code>host.saveSettings</code>.', 4],
          wrappers: ['partial', 'The gear opens; changes are saved only through <code>host.saveSettings</code>.', 4],
        },
      },
      {
        id: 'zoom', name: 'Zoom',
        description: 'Change the text size with Ctrl and the scroll wheel (Cmd on a Mac), a trackpad pinch, or the zoom control in the toolbar.',
        editions: { desktop: 'yes', vscode: 'yes', wc: ['yes', 'Kept across reloads only through <code>host.saveSettings</code> (Angular saves it for you).', 4], wrappers: ['yes', 'Kept across reloads only through <code>host.saveSettings</code> (Angular saves it for you).', 4] },
      },
      {
        id: 'theme', name: 'Light or dark, just for the editor',
        description: 'Give your writing a light page while everything around it stays dark, or the other way round.',
        editions: {
          desktop: ['no', 'Desktop follows the system theme.'],
          vscode: 'yes',
          wc: ['partial', 'Set it with the <code>theme</code> attribute; the toolbar toggle lasts until reload.'],
          wrappers: ['partial', 'Set it with the <code>theme</code> prop; the toolbar toggle lasts until reload.'],
        },
      },
      {
        id: 'fonts', name: 'Font themes',
        description: 'Ten heading and body font pairings, serif, sans-serif or mixed, previewed live.',
        editions: { desktop: 'yes', vscode: 'yes', wc: ['yes', 'Kept across reloads only through <code>host.saveSettings</code> (Angular saves it for you).', 4], wrappers: ['yes', 'Kept across reloads only through <code>host.saveSettings</code> (Angular saves it for you).', 4] },
      },
      {
        id: 'preserve', name: 'Your markdown, as you wrote it',
        description: 'Saving keeps your markers, line breaks and final newline. Turn on normalization if you want one style everywhere.',
        editions: ALL,
      },
    ],
  },
  {
    id: 'files',
    title: 'Files and windows',
    features: [
      {
        id: 'folders', name: 'Folder tree',
        description: 'Open one file, or a whole folder of notes. The files stay ordinary .md text on your disk, so other apps, Git and sync tools keep working with them.',
        editions: APPS_ONLY('VS Code’s Explorer.'),
      },
      {
        id: 'tabs', name: 'Tabs',
        description: 'Open as many documents as you like, each in its own tab.',
        editions: APPS_ONLY('VS Code’s editor tabs.'),
      },
      {
        id: 'split', name: 'Split panes',
        note: 'Each Desktop pane has its own tabs and sidebar.',
        description: 'Put two documents side by side, each pane with its own tabs and sidebar.',
        editions: APPS_ONLY('VS Code’s editor groups.'),
      },
      {
        id: 'search', name: 'Folder search',
        note: 'Plain text, with case and whole-word options.',
        description: 'Search every note in the folder, with case and whole-word options.',
        editions: APPS_ONLY('VS Code’s Search view.'),
      },
      {
        id: 'history', name: 'Version history', highlight: true,
        note: 'Desktop keeps a snapshot on every save in an open folder, with a side-by-side diff and restore.',
        description: 'A snapshot on every save in an open folder. Compare any snapshot with the current text and go back to it if you need to.',
        editions: APPS_ONLY('Git and the Timeline view.'),
      },
      {
        id: 'windows', name: 'Multi-window',
        note: 'New Window from the Dock or the taskbar; a file from outside the folder can open its own folder in a new window.',
        description: 'Give each folder its own window and open as many as you like. Files land where they belong.',
        editions: APPS_ONLY('VS Code’s own windows.'),
      },
    ],
  },
  {
    id: 'export',
    title: 'Export and updates',
    features: [
      {
        id: 'export', name: 'HTML and PDF export',
        note: 'Export to HTML, print or save as PDF (through the system print dialog).',
        description: 'Save as HTML, print, or save a PDF through the system print dialog.',
        editions: {
          desktop: 'yes', vscode: 'yes',
          wc: ['host', 'Take <code>handle.getHtml()</code> and offer your own download.'],
          wrappers: ['host', 'Take <code>handle.getHtml()</code> and offer your own download.'],
        },
      },
      {
        id: 'rich-copy', name: 'Copy as rich text',
        description: 'Copy a selection or the whole document as formatted text for an email or a chat.',
        editions: {
          desktop: ['no', 'Cmd+C still copies a selection as formatted text.'],
          vscode: 'yes',
          wc: ['host', 'Call <code>handle.command(\'copyAsRichText\')</code> from your own button.'],
          wrappers: ['host', 'Call <code>handle.command(\'copyAsRichText\')</code> from your own button.'],
        },
      },
      {
        id: 'updates', name: 'Auto-update',
        description: 'New versions arrive on their own.',
        editions: {
          desktop: ['partial', 'macOS and Windows update in the app; the Linux AppImage does not.', 3],
          vscode: ['host', 'The Marketplace.', 2],
          wc: ['no', 'You update the npm package.'],
          wrappers: ['no', 'You update the npm packages.'],
        },
      },
    ],
  },
  {
    id: 'ai',
    title: 'AI (experimental)',
    features: [
      {
        id: 'ai-tools', name: 'AI writing tools',
        note: 'Rewrite, Explain, Translate, Summarize, Suggest titles and properties.',
        description: 'Rewrite a selection shorter, longer, simpler or more formal, explain or translate it, summarize the document, and suggest a title and properties. Off until you set up an engine.',
        editions: {
          desktop: ['yes', 'Experimental, off by default.', 1],
          vscode: ['yes', 'Experimental, off by default.', 1],
          wc: ['host', 'The AI tools appear once you set the <code>ai</code> property from script (there is no attribute).', 4],
          wrappers: ['host', 'The AI tools appear once you pass an <code>ai</code> host.', 4],
        },
      },
      {
        id: 'ai-engines', name: 'AI engine setup',
        note: 'Find running local servers, a setup wizard, keys in secure storage and consent per folder or workspace.',
        description: 'Use a model on your own machine, a cloud API key or GitHub Copilot. A wizard finds running local servers; keys stay in secure storage.',
        editions: {
          desktop: ['yes', '', 1],
          vscode: ['yes', 'GitHub Copilot can be an engine too.', 1],
          wc: ['host', 'The same Engines page; the connection, keys and consent dialog are your app’s.', 4],
          wrappers: ['host', 'The same Engines page; the connection, keys and consent dialog are your app’s.', 4],
        },
      },
    ],
  },
  {
    id: 'in-your-app',
    title: 'In your own app',
    features: [
      {
        id: 'binding', name: 'Two-way value binding',
        note: 'Keep the editor’s markdown in your app’s state.',
        description: 'Keep the editor’s markdown in your app’s state, updated as people type.',
        editions: {
          desktop: 'na', vscode: 'na',
          wc: ['yes', 'The <code>value</code> property and the <code>change</code> event.'],
          wrappers: ['yes', 'React <code>value</code> and <code>onChange</code>, Vue <code>v-model</code>, Angular forms.'],
        },
      },
      {
        id: 'form-field', name: 'Native form field',
        description: 'Submits with the form like a textarea, honors <code>required</code> and resets with the form.',
        editions: {
          desktop: 'na', vscode: 'na',
          wc: ['yes', 'Submits under <code>name</code>, honors <code>required</code> and resets with the form.'],
          wrappers: ['partial', 'Angular: reactive and template forms. React and Vue: two-way binding only; wrap the web component or post the value yourself.'],
        },
      },
    ],
  },
];

/** [mark, noteHtml, footnote] for any cell shape. */
export function cell(value) {
  const [mark, note = '', fn = null] = Array.isArray(value) ? value : [value];
  if (!MARKS[mark]) {throw new Error(`features: unknown mark "${mark}"`);}
  return { mark, note, fn };
}

/** 'desktop:yes vscode:host ...', read by the page's edition filter. */
const marksOf = (f) => EDITIONS.map((e) => `${e.id}:${cell(f.editions[e.id]).mark}`).join(' ');
const icon = (mark, size = 16) => `<svg width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="#mk-${mark}"/></svg>`;
const fnRef = (n) => `<sup><a class="fn-ref" href="#note-${n}" aria-label="Note ${n}">${n}</a></sup>`;

/** The <symbol>s the marks use; put it once per page, before the marks. */
export const MARK_SPRITE = `<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false">
    <symbol id="mk-yes" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.2 9.5"/></symbol>
    <symbol id="mk-partial" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></symbol>
    <symbol id="mk-host" viewBox="0 0 24 24"><path d="M9 3v4M15 3v4M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0z M12 16v5"/></symbol>
    <symbol id="mk-no" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></symbol>
    <symbol id="mk-na" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-dasharray="2.6 3.05"/></symbol>
  </svg>`;

/** The comparison table's body: one <tbody> per group, its heading row first. */
export function renderMatrixRows() {
  return GROUPS.map((g, gi) => {
    const rows = [`<tr class="group-row" role="row"><th scope="rowgroup" colspan="${EDITIONS.length + 1}" id="group-${gi + 1}" role="rowheader">${g.title}</th></tr>`];
    for (const f of g.features) {
      const head = `<th scope="row" role="rowheader"><span class="feature"><a href="#${f.id}">${f.name}</a></span>${f.note ? `<span class="feature-note">${f.note}</span>` : ''}</th>`;
      const cells = EDITIONS.map((e) => {
        const { mark, note, fn } = cell(f.editions[e.id]);
        const extra = note || fn ? `<span class="cell-note">${note}${fn ? fnRef(fn) : ''}</span>` : '';
        return `<td role="cell" data-label="${e.label}" data-edition="${e.id}"><span class="mark mark--${mark}">${icon(mark)}${MARKS[mark]}</span>${extra}</td>`;
      });
      rows.push(`<tr role="row" id="compare-${f.id}">\n              ${head}\n              ${cells.join('\n              ')}\n            </tr>`);
    }
    return `<tbody role="rowgroup">\n            ${rows.join('\n            ')}\n          </tbody>`;
  }).join('\n          ');
}

const chipLabel = { yes: '', partial: ' (partial)', host: ' (host must provide)', no: ' (no)', na: ' (does not apply)' };

/** The Features page list: one section per group, one entry per feature with its edition chips. */
export function renderFeatureList() {
  return GROUPS.map((g) => {
    const items = g.features.map((f) => {
      const chips = EDITIONS.map((e) => {
        const { mark } = cell(f.editions[e.id]);
        const body = `${icon(mark, 14)}<span>${e.chip}<span class="visually-hidden">${chipLabel[mark]}</span></span>`;
        // Partial and host chips have a note in the table: link to it.
        const inner = mark === 'partial' || mark === 'host' ? `<a href="#compare-${f.id}" title="Details in the comparison table">${body}</a>` : `<span>${body}</span>`;
        return `<li class="chip chip--${mark}" data-edition="${e.id}" data-mark="${mark}">${inner}</li>`;
      }).join('');
      return `<li class="feat" id="${f.id}" data-marks="${marksOf(f)}">
            <h3>${f.name}</h3>
            <p>${f.description}</p>
            <ul class="chips" aria-label="Editions">${chips}</ul>
          </li>`;
    }).join('\n          ');
    return `<section class="feat-group" aria-labelledby="fg-${g.id}">
        <h2 class="feat-group__title" id="fg-${g.id}">${g.title}</h2>
        <ul class="feats">
          ${items}
        </ul>
      </section>`;
  }).join('\n      ');
}

/** The home page highlights: the features marked highlight, linking to their entries. */
export function renderHighlights() {
  return GROUPS.flatMap((g) => g.features).filter((f) => f.highlight).map((f) => `<li><a class="highlight" href="features/#${f.id}"><strong>${f.name}</strong><span>${f.description}</span></a></li>`).join('\n          ');
}

const MARKERS = {
  'features:list': renderFeatureList,
  'features:matrix': renderMatrixRows,
  'features:highlights': renderHighlights,
  'features:sprite': () => MARK_SPRITE,
};

/** Fill every <!--features:...--> marker. */
export function applyFeatureMarkers(html) {
  return html.replace(/<!--\s*(features:[a-z]+)\s*-->/g, (all, name) => {
    if (!MARKERS[name]) {throw new Error(`features: unknown marker ${all}`);}
    return MARKERS[name]();
  });
}
