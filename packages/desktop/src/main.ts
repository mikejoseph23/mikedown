/**
 * MikeDown Desktop boot (M0): mount one core editor over the smoke fixture.
 *
 * Later milestones replace the fixture with the document model, the NoopHost
 * with TauriHost, and the two shortcuts below with `menu/shortcuts.ts`.
 */
import '@mikedown/core/tokens.css';
import '@mikedown/core/styles.css';
import './styles/app.css';

import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '@mikedown/core';
import { SMOKE_FIXTURE } from './smoke/fixture';
import { smokeEnabled, runSmoke } from './smoke/harness';

const container = document.getElementById('editor');
if (!container) {throw new Error('MikeDown: #editor missing from index.html');}

const handle: MikeDownEditorHandle = createMikeDownEditor(container, {
  host: new NoopHost(),
  initialMarkdown: SMOKE_FIXTURE,
  theme: 'auto',
  features: { sidebar: false, supportCard: false },
  hostOwnsShortcuts: true,
  // Desktop default is ON (edge case 22); served by vite.config.ts in dev and
  // copied next to index.html in release builds.
  spellcheckDictionaryUrl: new URL('dictionaries', document.baseURI).toString(),
  settings: { spellCheckEnabled: true },
});

// hostOwnsShortcuts: the app binds the editor-level chords it owns. M2 moves
// these into the single shortcut table shared with the native menu.
const isMac = navigator.platform.startsWith('Mac');
window.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) {return;}
  if (e.key === '/') { e.preventDefault(); handle.command('toggleSource'); }
  else if (e.key === ',') { e.preventDefault(); handle.command('openSettings'); }
});

handle.focus();

// Dev / smoke builds expose the handle for Web Inspector poking and run the
// WebKit / WebView2 checks that fill docs/webview-notes.md.
if (import.meta.env.DEV || smokeEnabled()) {
  (window as unknown as { mikedown: MikeDownEditorHandle }).mikedown = handle;
}
if (smokeEnabled()) {
  void runSmoke(handle, SMOKE_FIXTURE);
}
