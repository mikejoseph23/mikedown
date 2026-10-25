// The hub's live editor: the web component, with its markdown value next to it.
import './common/stage.js';
import '../shared/copy.js';
import '@mikedown/core/styles.css';
import '@mikedown/web-component/define';
import { stubAiHost, stubAiSettings } from './common/stub-ai';

const starter = `# Meeting notes

MikeDown edits **formatted text**. Your app stores the markdown value beside it.

## Decisions

- [x] Ship the web component first
- [ ] Add the React and Vue demos

| Owner | Task | Due |
| --- | --- | --- |
| Sam | Write the docs | Friday |

> Type / for headings, tables, callouts and more.
`;

const root = document.getElementById('demo-root');
root.innerHTML = `<div class="demo">
  <mikedown-editor class="demo__editor" aria-label="Try the editor"></mikedown-editor>
  <pre class="demo__value" tabindex="0" aria-label="Markdown value"></pre>
</div>`;

const editor = root.querySelector('mikedown-editor');
const value = root.querySelector('.demo__value');
// The demo's AI is a stub: it streams canned text and calls no server.
editor.settings = { ai: stubAiSettings };
editor.ai = stubAiHost;
editor.value = starter;
value.textContent = starter;
editor.addEventListener('change', (e) => { value.textContent = e.detail.value; });

const apply = ({ theme, readOnly }) => {
  editor.theme = theme;
  editor.readOnly = readOnly;
};
apply(window.mikedownStage.state);
document.addEventListener('stage:controls', (e) => apply(e.detail));
