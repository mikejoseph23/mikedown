//! Anthropic Messages API. `x-api-key` plus `anthropic-version`; discovery is
//! `GET /v1/models` (paged by `after_id`), which reports context window and
//! the vision and structured-output flags. Requests never carry sampling
//! parameters (see `requests.rs`).

use super::super::discovery::{anthropic_next_page, parse_anthropic_models};
use super::super::errors::AiError;
use super::super::model::{DiscoveredModel, EngineConfig, EngineKind};
use super::super::requests::engine_endpoints;
use super::{get_json, Cancel, ProviderAdapter, DISCOVERY_REQUEST_TIMEOUT};

/// A runaway `has_more` never loops forever.
const MAX_PAGES: usize = 10;

pub struct Anthropic;

impl ProviderAdapter for Anthropic {
    fn kind(&self) -> EngineKind {
        EngineKind::Anthropic
    }

    fn probe_url(&self, engine: &EngineConfig) -> String {
        format!("{}?limit=1", engine_endpoints(engine.kind, &engine.base_url).models)
    }

    async fn list_models(&self, client: &reqwest::Client, engine: &EngineConfig, api_key: Option<&str>, cancel: &Cancel) -> Result<Vec<DiscoveredModel>, AiError> {
        let base = engine_endpoints(engine.kind, &engine.base_url).models;
        let mut models = Vec::new();
        let mut after: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let url = match &after {
                Some(id) => format!("{base}?limit=1000&after_id={id}"),
                None => format!("{base}?limit=1000"),
            };
            let body = get_json(client, engine.kind, &url, api_key, DISCOVERY_REQUEST_TIMEOUT, cancel).await?;
            models.extend(parse_anthropic_models(&body));
            match anthropic_next_page(&body) {
                Some(next) => after = Some(next),
                None => break,
            }
        }
        Ok(models)
    }
}
