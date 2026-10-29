//! The per-request log line, in the same shape as the VS Code extension's
//! (`logRequest` in `src/ai/engineService.ts`):
//! `feature/task · engine · model · local|cloud · N ms · finish[ · thinking <level>[ · max_tokens N]][ · P in, C out]`.
//! Never the prompt, the response or a key.

use serde_json::{Map, Value};

use super::model::{EngineKind, ServedBy, Usage};
use super::requests::merge_request_overrides;

/// `thinking <level>` and `max_tokens <n>` when the effective overrides (the
/// model's, then the request's) set a thinking level; nothing otherwise.
/// Mirrors `thinkingLevelFrom` in core.
pub fn thinking_log_parts(
    kind: EngineKind,
    model_overrides: Option<&Map<String, Value>>,
    request_overrides: Option<&Value>,
    max_tokens: Option<u64>,
) -> Vec<String> {
    let merged = merge_request_overrides(Value::Object(Map::new()), model_overrides);
    let merged = merge_request_overrides(merged, request_overrides.and_then(Value::as_object));
    let Value::Object(overrides) = merged else { return Vec::new() };
    let Some(level) = thinking_level(kind, &overrides) else { return Vec::new() };
    let mut parts = vec![format!("thinking {level}")];
    let max = overrides
        .get("max_tokens")
        .or_else(|| overrides.get("max_completion_tokens"))
        .and_then(Value::as_u64)
        .or(max_tokens);
    if let Some(max) = max {
        parts.push(format!("max_tokens {max}"));
    }
    parts
}

fn thinking_level(kind: EngineKind, overrides: &Map<String, Value>) -> Option<&'static str> {
    let tier = |v: &Value| match v.as_str() {
        Some("low") => Some("low"),
        Some("medium") => Some("medium"),
        Some("high") => Some("high"),
        _ => None,
    };
    if kind == EngineKind::Anthropic {
        return overrides.get("output_config").and_then(|c| c.get("effort")).and_then(tier);
    }
    if overrides.get("chat_template_kwargs").and_then(|k| k.get("enable_thinking")) == Some(&Value::Bool(false)) {
        return Some("off");
    }
    let effort = overrides.get("reasoning_effort")?;
    if effort.as_str() == Some("none") {
        return Some("off");
    }
    let level = tier(effort)?;
    // LM Studio is on/off: any tier reads as On.
    Some(if kind == EngineKind::LmStudio { "medium" } else { level })
}

pub fn format_request_log(
    feature: &str,
    task: &str,
    served: &ServedBy,
    duration_ms: u128,
    finish: &str,
    thinking: &[String],
    usage: Option<&Usage>,
) -> String {
    let mut parts = vec![
        format!("{feature}/{task}"),
        served.engine_name.clone(),
        served.model_id.clone(),
        if served.is_local { "local" } else { "cloud" }.to_string(),
        format!("{duration_ms} ms"),
        finish.to_string(),
    ];
    parts.extend(thinking.iter().cloned());
    if let Some(u) = usage {
        if u.prompt_tokens.is_some() || u.completion_tokens.is_some() {
            let n = |v: Option<u64>| v.map_or("?".to_string(), |v| v.to_string());
            parts.push(format!("{} in, {} out", n(u.prompt_tokens), n(u.completion_tokens)));
        }
    }
    parts.join(" · ")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn served(local: bool) -> ServedBy {
        ServedBy { engine_id: "omlx".into(), engine_name: "oMLX".into(), model_id: "qwen".into(), is_local: local }
    }

    #[test]
    fn plain_line_without_thinking_keeps_the_base_shape() {
        let line = format_request_log("rewrite", "rewrite", &served(true), 13024, "stop", &[], None);
        assert_eq!(line, "rewrite/rewrite · oMLX · qwen · local · 13024 ms · stop");
    }

    #[test]
    fn thinking_max_tokens_and_usage_are_appended_in_order() {
        let overrides = json!({ "reasoning_effort": "high" });
        let thinking = thinking_log_parts(EngineKind::OpenAiCompatible, None, Some(&overrides), Some(4096));
        let usage = Usage { prompt_tokens: Some(10), completion_tokens: None };
        let line = format_request_log("rewrite", "rewrite", &served(false), 5, "length", &thinking, Some(&usage));
        assert_eq!(line, "rewrite/rewrite · oMLX · qwen · cloud · 5 ms · length · thinking high · max_tokens 4096 · 10 in, ? out");
    }

    #[test]
    fn thinking_comes_from_the_request_over_the_model_and_is_absent_without_a_level() {
        let model = json!({ "reasoning_effort": "low", "max_tokens": 99 });
        let model = model.as_object();
        let req = json!({ "reasoning_effort": "high" });
        assert_eq!(thinking_log_parts(EngineKind::Ollama, model, Some(&req), Some(4096)), ["thinking high", "max_tokens 99"]);
        assert_eq!(thinking_log_parts(EngineKind::Ollama, model, None, None), ["thinking low", "max_tokens 99"]);
        let other = json!({ "top_p": 0.5 });
        assert!(thinking_log_parts(EngineKind::Ollama, None, Some(&other), Some(10)).is_empty());
        assert!(thinking_log_parts(EngineKind::Ollama, None, None, Some(10)).is_empty());
        assert!(thinking_log_parts(EngineKind::Ollama, None, Some(&json!("high")), None).is_empty());
    }

    #[test]
    fn off_anthropic_and_lmstudio_levels() {
        let none = json!({ "reasoning_effort": "none" });
        assert_eq!(thinking_log_parts(EngineKind::OpenAi, None, Some(&none), None), ["thinking off"]);
        let kwargs = json!({ "chat_template_kwargs": { "enable_thinking": false } });
        assert_eq!(thinking_log_parts(EngineKind::OpenAiCompatible, None, Some(&kwargs), None), ["thinking off"]);
        let anthropic = json!({ "thinking": { "type": "adaptive" }, "output_config": { "effort": "medium" } });
        assert_eq!(thinking_log_parts(EngineKind::Anthropic, None, Some(&anthropic), Some(2048)), ["thinking medium", "max_tokens 2048"]);
        assert!(thinking_log_parts(EngineKind::Anthropic, None, Some(&json!({ "reasoning_effort": "high" })), None).is_empty());
        let high = json!({ "reasoning_effort": "high" });
        assert_eq!(thinking_log_parts(EngineKind::LmStudio, None, Some(&high), None), ["thinking medium"]);
    }
}
