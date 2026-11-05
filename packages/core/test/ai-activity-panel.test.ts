/**
 * The AI Activity panel: empty state, rows, detail, streaming, Copy/Save,
 * the plain-text export and clearing. The recorder itself is tested in
 * ai-activity.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiActivityLog } from '../src/ai-activity';
import type { AiActivityEntry, AiActivityLog } from '../src/ai-activity';
import { AI_ACTIVITY_BANNER, AI_ACTIVITY_EMPTY, AI_ACTIVITY_OFF } from '../src/ai-activity-panel';
import { activityExportFileName, formatActivityExport, mountAiActivityPanel } from '../src/ai-ui';
import type { AiActivityPanelHandle } from '../src/ai-ui';
import { settingsSectionContext } from '../src/settings-rows';

const route = { engineId: 'omlx', modelId: 'qwen', label: 'oMLX', isLocal: true, viaFallback: false };

function entry(id: string, over: Partial<AiActivityEntry> = {}): AiActivityEntry {
  return {
    id,
    startedAt: Date.UTC(2026, 10, 5, 9, 30, 0),
    endedAt: null,
    feature: 'rewrite',
    task: 'rewrite',
    route,
    thinking: null,
    request: {
      requestId: id,
      feature: 'rewrite',
      task: 'rewrite',
      messages: [
        { role: 'system', content: 'You rewrite text.' },
        { role: 'user', content: 'Make this shorter.' },
      ],
    },
    response: { text: '' },
    error: null,
    attempt: 1,
    ...over,
  };
}

const containers: HTMLElement[] = [];
const handles: AiActivityPanelHandle[] = [];

function mount(log: AiActivityLog, saveTextFile?: (name: string, text: string) => Promise<void>) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  containers.push(c);
  const handle = mountAiActivityPanel(c, settingsSectionContext(() => {}), { log, ...(saveTextFile ? { saveTextFile } : {}) });
  handles.push(handle);
  return { c, handle };
}

function enabledLog(): AiActivityLog {
  const log = createAiActivityLog();
  log.setEnabled(true);
  return log;
}

const q = <T extends Element = HTMLElement>(c: ParentNode, sel: string): T | null => c.querySelector<T>(sel);
const click = (n: Element | null | undefined): void => (n as HTMLElement).click();

afterEach(() => {
  while (handles.length) {handles.pop()!.destroy();}
  while (containers.length) {containers.pop()!.remove();}
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('empty state', () => {
  it('shows the empty state and the banner with an empty log', () => {
    const { c } = mount(enabledLog());
    expect(q(c, '.ai-activity-banner')?.textContent).toBe(AI_ACTIVITY_BANNER);
    expect(q(c, '.ai-activity')?.getAttribute('data-recording')).toBe('on');
    const empty = q(c, '.ai-activity-empty')!;
    expect(empty.hidden).toBe(false);
    expect(q(c, '.ai-activity-empty-title')?.textContent).toBe(AI_ACTIVITY_EMPTY.title);
    expect(q(c, '.ai-activity-empty-text')?.textContent).toBe(AI_ACTIVITY_EMPTY.text);
    expect(q(c, '.ai-activity-body')!.hidden).toBe(true);
    expect(c.querySelectorAll('.ai-activity-row')).toHaveLength(0);
  });
});

describe('rows and detail', () => {
  it('renders a row with feature, engine and status, and the detail verbatim', () => {
    const log = enabledLog();
    const { c } = mount(log);
    const script = '<script>window.__pwned = true</script> & <b>bold</b>';
    log.record(entry('a', {
      endedAt: Date.UTC(2026, 10, 5, 9, 30, 2),
      error: { code: 'network', message: 'Connection refused' } as AiActivityEntry['error'],
      request: {
        requestId: 'a', feature: 'rewrite', task: 'rewrite',
        messages: [
          { role: 'system', content: 'You rewrite text.' },
          { role: 'user', content: script },
        ],
      },
      response: { text: 'Shorter <i>text</i>\nline two' },
    }));

    const rows = c.querySelectorAll<HTMLElement>('.ai-activity-row');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.dataset.entryId).toBe('a');
    expect(row.dataset.status).toBe('error');
    expect(q(row, '.ai-activity-row-feature')?.textContent).toBe('Rewrite selection');
    expect(q(row, '.ai-activity-row-engine')?.textContent).toBe('oMLX · qwen');
    expect(q(row, '.ai-activity-row-status')?.textContent).toBe('Failed');
    expect(q(c, '.ai-activity-empty')!.hidden).toBe(true);

    click(row);
    expect(row.getAttribute('aria-selected')).toBe('true');
    const messages = Array.from(c.querySelectorAll<HTMLElement>('.ai-activity-message'));
    expect(messages.map((m) => m.dataset.role)).toEqual(['system', 'user']);
    expect(messages.map((m) => q(m, '.ai-activity-message-text')!.textContent)).toEqual(['You rewrite text.', script]);
    expect(q(c, '.ai-activity-received-text')!.textContent).toBe('Shorter <i>text</i>\nline two');
    // Text, not markup.
    expect(q(c, '.ai-activity-detail script')).toBeNull();
    expect(q(c, '.ai-activity-detail b')).toBeNull();
    expect(q(c, '.ai-activity-detail i')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('puts the newest request first', () => {
    const log = enabledLog();
    const { c } = mount(log);
    log.record(entry('old', { endedAt: 5 }));
    log.record(entry('new', { endedAt: 6 }));
    expect(Array.from(c.querySelectorAll<HTMLElement>('.ai-activity-row')).map((r) => r.dataset.entryId)).toEqual(['new', 'old']);
  });
});

describe('streaming', () => {
  it('appends to the detail text without resetting scroll or selection', () => {
    const log = enabledLog();
    const { c, handle } = mount(log);
    log.record(entry('s', { response: { text: 'Hello' } }));
    const list = q(c, '.ai-activity-list')!;
    const detailPane = q(c, '.ai-activity-detail')!;
    const received = q(c, '.ai-activity-received-text')!;
    const textNode = received.firstChild as Text;
    expect(textNode.data).toBe('Hello');

    // jsdom has no layout: watch for writes to scrollTop instead.
    const writes: Array<[string, number]> = [];
    for (const [name, node] of [['list', list], ['detail', detailPane]] as const) {
      let value = 120;
      Object.defineProperty(node, 'scrollTop', {
        configurable: true,
        get: () => value,
        set: (v: number) => { writes.push([name, v]); value = v; },
      });
    }

    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    for (const text of ['Hello, wor', 'Hello, world', 'Hello, world!']) {
      log.update('s', { response: { text } });
      handle.refresh();
    }

    expect(q(c, '.ai-activity-received-text')!.textContent).toBe('Hello, world!');
    // The same text node was appended to, so the selection is intact.
    expect(received.firstChild).toBe(textNode);
    expect(selection.toString()).toBe('ell');
    expect(selection.anchorNode).toBe(textNode);
    expect(writes).toEqual([]);
    expect(list.scrollTop).toBe(120);
    expect(detailPane.scrollTop).toBe(120);
  });
});

describe('Copy and Save', () => {
  it('has no Save buttons without saveTextFile', () => {
    const log = enabledLog();
    const { c } = mount(log);
    log.record(entry('a', { endedAt: 5 }));
    expect(q(c, '[data-action="copy"]')).not.toBeNull();
    expect(q(c, '[data-action="save"]')).toBeNull();
    expect(q(c, '[data-action="save-all"]')!.hidden).toBe(true);
  });

  it('Save this request and Save all hand the export and a dated name to saveTextFile', async () => {
    const log = enabledLog();
    const saveTextFile = vi.fn(async (_name: string, _text: string) => {});
    const { c } = mount(log, saveTextFile);
    const a = entry('a', { endedAt: Date.UTC(2026, 10, 5, 9, 30, 1), response: { text: 'one' } });
    const b = entry('b', { endedAt: Date.UTC(2026, 10, 5, 9, 30, 2), response: { text: 'two' } });
    log.record(a);
    log.record(b);

    // The first request is auto-selected; click it anyway so the test does not depend on that.
    click(q(c, '.ai-activity-row[data-entry-id="a"]'));
    const saveAll = q<HTMLButtonElement>(c, '[data-action="save-all"]')!;
    expect(saveAll.hidden).toBe(false);

    click(q(c, '[data-action="save"]'));
    await vi.waitFor(() => expect(saveTextFile).toHaveBeenCalledTimes(1));
    const [name1, text1] = saveTextFile.mock.calls[0];
    expect(name1).toMatch(/^mikedown-ai-activity-\d{8}-\d{4}\.txt$/);
    expect(text1).toBe(formatActivityExport([log.get('a')!]));

    click(saveAll);
    await vi.waitFor(() => expect(saveTextFile).toHaveBeenCalledTimes(2));
    const [name2, text2] = saveTextFile.mock.calls[1];
    expect(name2).toMatch(/^mikedown-ai-activity-\d{8}-\d{4}\.txt$/);
    expect(text2).toBe(formatActivityExport(log.entries()));
  });

  it('Copy writes the selected request export to the clipboard', async () => {
    const log = enabledLog();
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { c } = mount(log);
    log.record(entry('a', { endedAt: 5, response: { text: 'one' } }));
    click(q(c, '[data-action="copy"]'));
    expect(writeText).toHaveBeenCalledWith(formatActivityExport([log.get('a')!]));
    await vi.waitFor(() => expect(q(c, '.ai-activity-detail .ai-activity-inline-status')!.textContent).toBe('Copied'));
  });

  it('names the file from local time', () => {
    expect(activityExportFileName(new Date(2026, 10, 5, 9, 7))).toBe('mikedown-ai-activity-20261105-0907.txt');
  });
});

describe('formatActivityExport', () => {
  it('is empty for no entries', () => {
    expect(formatActivityExport([])).toBe('');
  });

  it('turns a two-entry log into plain text', () => {
    const first = entry('a', {
      endedAt: Date.UTC(2026, 10, 5, 9, 30, 2),
      thinking: { configured: 'low', sent: 'low', auto: false } as AiActivityEntry['thinking'],
      request: {
        requestId: 'a', feature: 'rewrite', task: 'rewrite', maxTokens: 512, temperature: 0.3,
        messages: [
          { role: 'system', content: 'You rewrite text.' },
          { role: 'user', content: '<script>x</script> keep as is' },
        ],
      },
      response: {
        text: 'Short.',
        usage: { promptTokens: 20, completionTokens: 3 },
        finishReason: 'stop',
        timing: { totalMs: 2000, firstTokenMs: 300 },
      },
    });
    const second = entry('b', {
      startedAt: Date.UTC(2026, 10, 5, 9, 31, 0),
      endedAt: Date.UTC(2026, 10, 5, 9, 31, 1),
      feature: 'summary',
      task: 'summary',
      route: { engineId: 'claude', modelId: 'sonnet', label: 'Anthropic', isLocal: false, viaFallback: true },
      error: { code: 'network', message: 'Connection lost' } as AiActivityEntry['error'],
      attempt: 2,
      response: { text: 'partial' },
    });
    expect(formatActivityExport([first, second])).toMatchInlineSnapshot(`
      "=== Request 1 of 2 ===
      Time: 2026-11-05T09:30:00.000Z
      Feature: rewrite
      Task: rewrite
      Status: ok
      Engine: oMLX (local)
      Model: qwen
      Attempt: 1
      Thinking: Low
      Duration: 2000 ms
      Max tokens: 512
      Temperature: 0.3

      --- Sent ---

      [system]
      You rewrite text.

      [user]
      <script>x</script> keep as is

      --- Received ---

      Short.

      --- Result ---
      Prompt tokens: 20
      Completion tokens: 3
      Finish reason: stop
      Total time: 2000 ms
      First token: 300 ms

      === Request 2 of 2 ===
      Time: 2026-11-05T09:31:00.000Z
      Feature: summary
      Task: summary
      Status: error
      Engine: Anthropic (cloud)
      Model: sonnet
      Via fallback: yes
      Attempt: 2
      Duration: 1000 ms

      --- Sent ---

      [system]
      You rewrite text.

      [user]
      Make this shorter.

      --- Received ---

      partial

      --- Result ---
      Error: network: Connection lost
      "
    `);
  });
});

describe('clearing', () => {
  it('Clear all empties the list and shows the empty state', () => {
    const log = enabledLog();
    const { c } = mount(log);
    log.record(entry('a', { endedAt: 5 }));
    log.record(entry('b', { endedAt: 6 }));
    expect(c.querySelectorAll('.ai-activity-row')).toHaveLength(2);
    click(q(c, '[data-action="clear"]'));
    expect(log.entries()).toEqual([]);
    expect(c.querySelectorAll('.ai-activity-row')).toHaveLength(0);
    expect(q(c, '.ai-activity-empty')!.hidden).toBe(false);
    expect(q(c, '.ai-activity-empty-title')?.textContent).toBe(AI_ACTIVITY_EMPTY.title);
    expect(q<HTMLButtonElement>(c, '[data-action="clear"]')!.disabled).toBe(true);
  });

  it('disabling the setting clears the log and shows the off state', () => {
    const log = enabledLog();
    const { c, handle } = mount(log);
    log.record(entry('a', { endedAt: 5 }));
    expect(c.querySelectorAll('.ai-activity-row')).toHaveLength(1);
    log.setEnabled(false);
    handle.refresh();
    expect(log.entries()).toEqual([]);
    expect(c.querySelectorAll('.ai-activity-row')).toHaveLength(0);
    expect(q(c, '.ai-activity')?.getAttribute('data-recording')).toBe('off');
    expect(q(c, '.ai-activity-empty')!.hidden).toBe(false);
    expect(q(c, '.ai-activity-empty-title')?.textContent).toBe(AI_ACTIVITY_OFF.title);
    expect(q(c, '.ai-activity-empty-text')?.textContent).toBe(AI_ACTIVITY_OFF.text);
  });
});
