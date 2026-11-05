/**
 * Fakes shared by the documentation chat's tests (ai-docs-loop, ai-chat-panel):
 * a tier-2 `host.ai` that scripts navigation replies, `host.docs` built from a
 * small description, and the settings and run context to go with them.
 */
import { vi } from 'vitest';
import {
  buildDocsIndex,
  parseAiSettings,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiDocBaseStatus,
  type AiDocsLink,
  type AiDocsSection,
  type AiDocsSectionRef,
  type AiEngineStatus,
  type AiSettings,
  type DocsReadHost,
  type MikeDownAiHost,
} from '../../src/ai';
import type { AiRunContext } from '../../src/ai-request';

export const CHAT = { chat: true, stream: true, vision: false, json: true, tools: false, fim: false, embed: false, contextTokens: 32768 };
export const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';

export function aiSettings(over: Record<string, unknown> = {}): AiSettings {
  return parseAiSettings({
    enabled: true,
    allowCloud: true,
    engines: [
      { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: CHAT, capabilitiesSource: 'user' }] },
      { id: 'claude', name: 'Cloud', kind: 'anthropic', baseUrl: 'https://api.example.com', models: [{ id: 'sonnet', capabilities: CHAT, capabilitiesSource: 'user' }] },
    ],
    routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'any', tasks: {} },
    ...over,
  }, { onWarning: () => {} });
}

export const toCloud = (): Record<string, unknown> => ({ routing: { default: { engineId: 'claude', modelId: 'sonnet' }, fallback: 'none', tasks: {} } });

export const served = (req: AiCompletionRequest): AiCompletionResult['served'] => ({
  engineId: req.route?.engineId ?? 'host',
  engineName: 'x',
  modelId: req.route?.modelId ?? 'm',
  isLocal: req.route?.engineId !== 'claude',
});
export const nav = (read: unknown, done = false): string => JSON.stringify({ read, done });

/** A tier-2 host: navigation replies from `script` in order, then "the answer [1]" for anything not JSON format. */
export function fakeAi(script: Array<string | ((req: AiCompletionRequest) => string | Promise<string>)>, extra: Partial<MikeDownAiHost> = {}) {
  const calls: AiCompletionRequest[] = [];
  let i = 0;
  const ai: MikeDownAiHost = {
    listEngines: () => Promise.resolve([]),
    complete: async (req, onToken) => {
      calls.push(req);
      if (req.format !== 'json') {
        onToken('the answer [1]');
        return { text: 'the answer [1]', served: served(req), finishReason: 'stop' };
      }
      const step = script[Math.min(i++, script.length - 1)];
      const text = typeof step === 'function' ? await step(req) : step ?? nav([], true);
      return { text, served: served(req), finishReason: 'stop' };
    },
    ...extra,
  };
  return { ai, calls };
}

export function ctxOf(ai: MikeDownAiHost, settings: AiSettings, statuses: AiEngineStatus[] = [], over: Partial<AiRunContext> = {}): AiRunContext {
  return { ai, settings: () => settings, statuses: () => statuses, consent: {}, ...over };
}

export interface FakePage {
  relPath: string;
  title?: string;
  headings?: string[];
  links?: AiDocsLink[];
  /** Section text by heading; `''` is the whole page. */
  bodies?: Record<string, string>;
}

export interface FakeBase {
  id: string;
  name?: string;
  allowCloud?: boolean;
  enabled?: boolean;
  active?: boolean;
  root?: string;
  pages: FakePage[];
}

/** `host.docs` from a small description. `readSections` returns exactly what its contract says and records what it was asked. */
export function fakeDocs(bases: FakeBase[]) {
  const reads: Array<{ baseId: string; ids: string[] }> = [];
  const indexed: string[] = [];
  const keyword: Record<string, AiDocsSectionRef[]> = {};
  const listBases = vi.fn(() => Promise.resolve(bases.map((b): AiDocBaseStatus => ({
    base: { id: b.id, name: b.name ?? b.id, roots: [`/r/${b.id}`], allowCloud: b.allowCloud ?? false, enabled: b.enabled ?? true },
    active: b.active ?? (b.enabled ?? true),
    roots: [{ root: `/r/${b.id}`, label: b.root ?? 'docs', found: true, fileCount: b.pages.length, oversizeSkipped: 0, capReached: false }],
    fileCount: b.pages.length,
    oversizeSkipped: 0,
    rootsMissing: 0,
    capReached: false,
  }))));
  const build = (b: FakeBase) => buildDocsIndex({
    baseId: b.id,
    roots: [{ label: b.root ?? 'docs' }],
    pages: b.pages.map((p) => ({
      root: b.root ?? 'docs',
      relPath: p.relPath,
      ...(p.title ? { title: p.title } : {}),
      headings: (p.headings ?? []).map((text) => ({ level: 2, text })),
      links: p.links ?? [],
      chars: 10,
    })),
  });
  const docs: DocsReadHost = {
    listBases,
    index(baseId) {
      indexed.push(baseId);
      const b = bases.find((x) => x.id === baseId);
      return b ? Promise.resolve(build(b)) : Promise.reject(new Error('unknown base'));
    },
    readSections(baseId, ids) {
      reads.push({ baseId, ids });
      const b = bases.find((x) => x.id === baseId) as FakeBase;
      const index = build(b);
      const out: AiDocsSection[] = [];
      for (const id of ids) {
        const pageId = id.includes('#') ? id.slice(0, id.lastIndexOf('#')) : id;
        const page = index.pages.find((p) => p.id === pageId);
        const fake = b.pages.find((p) => p.relPath === page?.relPath);
        if (!page || !fake) {continue;}
        const heading = page.headings.find((h) => h.id === id);
        const text = fake.bodies?.[heading?.text ?? ''] ?? `body of ${id}`;
        out.push({ id, pageId, title: page.title, relPath: page.relPath, ...(heading ? { heading: heading.text } : {}), text, truncated: false });
      }
      return Promise.resolve(out);
    },
    keywordSearch: (baseId) => Promise.resolve(keyword[baseId] ?? []),
  };
  return { docs, reads, indexed, keyword, listBases };
}

export const HOME: FakePage = {
  relPath: 'README.md',
  title: 'Handbook',
  headings: ['Start here'],
  links: [{ target: 'security.md', text: 'Security', kind: 'markdown' }, { target: 'ops.md', text: 'Operations', kind: 'markdown' }],
};
export const SECURITY: FakePage = { relPath: 'security.md', title: 'Security', headings: ['Key rotation', 'Audit'] };
export const OPS: FakePage = { relPath: 'ops.md', title: 'Operations', headings: ['Backups'] };
export const simple = (over: Partial<FakeBase> = {}): FakeBase => ({ id: 'b', name: 'Handbook', pages: [HOME, SECURITY, OPS], ...over });
