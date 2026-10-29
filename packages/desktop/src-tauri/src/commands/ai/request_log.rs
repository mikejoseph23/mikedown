//! The per-request log line, in the same shape as the VS Code extension's
//! (`logRequest` in `src/ai/engineService.ts`):
//! `feature/task · engine · model · local|cloud · N ms · finish[ · thinking <level>[ · max_tokens N]][ · P in, C out][ · first token N ms][ · [~]X tok/s]`.
//! Never the prompt, the response or a key.

use serde_json::{Map, Value};

use super::model::{EngineKind, ServedBy, Timing, Usage};
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

/// Characters per token for the estimate when the engine reports no usage (`AI_CHARS_PER_TOKEN`).
const CHARS_PER_TOKEN: f64 = 4.0;

/// Port of `formatAiTokensPerSecond`: "38 tok/s", "~38 tok/s", "4.5 tok/s".
fn format_tokens_per_second(tps: f64, approximate: bool) -> String {
    let n = if tps < 10.0 { format!("{tps:.1}") } else { format!("{}", tps.round()) };
    format!("{}{n} tok/s", if approximate { "~" } else { "" })
}

/// Port of `aiTimingLogParts` (core `stats.ts`): `first token N ms` and the
/// speed. Output tokens are the reported count when above zero, else
/// output characters / 4 (approximate); speed is over the time after the
/// first token, or the whole request without one.
pub fn timing_log_parts(timing: Option<&Timing>, usage: Option<&Usage>) -> Vec<String> {
    let Some(t) = timing else { return Vec::new() };
    let mut parts = Vec::new();
    if let Some(first) = t.first_token_ms {
        parts.push(format!("first token {first} ms"));
    }
    let reported = usage.and_then(|u| u.completion_tokens).filter(|n| *n > 0);
    let (tokens, approximate) = match reported {
        Some(n) => (Some(n as f64), false),
        None if t.output_chars > 0 => (Some((t.output_chars as f64 / CHARS_PER_TOKEN).round().max(1.0)), true),
        None => (None, false),
    };
    let generation_ms = match t.first_token_ms {
        Some(first) if t.total_ms > first => t.total_ms - first,
        _ => t.total_ms,
    };
    if let Some(tokens) = tokens.filter(|_| generation_ms > 0) {
        parts.push(format_tokens_per_second(tokens / (generation_ms as f64 / 1000.0), approximate));
    }
    parts
}

#[allow(clippy::too_many_arguments)]
pub fn format_request_log(
    feature: &str,
    task: &str,
    served: &ServedBy,
    duration_ms: u128,
    finish: &str,
    thinking: &[String],
    usage: Option<&Usage>,
    timing: Option<&Timing>,
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
    parts.extend(timing_log_parts(timing, usage));
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
        let line = format_request_log("rewrite", "rewrite", &served(true), 13024, "stop", &[], None, None);
        assert_eq!(line, "rewrite/rewrite · oMLX · qwen · local · 13024 ms · stop");
    }

    #[test]
    fn thinking_max_tokens_and_usage_are_appended_in_order() {
        let overrides = json!({ "reasoning_effort": "high" });
        let thinking = thinking_log_parts(EngineKind::OpenAiCompatible, None, Some(&overrides), Some(4096));
        let usage = Usage { prompt_tokens: Some(10), completion_tokens: None };
        let line = format_request_log("rewrite", "rewrite", &served(false), 5, "length", &thinking, Some(&usage), None);
        assert_eq!(line, "rewrite/rewrite · oMLX · qwen · cloud · 5 ms · length · thinking high · max_tokens 4096 · 10 in, ? out");
    }

    #[test]
    fn timing_comes_last_with_the_first_token_and_the_speed() {
        let usage = Usage { prompt_tokens: Some(418), completion_tokens: Some(68) };
        let timing = Timing { total_ms: 2400, first_token_ms: Some(600), output_chars: 300 };
        let line = format_request_log("rewrite", "rewrite", &served(true), 2410, "stop", &[], Some(&usage), Some(&timing));
        assert_eq!(line, "rewrite/rewrite · oMLX · qwen · local · 2410 ms · stop · 418 in, 68 out · first token 600 ms · 38 tok/s");
    }

    #[test]
    fn timing_parts_match_the_shared_stats_fixture() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../test/ai-fixtures/stats/result-stats.json");
        let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let result = &case["result"];
            let usage = result.get("usage").map(|u| Usage {
                prompt_tokens: u.get("promptTokens").and_then(Value::as_u64),
                completion_tokens: u.get("completionTokens").and_then(Value::as_u64),
            });
            let timing = result.get("timing").map(|t| Timing {
                total_ms: t["totalMs"].as_u64().unwrap(),
                first_token_ms: t.get("firstTokenMs").and_then(Value::as_u64),
                output_chars: t.get("outputChars").and_then(Value::as_u64).unwrap_or(0),
            });
            let want: Vec<String> = case["log"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
            assert_eq!(timing_log_parts(timing.as_ref(), usage.as_ref()), want, "{name}");
        }
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
