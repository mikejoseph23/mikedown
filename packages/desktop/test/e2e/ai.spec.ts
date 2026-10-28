/**
 * AI inference engines (M4 host, M3 tab, M3c page): the Settings modal AI tab
 * with an engine, the AI Engines page it opens, and the `host.ai` group (aiHost.ts over aiApi.ts) round-tripping
 * `listEngines` and a streamed completion.
 *
 * The Rust side is replaced by this file: `ai_*` commands are answered here
 * (`ipc.custom`), and `ai_complete` makes a real HTTP request to a loopback
 * "engine" that replays the shared SSE fixture (`test/ai-fixtures/sse/`), then
 * emits the same `ai-token` / `ai-done` / `ai-error` events the Rust command
 * does. Cancel mid-stream aborts that request. The Rust command layer itself
 * is covered by `cargo test` (`commands/ai/tests/command_layer.rs`).
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect, type Ipc } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(here, '../../../../test/ai-fixtures/sse/openai-chat-stream.json'), 'utf8'),
) as { chunks: string[]; expected: { text: string } };

interface MockEngine {
  base: string;
  /** Request bodies the engine received, in order. */
  bodies: Array<Record<string, unknown>>;
  /** Connections the engine saw closed before it finished (a cancelled stream). */
  aborted: () => number;
  close(): Promise<void>;
}

/** `/v1/chat/completions`: the fixture's chunks, or (model `stall`) one token and then silence. */
async function startEngine(): Promise<MockEngine> {
  const bodies: Array<Record<string, unknown>> = [];
  let aborted = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += String(c); });
    req.on('end', () => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'qwen' }] }));
        return;
      }
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      bodies.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.on('close', () => { if (!res.writableFinished) {aborted++;} });
      if (body.model === 'stall') {
        res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
        return;
      }
      let i = 0;
      const tick = (): void => {
        if (i < fixture.chunks.length) {res.write(fixture.chunks[i++]); setTimeout(tick, 5);} else {res.end();}
      };
      tick();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    bodies,
    aborted: () => aborted,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

const channelOf = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_');

/** Answer the Rust `ai_*` commands from Node, and push the events the page listens for. */
function wireAi(page: Page, ipc: Ipc, engine: MockEngine): void {
  const emit = (event: string, payload: unknown): Promise<void> =>
    page.evaluate(([e, p]) => (window as unknown as { __mikedownE2eEmit(e: string, p: unknown): Promise<void> }).__mikedownE2eEmit(e as string, p), [event, payload]);
  const running = new Map<string, AbortController>();

  ipc.custom.ai_list_engines = () => [{ engineId: 'e1', ok: null, isLocal: true, hasKey: false }];
  ipc.custom.ai_test_engine = () => ({ engineId: 'e1', ok: true, isLocal: true, hasKey: false, latencyMs: 12 });
  ipc.custom.ai_cancel = (args: { id: string }) => {
    const ctl = running.get(channelOf(args.id));
    ctl?.abort();
    return !!ctl;
  };
  ipc.custom.ai_complete = (args: { request: { requestId: string; route: { modelId: string }; messages: unknown[] } }) => {
    const { requestId, route, messages } = args.request;
    const channel = channelOf(requestId);
    const ctl = new AbortController();
    running.set(channel, ctl);
    void (async () => {
      try {
        const res = await fetch(`${engine.base}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: route.modelId, stream: true, messages }),
          signal: ctl.signal,
        });
        const decoder = new TextDecoder();
        let text = '';
        let buffer = '';
        for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(part, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:') || line.includes('[DONE]')) {continue;}
            const delta = (JSON.parse(line.slice(5)) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
            if (delta) {
              text += delta;
              await emit(`ai-token:${channel}`, { requestId, delta });
            }
          }
        }
        const served = { engineId: 'e1', engineName: 'oMLX', modelId: route.modelId, isLocal: true };
        await emit(`ai-done:${channel}`, { requestId, result: { text, served, finishReason: 'stop' } });
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          await emit(`ai-error:${channel}`, { requestId, code: 'cancelled', message: 'The request was cancelled.' }).catch(() => undefined);
        } else {
          await emit(`ai-error:${channel}`, { requestId, code: 'unreachable', message: String(err) }).catch(() => undefined);
        }
      } finally {
        running.delete(channel);
      }
    })();
    return channel;
  };
}

function writeEngineSettings(ipc: Ipc, base: string): void {
  fs.writeFileSync(path.join(ipc.appData, 'settings.json'), JSON.stringify({
    'ai.enabled': true,
    'ai.engines': [{
      id: 'e1',
      name: 'oMLX',
      kind: 'openai-compatible',
      baseUrl: `${base}/v1`,
      enabled: true,
      locality: 'auto',
      discovery: 'auto',
      models: [
        { id: 'qwen', enabled: true, capabilities: {}, capabilitiesSource: 'unknown' },
        { id: 'stall', enabled: true, capabilities: {}, capabilitiesSource: 'unknown' },
      ],
    }],
  }));
}

let engine: MockEngine;
test.beforeEach(async () => { engine = await startEngine(); });
test.afterEach(async () => { await engine.close(); });

test('the Settings modal AI tab lists the saved engine; the AI Engines page tests it', async ({ page, ipc }) => {
  writeEngineSettings(ipc, engine.base);
  wireAi(page, ipc, engine);
  ipc.launchFiles = [ipc.write('a.md', '# A\n\nText.\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');

  await page.locator('#editor .ProseMirror').first().click();
  await page.keyboard.press('ControlOrMeta+,');
  const modal = page.locator('.settings-modal');
  await expect(modal).toBeVisible();
  await modal.getByRole('tab', { name: 'AI Experimental', exact: true }).click();

  const engines = modal.getByRole('list', { name: 'Engines' });
  await expect(engines).toBeVisible();
  await expect(engines).toContainText('oMLX');
  await expect(modal.getByText('No engines yet')).toHaveCount(0);

  // Engines are edited on the page, which opens over the modal inside the window.
  await modal.getByRole('button', { name: 'Manage engines…' }).click();
  const enginesPage = page.getByRole('dialog', { name: 'AI Engines' });
  await expect(enginesPage).toBeVisible();
  const box = await enginesPage.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.width >= viewport.width - 1 && box.height >= viewport.height - 1).toBe(true);
  await expect(enginesPage.getByRole('list', { name: 'Engines' })).toContainText('oMLX');
  await enginesPage.getByRole('button', { name: 'Test connection' }).click();
  await expect.poll(() => ipc.calls.some((c) => c.cmd === 'ai_test_engine')).toBe(true);
  await expect(enginesPage.locator('[data-state="ok"]').filter({ hasText: '12 ms' }).first()).toBeVisible();

  // The page is modal: Tab and Shift+Tab never leave it.
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press(key);
      expect(await enginesPage.evaluate((n) => n.contains(document.activeElement))).toBe(true);
    }
  }

  // Escape is Back: nothing changed, so the page closes and the modal is still there.
  await page.keyboard.press('Escape');
  await expect(enginesPage).toHaveCount(0);
  await expect(modal).toBeVisible();
});

test('the AI tab shows the empty state when no engine is saved', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('a.md', '# A\n\nText.\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  await page.locator('#editor .ProseMirror').first().click();
  await page.keyboard.press('ControlOrMeta+,');
  const modal = page.locator('.settings-modal');
  await modal.getByRole('tab', { name: 'AI Experimental', exact: true }).click();
  await expect(modal.getByText('No engines yet')).toBeVisible();
  await modal.getByRole('button', { name: 'Add engine…' }).click();
  // The page opens on the quick-start cards.
  const enginesPage = page.getByRole('dialog', { name: 'AI Engines' });
  await expect(enginesPage.getByRole('button', { name: 'Add oMLX' })).toBeVisible();
});

test('a pasted cloud key is stored first, then the models are fetched into a collapsed form', async ({ page, ipc }) => {
  writeEngineSettings(ipc, engine.base);
  wireAi(page, ipc, engine);
  ipc.custom.ai_set_secret = () => null;
  ipc.custom.ai_discover_models = (args: { id: string }) => ({
    info: { engineId: args.id, ok: true, isLocal: false, hasKey: true },
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'].map((id) => ({
      id,
      capabilities: { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: null },
      source: 'endpoint',
    })),
  });
  ipc.launchFiles = [ipc.write('a.md', '# A\n\nText.\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  await page.locator('#editor .ProseMirror').first().click();
  await page.keyboard.press('ControlOrMeta+,');
  const modal = page.locator('.settings-modal');
  await modal.getByRole('tab', { name: 'AI Experimental', exact: true }).click();
  await modal.getByRole('button', { name: 'Manage engines…' }).click();

  const enginesPage = page.getByRole('dialog', { name: 'AI Engines' });
  await enginesPage.getByRole('button', { name: 'Add engine' }).click();
  await enginesPage.getByRole('button', { name: 'Add Anthropic' }).click();
  // The new cloud engine opens on its key field; typing is pasting, one settle later it is stored and fetched.
  await expect(enginesPage.getByLabel('API key for Anthropic')).toBeFocused();
  await page.keyboard.type('sk-test-key');
  // (Opening the oMLX form already asked its server once, as it was never probed; this is the new engine's.)
  const fetchedNew = () => ipc.calls.findIndex((c) => c.cmd === 'ai_discover_models' && (c.args as { id: string }).id !== 'e1');
  await expect.poll(fetchedNew, { timeout: 15000 }).toBeGreaterThanOrEqual(0);
  const stored = ipc.calls.findIndex((c) => c.cmd === 'ai_set_secret');
  expect(stored).toBeGreaterThanOrEqual(0);
  expect(stored).toBeLessThan(fetchedNew());
  expect(ipc.calls[stored].args).toMatchObject({ apiKey: 'sk-test-key' });

  const picker = enginesPage.getByRole('listbox', { name: 'Models' });
  await expect(picker.getByRole('option', { name: /claude-sonnet-5-5/ })).toHaveAttribute('aria-selected', 'true');
  await expect(picker.getByRole('option', { name: /claude-opus-5-5/ })).toHaveAttribute('aria-selected', 'false');
  // Express only: the full models table waits behind Advanced.
  await expect(enginesPage.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'false');
  await expect(enginesPage.getByRole('button', { name: 'Add model' })).toHaveCount(0);
});

/** The same host module the app builds (`createAiHost` over `aiApi`), driven from the page. */
async function driveHost(page: Page, script: string): Promise<unknown> {
  return page.evaluate(async (body) => {
    const { createAiHost } = await import(/* @vite-ignore */ '/src/host/aiHost.ts');
    const { aiApi } = await import(/* @vite-ignore */ '/src/host/aiApi.ts');
    const engines = JSON.parse(body.engines);
    const host = createAiHost({ api: aiApi, settings: () => ({ enabled: true, allowCloud: false, engines, routing: {}, features: {}, localNetworks: [] }), saveEngines: async () => undefined });
    // eslint-disable-next-line no-new-func
    return new Function('host', `return (async () => { ${body.script} })();`)(host);
  }, { script, engines: JSON.stringify(savedEngines()) });
}

function savedEngines(): unknown[] {
  return [{
    id: 'e1', name: 'oMLX', kind: 'openai-compatible', baseUrl: `${engine.base}/v1`, enabled: true, locality: 'auto', discovery: 'auto',
    models: [{ id: 'qwen', enabled: true, capabilities: {}, capabilitiesSource: 'unknown' }, { id: 'stall', enabled: true, capabilities: {}, capabilitiesSource: 'unknown' }],
  }];
}

test('host.ai.listEngines round-trips through ai_list_engines', async ({ page, ipc }) => {
  wireAi(page, ipc, engine);
  ipc.launchFiles = [ipc.write('a.md', '# A\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('A');
  const list = await driveHost(page, 'return await host.listEngines();') as Array<{ engineId: string; isLocal: boolean; ok: boolean | null; models: Array<{ id: string }> }>;
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ engineId: 'e1', isLocal: true, ok: null });
  expect(list[0].models.map((m) => m.id)).toEqual(['qwen', 'stall']);
  expect(ipc.calls.filter((c) => c.cmd === 'ai_list_engines').length).toBeGreaterThan(0);
});

test('host.ai.complete streams the fixture from the mock engine and resolves with the result', async ({ page, ipc }) => {
  wireAi(page, ipc, engine);
  ipc.launchFiles = [ipc.write('a.md', '# A\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('A');
  const out = await driveHost(page, `
    const tokens = [];
    const result = await host.complete({
      requestId: 'rewrite:1', feature: 'rewrite', task: 'rewrite',
      route: { engineId: 'e1', modelId: 'qwen' },
      messages: [{ role: 'user', content: 'hello' }],
    }, (d) => tokens.push(d), new AbortController().signal);
    return { tokens, result };
  `) as { tokens: string[]; result: { text: string; finishReason: string; served: { engineId: string; modelId: string } } };
  expect(out.tokens.join('')).toBe(fixture.expected.text);
  expect(out.result.text).toBe(fixture.expected.text);
  expect(out.result).toMatchObject({ finishReason: 'stop', served: { engineId: 'e1', modelId: 'qwen' } });
  const call = ipc.calls.find((c) => c.cmd === 'ai_complete');
  expect((call?.args as { request: { requestId: string } }).request.requestId).toBe('rewrite:1');
  expect(engine.bodies).toHaveLength(1);
  expect(engine.bodies[0]).toMatchObject({ model: 'qwen', stream: true });
});

test('aborting host.ai.complete mid-stream rejects as cancelled and closes the engine connection', async ({ page, ipc }) => {
  wireAi(page, ipc, engine);
  ipc.launchFiles = [ipc.write('a.md', '# A\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('A');
  const out = await driveHost(page, `
    const ctl = new AbortController();
    const tokens = [];
    const pending = host.complete({
      requestId: 'slow-1', feature: 'rewrite', task: 'rewrite',
      route: { engineId: 'e1', modelId: 'stall' },
      messages: [{ role: 'user', content: 'hello' }],
    }, (d) => { tokens.push(d); ctl.abort(); }, ctl.signal);
    const error = await pending.then(() => null, (e) => e);
    return { tokens, error };
  `) as { tokens: string[]; error: { code: string } | null };
  expect(out.tokens).toEqual(['Hel']);
  expect(out.error).toMatchObject({ code: 'cancelled' });
  await expect.poll(() => ipc.calls.some((c) => c.cmd === 'ai_cancel' && (c.args as { id: string }).id === 'slow-1')).toBe(true);
  await expect.poll(() => engine.aborted()).toBe(1);
});
