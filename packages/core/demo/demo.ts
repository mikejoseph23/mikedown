// Demo: two editors side by side on a Material-like page, running against the
// BUILT package (dist/index.js, dist/styles.css), no framework.
// Query parameters drive editor A for screenshots: ?theme=dark&base=14&open=settings
import { createMikeDownEditor } from '../dist/index.js';
import type { MikeDownHost } from '../dist/index.js';

const params = new URLSearchParams(location.search);
const theme = (params.get('theme') ?? 'light') as 'light' | 'dark' | 'auto';
const base = params.get('base') ?? '16';

const sample = `# Release checklist

Notes for the **2.15** release. See the [changelog](https://example.com) and ==highlight== anything risky.

> [!NOTE]
> Callouts, tables, task lists, code and math all render here.

- [x] Bump the version
- [ ] Tag the release

| Step | Owner |
| --- | --- |
| Build | CI |
| Publish | Mike |

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

Inline math $a^2 + b^2 = c^2$ and a footnote.[^1]

[^1]: Footnotes work too.
`;

const sampleB = `# Meeting notes

- [ ] Review the **core extraction** plan
- [ ] Decide on the \`rc\` tag

Paste or drop an image here: the demo host turns it into an object URL.

\`\`\`mermaid
graph LR
  A[Editor] --> B[Host]
\`\`\`
`;

/**
 * Host stub: a no-op onChange plus uploadImage, which returns an object URL. A real
 * host would store the bytes and return a durable URL or path.
 */
const host: MikeDownHost = {
  onChange() {},
  async uploadImage(file) {
    const blob = new Blob([file.bytes as BlobPart], { type: file.mime });
    return { src: URL.createObjectURL(blob), alt: file.name ?? 'pasted image' };
  },
};

/** Page base size and the editor chrome size (--mikedown-font-size-ui) together. */
function applyBase(px: string): void {
  document.documentElement.style.setProperty('--demo-base', `${px}px`);
  document.documentElement.style.setProperty('--mikedown-font-size-ui', `${px}px`);
}

applyBase(base);
document.body.classList.toggle('demo-dark', theme === 'dark');

const handle = createMikeDownEditor(document.getElementById('editor')!, {
  host,
  initialMarkdown: sample,
  theme,
  spellcheckDictionaryUrl: '../dist/dictionaries',
});
const handleB = createMikeDownEditor(document.getElementById('editor-b')!, {
  host,
  initialMarkdown: sampleB,
  theme,
});

const themeSel = document.getElementById('theme') as HTMLSelectElement;
themeSel.value = theme;
themeSel.addEventListener('change', () => {
  handle.setTheme(themeSel.value as 'light' | 'dark' | 'auto');
  handleB.setTheme(themeSel.value as 'light' | 'dark' | 'auto');
  document.body.classList.toggle('demo-dark', themeSel.value === 'dark');
});
const baseSel = document.getElementById('base') as HTMLSelectElement;
baseSel.value = base;
baseSel.addEventListener('change', () => applyBase(baseSel.value));
document.getElementById('log')!.addEventListener('click', () => {
  console.log('--- Editor A ---\n' + handle.getMarkdown());
  console.log('--- Editor B ---\n' + handleB.getMarkdown());
});
document.getElementById('settings')!.addEventListener('click', () => handle.command('openSettings'));

const open = params.get('open');
if (open === 'settings') {handle.command('openSettings');}
if (open === 'slash' || open === 'emoji') {
  handle.focus();
  if (open === 'emoji') {handle.command('openEmojiPicker');}
  else {handle.tiptap.chain().focus('end').insertContent('\n/').run();}
}
// ?click=<css selector> clicks a toolbar control; ?find=1 opens find/replace.
const click = params.get('click');
if (click) {setTimeout(() => document.querySelector<HTMLElement>(click)?.click(), 200);}
if (params.get('find')) {
  handle.focus();
  setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, ctrlKey: true, bubbles: true })), 200);
}
(window as unknown as { mikedown: unknown; mikedownB: unknown }).mikedown = handle;
(window as unknown as { mikedownB: unknown }).mikedownB = handleB;
