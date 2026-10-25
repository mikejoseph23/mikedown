//! Tests for the pieces of `ai.rs` that do not need a running Tauri app (the
//! settings slice, the cloud gate, consent storage, request ids, cancel
//! bookkeeping) and the provider adapters against a loopback HTTP server that
//! replays the shared SSE fixtures.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;

use super::errors::ErrorCode;
use super::locality::Locality;
use super::model::{CompletionRequest, EngineConfig, FinishReason, ServedBy};
use super::providers::{self, Cancel, ProviderAdapter};
use super::secrets::MemoryStore;
use super::*;

mod command_layer;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mikedown-ai-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../test/ai-fixtures")
}

fn sse_fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(fixtures().join("sse").join(name)).unwrap()).unwrap()
}

// ── Settings slice ──────────────────────────────────────────────────────────

#[test]
fn engines_and_the_cloud_switch_come_from_flat_ai_keys() {
    let text = json!({
        "fontSize": 18,
        "ai.allowCloud": true,
        "ai.localNetworks": ["10.0.98.0/24", "  "],
        "ai.engines": [
            { "id": "omlx", "name": "oMLX", "kind": "openai-compatible", "baseUrl": "http://127.0.0.1:8000/v1",
              "models": [{ "id": "qwen", "enabled": true, "requestOverrides": { "reasoning_effort": "low" }, "futureKey": 1 }] },
            { "id": "future", "kind": "quantum", "baseUrl": "http://x" },
            { "id": "nourl", "kind": "ollama" },
            { "id": "omlx", "kind": "ollama", "baseUrl": "http://dup" },
            { "id": "claude", "name": "Anthropic", "kind": "anthropic", "baseUrl": "https://api.anthropic.com", "enabled": false },
        ],
    })
    .to_string();
    let config = parse_ai_config(Some(&text));
    assert!(config.allow_cloud);
    assert_eq!(config.local_networks, vec!["10.0.98.0/24".to_string()]);
    let ids: Vec<&str> = config.engines.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, vec!["omlx", "claude"], "unknown kinds, missing URLs and duplicate ids are skipped");
    assert_eq!(config.engines[0].models[0].request_overrides.as_ref().unwrap()["reasoning_effort"], "low");
    assert!(!config.engines[1].enabled);
    assert_eq!(config.engines[1].locality, "auto");
}

#[test]
fn missing_or_broken_settings_mean_no_engines_and_no_cloud() {
    for text in [None, Some(""), Some("{ broken"), Some("[1]"), Some("{}")] {
        let config = parse_ai_config(text);
        assert!(!config.allow_cloud);
        assert!(config.engines.is_empty());
        assert_eq!(config.local_networks, default_local_networks());
    }
    // The nested shape is read too.
    let nested = parse_ai_config(Some(r#"{ "ai": { "allowCloud": true, "engines": [{ "id": "a", "kind": "ollama", "baseUrl": "http://h" }] } }"#));
    assert!(nested.allow_cloud);
    assert_eq!(nested.engines.len(), 1);
}

// ── Cloud gate and consent ──────────────────────────────────────────────────

#[test]
fn the_cloud_gate_needs_both_the_switch_and_consent() {
    assert!(cloud_gate(Locality::Local, false, None).is_ok());
    assert_eq!(cloud_gate(Locality::Cloud, false, Some(true)).unwrap_err().code, ErrorCode::CloudBlocked);
    assert_eq!(cloud_gate(Locality::Cloud, true, None).unwrap_err().code, ErrorCode::ConsentDenied);
    assert_eq!(cloud_gate(Locality::Cloud, true, Some(false)).unwrap_err().code, ErrorCode::ConsentDenied);
    assert!(cloud_gate(Locality::Cloud, true, Some(true)).is_ok());
}

#[test]
fn consent_is_stored_per_folder_and_engine_beside_other_settings() {
    let dir = temp_dir("consent");
    assert!(!read_folder_consent(&dir, "claude"));
    write_folder_consent(&dir, "claude").unwrap();
    assert!(read_folder_consent(&dir, "claude"));
    assert!(!read_folder_consent(&dir, "openai"), "another engine is not covered");

    // Existing keys survive.
    std::fs::write(dir.join(".mikedown/settings.json"), "{\n  \"versioning.keep\": 10,\n  \"ai.consent.claude\": true\n}\n").unwrap();
    write_folder_consent(&dir, "openai").unwrap();
    let text = std::fs::read_to_string(dir.join(".mikedown/settings.json")).unwrap();
    let json: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(json["versioning.keep"], 10);
    assert_eq!(json["ai.consent.claude"], true);
    assert_eq!(json["ai.consent.openai"], true);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_damaged_folder_settings_file_is_not_overwritten_by_consent() {
    let dir = temp_dir("consent-damaged");
    std::fs::create_dir_all(dir.join(".mikedown")).unwrap();
    std::fs::write(dir.join(".mikedown/settings.json"), "{ broken").unwrap();
    assert!(write_folder_consent(&dir, "claude").is_err());
    assert_eq!(std::fs::read_to_string(dir.join(".mikedown/settings.json")).unwrap(), "{ broken");
    assert!(!read_folder_consent(&dir, "claude"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_session_answer_beats_the_file_and_a_decline_is_remembered() {
    let dir = temp_dir("consent-session");
    let state = AiState::with_store(Arc::new(MemoryStore::default()));
    assert_eq!(state.consent_state(Some(&dir), "claude"), None);
    state.remember_consent(Some(&dir), "claude", false);
    assert_eq!(state.consent_state(Some(&dir), "claude"), Some(false));
    // Another folder, and a lone-file window, are asked separately.
    assert_eq!(state.consent_state(None, "claude"), None);
    state.remember_consent(None, "claude", true);
    assert_eq!(state.consent_state(None, "claude"), Some(true));
    // A grant stored in the folder file counts without a session answer.
    write_folder_consent(&dir, "openai").unwrap();
    assert_eq!(state.consent_state(Some(&dir), "openai"), Some(true));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn request_ids_become_event_safe_channel_ids() {
    assert_eq!(channel_id("req-1_a").unwrap(), "req-1_a");
    assert_eq!(channel_id("ai:rewrite/1 x").unwrap(), "ai_rewrite_1_x");
    assert!(channel_id("").is_err());
    assert!(channel_id(&"x".repeat(129)).is_err());
}

#[test]
fn closing_a_window_cancels_only_its_requests() {
    let state = AiState::with_store(Arc::new(MemoryStore::default()));
    let mut receivers = Vec::new();
    for (id, window) in [("a1", "main"), ("a2", "main"), ("b1", "w-2")] {
        let (tx, rx) = watch::channel(false);
        state.inflight.lock().unwrap().insert(id.to_string(), Inflight { window: window.to_string(), cancel: tx });
        receivers.push((id, rx));
    }
    assert_eq!(state.inflight_count(), 3);
    assert_eq!(state.cancel_window("main"), 2);
    let flags: Vec<(&str, bool)> = receivers.iter().map(|(id, rx)| (*id, *rx.borrow())).collect();
    assert_eq!(flags, vec![("a1", true), ("a2", true), ("b1", false)]);
    // `ai_cancel` semantics: only the owner's id matches.
    assert_eq!(state.cancel_where(|key, f| key == "b1" && f.window == "main"), 0);
    assert_eq!(state.cancel_where(|key, f| key == "b1" && f.window == "w-2"), 1);
}

// ── Providers against a loopback server ─────────────────────────────────────

#[derive(Clone, Debug)]
struct Recorded {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

enum Reply {
    Json(u16, Value),
    /// Chunks written one by one as an event stream.
    Sse(Vec<String>),
    /// One chunk, then the connection stays open (a stalled engine).
    SseThenHang(String),
}

type Handler = dyn Fn(&Recorded) -> Reply + Send + Sync;

async fn serve(handler: impl Fn(&Recorded) -> Reply + Send + Sync + 'static) -> (String, Arc<Mutex<Vec<Recorded>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let handler: Arc<Handler> = Arc::new(handler);
    let log = seen.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { return };
            let handler = handler.clone();
            let log = log.clone();
            tokio::spawn(async move {
                let Some(req) = read_request(&mut socket).await else { return };
                log.lock().unwrap().push(req.clone());
                let _ = respond(&mut socket, handler(&req)).await;
            });
        }
    });
    (base, seen)
}

async fn read_request(socket: &mut tokio::net::TcpStream) -> Option<Recorded> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        let n = socket.read(&mut tmp).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.lines();
    let mut first = lines.next()?.split_whitespace();
    let (method, path) = (first.next()?.to_string(), first.next()?.to_string());
    let headers: HashMap<String, String> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
        .collect();
    let want: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < want {
        let n = socket.read(&mut tmp).await.ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    Some(Recorded { method, path, headers, body: String::from_utf8_lossy(&body).into_owned() })
}

async fn write_chunk(socket: &mut tokio::net::TcpStream, data: &str) -> std::io::Result<()> {
    socket.write_all(format!("{:x}\r\n{data}\r\n", data.len()).as_bytes()).await?;
    socket.flush().await
}

async fn respond(socket: &mut tokio::net::TcpStream, reply: Reply) -> std::io::Result<()> {
    match reply {
        Reply::Json(status, body) => {
            let text = body.to_string();
            let head = format!("HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", text.len());
            socket.write_all(head.as_bytes()).await?;
            socket.write_all(text.as_bytes()).await?;
        }
        Reply::Sse(chunks) => {
            socket.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n").await?;
            for chunk in chunks {
                write_chunk(socket, &chunk).await?;
                tokio::time::sleep(Duration::from_millis(3)).await;
            }
            socket.write_all(b"0\r\n\r\n").await?;
        }
        Reply::SseThenHang(first) => {
            socket.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n").await?;
            write_chunk(socket, &first).await?;
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    }
    socket.flush().await
}

fn engine(kind: &str, base: &str) -> EngineConfig {
    serde_json::from_value(json!({
        "id": "e1", "name": "Test engine", "kind": kind, "baseUrl": base,
        "models": [{ "id": "the-model", "enabled": true }],
    }))
    .unwrap()
}

fn request(extra: Value) -> CompletionRequest {
    let mut base = json!({ "requestId": "r1", "feature": "rewrite", "task": "rewrite", "messages": [{ "role": "user", "content": "hello" }] });
    for (k, v) in extra.as_object().unwrap() {
        base[k] = v.clone();
    }
    serde_json::from_value(base).unwrap()
}

fn served() -> ServedBy {
    ServedBy { engine_id: "e1".into(), engine_name: "Test engine".into(), model_id: "the-model".into(), is_local: true }
}

fn never() -> (watch::Sender<bool>, Cancel) {
    watch::channel(false)
}

async fn run(engine: &EngineConfig, key: Option<&str>, req: &CompletionRequest, cancel: &Cancel) -> (Result<super::model::CompletionResult, AiError>, Vec<String>) {
    let client = providers::build_client();
    let mut deltas: Vec<String> = Vec::new();
    let mut on_token = |d: &str| deltas.push(d.to_string());
    let model = engine.models[0].clone();
    let result = providers::complete(&client, engine, key, &model, req, served(), cancel, &mut on_token).await;
    (result, deltas)
}

fn chunks_of(fixture: &Value) -> Vec<String> {
    fixture["chunks"].as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn an_openai_style_stream_reaches_on_token_and_the_result() {
    let fixture = sse_fixture("openai-chat-stream.json");
    let chunks = chunks_of(&fixture);
    let (base, seen) = serve(move |_| Reply::Sse(chunks.clone())).await;
    let eng = engine("openai-compatible", &format!("{base}/v1"));
    let (_tx, cancel) = never();
    let req = request(json!({ "maxTokens": 32, "temperature": 0.1 }));
    let (result, deltas) = run(&eng, Some("secret"), &req, &cancel).await;

    let result = result.unwrap();
    let expected = &fixture["expected"];
    assert_eq!(result.text, expected["text"].as_str().unwrap());
    assert_eq!(result.finish_reason, FinishReason::Stop);
    assert_eq!(deltas.concat(), result.text);
    assert_eq!(result.served.engine_name, "Test engine");
    assert_eq!(result.usage.unwrap().completion_tokens, expected["usage"]["completionTokens"].as_u64());

    let sent = seen.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!((sent[0].method.as_str(), sent[0].path.as_str()), ("POST", "/v1/chat/completions"));
    assert_eq!(sent[0].headers["authorization"], "Bearer secret");
    let body: Value = serde_json::from_str(&sent[0].body).unwrap();
    assert_eq!(body["model"], "the-model");
    assert_eq!(body["stream"], true);
    assert_eq!(body["max_tokens"], 32);
}

#[tokio::test]
async fn an_anthropic_stream_uses_the_messages_api_and_its_headers() {
    let fixture = sse_fixture("anthropic-messages-stream.json");
    let chunks = chunks_of(&fixture);
    let (base, seen) = serve(move |_| Reply::Sse(chunks.clone())).await;
    let eng = engine("anthropic", &base);
    let (_tx, cancel) = never();
    let req = request(json!({ "messages": [{ "role": "system", "content": "be brief" }, { "role": "user", "content": "hi" }], "temperature": 0.9 }));
    let (result, deltas) = run(&eng, Some("sk-ant"), &req, &cancel).await;

    let result = result.unwrap();
    assert_eq!(result.text, fixture["expected"]["text"].as_str().unwrap());
    assert_eq!(deltas.concat(), result.text);
    let sent = seen.lock().unwrap();
    assert_eq!(sent[0].path, "/v1/messages");
    assert_eq!(sent[0].headers["x-api-key"], "sk-ant");
    assert_eq!(sent[0].headers["anthropic-version"], super::requests::ANTHROPIC_API_VERSION);
    assert!(!sent[0].headers.contains_key("authorization"));
    let body: Value = serde_json::from_str(&sent[0].body).unwrap();
    assert_eq!(body["system"], "be brief");
    assert!(body.get("temperature").is_none(), "Anthropic rejects sampling parameters");
}

#[tokio::test]
async fn a_stream_error_event_rejects_with_its_code() {
    let fixture = sse_fixture("anthropic-error-stream.json");
    let chunks = chunks_of(&fixture);
    let (base, _) = serve(move |_| Reply::Sse(chunks.clone())).await;
    let (_tx, cancel) = never();
    let (result, deltas) = run(&engine("anthropic", &base), Some("k"), &request(json!({})), &cancel).await;
    let err = result.unwrap_err();
    assert_eq!(err.code.as_str(), fixture["expected"]["error"]["code"].as_str().unwrap());
    assert!(!deltas.is_empty(), "the delta before the error still streamed");
}

#[tokio::test]
async fn a_truncated_stream_with_text_finishes_as_error_and_without_text_rejects() {
    let fixture = sse_fixture("openai-truncated-stream.json");
    let chunks = chunks_of(&fixture);
    let (base, _) = serve(move |_| Reply::Sse(chunks.clone())).await;
    let (_tx, cancel) = never();
    let (result, _) = run(&engine("openai-compatible", &base), None, &request(json!({})), &cancel).await;
    assert_eq!(result.unwrap().finish_reason, FinishReason::Error);

    let (base, _) = serve(|_| Reply::Sse(vec![])).await;
    let (result, _) = run(&engine("openai-compatible", &base), None, &request(json!({})), &cancel).await;
    assert_eq!(result.unwrap_err().code, ErrorCode::Unreachable);
}

#[tokio::test]
async fn http_failures_map_to_codes_with_the_servers_message() {
    for (status, body, code) in [
        (401, json!({ "error": { "message": "bad key" } }), ErrorCode::Auth),
        (404, json!({ "error": { "message": "no such model" } }), ErrorCode::ModelNotFound),
        (429, json!({}), ErrorCode::RateLimited),
        (400, json!({ "error": { "message": "maximum context length is 8192 tokens" } }), ErrorCode::ContextOverflow),
    ] {
        let (base, _) = serve(move |_| Reply::Json(status, body.clone())).await;
        let (_tx, cancel) = never();
        let (result, _) = run(&engine("openai-compatible", &base), None, &request(json!({})), &cancel).await;
        let err = result.unwrap_err();
        assert_eq!(err.code, code, "status {status}");
        assert!(err.message.starts_with(&format!("HTTP {status}")), "{}", err.message);
    }
}

#[tokio::test]
async fn nothing_listening_is_unreachable_and_a_redirect_is_not_followed() {
    let free = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = free.local_addr().unwrap();
    drop(free);
    let (_tx, cancel) = never();
    let (result, _) = run(&engine("openai-compatible", &format!("http://{addr}/v1")), None, &request(json!({})), &cancel).await;
    assert_eq!(result.unwrap_err().code, ErrorCode::Unreachable);

    // A 302 is an error response, never followed (the key would ride along).
    let (base, seen) = serve(|_| Reply::Json(302, json!({}))).await;
    let (result, _) = run(&engine("openai-compatible", &base), Some("k"), &request(json!({})), &cancel).await;
    assert!(result.is_err());
    assert_eq!(seen.lock().unwrap().len(), 1);

    let bad = engine("openai-compatible", "ftp://example.com");
    let (result, _) = run(&bad, None, &request(json!({})), &cancel).await;
    assert_eq!(result.unwrap_err().code, ErrorCode::Unreachable);
}

#[tokio::test]
async fn cancelling_stops_a_stalled_stream_quickly() {
    let (base, _) = serve(|_| Reply::SseThenHang("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n".to_string())).await;
    let eng = engine("openai-compatible", &base);
    let (tx, cancel) = never();
    let canceller = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        let _ = tx.send(true);
    });
    let started = std::time::Instant::now();
    let (result, deltas) = run(&eng, None, &request(json!({})), &cancel).await;
    canceller.await.unwrap();
    assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
    assert_eq!(deltas, vec!["Hel".to_string()]);
    assert!(started.elapsed() < Duration::from_secs(5));

    // Cancelled before the request starts.
    let (_tx2, already) = watch::channel(true);
    let (result, _) = run(&eng, None, &request(json!({})), &already).await;
    assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
}

#[tokio::test]
async fn probe_reports_ok_latency_and_auth_failures() {
    let (base, seen) = serve(|req| {
        if req.headers.get("authorization").map(String::as_str) == Some("Bearer good") {
            Reply::Json(200, json!({ "data": [] }))
        } else {
            Reply::Json(401, json!({ "error": { "message": "nope" } }))
        }
    })
    .await;
    let eng = engine("openai-compatible", &format!("{base}/v1"));
    let client = providers::build_client();
    let (_tx, cancel) = never();
    let ok = providers::probe(&client, &eng, Some("good"), &cancel).await;
    assert!(ok.ok && ok.error.is_none());
    let bad = providers::probe(&client, &eng, Some("bad"), &cancel).await;
    assert!(!bad.ok);
    assert_eq!(bad.error.unwrap().code, ErrorCode::Auth);
    assert_eq!(seen.lock().unwrap()[0].path, "/v1/models");

    let a = engine("anthropic", &base);
    providers::probe(&client, &a, Some("k"), &cancel).await;
    assert_eq!(seen.lock().unwrap().last().unwrap().path, "/v1/models?limit=1");
}

fn discovery_fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(fixtures().join("discovery").join(name)).unwrap()).unwrap()
}

#[tokio::test]
async fn lmstudio_discovery_uses_the_native_endpoint_then_falls_back() {
    let fixture = discovery_fixture("lmstudio-api-v0-models.json");
    let native = fixture["response"].clone();
    let (base, seen) = serve(move |req| {
        if req.path == "/api/v0/models" { Reply::Json(200, native.clone()) } else { Reply::Json(404, json!({})) }
    })
    .await;
    let client = providers::build_client();
    let (_tx, cancel) = never();
    let eng = engine("lmstudio", &format!("{base}/v1"));
    let models = providers::list_models(&client, &eng, None, &cancel).await.unwrap();
    assert_eq!(serde_json::to_value(&models).unwrap(), fixture["expected"]);
    assert_eq!(seen.lock().unwrap()[0].path, "/api/v0/models");

    // An older LM Studio without /api/v0 still lists its models.
    let (base, _) = serve(|req| {
        if req.path == "/v1/models" { Reply::Json(200, json!({ "data": [{ "id": "old-model" }] })) } else { Reply::Json(404, json!({})) }
    })
    .await;
    let models = providers::list_models(&client, &engine("lmstudio", &base), None, &cancel).await.unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "old-model");
}

#[tokio::test]
async fn ollama_discovery_runs_tags_then_show_per_model_and_marks_loaded() {
    let tags = discovery_fixture("ollama-api-tags.json");
    let show = discovery_fixture("ollama-api-show.json");
    let tags_body = tags["response"].clone();
    let responses = show["responses"].clone();
    let (base, seen) = serve(move |req| match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/tags") => Reply::Json(200, tags_body.clone()),
        ("GET", "/api/ps") => Reply::Json(200, json!({ "models": [{ "name": "gemma3:12b", "model": "gemma3:12b" }] })),
        ("POST", "/api/show") => {
            let name = serde_json::from_str::<Value>(&req.body).unwrap()["model"].as_str().unwrap().to_string();
            Reply::Json(200, responses[name.as_str()].clone())
        }
        _ => Reply::Json(404, json!({})),
    })
    .await;
    let client = providers::build_client();
    let (_tx, cancel) = never();
    let models = providers::list_models(&client, &engine("ollama", &format!("{base}/v1")), None, &cancel).await.unwrap();
    let mut got = serde_json::to_value(&models).unwrap();
    for m in got.as_array_mut().unwrap() {
        let loaded = m.as_object_mut().unwrap().remove("loaded").unwrap();
        assert_eq!(loaded, json!(m["id"] == "gemma3:12b"));
    }
    assert_eq!(got, show["expected"]);
    assert_eq!(seen.lock().unwrap().iter().filter(|r| r.path == "/api/show").count(), 3);
}

#[tokio::test]
async fn anthropic_discovery_follows_pages() {
    let (base, seen) = serve(|req| {
        if req.path.contains("after_id=m1") {
            Reply::Json(200, json!({ "data": [{ "id": "m2", "display_name": "Two" }], "has_more": false }))
        } else {
            Reply::Json(200, json!({ "data": [{ "id": "m1" }], "has_more": true, "last_id": "m1" }))
        }
    })
    .await;
    let client = providers::build_client();
    let (_tx, cancel) = never();
    let models = providers::list_models(&client, &engine("anthropic", &base), Some("k"), &cancel).await.unwrap();
    let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, vec!["m1", "m2"]);
    assert_eq!(models[1].label.as_deref(), Some("Two"));
    assert_eq!(seen.lock().unwrap().len(), 2);
}

#[test]
fn each_adapter_reports_its_kind() {
    use super::model::EngineKind::*;
    assert_eq!(providers::openai_compatible::OpenAiCompatible.kind(), OpenAiCompatible);
    assert_eq!(providers::lmstudio::LmStudio.kind(), LmStudio);
    assert_eq!(providers::ollama::Ollama.kind(), Ollama);
    assert_eq!(providers::anthropic::Anthropic.kind(), Anthropic);
    assert_eq!(providers::openai::OpenAi.kind(), OpenAi);
}
