//! Ollama: OpenAI-compatible `/v1` for completions. Discovery is
//! `GET /api/tags` for the names and sizes, then `POST /api/show` per model for
//! `capabilities` and the context length, and `GET /api/ps` for what is
//! loaded. A failed `show` leaves that model to the id heuristics; a missing
//! `/api/tags` falls back to the bare `/v1/models` list.

use std::collections::HashSet;

use futures_util::{stream, StreamExt};
use serde_json::{json, Value};

use super::super::discovery::{parse_model_sizes, parse_ollama_running, parse_ollama_show, parse_ollama_tags};
use super::super::errors::{AiError, ErrorCode};
use super::super::model::{DiscoveredModel, DiscoverySource, EngineConfig, EngineKind, PartialCapabilities};
use super::super::requests::engine_endpoints;
use super::{get_json, list_openai_models, post_json, Cancel, ProviderAdapter, DISCOVERY_REQUEST_TIMEOUT};

/// `show` calls in flight at once.
const SHOW_CONCURRENCY: usize = 4;

pub struct Ollama;

impl ProviderAdapter for Ollama {
    fn kind(&self) -> EngineKind {
        EngineKind::Ollama
    }

    async fn list_models(&self, client: &reqwest::Client, engine: &EngineConfig, api_key: Option<&str>, cancel: &Cancel) -> Result<Vec<DiscoveredModel>, AiError> {
        let endpoints = engine_endpoints(engine.kind, &engine.base_url);
        let (Some(tags_url), Some(show_url)) = (endpoints.native_models, endpoints.native_show) else {
            return list_openai_models(client, engine, api_key, cancel).await;
        };
        let tags = match get_json(client, engine.kind, &tags_url, api_key, DISCOVERY_REQUEST_TIMEOUT, cancel).await {
            Ok(body) => body,
            Err(e) if matches!(e.code, ErrorCode::Unreachable | ErrorCode::Auth | ErrorCode::Cancelled) => return Err(e),
            Err(_) => return list_openai_models(client, engine, api_key, cancel).await,
        };
        let names = parse_ollama_tags(&tags);
        let sizes = parse_model_sizes(&tags);

        let running: Option<HashSet<String>> = match endpoints.native_running {
            Some(url) => get_json(client, engine.kind, &url, api_key, DISCOVERY_REQUEST_TIMEOUT, cancel)
                .await
                .ok()
                .map(|body: Value| parse_ollama_running(&body)),
            None => None,
        };

        let kind = engine.kind;
        let shown: Vec<DiscoveredModel> = stream::iter(names)
            .map(|name| {
                let show_url = show_url.clone();
                async move {
                    let body = post_json(client, kind, &show_url, api_key, &json!({ "model": name }), DISCOVERY_REQUEST_TIMEOUT, cancel).await;
                    match body {
                        Ok(body) => parse_ollama_show(&name, &body),
                        Err(_) => DiscoveredModel {
                            id: name,
                            label: None,
                            capabilities: PartialCapabilities::default(),
                            source: DiscoverySource::Heuristic,
                            loaded: None,
                            size_bytes: None,
                        },
                    }
                }
            })
            .buffered(SHOW_CONCURRENCY)
            .collect()
            .await;
        if *cancel.borrow() {
            return Err(AiError::cancelled());
        }
        Ok(shown
            .into_iter()
            .map(|mut m| {
                if let Some(r) = &running {
                    m.loaded = Some(r.contains(&m.id));
                }
                if let Some(size) = sizes.get(&m.id) {
                    m.size_bytes = Some(*size);
                }
                m
            })
            .collect())
    }
}
