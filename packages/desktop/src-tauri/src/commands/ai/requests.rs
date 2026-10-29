//! Request building per engine kind, ported from
//! `packages/core/src/ai/requests.ts`: endpoint URLs, auth headers and the
//! completion body. Same shapes, so Desktop and the extension send identical
//! requests.
//!
//! - Chat Completions kinds: `{ model, messages, stream, max_tokens,
//!   temperature, response_format }`; `openai` uses `max_completion_tokens`
//!   and asks for usage in the stream. OpenAI reasoning models (o-series,
//!   GPT-5 onwards) get no `temperature`: they accept only the default.
//! - `anthropic`: Messages API, system prompts lifted into `system`,
//!   `max_tokens` always set. No sampling parameters: API version 2026-10-21
//!   rejects `temperature`.
//!
//! `model.requestOverrides` merge last, deeply, so they win (OPEN-6); the
//! request's own `requestOverrides` (a per-request thinking level) merge over
//! those the same way.
//!
//! A 400 that names a parameter the model does not take
//! (`unsupported_request_param`) is retried once without it
//! (`without_request_param`); see `providers::complete_streaming`.

use serde_json::{json, Map, Value};

use super::model::{CompletionRequest, EngineKind, Message, MessageContent, MessagePart, ModelConfig};

pub const ANTHROPIC_API_VERSION: &str = "2026-10-21";
pub const ANTHROPIC_DEFAULT_MAX_TOKENS: u64 = 4096;
pub const JSON_ONLY_INSTRUCTION: &str = "Respond with a single valid JSON value and nothing else.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub completions: String,
    pub models: String,
    pub native_models: Option<String>,
    pub native_show: Option<String>,
    /// Ollama `GET /api/ps`: which models are loaded right now.
    pub native_running: Option<String>,
}

fn trim_slash(url: &str) -> &str {
    url.trim().trim_end_matches('/')
}

/// URLs for an engine. OpenAI-style base URLs include `/v1`; for LM Studio
/// and Ollama a base without it gets `/v1` added for completions and their
/// native endpoints hang off the root. Anthropic's base is the host, with or
/// without `/v1`.
pub fn engine_endpoints(kind: EngineKind, base_url: &str) -> Endpoints {
    let base = trim_slash(base_url);
    let root = base.strip_suffix("/v1").unwrap_or(base);
    let v1 = format!("{root}/v1");
    match kind {
        EngineKind::Anthropic => Endpoints {
            completions: format!("{v1}/messages"),
            models: format!("{v1}/models"),
            native_models: None,
            native_show: None,
            native_running: None,
        },
        EngineKind::LmStudio => Endpoints {
            completions: format!("{v1}/chat/completions"),
            models: format!("{v1}/models"),
            native_models: Some(format!("{root}/api/v0/models")),
            native_show: None,
            native_running: None,
        },
        EngineKind::Ollama => Endpoints {
            completions: format!("{v1}/chat/completions"),
            models: format!("{v1}/models"),
            native_models: Some(format!("{root}/api/tags")),
            native_show: Some(format!("{root}/api/show")),
            native_running: Some(format!("{root}/api/ps")),
        },
        EngineKind::OpenAiCompatible | EngineKind::OpenAi => Endpoints {
            completions: format!("{base}/chat/completions"),
            models: format!("{base}/models"),
            native_models: None,
            native_show: None,
            native_running: None,
        },
    }
}

/// Headers for every request to the engine (JSON content type included).
pub fn auth_headers(kind: EngineKind, api_key: Option<&str>) -> Vec<(&'static str, String)> {
    let mut headers = vec![("content-type", "application/json".to_string())];
    let key = api_key.filter(|k| !k.is_empty());
    if kind == EngineKind::Anthropic {
        headers.push(("anthropic-version", ANTHROPIC_API_VERSION.to_string()));
        if let Some(k) = key {
            headers.push(("x-api-key", k.to_string()));
        }
    } else if let Some(k) = key {
        headers.push(("authorization", format!("Bearer {k}")));
    }
    headers
}

/// Deep merge: nested objects merge, anything else in `overrides` replaces.
pub fn merge_request_overrides(body: Value, overrides: Option<&Map<String, Value>>) -> Value {
    let Some(overrides) = overrides else { return body };
    let Value::Object(mut out) = body else { return body };
    for (key, value) in overrides {
        let merged = match (out.get(key), value) {
            (Some(current @ Value::Object(_)), Value::Object(over)) => merge_request_overrides(current.clone(), Some(over)),
            _ => value.clone(),
        };
        out.insert(key.clone(), merged);
    }
    Value::Object(out)
}

fn openai_content(content: &MessageContent) -> Value {
    match content {
        MessageContent::Text(t) => Value::String(t.clone()),
        MessageContent::Parts(parts) => Value::Array(
            parts
                .iter()
                .map(|p| match p {
                    MessagePart::Text { text } => json!({ "type": "text", "text": text }),
                    MessagePart::Image { mime, data_base64 } => {
                        json!({ "type": "image_url", "image_url": { "url": format!("data:{mime};base64,{data_base64}") } })
                    }
                })
                .collect(),
        ),
    }
}

fn anthropic_content(content: &MessageContent) -> Value {
    match content {
        MessageContent::Text(t) => Value::String(t.clone()),
        MessageContent::Parts(parts) => Value::Array(
            parts
                .iter()
                .map(|p| match p {
                    MessagePart::Text { text } => json!({ "type": "text", "text": text }),
                    MessagePart::Image { mime, data_base64 } => {
                        json!({ "type": "image", "source": { "type": "base64", "media_type": mime, "data": data_base64 } })
                    }
                })
                .collect(),
        ),
    }
}

/// The JSON body for one completion against `model` on an engine of `kind`.
pub fn build_completion_body(kind: EngineKind, model: &ModelConfig, req: &CompletionRequest, stream: bool) -> Value {
    let body = if kind == EngineKind::Anthropic {
        anthropic_body(&model.id, req, stream)
    } else {
        chat_completions_body(kind, &model.id, req, stream)
    };
    let body = merge_request_overrides(body, model.request_overrides.as_ref());
    let mut body = merge_request_overrides(body, req.request_overrides.as_ref().and_then(Value::as_object));
    if kind != EngineKind::Anthropic && body.get("reasoning_effort").and_then(Value::as_str) == Some("none") {
        // Port of `acceptedOffEffort`: Off is stored as `none`, which gpt-5 and the o-series reject.
        if let Some(effort) = openai_off_reasoning_effort(&model.id, kind).filter(|e| *e != "none") {
            body["reasoning_effort"] = json!(effort);
        }
    }
    body
}

fn chat_completions_body(kind: EngineKind, model_id: &str, req: &CompletionRequest, stream: bool) -> Value {
    let messages: Vec<Value> = req
        .messages
        .iter()
        .map(|m: &Message| json!({ "role": m.role, "content": openai_content(&m.content) }))
        .collect();
    let mut body = json!({ "model": model_id, "messages": messages, "stream": stream });
    let obj = body.as_object_mut().expect("object literal");
    if let Some(max) = req.max_tokens {
        obj.insert(if kind == EngineKind::OpenAi { "max_completion_tokens" } else { "max_tokens" }.to_string(), json!(max));
    }
    if let Some(t) = req.temperature.filter(|_| !is_openai_reasoning_model(model_id, kind)) {
        obj.insert("temperature".to_string(), json!(t));
    }
    if req.format.as_deref() == Some("json") {
        // LM Studio accepts only `json_schema`; a permissive object schema is
        // the schema-free equivalent.
        let format = if kind == EngineKind::LmStudio {
            json!({ "type": "json_schema", "json_schema": { "name": "response", "schema": { "type": "object" } } })
        } else {
            json!({ "type": "json_object" })
        };
        obj.insert("response_format".to_string(), format);
    }
    if kind == EngineKind::OpenAi && stream {
        obj.insert("stream_options".to_string(), json!({ "include_usage": true }));
    }
    body
}

/// Port of `isOpenAiReasoningModel` (core `capabilityHeuristics.ts`):
/// OpenAI's reasoning models take only the default sampling. The native
/// `openai` kind matches on the id; any other kind only on an `openai/` id
/// (OpenRouter).
pub fn is_openai_reasoning_model(model_id: &str, kind: EngineKind) -> bool {
    bare_openai_id(model_id, kind).is_some_and(|id| openai_reasoning_id(&id))
}

/// The id without an `openai/` vendor prefix, or `None` for an id that is not OpenAI's on this kind.
fn bare_openai_id(model_id: &str, kind: EngineKind) -> Option<String> {
    let id = model_id.trim().to_lowercase();
    if kind == EngineKind::OpenAi {
        Some(id.rsplit('/').next().unwrap_or_default().to_string())
    } else {
        id.strip_prefix("openai/").map(str::to_string)
    }
}

/// Port of `openAiOffReasoningEffort` (core `capabilityHeuristics.ts`): the
/// `reasoning_effort` that means "Off" for an OpenAI reasoning model, `None`
/// when it is not one. `gpt-5.1`+ in the 5.x line take `none`; plain
/// `gpt-5`/`-mini`/`-nano` take `minimal`; everything else (o-series,
/// `gpt-6`+, codex/pro, undocumented ids) gets `low`, which every family
/// accepts.
pub fn openai_off_reasoning_effort(model_id: &str, kind: EngineKind) -> Option<&'static str> {
    let id = bare_openai_id(model_id, kind)?;
    if !openai_reasoning_id(&id) {
        return None;
    }
    let is_pro = id.ends_with("-pro") || id.contains("-pro-");
    if id.contains("codex") || is_pro {
        return Some("low");
    }
    if let Some(rest) = id.strip_prefix("gpt-5.") {
        let minor = rest.bytes().take_while(u8::is_ascii_digit).count();
        if minor > 0 && !rest.starts_with('0') && (rest.len() == minor || rest.as_bytes()[minor] == b'-') {
            return Some("none");
        }
    }
    if id == "gpt-5" || id.starts_with("gpt-5-") {
        return Some("minimal");
    }
    Some("low")
}

/// `^(o\d+|gpt-([5-9]|\d{2,})(\.\d+)?)(-|$)`, without a regex crate.
fn openai_reasoning_id(id: &str) -> bool {
    let digits = |s: &str| s.bytes().take_while(u8::is_ascii_digit).count();
    let rest = if let Some(r) = id.strip_prefix("gpt-") {
        let n = digits(r);
        if n == 0 || (n == 1 && r.as_bytes()[0] < b'5') {
            return false;
        }
        let r = &r[n..];
        match r.strip_prefix('.') {
            Some(minor) if digits(minor) > 0 => &minor[digits(minor)..],
            _ => r,
        }
    } else if let Some(r) = id.strip_prefix('o') {
        let n = digits(r);
        if n == 0 {
            return false;
        }
        &r[n..]
    } else {
        return false;
    };
    rest.is_empty() || rest.starts_with('-')
}

fn anthropic_body(model_id: &str, req: &CompletionRequest, stream: bool) -> Value {
    let mut system: Vec<String> = req.messages.iter().filter(|m| m.role == "system").map(|m| m.content.text()).collect();
    if req.format.as_deref() == Some("json") {
        system.push(JSON_ONLY_INSTRUCTION.to_string());
    }
    let messages: Vec<Value> = req
        .messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| json!({ "role": m.role, "content": anthropic_content(&m.content) }))
        .collect();
    let mut body = json!({
        "model": model_id,
        "max_tokens": req.max_tokens.unwrap_or(ANTHROPIC_DEFAULT_MAX_TOKENS),
        "messages": messages,
        "stream": stream,
    });
    if !system.is_empty() {
        body.as_object_mut().expect("object literal").insert("system".to_string(), Value::String(system.join("\n\n")));
    }
    body
}

// ── Unsupported parameters ──────────────────────────────────────────────────

/// Body fields a server may reject for one model while taking them for
/// others. Only these are retried: anything else in a 400 is a real error.
pub const RETRYABLE_REQUEST_PARAMS: [&str; 7] =
    ["temperature", "top_p", "presence_penalty", "frequency_penalty", "max_tokens", "max_completion_tokens", "reasoning_effort"];

const UNSUPPORTED_WORDING: [&str; 4] = ["unsupported", "not supported", "does not support", "not compatible"];

/// Port of `unsupportedRequestParam`: the parameter a failed completion was
/// rejected for, or None. Only a 400 whose error says the parameter (or its
/// value) is unsupported counts: OpenAI's `error.param`, or the first
/// retryable name quoted in the message.
pub fn unsupported_request_param(status: u16, body: &str) -> Option<String> {
    if status != 400 {
        return None;
    }
    let mut message = body.to_string();
    let mut param: Option<Value> = None;
    let mut code = String::new();
    if let Ok(json) = serde_json::from_str::<Value>(body) {
        match json.get("error") {
            Some(Value::Object(error)) => {
                message = error.get("message").and_then(Value::as_str).unwrap_or_default().to_string();
                param = error.get("param").cloned();
                code = error.get("code").and_then(Value::as_str).unwrap_or_default().to_string();
            }
            Some(Value::String(error)) => message = error.clone(),
            _ => {
                if let Some(m) = json.get("message").and_then(Value::as_str) {
                    message = m.to_string();
                }
            }
        }
    }
    let wording = format!("{code} {message}").to_lowercase();
    if !UNSUPPORTED_WORDING.iter().any(|w| wording.contains(w)) {
        return None;
    }
    if let Some(Value::String(p)) = param.filter(|p| p.as_str().is_some_and(|s| !s.is_empty())) {
        return RETRYABLE_REQUEST_PARAMS.contains(&p.as_str()).then_some(p);
    }
    // The first retryable name in quotes (', " or `), so "Use
    // 'max_completion_tokens' instead" after the real one does not count.
    let bytes = message.as_bytes();
    let is_quote = |b: u8| matches!(b, b'\'' | b'"' | b'`');
    let mut i = 0;
    while i < bytes.len() {
        if is_quote(bytes[i]) {
            let start = i + 1;
            let mut j = start;
            while j < bytes.len() && (bytes[j].is_ascii_lowercase() || bytes[j] == b'_') {
                j += 1;
            }
            if j > start && j < bytes.len() && is_quote(bytes[j]) {
                let name = &message[start..j];
                if RETRYABLE_REQUEST_PARAMS.contains(&name) {
                    return Some(name.to_string());
                }
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    None
}

/// Port of `withoutRequestParam`: `body` without a parameter the server
/// rejected. `max_tokens` and `max_completion_tokens` become each other,
/// anything else is dropped. None when the body does not carry it.
pub fn without_request_param(body: &Value, param: &str) -> Option<Value> {
    let mut out = body.as_object()?.clone();
    let value = out.remove(param)?;
    let replacement = match param {
        "max_tokens" => Some("max_completion_tokens"),
        "max_completion_tokens" => Some("max_tokens"),
        _ => None,
    };
    if let Some(r) = replacement.filter(|r| !out.contains_key(*r)) {
        out.insert(r.to_string(), value);
    }
    Some(Value::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(overrides: Option<Value>) -> ModelConfig {
        ModelConfig {
            id: "m".into(),
            enabled: true,
            request_overrides: overrides.and_then(|v| v.as_object().cloned()),
        }
    }

    fn request(json: Value) -> CompletionRequest {
        let mut base = json!({ "requestId": "r1", "messages": [] });
        for (k, v) in json.as_object().unwrap() {
            base[k] = v.clone();
        }
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn endpoints_follow_the_kind() {
        let e = engine_endpoints(EngineKind::OpenAiCompatible, "http://127.0.0.1:8000/v1/");
        assert_eq!(e.completions, "http://127.0.0.1:8000/v1/chat/completions");
        assert_eq!(e.models, "http://127.0.0.1:8000/v1/models");

        let lm = engine_endpoints(EngineKind::LmStudio, "http://127.0.0.1:1234");
        assert_eq!(lm.completions, "http://127.0.0.1:1234/v1/chat/completions");
        assert_eq!(lm.native_models.as_deref(), Some("http://127.0.0.1:1234/api/v0/models"));

        let ol = engine_endpoints(EngineKind::Ollama, "http://127.0.0.1:11434/v1");
        assert_eq!(ol.completions, "http://127.0.0.1:11434/v1/chat/completions");
        assert_eq!(ol.native_models.as_deref(), Some("http://127.0.0.1:11434/api/tags"));
        assert_eq!(ol.native_show.as_deref(), Some("http://127.0.0.1:11434/api/show"));

        for base in ["https://api.anthropic.com", "https://api.anthropic.com/v1"] {
            let a = engine_endpoints(EngineKind::Anthropic, base);
            assert_eq!(a.completions, "https://api.anthropic.com/v1/messages");
            assert_eq!(a.models, "https://api.anthropic.com/v1/models");
        }
    }

    #[test]
    fn headers_carry_the_key_the_way_each_kind_wants_it() {
        let h = auth_headers(EngineKind::Anthropic, Some("k"));
        assert!(h.contains(&("x-api-key", "k".to_string())));
        assert!(h.contains(&("anthropic-version", ANTHROPIC_API_VERSION.to_string())));
        let h = auth_headers(EngineKind::OpenAi, Some("k"));
        assert!(h.contains(&("authorization", "Bearer k".to_string())));
        let h = auth_headers(EngineKind::LmStudio, None);
        assert_eq!(h, vec![("content-type", "application/json".to_string())]);
        // An empty key is no key.
        assert_eq!(auth_headers(EngineKind::OpenAiCompatible, Some("")).len(), 1);
    }

    #[test]
    fn chat_completions_body_has_the_documented_shape() {
        let req = request(json!({
            "messages": [{ "role": "user", "content": "hi" }],
            "maxTokens": 64, "temperature": 0.2, "format": "json",
        }));
        let body = build_completion_body(EngineKind::OpenAiCompatible, &model(None), &req, true);
        assert_eq!(
            body,
            json!({
                "model": "m", "stream": true, "max_tokens": 64, "temperature": 0.2,
                "messages": [{ "role": "user", "content": "hi" }],
                "response_format": { "type": "json_object" },
            })
        );
        let lm = build_completion_body(EngineKind::LmStudio, &model(None), &req, true);
        assert_eq!(lm["response_format"]["type"], "json_schema");
        let oa = build_completion_body(EngineKind::OpenAi, &model(None), &req, true);
        assert_eq!(oa["max_completion_tokens"], 64);
        assert!(oa.get("max_tokens").is_none());
        assert_eq!(oa["stream_options"], json!({ "include_usage": true }));
    }

    #[test]
    fn images_become_data_urls_and_anthropic_source_blocks() {
        let req = request(json!({
            "messages": [{ "role": "user", "content": [
                { "type": "text", "text": "what is this" },
                { "type": "image", "mime": "image/png", "dataBase64": "AAAA" },
            ] }],
        }));
        let oa = build_completion_body(EngineKind::OpenAiCompatible, &model(None), &req, true);
        assert_eq!(oa["messages"][0]["content"][1]["image_url"]["url"], "data:image/png;base64,AAAA");
        let an = build_completion_body(EngineKind::Anthropic, &model(None), &req, true);
        assert_eq!(an["messages"][0]["content"][1], json!({ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } }));
    }

    #[test]
    fn anthropic_lifts_system_prompts_and_never_sends_temperature() {
        let req = request(json!({
            "messages": [
                { "role": "system", "content": "be brief" },
                { "role": "user", "content": "hi" },
            ],
            "temperature": 0.5, "format": "json",
        }));
        let body = build_completion_body(EngineKind::Anthropic, &model(None), &req, true);
        assert_eq!(body["system"], format!("be brief\n\n{JSON_ONLY_INSTRUCTION}"));
        assert_eq!(body["max_tokens"], ANTHROPIC_DEFAULT_MAX_TOKENS);
        assert!(body.get("temperature").is_none());
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn overrides_merge_last_and_deeply() {
        let req = request(json!({ "messages": [{ "role": "user", "content": "x" }], "maxTokens": 10 }));
        let m = model(Some(json!({ "reasoning_effort": "low", "max_tokens": 99, "response_format": { "extra": 1 } })));
        let body = build_completion_body(EngineKind::OpenAiCompatible, &m, &req, true);
        assert_eq!(body["reasoning_effort"], "low");
        assert_eq!(body["max_tokens"], 99);
        let merged = merge_request_overrides(json!({ "a": { "b": 1, "c": 2 } }), json!({ "a": { "b": 9 } }).as_object());
        assert_eq!(merged, json!({ "a": { "b": 9, "c": 2 } }));
    }
}
