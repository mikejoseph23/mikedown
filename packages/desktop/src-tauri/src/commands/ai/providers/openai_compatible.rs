//! Generic OpenAI-compatible servers (oMLX, vLLM, llama.cpp server, and the
//! hosted OpenAI-style APIs behind presets: OpenRouter, Groq, Gemini, Mistral,
//! DeepSeek, xAI). Discovery is `GET {base}/models`, ids only; the webview
//! fills capabilities from core's id heuristics.

use super::super::errors::AiError;
use super::super::model::{DiscoveredModel, EngineConfig, EngineKind};
use super::{list_openai_models, Cancel, ProviderAdapter};

pub struct OpenAiCompatible;

impl ProviderAdapter for OpenAiCompatible {
    fn kind(&self) -> EngineKind {
        EngineKind::OpenAiCompatible
    }

    async fn list_models(&self, client: &reqwest::Client, engine: &EngineConfig, api_key: Option<&str>, cancel: &Cancel) -> Result<Vec<DiscoveredModel>, AiError> {
        list_openai_models(client, engine, api_key, cancel).await
    }
}
