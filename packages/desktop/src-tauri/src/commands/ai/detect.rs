//! Local server detection for the setup UI (the first-run panel and the
//! quick-start cards): does a local preset's address answer, and how many
//! models does it list? A port of `localDetectTarget` and
//! `countDetectedModels` in core's `ai/discovery.ts`, and of
//! `AiEngineService#detectLocalServers` in the VS Code extension.
//!
//! The local presets are listed here as in core's `ai/presets.ts` (only what
//! detection needs). One GET per candidate, all at once, each capped at
//! `DETECT_TIMEOUT`. The first GET carries no key; a server that answers
//! 401/403 is asked again with the preset's key (oMLX's key file), and only at
//! the preset's own address. Nothing is cached or saved.

use std::time::{Duration, Instant};

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::watch;

use super::errors::{AiError, ErrorCode};
use super::model::{ApiKeyFile, EngineKind};
use super::providers;

/// Each address gets this long (`AI_LOCAL_DETECT_TIMEOUT_MS` in core).
pub const DETECT_TIMEOUT: Duration = Duration::from_millis(1500);
/// More candidates than this are ignored.
const MAX_CANDIDATES: usize = 32;

/// A local preset, as far as detection needs it.
pub struct LocalPreset {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: EngineKind,
    pub base_url: &'static str,
    /// The path under the server root when it is not `{base_url}/models`.
    pub detect_path: Option<&'static str>,
    pub api_key_env: Option<&'static str>,
    /// `(path, jsonPath)`.
    pub api_key_file: Option<(&'static str, &'static str)>,
}

/// Core's local presets but Custom, in the same order.
pub const LOCAL_PRESETS: &[LocalPreset] = &[
    LocalPreset {
        id: "omlx",
        name: "oMLX",
        kind: EngineKind::OpenAiCompatible,
        base_url: "http://127.0.0.1:8000/v1",
        detect_path: None,
        api_key_env: Some("OMLX_API_KEY"),
        api_key_file: Some(("~/.omlx/settings.json", "auth.api_key")),
    },
    LocalPreset {
        id: "lmstudio",
        name: "LM Studio",
        kind: EngineKind::LmStudio,
        base_url: "http://127.0.0.1:1234/v1",
        detect_path: Some("/api/v0/models"),
        api_key_env: None,
        api_key_file: None,
    },
    LocalPreset {
        id: "ollama",
        name: "Ollama",
        kind: EngineKind::Ollama,
        base_url: "http://127.0.0.1:11434/v1",
        detect_path: Some("/api/tags"),
        api_key_env: None,
        api_key_file: None,
    },
    LocalPreset {
        id: "llamacpp",
        name: "llama.cpp server",
        kind: EngineKind::OpenAiCompatible,
        base_url: "http://127.0.0.1:8080/v1",
        detect_path: None,
        api_key_env: None,
        api_key_file: None,
    },
    LocalPreset {
        id: "vllm",
        name: "vLLM",
        kind: EngineKind::OpenAiCompatible,
        base_url: "http://127.0.0.1:8000/v1",
        detect_path: None,
        api_key_env: Some("VLLM_API_KEY"),
        api_key_file: None,
    },
];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectCandidate {
    #[serde(default)]
    pub preset_id: String,
    #[serde(default)]
    pub base_url: String,
}

/// `AiLocalServerProbe` in core.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServerProbe {
    pub preset_id: String,
    pub base_url: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
}

/// What to GET for one candidate, and whether a key may be sent there.
pub struct DetectTarget<'a> {
    pub preset: &'a LocalPreset,
    pub url: String,
    /// The candidate is at the preset's own address.
    pub own_address: bool,
}

fn trim_slash(s: &str) -> &str {
    s.trim_end_matches('/')
}

/// `detect_path` under the server root (no `/v1`), else `{base_url}/models`.
pub fn detect_url(base_url: &str, detect_path: Option<&str>) -> String {
    let base = trim_slash(base_url.trim());
    match detect_path {
        Some(path) => format!("{}{path}", base.strip_suffix("/v1").unwrap_or(base)),
        None => format!("{base}/models"),
    }
}

/// A candidate checked against `presets`: None for an unknown preset or an
/// address that is not http(s).
pub fn detect_target<'a>(candidate: &DetectCandidate, presets: &'a [LocalPreset]) -> Option<DetectTarget<'a>> {
    let preset = presets.iter().find(|p| p.id == candidate.preset_id)?;
    let base = candidate.base_url.trim();
    let lower = base.to_ascii_lowercase();
    let rest = lower.strip_prefix("http://").or_else(|| lower.strip_prefix("https://"))?;
    if rest.is_empty() || rest.starts_with('/') {
        return None;
    }
    Some(DetectTarget {
        preset,
        url: detect_url(base, preset.detect_path),
        own_address: trim_slash(&lower) == trim_slash(&preset.base_url.to_ascii_lowercase()),
    })
}

/// Models a detection answer lists: `data` (OpenAI-style, LM Studio, minus
/// LM Studio's embedding models) or `models` (Ollama). None for another shape.
pub fn count_models(body: &Value) -> Option<usize> {
    let objects = |v: &Value| v.as_array().map(|a| a.iter().filter(|m| m.is_object()).cloned().collect::<Vec<_>>());
    if let Some(data) = body.get("data").and_then(objects) {
        return Some(data.iter().filter(|m| m.get("type").and_then(Value::as_str) != Some("embeddings")).count());
    }
    body.get("models").and_then(objects).map(|m| m.len())
}

/// The preset's key from its variable or key file (never the keychain: no
/// engine exists yet), only for its own address.
pub fn preset_key(target: &DetectTarget<'_>, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    if !target.own_address {
        return None;
    }
    let preset = target.preset;
    if preset.api_key_env.is_none() && preset.api_key_file.is_none() {
        return None;
    }
    let file = preset.api_key_file.map(|(path, json_path)| ApiKeyFile { path: path.to_string(), json_path: json_path.to_string() });
    let lookup = super::secrets::resolve_key_with_file(&NoStore, &format!("detect:{}", preset.id), preset.api_key_env, file.as_ref(), env);
    lookup.key
}

/// No stored keys: detection never reads the keychain.
struct NoStore;

impl super::secrets::SecretStore for NoStore {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn set(&self, _account: &str, _secret: &str) -> Result<(), String> {
        Ok(())
    }
    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

/// One candidate: the probe, and a few words for the log.
async fn detect_one(
    client: &reqwest::Client,
    candidate: DetectCandidate,
    presets: &[LocalPreset],
    key_for: &(dyn Fn(&DetectTarget<'_>) -> Option<String> + Sync),
) -> (LocalServerProbe, String) {
    let mut probe = LocalServerProbe { preset_id: candidate.preset_id.clone(), base_url: candidate.base_url.clone(), ok: false, models: None, latency_ms: None };
    let Some(target) = detect_target(&candidate, presets) else {
        return (probe, "not a local preset".into());
    };
    let started = Instant::now();
    let (_keep, cancel) = watch::channel(false);
    let work = async {
        match providers::get_json(client, target.preset.kind, &target.url, None, DETECT_TIMEOUT, &cancel).await {
            Err(e) if e.code == ErrorCode::Auth => match key_for(&target) {
                Some(key) => providers::get_json(client, target.preset.kind, &target.url, Some(&key), DETECT_TIMEOUT, &cancel).await,
                None => Err(e),
            },
            other => other,
        }
    };
    let outcome = tokio::time::timeout(DETECT_TIMEOUT, work).await.unwrap_or_else(|_| Err(AiError::new(ErrorCode::Unreachable, "timed out")));
    match outcome {
        Ok(body) => {
            probe.ok = true;
            probe.latency_ms = Some(started.elapsed().as_millis() as u64);
            probe.models = count_models(&body);
            let note = match probe.models {
                Some(n) => format!("ok ({n} model{})", if n == 1 { "" } else { "s" }),
                None => "ok".into(),
            };
            (probe, note)
        }
        Err(e) => {
            let note = match e.code {
                ErrorCode::Unreachable | ErrorCode::Cancelled => "no answer".to_string(),
                ErrorCode::Auth => "needs a key".to_string(),
                other => format!("failed ({})", other.as_str()),
            };
            (probe, note)
        }
    }
}

/// Every candidate at once; one result each, in order, and one log line.
pub async fn detect_all(
    client: &reqwest::Client,
    candidates: Vec<DetectCandidate>,
    presets: &[LocalPreset],
    key_for: &(dyn Fn(&DetectTarget<'_>) -> Option<String> + Sync),
) -> Vec<LocalServerProbe> {
    let runs = candidates.into_iter().take(MAX_CANDIDATES).map(|c| detect_one(client, c, presets, key_for));
    let outcomes = join_all(runs).await;
    let name = |id: &str| presets.iter().find(|p| p.id == id).map(|p| p.name.to_string()).unwrap_or_else(|| if id.is_empty() { "?".into() } else { id.to_string() });
    let line = outcomes.iter().map(|(p, note)| format!("{} {note}", name(&p.preset_id))).collect::<Vec<_>>().join(", ");
    eprintln!("[mikedown ai] Detect local servers: {}.", if line.is_empty() { "nothing asked" } else { &line });
    outcomes.into_iter().map(|(p, _)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn candidate(preset_id: &str, base_url: &str) -> DetectCandidate {
        DetectCandidate { preset_id: preset_id.into(), base_url: base_url.into() }
    }

    #[test]
    fn the_url_is_the_detect_path_under_the_root_or_models() {
        assert_eq!(detect_url("http://127.0.0.1:1234/v1", Some("/api/v0/models")), "http://127.0.0.1:1234/api/v0/models");
        assert_eq!(detect_url("http://127.0.0.1:11434/v1/", Some("/api/tags")), "http://127.0.0.1:11434/api/tags");
        assert_eq!(detect_url("http://127.0.0.1:8000/v1", None), "http://127.0.0.1:8000/v1/models");
    }

    #[test]
    fn only_known_local_presets_at_http_addresses_are_probed() {
        assert!(detect_target(&candidate("anthropic", "https://api.anthropic.com"), LOCAL_PRESETS).is_none());
        assert!(detect_target(&candidate("custom", "http://127.0.0.1:8000/v1"), LOCAL_PRESETS).is_none());
        assert!(detect_target(&candidate("ollama", "file:///etc/passwd"), LOCAL_PRESETS).is_none());
        assert!(detect_target(&candidate("ollama", "http://"), LOCAL_PRESETS).is_none());
        let t = detect_target(&candidate("ollama", "http://127.0.0.1:11434/v1"), LOCAL_PRESETS).unwrap();
        assert_eq!(t.url, "http://127.0.0.1:11434/api/tags");
        assert!(t.own_address);
        assert!(!detect_target(&candidate("omlx", "http://10.0.0.5:8000/v1"), LOCAL_PRESETS).unwrap().own_address);
    }

    #[test]
    fn a_key_goes_only_to_the_presets_own_address() {
        let env = |n: &str| (n == "OMLX_API_KEY").then(|| "k".to_string());
        let own = detect_target(&candidate("omlx", "http://127.0.0.1:8000/v1"), LOCAL_PRESETS).unwrap();
        assert_eq!(preset_key(&own, &env).as_deref(), Some("k"));
        let elsewhere = detect_target(&candidate("omlx", "http://10.0.0.5:8000/v1"), LOCAL_PRESETS).unwrap();
        assert_eq!(preset_key(&elsewhere, &env), None);
        let keyless = detect_target(&candidate("lmstudio", "http://127.0.0.1:1234/v1"), LOCAL_PRESETS).unwrap();
        assert_eq!(preset_key(&keyless, &env), None);
    }

    #[test]
    fn models_are_counted_from_data_or_models_without_embeddings() {
        assert_eq!(count_models(&json!({ "data": [{ "id": "a" }, { "id": "b" }] })), Some(2));
        assert_eq!(count_models(&json!({ "data": [{ "id": "a", "type": "llm" }, { "id": "e", "type": "embeddings" }] })), Some(1));
        assert_eq!(count_models(&json!({ "models": [{ "name": "llama3" }] })), Some(1));
        assert_eq!(count_models(&json!({ "ok": true })), None);
    }
}
