//! LM Studio: OpenAI-compatible `/v1` for completions, `GET /api/v0/models`
//! for discovery (`type`, `max_context_length`, `state`), plus the sizes from
//! `GET /api/v1/models` when it answers. Falls back to the
//! bare `/v1/models` list when the native endpoint is missing or empty (older
//! builds). Any non-empty key is accepted by the server; JSON mode is
//! `json_schema` (see `requests.rs`).

use std::time::Duration;

use super::super::discovery::{parse_lmstudio_models, parse_model_sizes, with_model_sizes};
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
                        // Sizes are only in the newer `/api/v1/models`; a build without it keeps the list as is.
                        let sizes_url = native.replace("/api/v0/models", "/api/v1/models");
                        return match get_json(client, engine.kind, &sizes_url, api_key, timeout, cancel).await {
                            Ok(sizes) => Ok(with_model_sizes(models, &parse_model_sizes(&sizes))),
                            Err(e) if e.code == ErrorCode::Cancelled => Err(e),
                            Err(_) => Ok(models),
                        };
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
