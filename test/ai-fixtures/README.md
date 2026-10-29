# AI fixtures

Plain JSON shared by the TypeScript tests (`packages/core/test/ai-*.test.ts`, `test/unit/ai-*.test.ts`) and the Desktop Rust tests (`packages/desktop/src-tauri`, read by relative path). Keep them plain JSON: no comments, no generated code. Change a fixture only together with both test suites.

## `sse/`

One completion stream per file:

```json
{
  "description": "...",
  "kind": "openai-compatible | anthropic",
  "chunks": ["raw text exactly as received, split at arbitrary points", "..."],
  "expected": {
    "deltas": ["text deltas in order, as push() returns them"],
    "text": "the full text",
    "finishReason": "stop | length | error",
    "stopReason": "the provider's own value, when it sent one",
    "usage": { "promptTokens": 0, "completionTokens": 0 },
    "error": { "code": "AiErrorCode", "message": "..." }
  }
}
```

Feed `chunks` in order to `createCompletionStreamReader(kind)` (`push` each, then `finish`). `deltas` are the concatenated `push` results; the other `expected` keys are the `finish()` outcome (absent keys are absent there too). Chunks are deliberately split mid-line, inside JSON strings, inside an `event:` line and between the lines of one event; one OpenAI event uses CRLF.

| File | Shape |
| --- | --- |
| `openai-chat-stream.json` | Chat Completions deltas, keep-alive comment, usage chunk, `[DONE]` |
| `openai-reasoning-length-stream.json` | oMLX `reasoning_content` deltas (ignored), `finish_reason: "length"` |
| `openai-truncated-stream.json` | No `finish_reason`, no `[DONE]`, last event cut mid-JSON: `finishReason: "error"` |
| `anthropic-messages-stream.json` | `message_start`, `ping`, empty thinking block, three `text_delta`, `message_delta` (`end_turn`, usage), `message_stop` |
| `anthropic-error-stream.json` | One delta, then an `error` event (`overloaded_error` maps to `rateLimited`) |

## `discovery/`

One endpoint response per file: `request` (method and URL, informational), `response` (the parsed JSON body) and `expected` (the `AiDiscoveredModel[]` the parser returns: `{ id, label?, capabilities (partial), source, loaded? }`).

| File | Parser | Extra keys |
| --- | --- | --- |
| `lmstudio-api-v0-models.json` | `parseLmStudioModels` | includes one entry with no id (skipped) |
| `ollama-api-tags.json` | `parseOllamaTags` | `expectedNames` instead of `expected` |
| `ollama-api-show.json` | `parseOllamaShow(name, body)` per name | `responses` keyed by model name instead of `response` |
| `openai-v1-models-bare.json` | `parseOpenAiModelList` | `expectedHeuristics`: `detectCapabilities(id)` per id (full capabilities) |
| `anthropic-v1-models.json` | `parseAnthropicModels` | `expectedNextPage`: `anthropicNextPage(response)` |

## `routing/scenarios.json`

`{ "description", "scenarios": [...] }`, each scenario:

```json
{
  "name": "...",
  "settings": { "raw mikedown.ai object, run through parseAiSettings" },
  "statuses": [{ "AiEngineStatus from the last listEngines" }],
  "consent": { "engineId": true },
  "request": { "feature": "rewrite", "task": "optional task override" },
  "expected": { "a subset of the resolveRoute result" }
}
```

A usable result is matched on `engineId`, `modelId`, `viaFallback`, `isLocal`, `needsConsent` (and `task` in some); an unusable one on `unusable` (the `AiUnusableCode`). Every scenario uses the plan's example registry (oMLX default, Gemma on LM Studio for `vision`, MiniMax for `structure`, Claude for `notes`) with one or two changes.

## `outputs/`

One model reply per file, for `parseLenientJson`: `{ "description", "raw", "expected": { "ok", "value" } }`. `raw` is the reply exactly as a local model might send it (clean JSON, in a fence, after prose, behind a `<think>` block, trailing comma, single quotes, unquoted key, plain text, cut off). `expected.value` is the parsed object; `ok: false` files have no `value`.

## `requests/thinking-overrides.json`

`{ "description", "cases": [...] }`, each case one per-request thinking level (the rewrite popover's dial):

```json
{
  "name": "...",
  "kind": "AiEngineKind",
  "local": true,
  "level": "off | low | medium | high",
  "modelOverrides": { "the model's saved requestOverrides, or null" },
  "requestOverrides": { "what thinkingRequestOverrides(kind, modelOverrides, level, { local }) returns" },
  "expectedBody": { "top-level keys of the built body, each compared whole" }
}
```

Core checks `requestOverrides` (`packages/core/test/ai-thinking-dial.test.ts`); both hosts build the body for model `m` with the model's and the request's overrides and compare each `expectedBody` key (`test/unit/ai-protocol.test.ts`, `packages/desktop/src-tauri/src/commands/ai/tests.rs`).

## `consent/`

`consent-text.json`: the cloud consent dialog's words, from core's `privacy.ts`. `privacy`, `sendsText`, `sendsFallback`, `features` (feature id → what it sends) and `policies` (cloud preset host → policy label, URL, optional note) mirror the core tables; `cases` are `aiConsentText` inputs (`engineName`, `host`, `feature?`, `sends?`, `scopeWord`, `offerNever?`) with the `expected` `{ title, body, allow, notNow, never? }`, the policy looked up from `host`. Checked by `packages/core/test/ai-privacy.test.ts` and the Rust port (`commands/ai/consent.rs`). When the copy changes in core, regenerate the expected text from `aiConsentText` and update the Rust tables to match.

## `requests/openai-reasoning.json`

`{ "description", "request", "cases": [...] }`: one `AiCompletionRequest` (`maxTokens` 500, `temperature` 0.3) built per case as `buildCompletionBody(kind, { id: modelId, requestOverrides: modelOverrides }, request)`. Each case has `expected` (top-level keys, each compared whole) and `absent` (keys that must not be there). OpenAI reasoning models (o-series, GPT-5 onwards on the `openai` kind, `openai/`-prefixed ids elsewhere) get no `temperature`; everything else keeps it. Checked by `packages/core/test/ai-unsupported-params.test.ts` and `commands/ai/tests.rs`.

## `requests/unsupported-params.json`

The one-retry net for a 400 that names a parameter the model does not take. `errors`: `{ name, status, body (raw response text), param }`, where `param` is what `unsupportedRequestParam(status, body)` returns (null: not retried). `adjust`: `{ name, param, body, expected }`, where `expected` is `withoutRequestParam(body, param)` (null: nothing to retry). Checked by the same two suites; both hosts' retry loops are tested against the first two `errors` bodies (`test/unit/ai-providers.test.ts`, `commands/ai/tests.rs`).
