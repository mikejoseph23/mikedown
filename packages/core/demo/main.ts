// Minimal demo: one editor with NoopHost on a Material-like page.
// Query parameters drive it for screenshots: ?theme=dark&base=14&open=settings
import { createMikeDownEditor, NoopHost } from '../src/index';

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

/** Page base size and the editor chrome size (--mikedown-font-size-ui) together. */
function applyBase(px: string): void {
  document.documentElement.style.setProperty('--demo-base', `${px}px`);
  document.documentElement.style.setProperty('--mikedown-font-size-ui', `${px}px`);
}

applyBase(base);
document.body.classList.toggle('demo-dark', theme === 'dark');

const handle = createMikeDownEditor(document.getElementById('editor')!, {
  host: new NoopHost(),
  initialMarkdown: sample,
  theme,
});

const themeSel = document.getElementById('theme') as HTMLSelectElement;
themeSel.value = theme;
themeSel.addEventListener('change', () => {
  handle.setTheme(themeSel.value as 'light' | 'dark' | 'auto');
  document.body.classList.toggle('demo-dark', themeSel.value === 'dark');
});
const baseSel = document.getElementById('base') as HTMLSelectElement;
baseSel.value = base;
baseSel.addEventListener('change', () => applyBase(baseSel.value));
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
(window as unknown as { mikedown: unknown }).mikedown = handle;
