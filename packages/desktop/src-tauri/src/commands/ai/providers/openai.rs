//! OpenAI proper (Chat Completions). The request body differs from the
//! generic kind (`max_completion_tokens`, usage in the stream) and is built
//! by `requests.rs`; discovery is `GET /v1/models`.

use super::super::errors::AiError;
use super::super::model::{DiscoveredModel, EngineConfig, EngineKind};
use super::{list_openai_models, Cancel, ProviderAdapter};

pub struct OpenAi;

impl ProviderAdapter for OpenAi {
    fn kind(&self) -> EngineKind {
        EngineKind::OpenAi
    }

    async fn list_models(&self, client: &reqwest::Client, engine: &EngineConfig, api_key: Option<&str>, cancel: &Cancel) -> Result<Vec<DiscoveredModel>, AiError> {
        list_openai_models(client, engine, api_key, cancel).await
    }
}
