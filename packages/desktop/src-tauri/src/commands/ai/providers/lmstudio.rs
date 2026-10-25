//! LM Studio: OpenAI-compatible `/v1` for completions, `GET /api/v0/models`
//! for discovery (`type`, `max_context_length`, `state`). Falls back to the
//! bare `/v1/models` list when the native endpoint is missing or empty (older
//! builds). Any non-empty key is accepted by the server; JSON mode is
//! `json_schema` (see `requests.rs`).

use std::time::Duration;

use super::super::discovery::parse_lmstudio_models;
use super::super::errors::{AiError, ErrorCode};
use super::super::model::{DiscoveredModel, EngineConfig, EngineKind};
use super::super::requests::engine_endpoints;
use super::{get_json, list_openai_models, Cancel, ProviderAdapter, DISCOVERY_REQUEST_TIMEOUT};

pub struct LmStudio;

impl ProviderAdapter for LmStudio {
    fn kind(&self) -> EngineKind {
        EngineKind::LmStudio
    }

    async fn list_models(&self, client: &reqwest::Client, engine: &EngineConfig, api_key: Option<&str>, cancel: &Cancel) -> Result<Vec<DiscoveredModel>, AiError> {
        if let Some(native) = engine_endpoints(engine.kind, &engine.base_url).native_models {
            let timeout: Duration = DISCOVERY_REQUEST_TIMEOUT;
            match get_json(client, engine.kind, &native, api_key, timeout, cancel).await {
                Ok(body) => {
                    let models = parse_lmstudio_models(&body);
                    if !models.is_empty() {
                        return Ok(models);
                    }
                }
                // The engine itself is the problem: the fallback would fail the same way.
                Err(e) if matches!(e.code, ErrorCode::Unreachable | ErrorCode::Auth | ErrorCode::Cancelled) => return Err(e),
                Err(_) => {}
            }
        }
        list_openai_models(client, engine, api_key, cancel).await
    }
}
