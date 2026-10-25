# AI Inference Engines Plan

## Summary

Give MikeDown a configurable AI provider layer: a registry of inference engines (any number, any mix of local and cloud), the models each one serves with their capabilities, task-based routing with fallback, a cloud consent gate, and one thin proof feature (selection rewrite) that exercises the whole path end to end. Everything is off by default behind a master switch in a new **AI** tab of the in-editor Settings modal.

This plan builds on `ai-copilot-brainstorm.md` (architecture constraints 1 to 10 there are taken as given, not re-argued) and borrows the engine-profile shape that shipped in LymeScribe (`~/git/lymescribe/docs/ai-features-plan.md`: named profiles, Keychain for keys, `/v1/models` as the Test Connection probe, OpenAI-compatible first with a native Anthropic adapter).

**Key objectives:**

- One engine/model/routing model that works in all three hosts: VS Code (extension host, Node), Desktop (Tauri, Rust command), npm consumers (their own `ai` host implementation). Core ships types, schema, router and UI; never a provider SDK.
- Inference runs host side and streams back to the editor over the existing host boundary (`postMessage` in VS Code, Tauri events on Desktop, a direct callback for npm consumers).
- API keys live in VS Code `SecretStorage` or the OS keychain on Desktop, never in `settings.json`.
- Settings schema is open-ended: new features and tasks slot in with no migration.
- A visible local/cloud indicator always says which engine and model served the last request.

**Critical success factors:**

- Mike's own setup works out of the box through presets: oMLX (`http://127.0.0.1:8000/v1`, key from `OMLX_API_KEY`) for MLX models, LM Studio (`http://127.0.0.1:1234/v1`, no key) for GGUF, plus Ollama, generic OpenAI-compatible, Anthropic and OpenAI.
- Routing example from the brief works: vision tasks to a local Gemma, structure/coding tasks to a local MiniMax, meeting-note tasks to Claude, everything else to the default route.
- A cloud engine can never be used silently: `allowCloud` false by default, plus one consent per workspace.
- The rewrite feature is a single undoable transaction and shows which engine served it.

**Defaults applied by the planning skill:** incremental testing milestones after each build group; automated tests preferred, one hands-on pass at the end (no screenshot review, the AI tab is a settings form); Opus recommended for UI and architecture milestones, Sonnet for plumbing; no schema review milestone (no database).

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| M1 Core contracts: schema, capabilities, task taxonomy, router | Opus | ✅ Done | 17 | `@mikedown/core/ai` |
| T1 Unit tests: schema, router, locality, SSE parser | Sonnet | ✅ Done | 8 | vitest, pure |
| M2 VS Code host: adapters, secrets, settings, protocol | Opus | ✅ Done | 16 | `src/ai/` |
| T2 Host tests: adapters with mocked fetch, live opt-in run | Sonnet | ✅ Done | 25 | `MIKEDOWN_AI_LIVE=1` |
| M3 Settings UI: AI tab, engine editor, routing, indicator | Opus | ✅ Done | 22 | core, all hosts |
| M4 Desktop: Rust `ai_*` commands, keyring, TauriHost `ai` | Sonnet | ✅ Done | 18 | reqwest + keyring |
| T3 Desktop tests: cargo fixtures, Tauri smoke | Sonnet | 🟡 Partial | 20 | real-webview smoke moved to T4 | shared fixtures |
| M5 Proof feature: selection rewrite with preview popover | Opus | ✅ Done | 28 | feature id `rewrite` |
| M6 npm consumers: wrappers, demo stub host, docs | Sonnet | ✅ Done | 14 | website demo |
| M4b Key file fallback (oMLX `~/.omlx/settings.json`), VS Code + Desktop | Sonnet | ✅ Done | 15 | added at Mike's request |
| M3b Express engine form: quick-start cards, auto-fetched models, Advanced fold | Opus | 🔄 In Progress | — | T4 finding: too complex, too cramped; OPEN-12 revised (Popular, auto-pick, thinking) |
| M3c AI Engines page (full window) and the AI tab as a summary | Opus | ⬜ Not Started | — | OPEN-11 |
| T3b Settings redesign tests and three screenshots | Sonnet | ⬜ Not Started | — | jsdom + website stub host |
| T4 Hands-on: end to end on Mike's machines | Sonnet | ⏸️ Blocked | — | blocked on M3b, M3c, T3b; first pass found the settings UI unusable |
| M7 Release prep: CHANGELOG, README, versions | Haiku | ⬜ Not Started | — | ships dark |

## Table of Contents

- [Summary](#summary)
- [Open Decisions](#open-decisions)
- [Architecture](#architecture)
  - [Where each piece lives](#where-each-piece-lives)
  - [Settings schema](#settings-schema)
  - [Engine kinds and presets](#engine-kinds-and-presets)
  - [Capabilities and detection](#capabilities-and-detection)
  - [Task taxonomy and routing](#task-taxonomy-and-routing)
  - [Cloud consent](#cloud-consent)
  - [Host interface: the `ai` group](#host-interface-the-ai-group)
  - [Provider adapter interface](#provider-adapter-interface)
  - [Protocol messages](#protocol-messages)
  - [Secrets](#secrets)
  - [Indicator](#indicator)
- [M1 Core contracts](#m1-core-contracts)
- [T1 Unit tests](#t1-unit-tests)
- [M2 VS Code host](#m2-vs-code-host)
- [T2 Host tests](#t2-host-tests)
- [M3 Settings UI](#m3-settings-ui)
- [Settings redesign (after the first T4 pass)](#settings-redesign-after-the-first-t4-pass)
  - [M3b Express engine form](#m3b-express-engine-form)
  - [M3c AI Engines page and summary tab](#m3c-ai-engines-page-and-summary-tab)
  - [T3b Settings redesign tests](#t3b-settings-redesign-tests)
- [M4 Desktop](#m4-desktop)
- [T3 Desktop tests](#t3-desktop-tests)
- [M5 Proof feature: selection rewrite](#m5-proof-feature-selection-rewrite)
- [M6 npm consumers](#m6-npm-consumers)
- [T4 Hands-on](#t4-hands-on)
- [M7 Release prep](#m7-release-prep)
- [Follow-up plans](#follow-up-plans)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Progress Log / Notes](#progress-log--notes)

---

## Open Decisions

Each has a recommendation so a worker can proceed if Mike has not overridden it.

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| OPEN-1 | Ship the TypeScript adapters only inside the extension, or also publish them as `@mikedown/ai-providers` for npm consumers? | Extension only in this plan (`src/ai/providers/`). Keep the pure parts (request builders, SSE parser, capability heuristics) in `packages/core/src/ai/` so a later package is a move, not a rewrite. | M2, M6 |
| OPEN-2 | Which cloud kinds get a native adapter in v1? | `anthropic` (Messages API, native) and `openai` (Responses or Chat Completions). Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI as `openai-compatible` presets. Azure OpenAI deferred (different URL and auth shape). | M1, M2 |
| OPEN-3 | Where do engines persist in VS Code: user scope only, or workspace too? | User scope only for `engines` (a repo must not be able to inject an endpoint). `routing`, `features`, `enabled` and `allowCloud` may be workspace-scoped so a team repo can turn AI off. Enforced by `scope` in `package.json`. | M2 |
| OPEN-4 | Desktop: engines app-wide only, or also per folder in `.mikedown/settings.json`? | App-wide only for `engines` (same reasoning as OPEN-3); the rest follows the existing folder-wins merge. | M4 |
| OPEN-5 | Cloud consent granularity. | Per workspace (VS Code `workspaceState`) and per folder on Desktop, keyed by engine id, in addition to the global `allowCloud` switch. npm consumers get `requestCloudConsent` on the host and decide themselves. | M1, M2, M4 |
| OPEN-6 | Thinking controls differ per server (`reasoning_effort` is on/off on LM Studio, three tiers on oMLX, which also has `thinking_budget`). | A per-model `requestOverrides` JSON object merged into the request body. No per-kind special casing in v1. | M1 |
| OPEN-7 | Is Ollama installed anywhere on the estate for a live test? | Fixture-only coverage in T2 if not; the Ollama adapter ships marked "fixture tested" in the CHANGELOG. | T2 |
| OPEN-8 | Release channel for the extension. | Ship dark in a normal 2.x release (`mikedown.ai.enabled` false, nothing visible but the AI tab). No pre-release channel. | M7 |
| OPEN-9 | Rewrite variants in the proof feature. | Shorter, Longer, Fix flow, Custom prompt. The rest of idea 2 (simpler, formal, casual) and ideas 12, 19, 20 come in the follow-up plan. | M5 |
| OPEN-10 | Context length for models the endpoint cannot describe (oMLX `/v1/models` is bare). | Heuristic from the model id, then user edit. Default 8k when unknown. | M1 |
| OPEN-11 | Where the full-size AI Engines page lives: an overlay rendered by core inside the editor's DOM, or a real VS Code editor tab (its own webview) and a Desktop window? | **Resolved 2026-10-25 (Mike): overlay.** **Overlay now, built as a standalone mountable component** (`mountAiEnginesPage(container, ctx)`). One implementation serves VS Code, Desktop and npm consumers, reuses the draft/save/secret flow the modal already has, and needs no second webview, HTML shell, CSS list or `postMessage` channel for settings and secrets. A VS Code tab would also lose the editor's `retainContextWhenHidden` state and need its own `getWebviewContent`. The mountable shape keeps the tab/window option open: hosting it elsewhere is a new shell, not a rewrite. Revisit if Mike wants engines editable with no document open. | M3c |
| OPEN-12 | Cloud discovery enables every model it finds (today's merge rule), which makes a 300-model OpenRouter list unusable in the routing pickers. | **Resolved 2026-10-25 (Mike), revised:** low friction first. Pasting a key auto-fetches and auto-picks the provider's usual default model (enabled, set as Default model), so key = done. The cloud picker shows a **Popular** group first, chosen by per-preset pattern rules matched against the fetched list (newest id per family, e.g. Anthropic sonnet/opus/haiku), never hardcoded ids; the full list is searchable below, and any id can be typed. A per-model **Thinking** level (Off/Low/Medium/High) is configured on the model and mapped per kind into `requestOverrides`; an on-demand dial is backlog. Original rule kept underneath: local kinds keep "discovered = enabled". Cloud kinds (`locality` cloud after detection) add discovered models **disabled**; the Express picker enables the ones chosen, a typed id is added enabled. Uses the existing `enabled` flag, no schema change. | M3b |
| OPEN-13 | Worktree `/Users/michaeljosephwork/git/mikedown-ai-express` (branch `ai-engines-express`), started for this work and stopped. | Checked 2026-10-25: clean tree, no stash, no commits ahead of `ai-engines` (both at `23e53e2`). Nothing to keep and nothing to reset; reuse it for M3b as is, or `git worktree remove` it and let the orchestrator create a fresh one. | M3b |

[Return to Top](#ai-inference-engines-plan)

---

## Architecture

### Where each piece lives

| Piece | Location | Notes |
|---|---|---|
| Types, settings schema and validation, task taxonomy, capability heuristics, locality detection, router, SSE parser, request builders (pure, no network) | `packages/core/src/ai/` exported as `@mikedown/core/ai` | Also importable by the extension host as `@mikedown/core/ai` (add the alias beside `@mikedown/core/shared/*` in `tsconfig.json`, `webpack.config.js`, `vitest.config.ts`). |
| Settings modal AI tab, indicator chip, consent dialog, rewrite popover | `packages/core/src/ai-settings.ts`, `packages/core/src/ai-rewrite.ts`, styles in `packages/core/src/styles/ai.css` | Built only when `host.ai` is present. |
| VS Code adapters (network), SecretStorage, status bar item, protocol routing | `src/ai/` (`engineService.ts`, `providers/*.ts`, `secrets.ts`), hooks in `markdownEditorProvider.ts`, `settings.ts`, `package.json` | Node `fetch` with `AbortController`. |
| Desktop | `packages/desktop/src-tauri/src/commands/ai.rs`, `ai/providers/*.rs`, `keyring` crate; `packages/desktop/src/host/tauriHost.ts` implements the `ai` group | Streaming via Tauri events, one channel per request id. |
| npm consumers | Pass `host.ai` themselves | `complete` alone turns the features on; the registry methods turn the engine UI on. |

The router runs in core. The editor resolves `task -> engine + model` from settings and last-known engine status, then asks the host to run exactly that pair. A host that implements only `complete` (a React consumer with a backend proxy) ignores the pair and does its own thing; that is tier 1 below.

Two host tiers:

- **Tier 1, bring your own routing:** `host.ai.complete` only. Core shows the master switch, per-feature toggles and the indicator (from whatever `served` the host reports). No engine registry UI.
- **Tier 2, managed registry:** `complete` plus `listEngines`, `testEngine`, `discoverModels`, `setSecret`. Core shows the full AI tab and routes. VS Code and Desktop are tier 2.

### Settings schema

Five top-level keys, all under `mikedown.ai`. Arrays and open maps so new entries never need a migration; unknown keys are preserved on save.

```jsonc
{
  "mikedown.ai.enabled": false,          // master switch
  "mikedown.ai.allowCloud": false,       // global gate for engines whose locality is cloud

  "mikedown.ai.engines": [
    {
      "id": "omlx-studio",               // stable, generated once (nanoid), never shown
      "name": "oMLX (Mac Studio)",
      "kind": "openai-compatible",       // see Engine kinds
      "baseUrl": "http://127.0.0.1:8000/v1",
      "enabled": true,
      "locality": "auto",                // "auto" | "local" | "cloud"; auto derives from the URL
      "apiKeyEnv": "OMLX_API_KEY",       // optional env var fallback; the key itself is never here
      "discovery": "auto",               // "auto" (list from endpoint, merge with manual) | "manual"
      "models": [
        {
          "id": "tls20/Qwen3.8-Flash-Next-oQ5e-mtp",
          "label": "Qwen 3.8 Flash Next",
          "enabled": true,
          "capabilities": { "chat": true, "stream": true, "vision": false, "json": true, "tools": true, "fim": false, "embed": false, "contextTokens": 262144 },
          "capabilitiesSource": "heuristic", // "endpoint" | "heuristic" | "user"
          "requestOverrides": { "reasoning_effort": "low" }  // OPEN-6, merged into the request body
        }
      ]
    },
    {
      "id": "claude",
      "name": "Anthropic",
      "kind": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "enabled": true,
      "locality": "auto",
      "discovery": "auto",
      "models": [{ "id": "claude-sonnet-5-5", "enabled": true, "capabilities": { "chat": true, "stream": true, "vision": true, "json": true, "tools": true, "contextTokens": 200000 }, "capabilitiesSource": "endpoint" }]
    }
  ],

  "mikedown.ai.routing": {
    "default": { "engineId": "omlx-studio", "modelId": "tls20/Qwen3.8-Flash-Next-oQ5e-mtp" },
    "fallback": "anyLocal",              // "none" | "default" | "anyLocal" | "any"
    "tasks": {                           // open map, task ids from the taxonomy; absent task = default
      "vision":    { "engineId": "lmstudio", "modelId": "gemma-4-26b-a4b-it-qat-mlx-4bit" },
      "structure": { "engineId": "omlx-studio", "modelId": "minimax-m3" },
      "notes":     { "engineId": "claude", "modelId": "claude-sonnet-5-5" }
    }
  },

  "mikedown.ai.features": {              // open map, feature ids; absent feature = its default
    "rewrite": { "enabled": true },
    "ghostText": { "enabled": false },   // future; separate opt-in per the brainstorm
    "altText": { "enabled": true, "task": "vision" }  // optional per-feature task override
  }
}
```

Rules:

- `package.json#contributes.configuration` declares each key with a JSON schema (`engines` as `array` of `object`, `routing` and `features` as `object` with `additionalProperties`). The VS Code settings UI shows "Edit in settings.json" for these; the modal is the primary UX (Settings rule).
- `src/settings.ts` gets `ai: AiSettings` built by `parseAiSettings(raw)` from `@mikedown/core/ai`, which validates, fills defaults and drops nothing it does not understand.
- Desktop persists the same keys through the existing flat `settings.json` store (`packages/desktop/src/settings/schema.ts`, add `ai.*` to `DESKTOP_KEY_DEFAULTS`).
- npm consumers receive and return the same keys through `settings` / `saveSettings`.
- A feature's defaults (enabled or not, default task) live in a core feature registry (`packages/core/src/ai/features.ts`); adding a feature is one registry entry plus its UI, no settings change.

### Engine kinds and presets

| Kind | Transport | Discovery | Capability detection | Notes |
|---|---|---|---|---|
| `openai-compatible` | `POST {base}/chat/completions` (SSE), `POST {base}/embeddings` | `GET {base}/models` | Heuristic from id (`vl`, `vision`, `embed`, `coder`, known families) | Covers oMLX, vLLM, llama.cpp server, OpenRouter, Groq, Gemini, Mistral, DeepSeek, xAI. Presets fill name, URL and `apiKeyEnv`. |
| `lmstudio` | OpenAI-compatible `/v1` | `GET /api/v0/models` | Endpoint: `type` (llm, vlm, embeddings), `max_context_length`, `state` (loaded) | Falls back to `openai-compatible` behavior if `/api/v0` is missing. Any non-empty key accepted. |
| `ollama` | OpenAI-compatible `/v1` for completions | `GET /api/tags`, then `POST /api/show` per model | Endpoint: `capabilities` (`completion`, `vision`, `tools`, `embedding`), `context_length` | Native endpoints only for metadata. |
| `anthropic` | Messages API, SSE | `GET /v1/models` | Static table in core (vision, tools, context) with id-prefix matching for new models | `x-api-key` plus `anthropic-version`. |
| `openai` | Chat Completions, SSE | `GET /v1/models` | Static table with prefix matching | Also used for Azure later (OPEN-2). |

Presets offered in "Add engine": oMLX, LM Studio, Ollama, llama.cpp server, vLLM, OpenRouter, Groq, Google Gemini (OpenAI-compatible), Mistral, DeepSeek, Anthropic, OpenAI, Custom OpenAI-compatible.

Locality `auto`: loopback, RFC 1918, link-local, `.local`, `.lan`, `.home.arpa` and WireGuard ranges (`10.0.98.0/24` style user-extendable list in `mikedown.ai.localNetworks`, default RFC 1918) resolve to `local`; everything else to `cloud`. The user can pin it either way; the indicator shows a warning glyph when `cloud` is pinned on a private address or the reverse.

### Capabilities and detection

```ts
interface AiModelCapabilities {
  chat: boolean;      // chat/instruct completion
  stream: boolean;    // SSE token streaming (assumed true unless the probe says otherwise)
  vision: boolean;    // image inputs
  json: boolean;      // JSON mode or reliable structured output
  tools: boolean;     // function calling
  fim: boolean;       // fill-in-the-middle / raw completion (ghost text)
  embed: boolean;     // embeddings endpoint
  contextTokens: number | null;
}
```

Detection order: endpoint metadata, then id heuristics (`packages/core/src/ai/capabilityHeuristics.ts`, a table of regexes and family defaults), then user edits. `capabilitiesSource` records where each model's values came from so a re-discovery refreshes `endpoint` and `heuristic` rows and leaves `user` rows alone. Models are merged by id on discovery: new ids added (enabled), missing ids marked `missing: true` (greyed, not deleted), manual entries kept.

### Task taxonomy and routing

| Task id | Needs | Brainstorm features | Typical local pick |
|---|---|---|---|
| `rewrite` | chat, stream | 2 selection rewrite, 12 explain/expand, 19 reading level, 20 translation | general instruct 7B+ |
| `continue` | fim (or chat with a continue prompt), stream, low latency | 1 ghost text | small FIM model |
| `chat` | chat, stream | 5 chat with document, 18 prompt blocks | daily driver |
| `summarize` | chat, large context | 4 summary, 17 what changed | large-context model |
| `structure` | chat, json | 7 frontmatter and tags, 9 Mermaid and tables and code, 14 titles, 16 paste cleanup | coding model (MiniMax M3) |
| `notes` | chat, json | 13 meeting notes to action items | Claude or large local |
| `review` | chat, json | 3 grammar pass, 15 consistency checker | json-reliable model |
| `vision` | vision | 8 alt text | Gemma 4 26B-A4B |
| `embed` | embed | 6 workspace RAG, 10 link suggestions | nomic-embed-text |
| `transcribe` | host `transcribe` | 11 dictation | LymeScribe Server |

Each feature declares a default task in the feature registry; `features.<id>.task` overrides it. Resolution, in core:

1. Feature enabled and master switch on, else the surface is hidden.
2. Route = `routing.tasks[task]`, else `routing.default`.
3. Candidate is usable when: engine exists and enabled, model exists, enabled and not `missing`, model has every required capability, engine locality is local or (`allowCloud` and consent granted), last probe not failed.
4. If not usable, apply `routing.fallback`: `none` (surface disabled with a reason tooltip), `default` (try the default route), `anyLocal` (default, then any usable local engine/model with the capabilities, in registry order), `any` (then cloud engines that pass the gate).
5. The result carries `{ engineId, modelId, viaFallback: boolean, reason? }`; the UI shows "fallback" in the indicator when `viaFallback` is true.

`fallback` never crosses from local to cloud unless it is `any`, and even then only through the gate. Routing is recomputed on every request (cheap, pure) using the status cache from the last `listEngines`.

### Cloud consent

- `allowCloud` false: cloud engines show as "blocked by Allow cloud" in the AI tab and are never routed. Test connection still works (it is the user clicking).
- `allowCloud` true: the first request a cloud engine would serve in a workspace triggers `host.ai.requestCloudConsent(engineId)`; VS Code shows a modal naming the engine, the URL and what is sent (the selection and one paragraph for rewrite), with "Allow for this workspace" and "Not now". The answer is stored per workspace and engine id (`workspaceState` in VS Code, folder settings on Desktop). "Not now" counts as unusable for routing this session.
- The consent dialog is host UI, not webview UI, so a shared workspace cannot style it away.

### Host interface: the `ai` group

Added to `MikeDownHost` in `packages/core/src/host.ts`:

```ts
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image'; mime: string; bytes: Uint8Array }>;
}

export interface AiCompletionRequest {
  requestId: string;
  feature: string;                 // feature id, for logging and consent copy
  task: string;                    // task id, informational for tier-1 hosts
  route?: { engineId: string; modelId: string }; // resolved by core; tier-1 hosts may ignore
  messages: AiMessage[];
  format?: 'text' | 'json';
  maxTokens?: number;
  temperature?: number;
}

export interface AiServedBy {
  engineId?: string;
  engineName: string;              // "oMLX (Mac Studio)"
  modelId: string;
  isLocal: boolean;
}

export interface AiCompletionResult {
  text: string;
  served: AiServedBy;
  usage?: { promptTokens?: number; completionTokens?: number };
  finishReason?: 'stop' | 'length' | 'cancelled' | 'error';
}

export interface AiEngineStatus {
  engineId: string;
  ok: boolean | null;              // null = never probed
  isLocal: boolean;
  hasKey: boolean;
  latencyMs?: number;
  error?: string;
  models: Array<{ id: string; label?: string; capabilities: AiModelCapabilities; source: 'endpoint' | 'heuristic' | 'user'; missing?: boolean; loaded?: boolean }>;
}

export type AiErrorCode = 'unreachable' | 'auth' | 'modelNotFound' | 'contextOverflow' | 'rateLimited' | 'cloudBlocked' | 'consentDenied' | 'cancelled' | 'unknown';

export interface MikeDownAiHost {
  // Tier 1: enough for every feature.
  complete(req: AiCompletionRequest, onToken: (delta: string) => void, signal: AbortSignal): Promise<AiCompletionResult>;
  embed?(texts: string[], route?: { engineId: string; modelId: string }, signal?: AbortSignal): Promise<number[][]>;
  transcribe?(audio: { mime: string; bytes: Uint8Array }, signal?: AbortSignal): Promise<string>;

  // Tier 2: turns on the engine registry UI and core routing.
  listEngines?(): Promise<AiEngineStatus[]>;
  testEngine?(engineId: string): Promise<AiEngineStatus>;
  discoverModels?(engineId: string): Promise<AiEngineStatus>;
  setSecret?(engineId: string, apiKey: string | null): Promise<void>;
  requestCloudConsent?(engineId: string): Promise<boolean>;
}

// in MikeDownHost:
//   ai?: MikeDownAiHost;
```

Errors reject with `AiError { code: AiErrorCode; message: string }`. Core maps codes to user copy once (`packages/core/src/ai/errors.ts`).

### Provider adapter interface

Host side (TypeScript in `src/ai/providers/`, Rust trait in `commands/ai/providers/mod.rs` with the same shape):

```ts
export interface ProviderAdapter {
  readonly kind: AiEngineKind;
  /** Discovery plus capability detection. */
  listModels(engine: AiEngineConfig, apiKey: string | null, signal: AbortSignal): Promise<AiDiscoveredModel[]>;
  /** Test connection: reachability, auth, latency. Uses listModels when the kind has nothing cheaper. */
  probe(engine: AiEngineConfig, apiKey: string | null, signal: AbortSignal): Promise<{ ok: boolean; latencyMs: number; error?: AiError }>;
  /** Streaming completion against one model. */
  complete(engine: AiEngineConfig, apiKey: string | null, model: AiModelConfig, req: AiCompletionRequest, onToken: (delta: string) => void, signal: AbortSignal): Promise<AiCompletionResult>;
  embed?(engine: AiEngineConfig, apiKey: string | null, model: AiModelConfig, texts: string[], signal: AbortSignal): Promise<number[][]>;
}
```

`src/ai/engineService.ts` (and `ai.rs`) owns: the adapter map by kind, the secret lookup (SecretStorage, then `apiKeyEnv`, then none), one in-flight request per panel with cancellation, the probe cache, the cloud gate check (defence in depth, the host refuses `cloudBlocked` even if the webview asked), and mapping HTTP failures to `AiErrorCode`.

Pure helpers shared by both adapters sets through fixtures: `packages/core/src/ai/sse.ts` (SSE line reassembly, `[DONE]`, Anthropic event types), `packages/core/src/ai/requests.ts` (request bodies per kind, `requestOverrides` merge, image parts encoding). The Rust side reimplements them and is tested against the same JSON fixtures in `test/ai-fixtures/`.

### Protocol messages

Webview to host (VS Code; Desktop maps each to a Tauri command):

| Type | Payload | Notes |
|---|---|---|
| `aiComplete` | `AiCompletionRequest` (images base64) | Host streams `aiToken`, ends with `aiDone` or `aiError`. |
| `aiCancel` | `{ requestId }` | Aborts the in-flight request. |
| `aiListEngines` | none | Answered by `aiEngines`. Also broadcast after settings change. |
| `aiTestEngine` | `{ engineId }` | Answered by `aiEngineStatus`. |
| `aiDiscoverModels` | `{ engineId }` | Answered by `aiEngineStatus`; the host also merges models into the saved engine. |
| `aiSetSecret` | `{ engineId, apiKey: string \| null }` | Never part of `saveSettings`. Answered by `aiEngineStatus` (`hasKey`). |
| `aiRequestCloudConsent` | `{ engineId, requestId }` | Answered by `aiConsent`. |

Host to webview:

| Type | Payload |
|---|---|
| `aiToken` | `{ requestId, delta }` |
| `aiDone` | `{ requestId, result: AiCompletionResult }` |
| `aiError` | `{ requestId, code: AiErrorCode, message }` |
| `aiEngines` | `{ engines: AiEngineStatus[] }` |
| `aiEngineStatus` | `{ status: AiEngineStatus }` |
| `aiConsent` | `{ engineId, requestId, granted }` |

`settings` broadcast carries `ai` like any other settings group (engines without secrets). Message shapes get documented in the protocol comment at the top of `packages/core/src/editor-main.ts`, and `src/webview/vsCodeHost.ts` implements the `ai` group over `post` with request-id correlation like `savePastedImage`.

### Secrets

- VS Code: `context.secrets` key `mikedown.ai.apiKey.<engineId>`. Deleted when the engine is deleted. Never read into settings, never sent to the webview; the webview only learns `hasKey`.
- Desktop: `keyring` crate, service `net.iadev.mikedown`, account `<engineId>`. Same lifecycle.
- `apiKeyEnv` on the engine: if no stored key, read the named environment variable from the host process (covers `OMLX_API_KEY`). Desktop launched from the Dock has a sparse environment; the AI tab says so when the variable is unset.
- The settings modal's key field is write-only: placeholder "Stored" when `hasKey`, a Clear button, and the field is blanked after save.

### Indicator

- Core sidebar footer chip: `AI: local · oMLX · Qwen 3.8 Flash Next` or `AI: cloud · Anthropic · claude-sonnet-5-5`, from the last `served`; `AI: off` when disabled; `AI: no route` when nothing is usable. Click opens the AI tab.
- VS Code status bar item mirrors it (host side, from `aiDone`). Cloud gets `$(cloud)`, local `$(home)`.
- The rewrite popover header shows the same badge plus "(fallback)" when `viaFallback`.
- Desktop reuses the core chip; no extra chrome.

[Return to Top](#ai-inference-engines-plan)

---

## M1 Core contracts

**Recommended model: Opus** (contracts everything else depends on)

> Workers must complete ALL items in this list. If an item seems out of scope, note it in your summary for the orchestrator, but attempt it unless truly blocked.

- [x] `packages/core/src/ai/types.ts`: `AiEngineKind`, `AiEngineConfig`, `AiModelConfig`, `AiModelCapabilities`, `AiRouting`, `AiFeatureSettings`, `AiSettings`, plus the host types above (`AiMessage`, `AiCompletionRequest`, `AiCompletionResult`, `AiEngineStatus`, `AiError`, `AiErrorCode`).
- [x] `packages/core/src/ai/schema.ts`: `parseAiSettings(raw: unknown): AiSettings` with defaults, id generation for engines missing an id, preservation of unknown keys; `serializeAiSettings` for the patch.
- [x] `packages/core/src/ai/features.ts`: feature registry (`id`, `label`, `defaultEnabled`, `defaultTask`, `requires: Partial<AiModelCapabilities>`), seeded with `rewrite` and placeholders for the brainstorm's top 5 (`ghostText`, `chat`, `summary`, `frontmatter`, `altText`) marked `planned` so the tab can list them greyed.
- [x] `packages/core/src/ai/tasks.ts`: task taxonomy table from this plan with required capabilities.
- [x] `packages/core/src/ai/locality.ts`: `detectLocality(baseUrl, localNetworks)`.
- [x] `packages/core/src/ai/capabilityHeuristics.ts`: id-based detection and the static cloud tables (Anthropic, OpenAI) with prefix matching; `mergeDiscoveredModels(existing, discovered)` honoring `capabilitiesSource`.
- [x] `packages/core/src/ai/router.ts`: `resolveRoute(settings, statuses, consent, { feature })` implementing steps 1 to 5, returning `{ engineId, modelId, viaFallback, reason }` or `{ unusable: reason }`.
- [x] `packages/core/src/ai/sse.ts` and `requests.ts`: pure SSE reassembly (OpenAI and Anthropic event shapes) and request body builders per kind with `requestOverrides` merge and image parts.
- [x] `packages/core/src/ai/errors.ts`: user copy per `AiErrorCode`.
- [x] `packages/core/src/host.ts`: add `ai?: MikeDownAiHost`; `packages/core/src/types.ts`: add `ai` to `MikeDownSettings` and the feature flags; export `@mikedown/core/ai` from `packages/core/package.json#exports` and tsup entries.
- [x] Add the `@mikedown/core/ai` alias to `tsconfig.json`, `webpack.config.js`, `vitest.config.ts`.
- [x] `test/ai-fixtures/`: JSON fixtures for SSE streams (OpenAI chunked deltas with `[DONE]`, Anthropic `content_block_delta` sequence, a truncated stream), discovery responses (LM Studio `/api/v0/models`, Ollama `/api/tags` + `/api/show`, bare `/v1/models`, Anthropic `/v1/models`), and routing scenarios (the vision/structure/notes example, cloud blocked, fallback chain).

[Return to Top](#ai-inference-engines-plan)

---

## T1 Unit tests

**Recommended model: Sonnet** · **Mode: vitest unit tests (automated), no human gate**

> Workers must complete ALL items, including running the suite green.

- [x] `packages/core/test/ai-schema.test.ts`: defaults, unknown keys preserved, missing ids generated once and stable across parse/serialize, malformed entries dropped with a warning not a throw.
- [x] `packages/core/test/ai-router.test.ts`: every fixture scenario; capability gating; `fallback` modes; cloud never reached without `allowCloud` plus consent; `viaFallback` set; disabled model skipped; `missing` model skipped.
- [x] `packages/core/test/ai-locality.test.ts`: loopback, RFC 1918, `.local`, WireGuard range from `localNetworks`, public host, pinned override.
- [x] `packages/core/test/ai-capabilities.test.ts`: heuristics for the model ids in `~/git/home-lab/local-ai/model-catalog.md` (Qwen VL and non-VL, Gemma 4, MiniMax M3, nomic-embed, Qwen Coder), endpoint metadata wins over heuristics, user edits survive re-discovery.
- [x] `packages/core/test/ai-sse.test.ts`: both stream shapes, split-across-chunks lines, `[DONE]`, truncated stream yields `finishReason: 'error'`.
- [x] `packages/core/test/ai-requests.test.ts`: body per kind, `requestOverrides` merge order (overrides win), `format: 'json'` mapping per kind, image parts.
- [x] Run `npm run test:unit` and `npm run test:packages` green; record the commands in the Progress Log.

[Return to Top](#ai-inference-engines-plan)

---

## M2 VS Code host

**Recommended model: Opus** (five adapters, secrets, protocol; many edge cases)

> Workers must complete ALL items in this list. If an item seems out of scope, note it in your summary for the orchestrator, but attempt it unless truly blocked.

- [x] `package.json#contributes.configuration`: `mikedown.ai.enabled`, `mikedown.ai.allowCloud`, `mikedown.ai.engines` (user scope, OPEN-3), `mikedown.ai.routing`, `mikedown.ai.features`, `mikedown.ai.localNetworks`, with schemas and descriptions that point at the Settings modal.
- [x] `src/settings.ts`: `ai: AiSettings` via `parseAiSettings`; included in the `settings` broadcast without secrets.
- [x] `src/ai/secrets.ts`: SecretStorage get/set/delete by engine id, `apiKeyEnv` fallback, delete on engine removal (diff old and new `engines` on config change).
- [x] `src/ai/providers/openaiCompatible.ts`, `lmstudio.ts`, `ollama.ts`, `anthropic.ts`, `openai.ts` implementing `ProviderAdapter` with Node `fetch`, SSE via core `sse.ts`, request bodies via core `requests.ts`, HTTP status to `AiErrorCode` mapping (401/403 auth, 404 modelNotFound, 413 or 400 with "context" contextOverflow, 429 rateLimited, network unreachable).
- [x] `src/ai/engineService.ts`: adapter map, probe cache with timestamps, one in-flight request per panel keyed by `requestId` with `AbortController`, cloud gate enforcement (`cloudBlocked`), consent store in `workspaceState` keyed `mikedown.ai.consent.<engineId>`, consent modal via `vscode.window.showWarningMessage({ modal: true })`.
- [x] `markdownEditorProvider.ts`: route the seven webview messages, emit the six host messages, dispose in-flight requests on `onDidDispose`, broadcast `aiEngines` after a config change.
- [x] `src/webview/vsCodeHost.ts`: implement `MikeDownAiHost` (tier 2) over `post` with request-id correlation.
- [x] Status bar item `AI: …` updated from `aiDone`, hidden when `enabled` is false; click runs `mikedown.openAiSettings` which opens the modal on the AI tab.
- [x] Commands: `mikedown.openAiSettings`, `mikedown.ai.testAllEngines` (writes results to an output channel "MikeDown AI").
- [x] Output channel logging: one line per request (feature, task, engine, model, local/cloud, latency, finish reason), never the prompt text.

[Return to Top](#ai-inference-engines-plan)

---

## T2 Host tests

**Recommended model: Sonnet** · **Mode: vitest with mocked `fetch` (automated) plus an opt-in live run (automated, skipped unless `MIKEDOWN_AI_LIVE=1`)**

> Workers must complete ALL items, including running the suite green. Live tests must skip cleanly, not fail, when the env var or the server is absent.

- [x] `test/unit/ai-providers.test.ts`: each adapter against the fixtures (discovery parsing, capabilities, probe ok/auth/unreachable, streaming reassembly, cancellation mid-stream aborts the fetch, `requestOverrides` present in the body, `apiKeyEnv` fallback used when no secret).
- [x] `test/unit/ai-engineService.test.ts`: cloud gate refuses without `allowCloud`, consent prompt once per workspace per engine, second request while one is in flight cancels the first, secret deleted when an engine disappears from settings.
- [x] `test/unit/ai-protocol.test.ts`: `vsCodeHost` `ai` group correlates `aiDone`/`aiError` by `requestId`, tokens forwarded in order, `aiCancel` posted on abort.
- [x] `test/live/ai-live.test.ts` (new folder, excluded from `test:unit`, run by `npm run test:ai-live`): against oMLX `http://127.0.0.1:8000/v1` with `OMLX_API_KEY` and LM Studio `http://127.0.0.1:1234/v1`: probe, discovery, a 20-token completion, a cancelled completion. Ollama live only if reachable at `:11434` (OPEN-7).
- [x] Run `npm run test:unit` green and `MIKEDOWN_AI_LIVE=1 npm run test:ai-live` on the Mac Studio with both servers up; paste the summary lines into the Progress Log.

[Return to Top](#ai-inference-engines-plan)

---

## M3 Settings UI

**Recommended model: Opus** (front-end UI design work)

> Workers must complete ALL items in this list. Apply genuine front-end design craft: this tab must sit flush with the existing Settings modal (same row rhythm, same controls), with the engine list reading like VS Code's Extensions list or Apple System Settings' network services (name, kind glyph, local/cloud pill, status dot, default star), not a generic admin table. Subtle transitions on probe results, inline validation, an inviting empty state. Never mutate `editor.view.dom`; this is modal UI, outside the editor.

- [x] New core tab `ai` (`tabLabel: 'AI'`, after `spelling`) built by `packages/core/src/ai-settings.ts` when `host.ai` exists; the tab shows only the master switch and feature toggles for tier-1 hosts.
- [x] Master switch row with a one-line explainer; `allowCloud` row with a warning line that it never applies without per-workspace consent.
- [x] Engines list: rows with name, kind, local/cloud pill, status dot (never probed, ok with latency, failed with tooltip), enabled toggle, default star, Edit, Delete (confirm; tells the host to drop the secret), Add engine with the preset picker.
- [x] Engine editor (inline expanding panel, not a second modal): name, kind, base URL (preset prefilled), locality (auto/local/cloud with the detected value shown), API key (write-only, "Stored" placeholder, Clear) plus `apiKeyEnv`, enabled, discovery mode, **Test connection** button with inline result, **Discover models** button.
- [x] Models table inside the editor: id, label, enabled, capability chips (chat, vision, json, tools, fim, embed) each clickable to toggle with `capabilitiesSource` flipping to `user`, context tokens (editable), loaded state when known, `missing` rows greyed, "Add model manually" row, per-model `requestOverrides` JSON (collapsed by default, validated).
- [x] Routing section: default engine+model pickers (only usable pairs listed, with a reason when a pair is excluded), fallback mode, and a task table: one row per task from the taxonomy with "Default" or an engine+model picker filtered by the task's required capabilities. Unknown tasks saved in settings are shown too, so a newer version's routes survive.
- [x] Features section: one row per registry entry (toggle, default task shown, optional task override), `planned` features greyed with "coming later".
- [x] Validation: a cloud engine with no key and no env var shows a warning; a task routed to a model lacking a required capability shows a warning and the row's fallback; duplicate names allowed, duplicate ids impossible.
- [x] Save flows through the normal `saveSettings` patch (`ai.*` keys) except secrets, which go through `host.ai.setSecret` immediately with a "Stored" confirmation.
- [x] Sidebar footer indicator chip (`outlineSidebar.ts` footer) with the states in the Indicator section; click opens the AI tab.
- [x] Keyboard and screen reader: every control labelled, probe results announced via a live region.
- [x] Styles in `packages/core/src/styles/ai.css`, added to the CSS list in `markdownEditorProvider.ts#getWebviewContent`, the core `styles.css` build and the Desktop/website bundles.

[Return to Top](#ai-inference-engines-plan)

---

## Settings redesign (after the first T4 pass)

Mike's first hands-on pass (T4, 2026-10-25) stopped at the AI tab: engines, models, capabilities, keys, routing and feature toggles all sit in one small modal tab (`packages/core/src/ai-settings.ts`, ~1500 LOC; `ai-settings-model.ts`; `ai/presets.ts`; `styles/ai.css`). Too much to read, too little room. Three milestones fix that before T4 resumes; T4 is blocked on all three.

**Direction (Mike, with LymeBooks as the reference):** the LymeBooks AI server drawer (`~/git/lymebooks/ng-app/src/app/lymebooks/settings/ai/servers/ai-server-form.component.html`, `ai-provider-presets.component.*`, `ai-server-form.model.ts`) gets the shape right: quick-start provider cards with one-line captions ("API key from console.anthropic.com"), a "two ways to connect" explainer (a cloud key, or your own server), a short main form, Models with **Fetch models** into a pick-or-type input, and everything else behind an **Advanced** toggle. No hardcoded model ids anywhere (they go stale; the endpoint is the source of truth). Workers read those four files before designing.

**Design calls (apply unless Mike overrides):**

1. **Express vs Advanced, per preset kind.** Presets gain `family: 'local' | 'cloud'` (local: oMLX, LM Studio, Ollama, llama.cpp, vLLM, Custom; cloud: Anthropic, OpenAI, OpenRouter, Groq, Gemini, Mistral, DeepSeek). Express shows only what differs per user:

   | | Cloud preset | Local preset |
   |---|---|---|
   | Express | Name (prefilled), **API key** (paste, caption with where to get it, "Stored" state), **Models** (auto-fetched, searchable pick list, pick-or-type), **Default model** (from the picked models), Enabled | Name, **Base URL** (prefilled, the one thing that changes per machine), API key only when the preset `needsKey` or is Custom ("leave blank if the server has no auth"; oMLX shows "found in ~/.omlx/settings.json" when the key file resolves), **Models** (auto-fetched, all enabled, searchable when more than 8), **Default model**, Enabled |
   | Advanced (collapsed, `aria-expanded`) | Base URL, Locality, Key from variable (`apiKeyEnv`), Key file (`apiKeyFile`), Discovery mode, the full models table from M3 (capability chips, context tokens, `requestOverrides`, missing rows, Add model manually) | Locality, Key from variable, Key file, Discovery mode, the full models table |

   "Default model" writes `routing.default` when this engine is the default engine (the star) and is otherwise the model pre-selected when the engine is picked in a routing row; no new settings key. Per-task routing and feature toggles are **not** in the engine form at all (see M3c).
2. **Add-engine flow.** The "Add engine" dropdown menu becomes a quick-start card grid in two groups, "Run on this machine" and "Cloud API key", each card with a kind glyph, name and caption; the same grid is the empty state. Picking a card opens the Express form for a new engine with focus on the first empty required field (key for cloud, URL for local). Cancel on a never-saved engine drops its key (`onDiscarded`, already shipped).
3. **Auto-fetch trigger.** Cloud: 600 ms after the key input settles (and the key is non-empty), `setSecret` then `discoverModels`; the key is stored first because discovery runs host side against the stored secret. Local: on Base URL blur or change, and when the Express form opens for an engine that was never probed. One discovery in flight per engine; a new trigger cancels the old one. **Fetch models** stays as a manual button with a spinner. Discovery never runs on a plain save.
4. **Failure states (inline, under Models, `role="status"`).** `unreachable` local: "Nothing answered at `<url>`. Is LM Studio running?" with Retry. `auth` cloud: "Key rejected by `<host>`", focus returns to the key field. Empty list: "Server is up but no models are loaded." `cloudBlocked` never applies to fetch (it is the user clicking). In every failure the pick-or-type input still accepts a typed id, which is saved as a manual model with heuristic capabilities.
5. **Where routing and feature toggles live.** Feature toggles stay on the AI tab (summary). Routing (default engine+model, fallback mode, task table) becomes its own section of the AI Engines page, reached from the page's left list and from "Change…" next to the default route on the summary tab. The engine form never shows routing.
6. **Accessibility and focus.** The page is `role="dialog" aria-modal="true" aria-labelledby`, traps Tab, closes on Escape, and restores focus to the control that opened it (gear, chip, status bar command lands on the first list item). The Advanced toggle is a button with `aria-expanded` and `aria-controls`; the models picker is a combobox (`role="combobox"`, `aria-expanded`, listbox with `aria-activedescendant`, Up/Down/Enter/Escape); fetch and test results are announced through the existing live region. All existing M3 keyboard rules carry over.
7. **No settings schema change.** Everything above uses existing keys (`enabled`, `routing.default`, `discovery`, `capabilitiesSource`). The one addition is `family` on presets, which is core data, not a setting. OPEN-12 is the only behavior change in how settings are written.
8. **Proof.** jsdom tests for every rule above (T3b), plus three screenshots because the look is the deliverable; hands-on verification moves into T4, which already opens the app.

### M3b Express engine form

**Recommended model: Opus** (front-end UI design work)

> Workers must complete ALL items in this list. If an item seems out of scope, note it in your summary for the orchestrator, but attempt it unless truly blocked. Read the four LymeBooks files named above and `ai-settings.ts` before designing. Design craft matters: the Express form should read like a macOS "Add Account" sheet (Mail, Internet Accounts), not a settings dump. Calm spacing, one column, short captions, the Advanced fold a quiet disclosure. Never mutate `editor.view.dom`; this is modal UI. Keep the full models table and every M3 capability intact under Advanced; nothing is removed, only folded.

- [ ] `packages/core/src/ai/presets.ts`: add `family: 'local' | 'cloud'` and `keyHint` (e.g. "API key from console.anthropic.com", "API key from openrouter.ai/keys", "Google AI Studio") per preset; no model ids. Export `AI_PRESET_FAMILIES` with the two group labels and the "two ways to connect" copy.
- [ ] `ai-settings-model.ts`: pure helpers `expressFields(preset)` (which fields are Express for a kind), `modelPickerOptions(engine, status, filter)` (filter, loaded-first on LM Studio, `missing` last), `applyDiscoveryForFamily` implementing OPEN-12 (local: enabled; cloud: disabled unless already enabled or picked), and `autoFetchDecision(prev, next)` (the debounce and "never probed" rules as pure data so tests need no timers).
- [ ] Add-engine: replace the dropdown menu with the quick-start card grid (two groups, glyph, name, caption, `aria-label="Add <name>"`); the empty state is the same grid under a one-line explainer. Picking opens the new engine's Express form with focus placed per design call 2.
- [ ] Express form per design call 1: Name, key (cloud, or local `needsKey`/Custom), Base URL (local), Models, Default model, Enabled. Key caption from `keyHint`; "Stored" state and Clear as today; the oMLX key-file caption when the host reports `hasKey` from the file.
- [ ] Models picker: combobox with a filter input (shown when more than 8 models), checkbox rows (enable/disable), count line ("312 models, 2 picked"), pick-or-type (a typed id not in the list is added as a manual model), loaded badge on LM Studio, `missing` rows greyed. Default model is a select over the enabled models.
- [ ] Auto-fetch per design call 3 with one in-flight discovery per engine, cancellation on a new trigger, spinner on the Models label, and the manual **Fetch models** button.
- [ ] Failure states per design call 4; Retry re-runs the same trigger.
- [ ] Advanced fold: a `button[aria-expanded][aria-controls]` revealing Base URL (cloud), Locality, Key from variable, Key file, Discovery mode and the existing full models table (capability chips, context tokens, `requestOverrides`, Add model manually). Remembered per engine while the modal is open; collapsed by default on open.
- [ ] OPEN-12 revised (Mike): `presets.ts` gains `popular` pattern rules per cloud preset (regexes or family prefixes matched against fetched ids, newest per family first; no literal model ids). `ai-settings-model.ts` gains `popularModels(preset, models)` and `autoPickDefault(preset, models)`. After the first successful cloud fetch with no model picked yet, the auto-picked model is enabled and set as Default model. The picker shows a **Popular** group above the searchable full list.
- [ ] Thinking level (Mike): per-model select Off/Low/Medium/High. Pure helpers `thinkingOverrides(kind, level)` and `thinkingLevelFrom(kind, overrides)` map it to each kind's request fields (OpenAI-compatible `reasoning_effort`; LM Studio on/off; oMLX tiers; Anthropic's native thinking/effort fields, checked against the current Anthropic API docs) and merge into `requestOverrides` without clobbering other keys. Express shows it next to Default model (applies to that model); Advanced's models table gets a column. Kinds with no known mapping hide the control. Adapters already merge `requestOverrides`, so no adapter change unless a mapping proves wrong.
- [ ] Remove routing and feature rows from the engine form if any crept in; the engine row list (name, pill, dot, enabled, star, Edit, Delete) stays as it is until M3c moves it.
- [ ] Styles in `styles/ai.css`: card grid, Express form rhythm, combobox, Advanced fold; both themes; no new CSS file.
- [ ] Update `packages/core/test/ai-settings.test.ts` where the Add-engine menu or field order changed (keep every existing assertion that still applies; T3b adds the new ones). `npm run lint`, `npm run test:unit`, `npm run test:packages` green.

[Return to Top](#ai-inference-engines-plan)

### M3c AI Engines page and summary tab

**Recommended model: Opus** (front-end UI design work and the overlay/focus architecture)

> Workers must complete ALL items in this list. If an item seems out of scope, note it in your summary for the orchestrator, but attempt it unless truly blocked. Follow OPEN-11 (overlay, mountable component) unless Mike has flipped it. The page should feel like VS Code's Settings editor or Apple System Settings' Network pane: a quiet list on the left, one engine's form on the right, routing as a list entry of its own, a header with Back and Done. Never mutate `editor.view.dom`. Depends on M3b (it hosts the Express form).

- [ ] `packages/core/src/ai-engines-page.ts`: `mountAiEnginesPage(container: HTMLElement, ctx: MikeDownSettingsSectionContext, opts: { initial?: { engineId?: string; section?: 'engines' | 'routing' }; onDone(patch): void; onCancel(): void }): { dispose(): void; focus(): void }`. Standalone: no reference to the modal, the editor or `document.body` beyond its container, so it can later mount in a VS Code editor tab or a Desktop window. Reuses the draft, validation, save-patch and secret flows from `ai-settings.ts` by extracting them into shared functions (no duplicated state logic).
- [ ] Layout: header (Back, title "AI Engines", Done); two panes: left list (engine rows with name, kind glyph, local/cloud pill, status dot, enabled; then a "Routing" entry; then "Add engine" opening the M3b card grid in the right pane), right pane the M3b Express form for the selected engine, or the routing section. Single column under 720 px: list first, selecting pushes the detail with Back returning to the list.
- [ ] Routing section: default engine+model, fallback mode and the task table from M3, moved here unchanged in behavior.
- [ ] Overlay host in `packages/core/src/editor.ts`: `showAiEnginesPage(opts)` renders the page full-window inside the editor root (above the modal when opened from it), `role="dialog" aria-modal="true"`, focus trap, Escape = Back, focus restored to the opener on close. Done applies the patch through the normal `saveSettings` path and closes; Back/Escape with unsaved changes asks "Discard changes?" and runs `onDiscarded` for never-saved engines' keys.
- [ ] AI tab becomes a summary: master switch, Allow cloud, default route line ("oMLX (Mac Studio) · Qwen 3.8 Flash Next", with "Change…" opening the page on routing), feature toggles (unchanged), compact engine list (name, pill, dot, enabled toggle only) and a **Manage engines…** button opening the page. Tier-1 hosts keep the switch and feature toggles only, no engine list and no button.
- [ ] Entry points: `openAiSettings` command (`mikedown.openAiSettings`, the VS Code status bar item, Desktop menu) opens the page directly; the sidebar chip keeps opening the AI tab, except `AI: no route`, which opens the page. `MikeDownCommand` `openAiSettings` gains an optional `{ page?: boolean }` arg; document the change in the protocol comment at the top of `packages/core/src/editor-main.ts`.
- [ ] Desktop and website: nothing host side; verify the overlay renders inside the Desktop window and the developers-hub demos (stub host) at `npm run dev:site`, and that the Playwright `ai.spec.ts` selectors still resolve (update them if the tab moved controls).
- [ ] Styles in `styles/ai.css`: page shell, panes, narrow layout, header; both themes; respects `--mikedown-font-*` tokens.
- [ ] `npm run lint`, `npm run test:unit`, `npm run test:packages`, Desktop typecheck and e2e green; existing `ai-settings.test.ts` updated for the moved controls, nothing deleted without a replacement in T3b.

[Return to Top](#ai-inference-engines-plan)

### T3b Settings redesign tests

**Recommended model: Sonnet** · **Mode: vitest jsdom unit tests (automated) plus screenshot review of three images (the look is the deliverable). No hands-on here; behavioral checks are folded into T4.**

> Workers must complete ALL items, including running the suite green. A worker who cannot legitimately reach a screenshot state skips that file and reports it; a manufactured screenshot poisons the sign-off.

- [ ] `packages/core/test/ai-express-form.test.ts`: Express field set per preset family (cloud shows key and no URL; local shows URL and key only for `needsKey`/Custom); Advanced collapsed by default with `aria-expanded="false"` and reveals the full models table; auto-fetch fires once per settled key input (fake timers), not on every keystroke, and stores the key through `setSecret` before `discoverModels`; a second paste cancels the first discovery; local auto-fetch on URL blur and on first open of a never-probed engine; no discovery on a plain save; each failure state's copy and the Retry path; typed model id becomes a manual model; OPEN-12 enabled-state rule for cloud vs local; Popular group from pattern rules and auto-picked default after the first cloud fetch; thinking level maps per kind into `requestOverrides`, round-trips through `thinkingLevelFrom`, and keeps unrelated override keys; Default model select limited to enabled models and writing `routing.default` only for the default engine; combobox keyboard navigation and filter; quick-start cards grouped and labelled; `onDiscarded` still drops a never-saved engine's key.
- [ ] `packages/core/test/ai-engines-page.test.ts`: `mountAiEnginesPage` renders into an arbitrary container with no document-level side effects and `dispose` leaves it clean; dialog semantics, focus trap and focus restore; Escape = Back; dirty Back asks, clean Back closes; Done emits only the changed `ai.*` keys; routing section round-trips; narrow layout class under 720 px and the push/Back navigation; summary tab shows the default route and status dots, "Manage engines…" opens the page, "Change…" lands on routing; `openAiSettings` opens the page and the chip opens the tab (page when no route); tier-1 host sees no engine list or button.
- [ ] Update `packages/core/test/ai-settings.test.ts` and `packages/desktop` Playwright `ai.spec.ts` for moved controls; keep the M3 assertions that still hold.
- [ ] Run `npm run lint`, `npm run test:unit`, `npm run test:packages`, Desktop e2e (`packages/desktop`, `npm run test:e2e`) green; record counts in the Progress Log.
- [ ] Screenshots, from the developers hub stub host (`npm run dev:site` in `/Users/michaeljosephwork/git/mikedown-ai-engines`, open `http://localhost:5180/mikedown/developers/`, any demo, gear, AI tab; no server needed), light theme, written to `.orchestrator/ai-settings-redesign/screenshots/`: `ai-summary-tab.png` (the AI tab with two stub engines and a default route), `ai-engines-page-cloud-express.png` (the page with a cloud engine selected, models fetched, Advanced collapsed), `ai-engines-page-narrow.png` (the same page at 640 px wide, detail pane pushed). The orchestrator lists the three absolute paths when handing off to Mike.

[Return to Top](#ai-inference-engines-plan)

---

## M4 Desktop

**Recommended model: Sonnet**

> Workers must complete ALL items in this list. Follow the shape of `src/commands/fs.rs` and the updater commands; keys never reach the webview.

- [x] `Cargo.toml`: `reqwest` (features `json`, `stream`, `rustls-tls`), `futures-util`, `keyring`, `tokio` features as needed.
- [x] `src-tauri/src/commands/ai.rs`: `ai_complete(request) -> request_id` streaming `ai-token:<id>`, `ai-done:<id>`, `ai-error:<id>` events to the calling window; `ai_cancel(id)`; `ai_list_engines`; `ai_test_engine(id)`; `ai_discover_models(id)`; `ai_set_secret(id, key)`; `ai_request_cloud_consent(id)` using the dialog plugin; registered in `lib.rs`.
- [x] `src-tauri/src/commands/ai/providers/{openai_compatible,lmstudio,ollama,anthropic,openai}.rs` behind a `ProviderAdapter` trait mirroring the TS interface; SSE parsing and request building ported from core's pure modules.
- [x] Secrets via `keyring` (service `net.iadev.mikedown`, account engine id); `apiKeyEnv` fallback with a note that Dock launches have a sparse environment.
- [x] Consent store per folder in the existing folder settings file (`ai.consent.<engineId>`), app-wide `allowCloud`.
- [x] `packages/desktop/src/settings/schema.ts`: `ai.*` keys in `DESKTOP_KEY_DEFAULTS`; `engines` app-wide only (OPEN-4).
- [x] `packages/desktop/src/host/tauriHost.ts`: implement `MikeDownAiHost` (tier 2) with `invoke` plus event listeners keyed by request id, unlisten on done/error/cancel.
- [x] Capabilities file: no new permissions needed for app commands; document in `default.json`'s description that AI network calls go through `commands/ai.rs` only.
- [x] Multi-window: in-flight requests are per window; closing a window cancels its requests.

[Return to Top](#ai-inference-engines-plan)

---

## T3 Desktop tests

**Recommended model: Sonnet** · **Mode: cargo unit tests against the shared fixtures (automated) plus the existing Desktop smoke harness (automated)**

> Workers must complete ALL items, including running green.

- [x] Cargo tests in `commands/ai/`: SSE reassembly and request bodies against `test/ai-fixtures/` (same files as T1, read by relative path), discovery parsing per kind, error mapping, `requestOverrides` merge.
- [x] Cargo test for the keyring wrapper using the `keyring` mock credential store (no real keychain in CI).
- [x] Mock HTTP server test (`wiremock` or `httpmock`) for `ai_complete` streaming and `ai_cancel` mid-stream.
- [ ] Smoke (`packages/desktop/src/smoke`): host `ai` group round-trips `listEngines` and a completion against the mock server; Settings modal AI tab renders with an engine.
- [ ] Run `cargo test` in `packages/desktop/src-tauri` and the Desktop smoke script green; record in the Progress Log.

[Return to Top](#ai-inference-engines-plan)

---

## M5 Proof feature: selection rewrite

**Recommended model: Opus** (front-end UI plus ProseMirror transaction discipline)

> Workers must complete ALL items in this list. The popover should feel like a native editor affordance (Notion's AI block, Apple Notes' Writing Tools), streaming text with a calm cursor, old and new side by side only when the selection is more than one line. Constraints 4, 5 and 7 from the brainstorm apply: decorations only, one transaction on accept, cancellation on every new request.

- [x] Feature registry entry `rewrite` (default enabled, task `rewrite`, requires chat + stream).
- [x] Entry points: selection bubble item "Rewrite" with a submenu (Shorter, Longer, Fix flow, Custom prompt), the same in `contextmenu.ts`, a `mikedown.ai.rewrite` command and `Mod-Alt-K` hotkey (was `Mod-Shift-K`, which is Inline Code) (customizable through the existing hotkeys tab). Hidden when the route is unusable; disabled with a reason tooltip when AI is on but no route works.
- [x] Prompt builder in `packages/core/src/ai/prompts/rewrite.ts`: system prompt that preserves markdown structure, links, code and inline formatting; context is the selection plus the enclosing paragraph before and after (constraint 8); custom prompt gets the same guardrails.
- [x] `packages/core/src/ai-rewrite.ts`: popover anchored to the selection, streaming preview, header badge with served engine (local/cloud, fallback), Accept (one `tr.replaceWith` from the markdown-parsed result), Retry, Copy, Esc or click-away cancels and aborts; selection highlighted with a decoration while the popover is open.
- [x] Source mode: the same commands operate on the CodeMirror selection and replace through one CM transaction; no popover redesign, same component rendered next to the CM selection.
- [x] Error states from `AiErrorCode` with one-click "Open AI settings"; `contextOverflow` suggests a shorter selection.
- [x] Indicator chip and VS Code status bar update from the served result.
- [x] Telemetry: none. Logging only through the host output channel line from M2.

[Return to Top](#ai-inference-engines-plan)

---

## M6 npm consumers

**Recommended model: Sonnet**

> Workers must complete ALL items in this list.

- [x] `bindMikeDownValue` and the React, Vue, Angular and web component wrappers pass `host.ai` through untouched; the web component accepts an `ai` property (not attribute).
- [x] `packages/core/README.md` and `website/developers/`: a "Bring your own AI" section with a tier-1 example (`complete` proxied to a backend) and a tier-2 example (an in-browser registry calling Ollama in dev), the consent note, and the statement that core ships no provider SDK.
- [x] Website demo: a stub `ai` host that streams canned text so the rewrite popover and the AI tab are visible on the developers hub without a server; clearly labelled as a stub.
- [x] `test/packages/package-shape.test.ts`: `@mikedown/core/ai` export present, types resolve, no network dependency added to core's `dependencies`.
- [x] `npm run test:packages` and `npm run test:wrappers` green.

[Return to Top](#ai-inference-engines-plan)

---

## T4 Hands-on

**Recommended model: Sonnet** · **Mode: hands-on (interactive workflows: streaming, cancel, consent, fallback) plus the full automated suites one more time. No screenshot review.**

> The orchestrator pauses for Mike's sign-off at the end of this milestone. Every item says where to look.

**Blocked on M3b, M3c and T3b.** The first pass (2026-10-25) stopped at the AI tab; the items below assume the redesigned summary tab and AI Engines page. Engine setup now goes through "Manage engines…" (or the status bar item), the quick-start cards and the Express form.

Automated first:

- [ ] `npm run lint`, `npm run test:unit`, `npm run test:edge`, `npm run test:packages`, `cargo test` in `packages/desktop/src-tauri`, all green.

Hands-on, VS Code (`npm run dev` in `/Users/michaeljosephwork/git/mikedown`, opens the dev host on `test/workspace`; open `test/workspace/sample.md` with MikeDown, toolbar gear, AI tab):

- [ ] Fresh state: AI tab shows the master switch off, no engines, "Manage engines…" opens the page on the quick-start cards (two groups, captions). Turn on. Sidebar footer shows `AI: no route`; clicking it opens the page.
- [ ] Pick the oMLX card: Express form shows Name, Base URL, key with the "found in ~/.omlx/settings.json" caption (no key typed); models fetch on their own as the form opens (spinner on Models, then the loaded MLX models, all enabled); pick Qwen 3.8 Flash Next as Default model and star the engine. Open Advanced: capability chips, context tokens and overrides are all still there.
- [ ] Pick the LM Studio card; models fetch on URL blur; Gemma 4 26B-A4B shows the vision chip under Advanced (from `/api/v0/models`). Routing entry in the left list: route `vision` to it and `structure` to MiniMax M3 on oMLX. Resize the window below 720 px: single column, Back returns to the list.
- [ ] Pick the Anthropic card: paste a real key, wait, the models list fills without clicking anything, search "sonnet", tick one; after Done the key field shows "Stored"; `grep -r sk-ant ~/Library/Application\ Support/Code/User/settings.json` finds nothing. Route `notes` to it. Leave `allowCloud` off; the summary tab's engine row shows "blocked by Allow cloud".
- [ ] Paste a wrong key into a new OpenAI engine: "Key rejected" under Models, focus back in the key field, a typed model id is still accepted; Cancel drops the engine and its key.
- [ ] Escape from the page with unsaved changes asks first; Done returns to the summary tab with the default route line filled in. Judge the look while here (spacing, Advanced fold, list rhythm); findings go into the Progress Log.
- [ ] Select two sentences in `sample.md`, bubble menu, Rewrite, Shorter: tokens stream, header badge says `local · oMLX (Mac Studio) · Qwen 3.8 Flash Next`; Accept replaces in place; one `Cmd+Z` restores the original.
- [ ] Retry while a stream is running cancels the first (output channel "MikeDown AI" shows `cancelled` then a new line).
- [ ] Stop the oMLX server, rewrite again: with `fallback: anyLocal` the badge shows LM Studio and "(fallback)"; with `fallback: none` the menu item is disabled with a reason tooltip.
- [ ] Turn on `allowCloud`, route `rewrite` temporarily to Anthropic, rewrite: the consent modal names the engine and URL; "Not now" cancels with `consentDenied`; a second attempt with "Allow for this workspace" streams from Claude and the badge says `cloud · Anthropic`. Reload the window: no second prompt.
- [ ] Source mode (`Cmd+/`): rewrite on a CodeMirror selection replaces in one undo step.
- [ ] Delete the Anthropic engine; confirm; the secret is gone (re-adding with the same name shows no "Stored").

Hands-on, Desktop (`npm run tauri dev` in `packages/desktop`, open the same folder):

- [ ] Same engines configured in the Desktop AI tab (app-wide); Test connection and Discover work; the key lands in Keychain Access under `net.iadev.mikedown`.
- [ ] Rewrite streams in a Desktop window; closing the window mid-stream leaves no stuck request (Activity Monitor network idle, next window works).
- [ ] Consent on Desktop is per folder: a second opened folder asks again.

- [ ] Orchestrator pauses for Mike's sign-off; findings go into the Progress Log and either get fixed here or listed under Follow-up plans.

[Return to Top](#ai-inference-engines-plan)

---

## M7 Release prep

**Recommended model: Haiku**

> Workers must complete ALL items in this list. Do not publish or push; Mike runs the release commands.

- [ ] `CHANGELOG.md`: npm family entry (core `ai` host group, `@mikedown/core/ai`, AI tab) and extension entry (AI engines, rewrite; off by default). Note Ollama fixture-only status if OPEN-7 stands.
- [ ] `README.md` (extension) and `website/vscode/`: short "AI (optional, off by default)" section naming supported engine kinds, local-first and the consent gate.
- [ ] `CLAUDE.md`: architecture lines for `packages/core/src/ai/`, `src/ai/`, `commands/ai.rs`; extend the Settings rule note with "secrets never in settings; use `setSecret`".
- [ ] Follow the release order in CLAUDE.md: `npm run version:npm -- X.Y.Z` (minor bump, new host surface), `npm run test:packages`, `npm run release:npm` dry run; then the Desktop pin bump and `npm run vsix:minor`. Stop before `--publish`, upload and tag; report the commands for Mike to run.

[Return to Top](#ai-inference-engines-plan)

---

## Follow-up plans

Each is its own planning document; all run on the layer this plan builds and each is one registry entry plus a surface.

1. Rewrite family: remaining variants (simpler, formal, casual), explain/expand (12), reading level (19), translation (20).
2. Inline ghost text (1): separate opt-in, decoration widget, `continue` task, FIM models; CM6 twin later.
3. Chat with this document (5) and prompt blocks (18): sidebar chat surface, `chat` task.
4. Document understanding bundle: `/summary` (4), frontmatter and tag suggestions (7), `/title` (14), meeting notes to action items (13), paste cleanup (16), Mermaid/table/code generation (9): `structure`, `summarize`, `notes` tasks.
5. Alt text for pasted images (8): first `vision` consumer; wires `imagePaste.altText: 'ai'`.
6. Review passes: grammar (3) and consistency (15) after local JSON reliability is measured on the catalog.
7. Workspace RAG (6) and link suggestions (10): `embed` task, vector index, its own storage plan.
8. Dictation (11): `transcribe` host method, LymeScribe Server adapter, audio capture.
9. What changed summary (17): git in the VS Code host.
10. `@mikedown/ai-providers` package if OPEN-1 flips.
11. On-demand thinking dial: change the thinking level per request (rewrite popover, future chat) on top of the per-model default from M3b.

[Return to Top](#ai-inference-engines-plan)

---

## Parallel Development Recommendations

- **Sequential blocker:** M1 (contracts) must land before anything else; T1 right after it.
- **Group A (after T1):** M2 VS Code host, M4 Desktop, M3 Settings UI can run in parallel. M3 only needs the host interface; it can develop against a stub `ai` host in the website demo folder. M2 and M4 touch disjoint trees (`src/` vs `packages/desktop/`). M2 and M4 both port the same pure modules; they share `test/ai-fixtures/`, which M1 owns, so neither edits fixtures without telling the other.
- **Group B (after Group A):** T2 and T3 in parallel; M5 can start once M2 and M3 are in (it needs a real streaming host and the indicator), M6 once M1 and M3 are in.
- **Settings redesign (added 2026-10-25):** M3b first (one worker, Opus; owns `packages/core/src/ai-settings.ts`, `ai-settings-model.ts`, `ai/presets.ts`, `styles/ai.css`). M3c after M3b lands (it hosts the Express form; owns `ai-engines-page.ts`, `editor.ts` overlay host, `types.ts` command arg, the Desktop e2e spec). T3b after M3c. Not parallel: all three touch `ai-settings.ts` and `ai.css`.
- **Then:** T4 (blocked on T3b), M7.

Workers in Group A list each other's directories in their prompts to avoid conflicts: M2 owns `src/`, `package.json#contributes.configuration`, `test/unit/ai-*`; M3 owns `packages/core/src/ai-settings.ts`, `outlineSidebar.ts` footer, `packages/core/src/styles/ai.css`; M4 owns `packages/desktop/`.

Gap-filling prompts (when a milestone comes back incomplete) follow the original prompt structure, state what was already done and which files changed, list other active workers and their directories, commit code before the summary, write the summary to `.orchestrator/worker-summary-<milestone-slug>-gap.md`, prompt the user to clear the context afterwards, and are labelled "Worker Context: <Milestone> - Gap Fill".

Orchestrator context: with three parallel workers in Group A the orchestrator should suggest `/compact` while waiting, then resume from `.orchestrator/state.json`.

[Return to Top](#ai-inference-engines-plan)

---

## Progress Log / Notes

**2026-10-25 00:00** - Plan written. Inputs: `ai-copilot-brainstorm.md`, LymeScribe `docs/ai-features-plan.md`, `home-lab/local-ai` catalog (oMLX `:8000` MLX-only with key, LM Studio `:1234` GGUF plus MLX with no auth and loopback-only as of 2026-10-04, Gemma 4 26B-A4B as the vision pick, MiniMax M3 on oMLX, DeepSeek V4 Flash and Qwen 3.8 Flash Next as default brains). Open decisions listed with recommendations; no code written.

**2026-10-25 15:36** - M1 done (`acf4b60`, 17 min). All 12 items plus extras `discovery.ts`, `wire.ts`, `presets.ts`. `localNetworks` is a sixth top-level key; router returns `needsConsent` for an un-asked cloud engine; Anthropic requests omit `temperature`. Verified on branch: `npm run test:unit` 1610 passed. Work is on branch `ai-engines` (worktree `../mikedown-ai-engines`).

**2026-10-25 15:45** - T1 done (`ea462de`, 8 min). Six new test files, 213 tests, no source bugs found. Commands: `npm run test:unit` 1823 passed (verified on branch), `npm run test:packages` 75 passed. Group A (M2, M3, M4) dispatched in parallel, each in its own worktree off the branch.

**2026-10-25 16:05** - M2 done (`ce8db45`, 16 min), fast-forwarded into `ai-engines`; main-tree check: `npm run compile` ok, `npm run test:unit` 1867 passed. `engines`/`localNetworks` are `scope: machine`; a workspace can turn `allowCloud` off but not on. Contract additions: non-image wire messages carry a `requestId`; `VsCodeHost.onAiEngines` push listener (non-contract, decide before M5); "Not now" consent is not stored. M5 should re-resolve and retry once after an `unreachable` before the first token so fallback works on the first attempt. Discovery writes merged models to settings itself (relayed to M3).

**2026-10-25 16:15** - M4 done (`f000f82`, 18 min), cherry-picked onto `ai-engines` as `900766b`. Verified on branch: `npm run test:unit` 1892 passed, Desktop typecheck clean and unit 559 passed, `cargo test` 166 + 26 + 7 passed. `ai.localNetworks` also app-wide (with engines and `allowCloud`) so a folder file cannot relabel a public host as local. Host lives in `src/host/aiHost.ts`, exposed as `TauriHost.ai`. No `embed`/`transcribe` on Desktop yet. **M7 blocker:** Desktop dist-mode `vite build` fails until core with `./ai` is published and the Desktop core pin is bumped.

**2026-10-25 16:20** - M3 done (`0612550`, 22 min), cherry-picked onto `ai-engines` as `bb803db`. Verified on branch: build:core, compile, both `tsc --noEmit`, lint 0 errors, `npm run test:unit` 1911 passed, `npm run test:packages` 75, Desktop typecheck and 559 unit. New handle API `setAiServed` and `setAiEngineStatuses`; `openAiSettings` is a `MikeDownCommand`. Chip hidden while AI is off with no engines (ships dark). Push decision: no contract change; core re-calls `listEngines` on every `settings.ai` change and hosts may push via `handle.setAiEngineStatuses` (M5 wires `VsCodeHost.onAiEngines` to it). Group B dispatched: T3, M5, M6 (T2 already running).

**2026-10-25 16:30** - T2 done (`294e283`, ~25 min), cherry-picked as `f2d9b83`; M3 follow-up `7556187` (Cancel drops keys of never-saved engines via a new optional section hook `onDiscarded`; core subscribes to `host.onAiEngines` when present) cherry-picked as `8b8f210`. Verified on branch: `npm run test:unit` 1988 passed, `npm run test:packages` 75, lint 0 errors, `npm run test:ai-live` 13 skipped without the env var, `MIKEDOWN_AI_LIVE=1 npm run test:ai-live` 7 passed / 6 skipped (oMLX probe, auth, discovery, 20-token completion, cancel pass; LM Studio probe and discovery pass, completion and cancel skipped because no chat model was loaded; Ollama skipped, not running, OPEN-7 stands). No source bugs found.

**2026-10-25 16:40** - M6 done (`1ccdb23`, 14 min), cherry-picked as `4f82fa7`. Fixed a real React bug (`stableHost` dropped non-function host entries, so `host.ai` never reached core). Web component `ai` property, Angular `[ai]` input, "Bring your own AI" docs in core README and on the hub (`#byo-ai`), tier-2 stub host in every demo. Verified on branch: `npm run test:unit` 1989, `npm run test:packages` 79, `npm run test:wrappers` (web component 49, React 24, Vue 12, Angular 26), `npm run build:site` ok. Demo note mentions Rewrite, which appears once M5 merges.

**2026-10-25 16:45** - T3 partial (`6a6479c`, ~20 min), cherry-picked as `ba71468`. New `command_layer.rs` drives every `ai_*` command on Tauri's mock runtime against the loopback server (streaming, cancel mid-stream, window isolation, route and cloud gates); keychain wrapper tested on a mock `keyring` credential builder; Playwright `ai.spec.ts` (AI tab with engine and empty, `listEngines`, streamed completion, abort). Verified on branch: `cargo test` 176 + 26 + 7, Desktop e2e 55 passed, Desktop unit 559. **Not run:** the real-webview smoke (`src/smoke/harness.ts` AI group typechecks but never executed) because the installed `/Applications/MikeDown.app` was running and the single-instance plugin swallowed the dev launch. Moved to T4: quit MikeDown, run the README smoke command, then `npm run smoke:compare`. No bugs found.

**2026-10-25 17:00** - M5 done (`ea80385`, 28 min), cherry-picked as `8d21d58`; orchestrator dropped M5's duplicate `onAiEngines` subscription in `src/webview/editor-main.ts` (core already subscribes since `8b8f210`). Hotkey is `Mod-Alt-K` (Mod-Shift-K is Inline Code); Desktop binds it host side in `menu/shortcuts.ts`. Consent "Not now" applies to that request only; retry once on `unreachable` before the first token overlays the engine as failed so fallback works on the first attempt. Prompt builder not yet exported from `@mikedown/core/ai`. Verified on branch: lint 0 errors, `npm run test:unit` 2021, `npm run test:edge` 22, `npm run test:packages` 79, `npm run test:wrappers` ok, `npm run build:site` ok, Desktop typecheck, unit 559, e2e 55. All build milestones merged; T4 next (needs Mike).

**2026-10-25 17:10** - Added M4b at Mike's request: generic `apiKeyFile { path, jsonPath }` engine field, set by the oMLX preset to `~/.omlx/settings.json` / `auth.api_key`; lookup order secret, env, file in both VS Code and Desktop, home-directory-only, 64 KB cap. Reason: Dock/Spotlight launches don't see `OMLX_API_KEY`. Dispatched on Sonnet in worktree `../mikedown-ai-keyfile`; T4 waits for it.

**2026-10-25 18:40** - Mike resolved OPEN-11 (overlay, mountable) and OPEN-12, revised: pasting a cloud key auto-picks a default model, the picker leads with a pattern-matched Popular group (no hardcoded ids), and each model gets a Thinking level mapped per kind into `requestOverrides`; an on-demand dial goes to follow-up plans. M3b and T3b items added for both. M3b dispatched (Opus) in `mikedown-ai-express`.

**2026-10-25 18:10** - Settings redesign added after Mike's first T4 pass found the AI tab too complex and too cramped. New milestones M3b (Express engine form, quick-start cards, auto-fetched models, Advanced fold), M3c (full-window AI Engines page as a mountable overlay, AI tab reduced to a summary) and T3b (jsdom tests plus three screenshots); T4 marked blocked and its setup items rewritten for the new flow. Open decisions OPEN-11 (overlay vs real VS Code tab/Desktop window; recommended overlay), OPEN-12 (cloud discovery adds models disabled until picked), OPEN-13 (worktree `mikedown-ai-express` is clean at `23e53e2`, nothing to keep). No schema change. No code written.

**2026-10-25 17:25** - M4b done (`b29d7f5`, ~15 min), cherry-picked as `85bffcb`. `apiKeyFile` in core types/schema/presets, VS Code `src/ai/secrets.ts`, Desktop `secrets.rs`, "Key file" row in the AI tab. Verified on branch: lint 0 errors, `npm run test:unit` 2036, `npm run test:packages` 79, Desktop unit 559, `cargo test` 185 + 26 + 7, `env -u OMLX_API_KEY MIKEDOWN_AI_LIVE=1 npm run test:ai-live` key-file test passes against the real oMLX. T4 hands-on started by Mike.

[Return to Top](#ai-inference-engines-plan)
