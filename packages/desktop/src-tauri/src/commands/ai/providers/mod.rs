//! Provider adapters: one per engine kind, behind the `ProviderAdapter` trait
//! that mirrors the TypeScript interface in `@mikedown/core/ai`
//! (`listModels`, `probe`, `complete`). The adapters do the HTTP; request
//! bodies, SSE reading and discovery parsing live in the sibling modules
//! (ports of core's pure code, checked against the same fixtures).
//!
//! The trait uses native `async fn` and so is not object safe; `list_models`,
//! `probe` and `complete` at the bottom dispatch on the engine kind.
//!
//! Cancellation is cooperative: every request races a `watch` channel that
//! `ai_cancel` (or closing the window) flips, and dropping the response body
//! closes the connection.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde_json::Value;
use tokio::sync::watch;

use super::discovery;
use super::errors::{code_from_http, from_reqwest, message_from_body, AiError, ErrorCode};
use super::model::{
    CompletionRequest, CompletionResult, DiscoveredModel, EngineConfig, EngineKind, FinishReason, ModelConfig, ProbeOutcome, ServedBy,
};
use super::requests::{auth_headers, build_completion_body, engine_endpoints, unsupported_request_param, without_request_param};
use super::sse::{StreamReader, Utf8Chunker};

pub mod anthropic;
pub mod lmstudio;
pub mod ollama;
pub mod openai;
pub mod openai_compatible;

/// Flipped to true to cancel. A dropped sender never cancels.
pub type Cancel = watch::Receiver<bool>;

/// Local models can think for a long time before the first token, so the wait
/// for the next chunk is generous. Past this the engine counts as unreachable.
pub const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(300);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const DISCOVERY_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// Error bodies are read up to this many bytes.
const ERROR_BODY_LIMIT: usize = 8 * 1024;

/// A client that never follows redirects (an `x-api-key` header would ride
/// along to the new host) and gives up connecting after 10 seconds.
pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(concat!("MikeDown/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
}

pub async fn wait_cancelled(mut cancel: Cancel) {
    loop {
        if *cancel.borrow() {
            return;
        }
        if cancel.changed().await.is_err() {
            // The sender is gone without cancelling: never fires.
            std::future::pending::<()>().await;
        }
    }
}

fn check_url(url: &str) -> Result<(), AiError> {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Ok(())
    } else {
        Err(AiError::new(ErrorCode::Unreachable, format!("\"{url}\" is not an http(s) address.")))
    }
}

async fn read_limited(resp: reqwest::Response) -> String {
    let mut stream = resp.bytes_stream();
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(Ok(chunk)) = stream.next().await {
        bytes.extend_from_slice(&chunk);
        if bytes.len() >= ERROR_BODY_LIMIT {
            bytes.truncate(ERROR_BODY_LIMIT);
            break;
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

async fn failure(resp: reqwest::Response) -> AiError {
    let status = resp.status().as_u16();
    let text = read_limited(resp).await;
    AiError::new(code_from_http(status, &text), message_from_body(status, &text))
}

fn with_headers(mut rb: reqwest::RequestBuilder, headers: Vec<(&'static str, String)>) -> reqwest::RequestBuilder {
    for (k, v) in headers {
        rb = rb.header(k, v);
    }
    rb
}

/// `GET url` with the kind's auth headers; the parsed JSON body.
pub async fn get_json(
    client: &reqwest::Client,
    kind: EngineKind,
    url: &str,
    api_key: Option<&str>,
    timeout: Duration,
    cancel: &Cancel,
) -> Result<Value, AiError> {
    check_url(url)?;
    let rb = with_headers(client.get(url).timeout(timeout), auth_headers(kind, api_key));
    exchange(rb, cancel).await
}

/// `POST url` with a JSON body; the parsed JSON response.
pub async fn post_json(
    client: &reqwest::Client,
    kind: EngineKind,
    url: &str,
    api_key: Option<&str>,
    body: &Value,
    timeout: Duration,
    cancel: &Cancel,
) -> Result<Value, AiError> {
    check_url(url)?;
    let rb = with_headers(client.post(url).timeout(timeout), auth_headers(kind, api_key)).body(body.to_string());
    exchange(rb, cancel).await
}

async fn exchange(rb: reqwest::RequestBuilder, cancel: &Cancel) -> Result<Value, AiError> {
    let work = async {
        let resp = rb.send().await.map_err(|e| from_reqwest(&e))?;
        if !resp.status().is_success() {
            return Err(failure(resp).await);
        }
        resp.json::<Value>().await.map_err(|e| from_reqwest(&e))
    };
    tokio::select! {
        biased;
        _ = wait_cancelled(cancel.clone()) => Err(AiError::cancelled()),
        r = work => r,
    }
}

/// A failed completion, with the request parameter the model rejected when
/// the error body names one (`unsupported_request_param`).
pub struct StreamFailure {
    pub error: AiError,
    pub unsupported_param: Option<String>,
}

impl From<AiError> for StreamFailure {
    fn from(error: AiError) -> Self {
        Self { error, unsupported_param: None }
    }
}

/// Streaming completion against `url`: POST the body, read SSE chunks through
/// the kind's reader, call `on_token` for every text delta.
#[allow(clippy::too_many_arguments)]
pub async fn stream_completion(
    client: &reqwest::Client,
    kind: EngineKind,
    url: &str,
    api_key: Option<&str>,
    body: &Value,
    served: ServedBy,
    cancel: &Cancel,
    on_token: &mut (dyn FnMut(&str) + Send),
) -> Result<CompletionResult, StreamFailure> {
    check_url(url)?;
    let rb = with_headers(client.post(url), auth_headers(kind, api_key)).body(body.to_string());
    let resp = tokio::select! {
        biased;
        _ = wait_cancelled(cancel.clone()) => return Err(AiError::cancelled().into()),
        r = rb.send() => r.map_err(|e| from_reqwest(&e))?,
    };
    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = read_limited(resp).await;
        return Err(StreamFailure {
            error: AiError::new(code_from_http(status, &text), message_from_body(status, &text)),
            unsupported_param: unsupported_request_param(status, &text),
        });
    }

    let mut stream = resp.bytes_stream();
    let mut chunker = Utf8Chunker::default();
    let mut reader = StreamReader::new(kind);
    loop {
        let next = tokio::select! {
            biased;
            _ = wait_cancelled(cancel.clone()) => return Err(AiError::cancelled().into()),
            r = tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.next()) => r,
        };
        match next {
            Err(_) => return Err(AiError::new(ErrorCode::Unreachable, "The engine stopped sending data.").into()),
            Ok(None) => break,
            Ok(Some(Err(e))) => return Err(from_reqwest(&e).into()),
            Ok(Some(Ok(bytes))) => {
                let text = chunker.push(&bytes);
                for delta in reader.push(&text) {
                    on_token(&delta);
                }
            }
        }
    }
    let tail = chunker.finish();
    if !tail.is_empty() {
        for delta in reader.push(&tail) {
            on_token(&delta);
        }
    }
    let outcome = reader.finish();
    if let Some(err) = outcome.error {
        return Err(err.into());
    }
    if outcome.finish_reason == FinishReason::Error && outcome.text.is_empty() {
        return Err(AiError::new(ErrorCode::Unreachable, "The engine closed the connection before answering.").into());
    }
    Ok(CompletionResult { text: outcome.text, served, usage: outcome.usage, finish_reason: outcome.finish_reason })
}

/// Parameters a model rejected this session, by (engine id, base URL, model id).
fn rejected_params() -> &'static Mutex<HashMap<(String, String, String), Vec<String>>> {
    static REJECTED: OnceLock<Mutex<HashMap<(String, String, String), Vec<String>>>> = OnceLock::new();
    REJECTED.get_or_init(Default::default)
}

/// Completion over the engine's `completions` endpoint with the body for its
/// kind. Every kind shares this; they differ in discovery.
///
/// When the model rejects a parameter (a 400 that names `temperature`,
/// `max_tokens` and the like) the request is retried once without it, or
/// with its replacement, and the parameter is remembered for that engine
/// and model for the session, so the next request leaves it out from the
/// start. Mirrors `createChatCompletionsAdapter` in the extension.
#[allow(clippy::too_many_arguments)]
pub async fn complete_streaming(
    client: &reqwest::Client,
    engine: &EngineConfig,
    api_key: Option<&str>,
    model: &ModelConfig,
    req: &CompletionRequest,
    served: ServedBy,
    cancel: &Cancel,
    on_token: &mut (dyn FnMut(&str) + Send),
) -> Result<CompletionResult, AiError> {
    let url = engine_endpoints(engine.kind, &engine.base_url).completions;
    let key = (engine.id.clone(), engine.base_url.clone(), model.id.clone());
    let mut body = build_completion_body(engine.kind, model, req, true);
    let remembered = rejected_params().lock().unwrap().get(&key).cloned().unwrap_or_default();
    for param in &remembered {
        body = without_request_param(&body, param).unwrap_or(body);
    }
    match stream_completion(client, engine.kind, &url, api_key, &body, served.clone(), cancel, on_token).await {
        Ok(result) => Ok(result),
        Err(StreamFailure { error, unsupported_param: Some(param) }) => {
            let Some(retry) = without_request_param(&body, &param) else { return Err(error) };
            rejected_params().lock().unwrap().entry(key).or_default().push(param);
            stream_completion(client, engine.kind, &url, api_key, &retry, served, cancel, on_token).await.map_err(|f| f.error)
        }
        Err(failure) => Err(failure.error),
    }
}

/// `GET {base}/models` on an OpenAI-style server: ids only.
pub async fn list_openai_models(
    client: &reqwest::Client,
    engine: &EngineConfig,
    api_key: Option<&str>,
    cancel: &Cancel,
) -> Result<Vec<DiscoveredModel>, AiError> {
    let url = engine_endpoints(engine.kind, &engine.base_url).models;
    let body = get_json(client, engine.kind, &url, api_key, DISCOVERY_REQUEST_TIMEOUT, cancel).await?;
    Ok(discovery::parse_openai_model_list(&body))
}

/// Host-side adapter shape, mirroring `ProviderAdapter` in `@mikedown/core/ai`.
#[allow(async_fn_in_trait)]
pub trait ProviderAdapter {
    #[cfg_attr(not(test), allow(dead_code))]
    fn kind(&self) -> EngineKind;

    /// Discovery plus whatever capability detail the endpoint gives.
    async fn list_models(
        &self,
        client: &reqwest::Client,
        engine: &EngineConfig,
        api_key: Option<&str>,
        cancel: &Cancel,
    ) -> Result<Vec<DiscoveredModel>, AiError>;

    /// The URL Test connection asks (the cheapest thing that checks reachability and auth).
    fn probe_url(&self, engine: &EngineConfig) -> String {
        engine_endpoints(engine.kind, &engine.base_url).models
    }

    /// Test connection: reachability, auth, latency.
    async fn probe(&self, client: &reqwest::Client, engine: &EngineConfig, api_key: Option<&str>, cancel: &Cancel) -> ProbeOutcome {
        let started = Instant::now();
        let result = get_json(client, engine.kind, &self.probe_url(engine), api_key, PROBE_TIMEOUT, cancel).await;
        let latency_ms = started.elapsed().as_millis() as u64;
        match result {
            Ok(_) => ProbeOutcome { ok: true, latency_ms, error: None },
            Err(error) => ProbeOutcome { ok: false, latency_ms, error: Some(error) },
        }
    }

    /// Streaming completion against one model.
    #[allow(clippy::too_many_arguments)]
    async fn complete(
        &self,
        client: &reqwest::Client,
        engine: &EngineConfig,
        api_key: Option<&str>,
        model: &ModelConfig,
        req: &CompletionRequest,
        served: ServedBy,
        cancel: &Cancel,
        on_token: &mut (dyn FnMut(&str) + Send),
    ) -> Result<CompletionResult, AiError> {
        complete_streaming(client, engine, api_key, model, req, served, cancel, on_token).await
    }
}

pub async fn list_models(client: &reqwest::Client, engine: &EngineConfig, api_key: Option<&str>, cancel: &Cancel) -> Result<Vec<DiscoveredModel>, AiError> {
    match engine.kind {
        EngineKind::OpenAiCompatible => openai_compatible::OpenAiCompatible.list_models(client, engine, api_key, cancel).await,
        EngineKind::LmStudio => lmstudio::LmStudio.list_models(client, engine, api_key, cancel).await,
        EngineKind::Ollama => ollama::Ollama.list_models(client, engine, api_key, cancel).await,
        EngineKind::Anthropic => anthropic::Anthropic.list_models(client, engine, api_key, cancel).await,
        EngineKind::OpenAi => openai::OpenAi.list_models(client, engine, api_key, cancel).await,
    }
}

pub async fn probe(client: &reqwest::Client, engine: &EngineConfig, api_key: Option<&str>, cancel: &Cancel) -> ProbeOutcome {
    match engine.kind {
        EngineKind::OpenAiCompatible => openai_compatible::OpenAiCompatible.probe(client, engine, api_key, cancel).await,
        EngineKind::LmStudio => lmstudio::LmStudio.probe(client, engine, api_key, cancel).await,
        EngineKind::Ollama => ollama::Ollama.probe(client, engine, api_key, cancel).await,
        EngineKind::Anthropic => anthropic::Anthropic.probe(client, engine, api_key, cancel).await,
        EngineKind::OpenAi => openai::OpenAi.probe(client, engine, api_key, cancel).await,
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn complete(
    client: &reqwest::Client,
    engine: &EngineConfig,
    api_key: Option<&str>,
    model: &ModelConfig,
    req: &CompletionRequest,
    served: ServedBy,
    cancel: &Cancel,
    on_token: &mut (dyn FnMut(&str) + Send),
) -> Result<CompletionResult, AiError> {
    match engine.kind {
        EngineKind::OpenAiCompatible => openai_compatible::OpenAiCompatible.complete(client, engine, api_key, model, req, served, cancel, on_token).await,
        EngineKind::LmStudio => lmstudio::LmStudio.complete(client, engine, api_key, model, req, served, cancel, on_token).await,
        EngineKind::Ollama => ollama::Ollama.complete(client, engine, api_key, model, req, served, cancel, on_token).await,
        EngineKind::Anthropic => anthropic::Anthropic.complete(client, engine, api_key, model, req, served, cancel, on_token).await,
        EngineKind::OpenAi => openai::OpenAi.complete(client, engine, api_key, model, req, served, cancel, on_token).await,
    }
}
