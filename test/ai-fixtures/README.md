# AI fixtures

Plain JSON shared by the TypeScript tests (`packages/core/test/ai-*.test.ts`, `test/unit/ai-*.test.ts`) and the Desktop Rust tests (`packages/desktop/src-tauri`, read by relative path). Keep them plain JSON: no comments, no generated code. Change a fixture only together with both test suites.

## `sse/`

One completion stream per file:

```json
{
  "description": "...",
  "kind": "openai-compatible | lmstudio | ollama | anthropic",
  "outputChars": 0,
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

Feed `chunks` in order to `createCompletionStreamReader(kind)` (`push` each, then `finish`). `deltas` are the concatenated `push` results; the other `expected` keys are the `finish()` outcome (absent keys are absent there too). `outputChars` (optional, top level) is `reader.outputChars()` after the stream: answer plus reasoning in UTF-16 units, the basis of the host's first-token time and token estimate. Chunks are deliberately split mid-line, inside JSON strings, inside an `event:` line and between the lines of one event; one OpenAI event uses CRLF.

| File | Shape |
| --- | --- |
| `openai-chat-stream.json` | Chat Completions deltas, keep-alive comment, usage chunk, `[DONE]` |
| `openai-reasoning-length-stream.json` | oMLX `reasoning_content` deltas (ignored), `finish_reason: "length"` |
| `openai-truncated-stream.json` | No `finish_reason`, no `[DONE]`, last event cut mid-JSON: `finishReason: "error"` |
| `openai-usage-stream.json` | LM Studio with `stream_options.include_usage`: `reasoning_content`, an emoji, then usage in its own chunk with empty `choices` |
| `openai-no-usage-stream.json` | Ollama `/v1` without usage: a `reasoning` delta, two content deltas; the host estimates tokens |
| `anthropic-messages-stream.json` | `message_start`, `ping`, empty thinking block, three `text_delta`, `message_delta` (`end_turn`, usage), `message_stop` |
| `anthropic-error-stream.json` | One delta, then an `error` event (`overloaded_error` maps to `rateLimited`) |

## `stats/result-stats.json`

`{ "description", "cases": [...] }`, each case one completion result (`text`, `usage?`, `timing?`) with the popover footer (`aiResultStatsText`, null without timing), its tooltip (`aiResultStatsTitle`) and the request log's additions (`aiTimingLogParts`; Desktop's `timing_log_parts`). Checked by `packages/core/test/ai-result-stats.test.ts` (all three) and `commands/ai/request_log.rs` (`log`).

## `requests/stream-usage.json`

`{ "description", "cases": [{ kind, baseUrl, expected }] }`: whether a streamed completion asks for usage (`streamUsageSupported`, `withStreamUsage`; Desktop's `stream_usage_supported`, `with_stream_usage`). Checked by `packages/core/test/ai-result-stats.test.ts` and `commands/ai/tests.rs`.

## `discovery/`

One endpoint response per file: `request` (method and URL, informational), `response` (the parsed JSON body) and `expected` (the `AiDiscoveredModel[]` the parser returns: `{ id, label?, capabilities (partial), source, loaded?, sizeBytes?, moe? }`; `moe` only ever `true`, from an architecture name with `moe` in it).

| File | Parser | Extra keys |
| --- | --- | --- |
| `lmstudio-api-v0-models.json` | `parseLmStudioModels` | includes one entry with no id (skipped) |
| `lmstudio-api-v0-models-loaded-later.json` | `parseLmStudioModels` | the loaded model is not first; `expectedDefault` / `expectedPicked`: what a new local engine picks and ticks (`applyDiscoveryForFamily`, TypeScript only) |
| `lmstudio-api-v1-models-sizes.json` | `parseModelSizes` | `expectedSizes` (id to bytes) instead of `expected`; the models of the file above, for a size-based default |
| `omlx-models-status.json` | `withModelStatus(parseOpenAiModelList(listed), parseOmlxModelStatus(response))` | `listed` is the `/v1/models` body; `expectedDefault` / `expectedPicked` as above |
| `ollama-api-tags.json` | `parseOllamaTags` | `expectedNames` instead of `expected`; `expectedSizes` from `parseModelSizes` |
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

## `requests/thinking-defaults.json`

`{ "description", "cases": [...] }`: what a request sends with the dial on Default, by job (Q6). Each case: `kind`, `local`, `modelId`, `job` (`rewrite`, `translate`, `title`, `frontmatter`, `explain`, `summary`), `explicit` (the dial's level or null), `modelOverrides` (or null), `expectedOverrides` (the request's thinking fields, or null for none), `expectedAuto` (the job's default, not the user's pick) and optionally `expectedBodyEffort` (`reasoning_effort` after `buildCompletionBody`'s OpenAI Off mapping). TypeScript only (`packages/core/test/ai-thinking-defaults.test.ts`): Desktop runs core's editor, so the level is decided before the request reaches Rust.

## `consent/`

`consent-text.json`: the cloud consent dialog's words, from core's `privacy.ts`. `privacy`, `sendsText`, `sendsFallback`, `features` (feature id → what it sends) and `policies` (cloud preset host → policy label, URL, optional note) mirror the core tables; `cases` are `aiConsentText` inputs (`engineName`, `host`, `feature?`, `sends?`, `scopeWord`, `policyLine?`) with the `expected` `{ title, body, allow, allowOnce, deny, readPolicy? }`, the policy looked up from `host`. `policyLine: true` is Desktop's native dialog (the policy URL in the body, no button); without it, VS Code's modal (a `readPolicy` button). Checked by `packages/core/test/ai-privacy.test.ts` (every case) and the Rust port (`commands/ai/consent.rs`, the `policyLine` cases). When the copy changes in core, regenerate the expected text from `aiConsentText` and update the Rust tables to match.

## `requests/openai-reasoning.json`

`{ "description", "request", "cases": [...] }`: one `AiCompletionRequest` (`maxTokens` 500, `temperature` 0.3) built per case as `buildCompletionBody(kind, { id: modelId, requestOverrides: modelOverrides }, request)`. Each case has `expected` (top-level keys, each compared whole) and `absent` (keys that must not be there). OpenAI reasoning models (o-series, GPT-5 onwards on the `openai` kind, `openai/`-prefixed ids elsewhere) get no `temperature`; everything else keeps it. Cases with `modelOverrides.reasoning_effort: "none"` (the dial's Off) check the per-family mapping: `none` for gpt-5.1 onwards in the 5.x line, `minimal` for plain gpt-5, `low` for the o-series, gpt-6+, codex/pro and anything undocumented; non-reasoning models keep `none`. Checked by `packages/core/test/ai-unsupported-params.test.ts` and `commands/ai/tests.rs`.

## `requests/unsupported-params.json`

The one-retry net for a 400 that names a parameter the model does not take. `errors`: `{ name, status, body (raw response text), param }`, where `param` is what `unsupportedRequestParam(status, body)` returns (null: not retried). `adjust`: `{ name, param, body, expected }`, where `expected` is `withoutRequestParam(body, param)` (null: nothing to retry). Checked by the same two suites; both hosts' retry loops are tested against the first two `errors` bodies (`test/unit/ai-providers.test.ts`, `commands/ai/tests.rs`).
