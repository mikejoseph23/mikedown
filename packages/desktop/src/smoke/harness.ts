/**
 * In-app smoke harness for the OS webview (WKWebView on macOS, WebView2 on
 * Windows). Runs when `VITE_MIKEDOWN_SMOKE=1` was set at build/dev time, drives
 * the editor through the M0 checklist, and posts a JSON report to the Rust
 * `smoke_report` command (stdout, plus a file when `MIKEDOWN_SMOKE_DIR` is set).
 *
 *   MIKEDOWN_SMOKE_DIR=/tmp/smoke VITE_MIKEDOWN_SMOKE=1 npm run dev
 *   node scripts/smoke-compare.mjs /tmp/smoke/webkit.json
 *
 * Checks that need a human (OS appearance flip, IME, Cmd+wheel feel) are
 * listed in docs/webview-notes.md; the harness only records what it can
 * observe (it keeps listening for a prefers-color-scheme change for 30 s so
 * the appearance flip can be scripted from outside).
 */
import { invoke } from '@tauri-apps/api/core';
import { aiApi } from '../host/aiApi';
import type { MikeDownEditorHandle } from '@mikedown/core';

export interface SmokeCheck {
  name: string;
  ok: boolean | null;
  detail?: string;
}

export interface SmokeReport {
  startedAt: string;
  host: Record<string, unknown>;
  env: Record<string, unknown>;
  roundTrip: { fixtureLength: number; markdown: string; deterministic: boolean; idempotent: boolean };
  checks: SmokeCheck[];
  themeEvents: Array<{ at: string; prefersDark: boolean; rootTheme: string | null; surface: string }>;
}

export function smokeEnabled(): boolean {
  return import.meta.env.VITE_MIKEDOWN_SMOKE === '1';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number, stepMs = 100): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) {return true;}
    await sleep(stepMs);
  }
  return pred();
}

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function measureScrollbarWidth(): number {
  const outer = document.createElement('div');
  outer.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;';
  document.body.appendChild(outer);
  const w = outer.offsetWidth - outer.clientWidth;
  outer.remove();
  return w;
}

function keydown(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

export async function runSmoke(handle: MikeDownEditorHandle, fixture: string): Promise<void> {
  const checks: SmokeCheck[] = [];
  const check = (name: string, ok: boolean | null, detail?: string) => { checks.push({ name, ok, detail }); };
  const root = document.documentElement;
  const editorRoot = (document.querySelector('.mikedown-root') ?? document.getElementById('editor')) as HTMLElement;
  const pm = () => document.querySelector<HTMLElement>('.ProseMirror');
  const themeEvents: SmokeReport['themeEvents'] = [];
  // Core puts data-mikedown-theme on its own root element, not on <html>.
  const themeAttr = () => editorRoot.getAttribute('data-mikedown-theme') ?? root.getAttribute('data-mikedown-theme');
  const recordTheme = () => themeEvents.push({
    at: new Date().toISOString(),
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    rootTheme: themeAttr(),
    surface: cssVar(editorRoot, '--mikedown-surface'),
  });

  let host: Record<string, unknown> = {};
  try { host = await invoke<Record<string, unknown>>('host_info'); }
  catch (e) { host = { error: String(e) }; }

  const env = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    devicePixelRatio: devicePixelRatio,
    innerSize: [innerWidth, innerHeight],
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    rootTheme: root.getAttribute('data-mikedown-theme'),
    scrollbarWidth: measureScrollbarWidth(),
    clipboard: {
      navigatorClipboard: typeof navigator.clipboard,
      writeText: typeof navigator.clipboard?.writeText,
      readText: typeof navigator.clipboard?.readText,
      read: typeof navigator.clipboard?.read,
      write: typeof navigator.clipboard?.write,
      ClipboardItem: typeof (globalThis as { ClipboardItem?: unknown }).ClipboardItem,
    },
    compositionEvent: 'CompositionEvent' in window,
    inputEvent: 'InputEvent' in window,
    beforeinputSupported: typeof (globalThis as { InputEvent?: { prototype?: object } }).InputEvent?.prototype === 'object'
      && 'getTargetRanges' in ((globalThis as { InputEvent?: { prototype?: object } }).InputEvent?.prototype ?? {}),
    coreFrom: __MIKEDOWN_CORE_FROM__,
    mode: import.meta.env.MODE,
  };

  // Wait for the editor to settle (async mermaid / KaTeX / dictionary loads).
  await sleep(500);
  recordTheme();

  // ── Round-trip ──────────────────────────────────────────────────────────────
  const md1 = handle.getMarkdown();
  handle.setMarkdown(fixture, { pristine: true });
  await sleep(50);
  const md2 = handle.getMarkdown();
  handle.setMarkdown(md1, { pristine: true });
  await sleep(50);
  const md3 = handle.getMarkdown();
  const roundTrip = {
    fixtureLength: fixture.length,
    markdown: md1,
    deterministic: md1 === md2,
    idempotent: md3 === md1,
  };
  check('round-trip deterministic (initialMarkdown vs setMarkdown)', md1 === md2);
  check('round-trip idempotent (second pass unchanged)', md3 === md1);

  // ── Rendering ───────────────────────────────────────────────────────────────
  const count = (sel: string) => document.querySelectorAll(sel).length;
  check('renders table', count('.ProseMirror table') >= 1, `${count('.ProseMirror table')} table(s)`);
  check('renders task list', count('.ProseMirror ul[data-type="taskList"] li') >= 3, `${count('.ProseMirror ul[data-type="taskList"] li')} task item(s)`);
  check('renders callouts', count('.ProseMirror [data-callout]') >= 2, `${count('.ProseMirror [data-callout]')} callout(s)`);
  check('renders highlight', count('.ProseMirror mark') >= 1);
  check('renders code block', count('.ProseMirror pre') >= 2, `${count('.ProseMirror pre')} pre(s)`);
  check('renders footnote ref', count('.ProseMirror [data-footnote-ref]') >= 1);
  check('renders image element', count('.ProseMirror img') >= 1);
  const katexOk = await waitFor(() => count('.ProseMirror .katex') >= 1, 5000);
  check('renders KaTeX', katexOk, `${count('.ProseMirror .katex')} .katex`);
  const mermaidOk = await waitFor(() => count('.ProseMirror .mikedown-mermaid-preview svg') >= 1, 10000);
  check('renders Mermaid svg', mermaidOk, `${count('.ProseMirror .mikedown-mermaid-preview svg')} svg`);

  // ── Focus and selection ─────────────────────────────────────────────────────
  handle.focus();
  await sleep(50);
  const view = pm();
  const sel = getSelection();
  check('document.hasFocus()', document.hasFocus(), 'false is normal when the window is not frontmost');
  check('activeElement is ProseMirror after focus()', document.activeElement === view);
  check('selection inside ProseMirror after focus()', !!view && !!sel?.anchorNode && view.contains(sel.anchorNode),
    `anchorNode=${sel?.anchorNode?.nodeName ?? 'none'}`);
  check('contenteditable attribute', view?.getAttribute('contenteditable') === 'true');
  check('spellcheck disabled on body', document.body.getAttribute('spellcheck') === 'false');

  // ── Typing, bold ────────────────────────────────────────────────────────────
  handle.tiptap.chain().focus('end').insertContent('\nTyped in the webview ').run();
  handle.command('toggleBold');
  handle.tiptap.chain().focus().insertContent('bold').run();
  handle.command('toggleBold');
  await sleep(50);
  check('typing + toggleBold', /\*\*bold\*\*/.test(handle.getMarkdown()));

  // ── Insert a table ──────────────────────────────────────────────────────────
  const tablesBefore = (handle.getMarkdown().match(/^\|/gm) ?? []).length;
  // The table extension's command typing is not part of core's public d.ts.
  type WithInsertTable = { insertTable(o: { rows: number; cols: number; withHeaderRow: boolean }): { run(): boolean } };
  (handle.tiptap.chain().focus('end') as unknown as WithInsertTable).insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
  await sleep(50);
  const tablesAfter = (handle.getMarkdown().match(/^\|/gm) ?? []).length;
  check('insertTable adds rows to markdown', tablesAfter > tablesBefore, `${tablesBefore} -> ${tablesAfter} table lines`);

  // ── /date slash command ─────────────────────────────────────────────────────
  handle.tiptap.chain().focus('end').insertContent({ type: 'paragraph' }).insertContent('/date').run();
  const slashOpened = await waitFor(() => !!document.querySelector('.slash-command-menu, .mikedown-slash-menu, [data-slash-menu]'), 1500);
  if (slashOpened) {keydown(view ?? document.body, 'Enter');}
  await sleep(100);
  const today = new Date().toISOString().slice(0, 10);
  check('/date slash command', handle.getMarkdown().includes(today) || null,
    slashOpened ? `menu opened; markdown ${handle.getMarkdown().includes(today) ? 'contains' : 'lacks'} ${today}` : 'menu did not open from insertContent; manual check');

  // ── Settings modal ──────────────────────────────────────────────────────────
  handle.command('openSettings');
  await sleep(100);
  const opened = handle.isModalOpen();
  keydown(document.activeElement ?? document.body, 'Escape');
  await sleep(100);
  check('openSettings opens the modal', opened);
  check('Escape closes the modal', !handle.isModalOpen());

  // ── AI (commands/ai.rs round-trips and the Settings AI tab) ───────────────
  // The webview has no mock engine to talk to, so the completion check goes
  // through the Rust route lookup and gate with an engine that does not exist;
  // the streamed completion and cancel are covered by `cargo test` and the
  // Playwright `ai.spec.ts`.
  let engineCount: number | null = null;
  try {
    const engines = await aiApi.listEngines();
    engineCount = Array.isArray(engines) ? engines.length : null;
    check('ai_list_engines round-trips', engineCount !== null, `${engineCount ?? '?'} engine(s) in settings`);
  } catch (e) {
    check('ai_list_engines round-trips', false, String(e));
  }
  try {
    const channel = await aiApi.complete({
      requestId: 'smoke-ai-1', feature: 'smoke', task: 'smoke',
      route: { engineId: 'smoke-no-such-engine', modelId: 'none' },
      messages: [{ role: 'user', content: 'hi' }],
    } as Parameters<typeof aiApi.complete>[0]);
    check('ai_complete refuses an unknown engine with modelNotFound', false, `started channel ${channel}`);
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    check('ai_complete refuses an unknown engine with modelNotFound', code === 'modelNotFound', `code=${code ?? String(e)}`);
  }
  check('ai_cancel on a finished request is false, not an error', (await aiApi.cancel('smoke-ai-1').catch(() => null)) === false);
  handle.command('openSettings');
  await sleep(100);
  const aiTab = Array.from(document.querySelectorAll<HTMLElement>('.settings-modal .settings-tab')).find((t) => t.textContent?.trim() === 'AI');
  aiTab?.click();
  await sleep(100);
  const aiPanel = document.querySelector<HTMLElement>('.settings-modal .settings-panel--ai');
  const aiRendered = !!aiPanel && aiPanel.getBoundingClientRect().height > 0 && /Engines/.test(aiPanel.textContent ?? '');
  const aiRows = aiPanel?.querySelectorAll('.ai-engines [role="listitem"], .ai-engines > *').length ?? 0;
  check('Settings modal AI tab renders', aiRendered, aiTab ? `${aiRows} engine row(s)` : 'no AI tab (host.ai missing)');
  check('AI tab lists a configured engine', engineCount === null ? false : engineCount > 0 ? aiRows > 0 : null,
    engineCount ? `${aiRows} row(s) for ${engineCount} engine(s)` : 'no engine configured on this machine; add one and re-run');
  keydown(document.activeElement ?? document.body, 'Escape');
  await sleep(100);

  // ── Source mode ─────────────────────────────────────────────────────────────
  const beforeSource = handle.getMarkdown();
  handle.command('toggleSource');
  const cmShown = await waitFor(() => {
    const cm = document.querySelector<HTMLElement>('.cm-editor');
    return !!cm && cm.getBoundingClientRect().height > 0;
  }, 1500);
  const inSource = handle.getMarkdown();
  handle.command('toggleSource');
  const pmShown = await waitFor(() => (pm()?.getBoundingClientRect().height ?? 0) > 0, 1500);
  check('toggleSource shows CodeMirror', cmShown);
  check('markdown unchanged entering source mode', inSource === beforeSource);
  check('toggleSource returns to rich text', pmShown);
  check('markdown unchanged after source round trip', handle.getMarkdown() === beforeSource);

  // ── Paste plain text ────────────────────────────────────────────────────────
  let pasteDetail = '';
  let pasteOk: boolean | null = null;
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Pasted plain line one\nPasted plain line two');
    handle.tiptap.chain().focus('end').run();
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    const dispatched = pm()?.dispatchEvent(ev);
    await sleep(100);
    const md = handle.getMarkdown();
    pasteOk = md.includes('Pasted plain line one') && md.includes('Pasted plain line two');
    pasteDetail = `dispatched=${dispatched}, defaultPrevented=${ev.defaultPrevented}`;
  } catch (e) {
    pasteOk = null;
    pasteDetail = `synthetic ClipboardEvent unsupported: ${String(e)}; manual check`;
  }
  check('paste plain text (synthetic ClipboardEvent)', pasteOk, pasteDetail);

  // ── Cmd/Ctrl+wheel zoom ─────────────────────────────────────────────────────
  const zoomBefore = cssVar(editorRoot, '--mikedown-font-size') || cssVar(root, '--mikedown-font-size');
  const wheelTarget = pm() ?? editorRoot;
  for (let i = 0; i < 3; i++) {
    wheelTarget.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(30);
  }
  await sleep(100);
  const zoomAfter = cssVar(editorRoot, '--mikedown-font-size') || cssVar(root, '--mikedown-font-size');
  check('Cmd/Ctrl+wheel zoom changes --mikedown-font-size', zoomBefore !== zoomAfter, `${zoomBefore || '(unset)'} -> ${zoomAfter || '(unset)'}`);
  // Undo the zoom so screenshots stay comparable.
  for (let i = 0; i < 3; i++) {
    wheelTarget.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(30);
  }

  // ── Theme ───────────────────────────────────────────────────────────────────
  const surfaceAuto = cssVar(editorRoot, '--mikedown-surface');
  handle.setTheme('dark');
  await sleep(50);
  const surfaceDark = cssVar(editorRoot, '--mikedown-surface');
  handle.setTheme('light');
  await sleep(50);
  const surfaceLight = cssVar(editorRoot, '--mikedown-surface');
  handle.setTheme('auto');
  check('setTheme dark/light swap tokens', surfaceDark !== surfaceLight, `dark=${surfaceDark} light=${surfaceLight} auto=${surfaceAuto}`);

  // Restore the fixture so the window shows the reference document again.
  handle.setMarkdown(md1, { pristine: true });

  const report: SmokeReport = {
    startedAt: new Date().toISOString(),
    host,
    env,
    roundTrip,
    checks,
    themeEvents,
  };
  await post('webkit-or-webview2', report);

  // Keep listening for an OS appearance flip (scripted from outside) and
  // post again with the observed events.
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { setTimeout(() => { recordTheme(); void post('theme-events', { ...report, themeEvents }); }, 100); };
  mq.addEventListener('change', onChange);
  await sleep(30000);
  mq.removeEventListener('change', onChange);
  recordTheme();
  await post('theme-events', { ...report, themeEvents });
}

async function post(name: string, report: SmokeReport): Promise<void> {
  const text = JSON.stringify(report, null, 2);
  console.log(`[mikedown-smoke:${name}]`, report);
  try {
    const where = await invoke<string | null>('smoke_report', { name, report: text });
    console.log(`[mikedown-smoke] report ${name} -> ${where ?? 'stdout only'}`);
  } catch (e) {
    console.error('[mikedown-smoke] smoke_report failed', e);
  }
}
