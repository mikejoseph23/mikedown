//! Serde shapes shared by the AI commands: the part of an engine's settings
//! the Rust side needs, the completion request as it arrives over `invoke`
//! (`AiWireCompletionRequest` in `@mikedown/core/ai`, images as base64), and
//! the results and events that go back.
//!
//! Settings objects carry keys this module does not know (a newer version's);
//! serde ignores them here, and the webview's settings manager keeps them on
//! save, so nothing is lost.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::errors::AiError;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EngineKind {
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible,
    #[serde(rename = "lmstudio")]
    LmStudio,
    #[serde(rename = "ollama")]
    Ollama,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "openai")]
    OpenAi,
}

fn yes() -> bool {
    true
}

fn auto() -> String {
    "auto".to_string()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub id: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Merged into the request body last (OPEN-6).
    #[serde(default)]
    pub request_overrides: Option<Map<String, Value>>,
}

/// A JSON file in the user's home folder holding the engine's key (oMLX's
/// `~/.omlx/settings.json`, `auth.api_key`). Engines are app-wide user
/// settings, so a project folder cannot set this.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyFile {
    pub path: String,
    pub json_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub kind: EngineKind,
    pub base_url: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// `auto`, `local` or `cloud`.
    #[serde(default = "auto")]
    pub locality: String,
    #[serde(default)]
    pub api_key_env: Option<String>,
    /// A malformed value (a missing part, wrong types) is treated as absent, like the webview's parser.
    #[serde(default, deserialize_with = "lenient_key_file")]
    pub api_key_file: Option<ApiKeyFile>,
    #[serde(default)]
    pub models: Vec<ModelConfig>,
}

fn lenient_key_file<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<ApiKeyFile>, D::Error> {
    let value = Option::<Value>::deserialize(d)?;
    Ok(value.and_then(|v| serde_json::from_value::<ApiKeyFile>(v).ok()))
}

impl EngineConfig {
    pub fn display_name(&self) -> &str {
        if self.name.trim().is_empty() {
            &self.base_url
        } else {
            &self.name
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    pub engine_id: String,
    pub model_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MessagePart {
    Text { text: String },
    #[serde(rename_all = "camelCase")]
    Image { mime: String, data_base64: String },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<MessagePart>),
}

impl MessageContent {
    /// Text parts joined by a blank line; images dropped (Anthropic `system`).
    pub fn text(&self) -> String {
        match self {
            MessageContent::Text(t) => t.clone(),
            MessageContent::Parts(parts) => parts
                .iter()
                .filter_map(|p| match p {
                    MessagePart::Text { text } => Some(text.as_str()),
                    MessagePart::Image { .. } => None,
                })
                .collect::<Vec<_>>()
                .join("\n\n"),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: MessageContent,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRequest {
    pub request_id: String,
    /// Feature and task ids are informational (logs, consent copy); routing
    /// is the `route` core already resolved.
    #[serde(default)]
    #[allow(dead_code)]
    pub feature: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub task: String,
    #[serde(default)]
    pub route: Option<Route>,
    pub messages: Vec<Message>,
    /// `text` or `json`.
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub max_tokens: Option<u64>,
    #[serde(default)]
    pub temperature: Option<f64>,
    /// Per-request body fields (the popover's thinking dial), merged over the
    /// model's `requestOverrides` so the request wins. Anything but an object
    /// is ignored.
    #[serde(default)]
    pub request_overrides: Option<Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FinishReason {
    Stop,
    Length,
    /// Part of the shared contract; a cancelled request rejects with `cancelled` instead.
    #[allow(dead_code)]
    Cancelled,
    Error,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServedBy {
    pub engine_id: String,
    pub engine_name: String,
    pub model_id: String,
    pub is_local: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionResult {
    pub text: String,
    pub served: ServedBy,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    pub finish_reason: FinishReason,
}

/// Capability values a discovery endpoint reported; anything absent is filled
/// by the webview from core's id heuristics (`mergeDiscoveredModels`).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vision: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fim: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_tokens: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiscoverySource {
    Endpoint,
    Heuristic,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub capabilities: PartialCapabilities,
    pub source: DiscoverySource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loaded: Option<bool>,
}

/// What `probe` found out.
#[derive(Clone, Debug)]
pub struct ProbeOutcome {
    pub ok: bool,
    pub latency_ms: u64,
    pub error: Option<AiError>,
}

/// One engine as the host last saw it. Models are the webview's business
/// (it owns the saved list); this carries what only the host knows.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub engine_id: String,
    /// Null until the engine has been probed this session.
    pub ok: Option<bool>,
    pub is_local: bool,
    pub has_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    pub info: EngineInfo,
    pub models: Vec<DiscoveredModel>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenEvent {
    pub request_id: String,
    pub delta: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneEvent {
    pub request_id: String,
    pub result: CompletionResult,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEvent {
    pub request_id: String,
    pub code: super::errors::ErrorCode,
    pub message: String,
}
