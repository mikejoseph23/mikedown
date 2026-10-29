//! Generic OpenAI-compatible servers (oMLX, vLLM, llama.cpp server, and the
//! hosted OpenAI-style APIs behind presets: OpenRouter, Groq, Gemini, Mistral,
//! DeepSeek, xAI). Discovery is `GET {base}/models`, ids only; the webview
//! fills capabilities from core's id heuristics. On a local server
//! `GET {base}/models/status` adds what it knows when it answers (oMLX:
//! loaded state and model types); any failure there keeps the bare list.

use super::super::discovery::{parse_omlx_model_status, with_model_status};
use super::super::errors::{AiError, ErrorCode};
use super::super::locality::{default_local_networks, engine_locality, Locality};
use super::super::model::{DiscoveredModel, EngineConfig, EngineKind};
use super::super::requests::engine_endpoints;
use super::{get_json, list_openai_models, Cancel, ProviderAdapter, PROBE_TIMEOUT};

pub struct OpenAiCompatible;

impl ProviderAdapter for OpenAiCompatible {
    fn kind(&self) -> EngineKind {
        EngineKind::OpenAiCompatible
    }

    async fn list_models(&self, client: &reqwest::Client, engine: &EngineConfig, api_key: Option<&str>, cancel: &Cancel) -> Result<Vec<DiscoveredModel>, AiError> {
        let listed = list_openai_models(client, engine, api_key, cancel).await?;
        if listed.is_empty() || engine_locality(&engine.locality, &engine.base_url, &default_local_networks()) != Locality::Local {
            return Ok(listed);
        }
        let url = format!("{}/status", engine_endpoints(engine.kind, &engine.base_url).models);
        match get_json(client, engine.kind, &url, api_key, PROBE_TIMEOUT, cancel).await {
            Ok(body) => Ok(with_model_status(listed, &parse_omlx_model_status(&body))),
            Err(e) if e.code == ErrorCode::Cancelled => Err(e),
            Err(_) => Ok(listed),
        }
    }
}
