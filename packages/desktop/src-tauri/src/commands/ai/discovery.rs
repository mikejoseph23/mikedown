//! Parsers for discovery responses, one per endpoint shape, ported from
//! `packages/core/src/ai/discovery.ts` and checked against the same fixtures
//! (`test/ai-fixtures/discovery/`). The providers do the HTTP and hand the
//! parsed JSON here. Every parser tolerates junk: entries without a string id
//! are skipped, never an error.
//!
//! Capability values the endpoint did not report stay unset; the webview
//! fills them from core's id heuristics (`mergeDiscoveredModels`).

use std::collections::HashSet;

use serde_json::Value;

use super::model::{DiscoveredModel, DiscoverySource, PartialCapabilities};

fn data_array<'a>(body: &'a Value, key: &str) -> Vec<&'a Value> {
    body.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter(|v| v.is_object()).collect())
        .unwrap_or_default()
}

fn positive_int(v: Option<&Value>) -> Option<u64> {
    let v = v?;
    if let Some(n) = v.as_u64() {
        return (n > 0).then_some(n);
    }
    let f = v.as_f64()?;
    (f.is_finite() && f >= 1.0).then(|| f.floor() as u64)
}

fn str_id(m: &Value) -> Option<&str> {
    m.get("id").and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// `GET {base}/models` on any OpenAI-compatible server: ids only.
pub fn parse_openai_model_list(body: &Value) -> Vec<DiscoveredModel> {
    data_array(body, "data")
        .into_iter()
        .filter_map(str_id)
        .map(|id| DiscoveredModel {
            id: id.to_string(),
            label: None,
            capabilities: PartialCapabilities::default(),
            source: DiscoverySource::Heuristic,
            loaded: None,
        })
        .collect()
}

/// LM Studio `GET /api/v0/models`: `type` (`llm`, `vlm`, `embeddings`),
/// `max_context_length`, `state`, and on newer builds `capabilities`.
pub fn parse_lmstudio_models(body: &Value) -> Vec<DiscoveredModel> {
    let mut out = Vec::new();
    for m in data_array(body, "data") {
        let Some(id) = str_id(m) else { continue };
        let mut caps = PartialCapabilities::default();
        match m.get("type").and_then(Value::as_str) {
            Some("embeddings") => {
                caps.chat = Some(false);
                caps.stream = Some(false);
                caps.vision = Some(false);
                caps.tools = Some(false);
                caps.json = Some(false);
                caps.embed = Some(true);
            }
            Some("vlm") => {
                caps.chat = Some(true);
                caps.vision = Some(true);
                caps.embed = Some(false);
            }
            Some("llm") => {
                caps.chat = Some(true);
                caps.vision = Some(false);
                caps.embed = Some(false);
            }
            _ => {}
        }
        if m.get("capabilities").and_then(Value::as_array).is_some_and(|a| a.iter().any(|c| c.as_str() == Some("tool_use"))) {
            caps.tools = Some(true);
        }
        caps.context_tokens = positive_int(m.get("max_context_length")).or_else(|| positive_int(m.get("loaded_context_length")));
        out.push(DiscoveredModel {
            id: id.to_string(),
            label: None,
            capabilities: caps,
            source: DiscoverySource::Endpoint,
            loaded: m.get("state").and_then(Value::as_str).map(|s| s == "loaded"),
        });
    }
    out
}

/// Ollama `GET /api/tags` (and `/api/ps`): the model names.
pub fn parse_ollama_tags(body: &Value) -> Vec<String> {
    data_array(body, "models")
        .into_iter()
        .filter_map(|m| {
            m.get("model")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .or_else(|| m.get("name").and_then(Value::as_str))
                .filter(|s| !s.is_empty())
        })
        .map(str::to_string)
        .collect()
}

/// Ollama `POST /api/show` for one model: `capabilities` (`completion`,
/// `vision`, `tools`, `embedding`, `insert`) and the context length under
/// `model_info["<arch>.context_length"]`.
pub fn parse_ollama_show(name: &str, body: &Value) -> DiscoveredModel {
    let mut caps = PartialCapabilities::default();
    if body.is_object() {
        if let Some(list) = body.get("capabilities").and_then(Value::as_array) {
            let has = |c: &str| list.iter().any(|v| v.as_str() == Some(c));
            caps.chat = Some(has("completion"));
            caps.stream = caps.chat;
            caps.vision = Some(has("vision"));
            caps.tools = Some(has("tools"));
            caps.embed = Some(has("embedding"));
            caps.fim = Some(has("insert"));
        }
        if let Some(info) = body.get("model_info").and_then(Value::as_object) {
            let arch = info.get("general.architecture").and_then(Value::as_str);
            let ctx = arch
                .and_then(|a| positive_int(info.get(&format!("{a}.context_length"))))
                .or_else(|| positive_int(info.iter().find(|(k, _)| k.ends_with(".context_length")).map(|(_, v)| v)));
            caps.context_tokens = ctx;
        }
    }
    let described = caps != PartialCapabilities::default();
    DiscoveredModel {
        id: name.to_string(),
        label: None,
        capabilities: caps,
        source: if described { DiscoverySource::Endpoint } else { DiscoverySource::Heuristic },
        loaded: None,
    }
}

/// Which Ollama models are loaded right now, from `GET /api/ps`.
pub fn parse_ollama_running(body: &Value) -> HashSet<String> {
    parse_ollama_tags(body).into_iter().collect()
}

/// Anthropic `GET /v1/models`: `display_name`, `max_input_tokens` and the
/// `capabilities` tree (`image_input.supported`, `structured_outputs.supported`).
/// Tools are assumed on.
pub fn parse_anthropic_models(body: &Value) -> Vec<DiscoveredModel> {
    let mut out = Vec::new();
    for m in data_array(body, "data") {
        let Some(id) = str_id(m) else { continue };
        let mut caps = PartialCapabilities {
            chat: Some(true),
            stream: Some(true),
            tools: Some(true),
            fim: Some(false),
            embed: Some(false),
            ..Default::default()
        };
        caps.context_tokens = positive_int(m.get("max_input_tokens"));
        let tree = m.get("capabilities").filter(|c| c.is_object());
        let supported = |key: &str| tree.and_then(|t| t.get(key)).and_then(|n| n.get("supported")).and_then(Value::as_bool);
        if let Some(v) = supported("image_input") {
            caps.vision = Some(v);
        }
        if let Some(j) = supported("structured_outputs") {
            caps.json = Some(j);
        }
        let label = m.get("display_name").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
        out.push(DiscoveredModel { id: id.to_string(), label, capabilities: caps, source: DiscoverySource::Endpoint, loaded: None });
    }
    out
}

/// Anthropic pages its list; the next `after_id`, or None on the last page.
pub fn anthropic_next_page(body: &Value) -> Option<String> {
    if body.get("has_more").and_then(Value::as_bool) == Some(true) {
        body.get("last_id").and_then(Value::as_str).map(str::to_string)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../test/ai-fixtures/discovery").join(name);
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn as_json(models: &[DiscoveredModel]) -> Value {
        serde_json::to_value(models).unwrap()
    }

    #[test]
    fn bare_openai_lists_give_ids_only() {
        let f = fixture("openai-v1-models-bare.json");
        assert_eq!(as_json(&parse_openai_model_list(&f["response"])), f["expected"]);
    }

    #[test]
    fn lmstudio_models_read_type_context_and_state() {
        let f = fixture("lmstudio-api-v0-models.json");
        assert_eq!(as_json(&parse_lmstudio_models(&f["response"])), f["expected"]);
    }

    #[test]
    fn ollama_tags_then_show_per_model() {
        let tags = fixture("ollama-api-tags.json");
        let names = parse_ollama_tags(&tags["response"]);
        assert_eq!(serde_json::to_value(&names).unwrap(), tags["expectedNames"]);

        let show = fixture("ollama-api-show.json");
        let models: Vec<DiscoveredModel> =
            names.iter().map(|n| parse_ollama_show(n, &show["responses"][n.as_str()])).collect();
        assert_eq!(as_json(&models), show["expected"]);
        // A body with nothing usable falls back to the id heuristics.
        let empty = parse_ollama_show("x", &serde_json::json!({}));
        assert_eq!(empty.source, DiscoverySource::Heuristic);
    }

    #[test]
    fn anthropic_models_read_the_capability_tree_and_paging() {
        let f = fixture("anthropic-v1-models.json");
        assert_eq!(as_json(&parse_anthropic_models(&f["response"])), f["expected"]);
        assert_eq!(anthropic_next_page(&f["response"]), f["expectedNextPage"].as_str().map(str::to_string));
        let paged = serde_json::json!({ "has_more": true, "last_id": "abc", "data": [] });
        assert_eq!(anthropic_next_page(&paged).as_deref(), Some("abc"));
    }

    #[test]
    fn junk_is_skipped_not_thrown_on() {
        assert!(parse_openai_model_list(&serde_json::json!("nope")).is_empty());
        assert!(parse_lmstudio_models(&serde_json::json!({ "data": [1, { "id": 3 }, {}] })).is_empty());
    }
}
