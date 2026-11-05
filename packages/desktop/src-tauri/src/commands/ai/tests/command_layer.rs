//! The Tauri commands themselves (`ai_complete`, `ai_cancel`, `ai_list_engines`,
//! `ai_test_engine`, `ai_discover_models`, `ai_set_secret`) on Tauri's mock
//! runtime, against the loopback server and an in-memory secret store. Events
//! are read the way the webview reads them: by listening on the window.

use tauri::test::MockRuntime;
use tauri::{Listener, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

use super::super::model::TurnClaim;
use super::*;

/// A mock app whose app-data folder is private to the test, with the global
/// settings file holding `settings`, a "main" window and a memory secret store.
struct Harness {
    app: tauri::App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    data_dir: PathBuf,
}

impl Harness {
    fn new(tag: &str, settings: Value) -> Self {
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().identifier = format!("com.interappdev.mikedown.t3.ai.{tag}");
        let app = tauri::test::mock_builder()
            .manage(AiState::with_store(Arc::new(MemoryStore::default())))
            .build(ctx)
            .expect("mock app");
        let data_dir = app.path().app_data_dir().expect("app data dir");
        let _ = std::fs::remove_dir_all(&data_dir);
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::write(data_dir.join("settings.json"), settings.to_string()).unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into())).build().expect("window");
        Self { app, window, data_dir }
    }

    fn state(&self) -> State<'_, AiState> {
        self.app.state::<AiState>()
    }

    fn other_window(&self) -> WebviewWindow<MockRuntime> {
        WebviewWindowBuilder::new(&self.app, "other", WebviewUrl::App("index.html".into())).build().expect("window")
    }

    async fn complete(&self, body: Value) -> Result<String, AiError> {
        let request: CompletionRequest = serde_json::from_value(body).unwrap();
        ai_complete(self.app.handle().clone(), self.window.clone(), self.state(), request).await
    }

    /// Every `ai-*:<channel>` event of one request, in order, as (kind, payload).
    fn listen(&self, channel: &str) -> UnboundedReceiver<(&'static str, Value)> {
        let (tx, rx) = unbounded_channel();
        for kind in ["token", "done", "error"] {
            let tx = tx.clone();
            self.window.listen(format!("ai-{kind}:{channel}"), move |event| {
                let _ = tx.send((kind, serde_json::from_str(event.payload()).unwrap()));
            });
        }
        rx
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.data_dir);
    }
}

async fn has_key(h: &Harness) -> bool {
    ai_list_engines(h.app.handle().clone(), h.state()).await.unwrap()[0].has_key
}

fn settings_for(base: &str, extra: Value) -> Value {
    let mut settings = json!({
        "ai.engines": [{
            "id": "e1", "name": "Test engine", "kind": "openai-compatible", "baseUrl": base,
            "models": [
                { "id": "the-model", "enabled": true, "requestOverrides": { "reasoning_effort": "low", "chat_template_kwargs": { "x": 1 } } },
                { "id": "off-model", "enabled": false },
            ],
        }],
    });
    for (k, v) in extra.as_object().unwrap() {
        settings[k] = v.clone();
    }
    settings
}

fn completion(id: &str, engine: &str, model: &str) -> Value {
    json!({
        "requestId": id, "feature": "rewrite", "task": "rewrite",
        "route": { "engineId": engine, "modelId": model },
        "messages": [{ "role": "user", "content": "hello" }],
    })
}

async fn next(rx: &mut UnboundedReceiver<(&'static str, Value)>) -> (&'static str, Value) {
    tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.expect("an event in time").expect("channel open")
}

const FIRST_TOKEN: &str = "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n";

#[tokio::test(flavor = "multi_thread")]
async fn ai_complete_streams_tokens_then_done_and_uses_the_stored_key() {
    let fixture = sse_fixture("openai-chat-stream.json");
    let chunks = chunks_of(&fixture);
    let (base, seen) = serve(move |_| Reply::Sse(chunks.clone())).await;
    let h = Harness::new("stream", settings_for(&format!("{base}/v1"), json!({})));

    h.state().secrets.set("e1", "sk-stored").unwrap();
    // Listeners go in before the invoke, as aiHost.ts does.
    let mut rx = h.listen("rewrite_1");
    let channel = h.complete(completion("rewrite:1", "e1", "the-model")).await.unwrap();
    assert_eq!(channel, "rewrite_1", "the channel id is the event-safe request id");
    let mut deltas = Vec::new();
    let done = loop {
        match next(&mut rx).await {
            ("token", payload) => {
                assert_eq!(payload["requestId"], "rewrite:1");
                deltas.push(payload["delta"].as_str().unwrap().to_string());
            }
            ("done", payload) => break payload,
            (kind, payload) => panic!("unexpected {kind} event: {payload}"),
        }
    };
    let expected = &fixture["expected"];
    assert_eq!(done["requestId"], "rewrite:1");
    assert_eq!(done["result"]["text"], expected["text"]);
    assert_eq!(done["result"]["finishReason"], "stop");
    assert_eq!(done["result"]["served"]["engineId"], "e1");
    assert_eq!(done["result"]["served"]["modelId"], "the-model");
    assert_eq!(done["result"]["served"]["isLocal"], true);
    assert_eq!(deltas.concat(), expected["text"].as_str().unwrap());
    assert_eq!(h.state().inflight_count(), 0, "a finished request is no longer cancellable");

    let sent = seen.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].path, "/v1/chat/completions");
    assert_eq!(sent[0].headers["authorization"], "Bearer sk-stored");
    let body: Value = serde_json::from_str(&sent[0].body).unwrap();
    assert_eq!(body["model"], "the-model");
    assert_eq!(body["stream"], true);
    // requestOverrides from the saved model are merged last and deeply.
    assert_eq!(body["reasoning_effort"], "low");
    assert_eq!(body["chat_template_kwargs"], json!({ "x": 1 }));
}

#[tokio::test(flavor = "multi_thread")]
async fn ai_complete_merges_the_request_overrides_over_the_models() {
    let fixture = sse_fixture("openai-chat-stream.json");
    let chunks = chunks_of(&fixture);
    let (base, seen) = serve(move |_| Reply::Sse(chunks.clone())).await;
    let h = Harness::new("thinking", settings_for(&format!("{base}/v1"), json!({})));

    let mut rx = h.listen("think-1");
    let mut req = completion("think-1", "e1", "the-model");
    req["requestOverrides"] = json!({ "reasoning_effort": "high", "chat_template_kwargs": { "enable_thinking": true } });
    h.complete(req).await.unwrap();
    loop {
        match next(&mut rx).await {
            ("token", _) => {}
            ("done", _) => break,
            (kind, payload) => panic!("unexpected {kind} event: {payload}"),
        }
    }
    let sent = seen.lock().unwrap();
    let body: Value = serde_json::from_str(&sent[0].body).unwrap();
    // The model says low; the request wins, and nested objects still merge.
    assert_eq!(body["reasoning_effort"], "high");
    assert_eq!(body["chat_template_kwargs"], json!({ "x": 1, "enable_thinking": true }));
}

#[tokio::test(flavor = "multi_thread")]
async fn ai_cancel_stops_a_stream_mid_flight_and_only_for_its_own_window() {
    let (base, _) = serve(|_| Reply::SseThenHang(FIRST_TOKEN.to_string())).await;
    let h = Harness::new("cancel", settings_for(&format!("{base}/v1"), json!({})));
    let other = h.other_window();

    let mut rx = h.listen("slow-1");
    let channel = h.complete(completion("slow-1", "e1", "the-model")).await.unwrap();
    let (kind, first) = next(&mut rx).await;
    assert_eq!((kind, first["delta"].as_str()), ("token", Some("Hel")));
    assert_eq!(h.state().inflight_count(), 1);

    // A second request with the same id is refused while the first runs.
    let twice = h.complete(completion("slow-1", "e1", "the-model")).await.unwrap_err();
    assert_eq!(twice.code, ErrorCode::Unknown);
    assert_eq!(h.state().inflight_count(), 1);

    // Another window cannot cancel it.
    assert!(!ai_cancel(other, h.state(), channel.clone()));
    assert_eq!(h.state().inflight_count(), 1);

    assert!(ai_cancel(h.window.clone(), h.state(), "slow-1".to_string()), "the id and the channel id both name it");
    let (kind, error) = next(&mut rx).await;
    assert_eq!((kind, error["code"].as_str()), ("error", Some("cancelled")));
    assert_eq!(error["requestId"], "slow-1");
    assert_eq!(h.state().inflight_count(), 0);
    assert!(!ai_cancel(h.window.clone(), h.state(), channel), "cancelling a finished request is not an error");
}

#[tokio::test(flavor = "multi_thread")]
async fn closing_a_window_cancels_its_streams_through_the_state() {
    let (base, _) = serve(|_| Reply::SseThenHang(FIRST_TOKEN.to_string())).await;
    let h = Harness::new("close", settings_for(&format!("{base}/v1"), json!({})));
    let mut rx = h.listen("slow-2");
    h.complete(completion("slow-2", "e1", "the-model")).await.unwrap();
    assert_eq!(next(&mut rx).await.0, "token");
    cancel_window(h.app.handle(), "main");
    let (kind, error) = next(&mut rx).await;
    assert_eq!((kind, error["code"].as_str()), ("error", Some("cancelled")));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failing_engine_arrives_as_an_error_event_with_a_code() {
    let (base, _) = serve(|_| Reply::Json(401, json!({ "error": { "message": "bad key" } }))).await;
    let h = Harness::new("autherr", settings_for(&format!("{base}/v1"), json!({})));
    let mut rx = h.listen("bad-1");
    h.complete(completion("bad-1", "e1", "the-model")).await.unwrap();
    let (kind, error) = next(&mut rx).await;
    assert_eq!((kind, error["code"].as_str()), ("error", Some("auth")));
    assert!(error["message"].as_str().unwrap().contains("bad key"));
    assert_eq!(h.state().inflight_count(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn requests_are_refused_before_any_network_call_when_the_route_or_gate_is_wrong() {
    let (base, seen) = serve(|_| Reply::Json(200, json!({}))).await;
    let mut settings = settings_for(&format!("{base}/v1"), json!({}));
    settings["ai.engines"].as_array_mut().unwrap().push(json!({
        "id": "cloud", "kind": "openai", "baseUrl": "https://api.example.com/v1",
        "models": [{ "id": "gpt", "enabled": true }],
    }));
    let h = Harness::new("gates", settings);

    let code = |r: Result<String, AiError>| r.unwrap_err().code;
    assert_eq!(code(h.complete(completion("a", "nope", "the-model")).await), ErrorCode::ModelNotFound);
    assert_eq!(code(h.complete(completion("b", "e1", "missing")).await), ErrorCode::ModelNotFound);
    assert_eq!(code(h.complete(completion("c", "e1", "off-model")).await), ErrorCode::ModelNotFound);
    let mut no_route = completion("d", "e1", "the-model");
    no_route.as_object_mut().unwrap().remove("route");
    assert_eq!(code(h.complete(no_route).await), ErrorCode::Unknown);
    assert_eq!(code(h.complete(completion("", "e1", "the-model")).await), ErrorCode::Unknown);
    // Cloud engine: blocked by the switch first...
    assert_eq!(code(h.complete(completion("e", "cloud", "gpt")).await), ErrorCode::CloudBlocked);
    assert!(seen.lock().unwrap().is_empty());

    // ...then, with the switch on, by missing consent (no folder, no session answer).
    std::fs::write(h.data_dir.join("settings.json"), {
        let mut s = settings_for(&format!("{base}/v1"), json!({ "ai.allowCloud": true }));
        s["ai.engines"].as_array_mut().unwrap().push(json!({
            "id": "cloud", "kind": "openai", "baseUrl": "https://api.example.com/v1",
            "models": [{ "id": "gpt", "enabled": true }],
        }));
        s.to_string()
    })
    .unwrap();
    assert_eq!(code(h.complete(completion("f", "cloud", "gpt")).await), ErrorCode::ConsentDenied);
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn keys_are_set_and_cleared_through_the_command_and_only_has_key_comes_back() {
    let h = Harness::new("secret", settings_for("http://127.0.0.1:9/v1", json!({})));

    assert!(!has_key(&h).await);
    ai_set_secret(h.state(), "e1".into(), Some("  sk-1  ".into())).await.unwrap();
    assert_eq!(h.state().secrets.get("e1").unwrap().as_deref(), Some("sk-1"), "the key is trimmed");
    assert!(has_key(&h).await);
    let listed = serde_json::to_string(&ai_list_engines(h.app.handle().clone(), h.state()).await.unwrap()).unwrap();
    assert!(!listed.contains("sk-1"), "the key never leaves the host: {listed}");

    ai_set_secret(h.state(), "e1".into(), Some("   ".into())).await.unwrap();
    assert!(!has_key(&h).await, "a blank key deletes");
    ai_set_secret(h.state(), "e1".into(), Some("sk-2".into())).await.unwrap();
    ai_set_secret(h.state(), "e1".into(), None).await.unwrap();
    ai_set_secret(h.state(), "e1".into(), None).await.unwrap();
    assert!(!has_key(&h).await);
    assert!(ai_set_secret(h.state(), " ".into(), Some("k".into())).await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_engine_list_says_when_a_key_is_stored() {
    let h = Harness::new("keysource", settings_for("http://127.0.0.1:9/v1", json!({})));
    let list = || async { serde_json::to_value(ai_list_engines(h.app.handle().clone(), h.state()).await.unwrap()).unwrap() };

    assert!(list().await[0].get("keySource").is_none(), "no key, no source");
    ai_set_secret(h.state(), "e1".into(), Some("sk-1".into())).await.unwrap();
    assert_eq!(list().await[0]["keySource"], "stored");
    ai_set_secret(h.state(), "e1".into(), None).await.unwrap();
    assert!(list().await[0].get("keySource").is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_engine_list_names_a_variable_as_the_key_source() {
    // B1: a key from `apiKeyEnv` is reported as `env`, and a stored key still wins.
    let var = format!("MIKEDOWN_TEST_KEYSOURCE_{}", std::process::id());
    std::env::set_var(&var, "sk-env");
    let engines = json!([{ "id": "e1", "name": "Env engine", "kind": "openai-compatible", "baseUrl": "http://127.0.0.1:9/v1", "apiKeyEnv": var, "models": [] }]);
    let h = Harness::new("keysource-env", settings_for("http://127.0.0.1:9/v1", json!({ "ai.engines": engines })));
    let list = || async { serde_json::to_value(ai_list_engines(h.app.handle().clone(), h.state()).await.unwrap()).unwrap() };

    let first = list().await;
    assert_eq!((&first[0]["hasKey"], &first[0]["keySource"]), (&json!(true), &json!("env")));
    ai_set_secret(h.state(), "e1".into(), Some("sk-stored".into())).await.unwrap();
    assert_eq!(list().await[0]["keySource"], "stored");
    std::env::remove_var(&var);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_model_fetch_alone_marks_the_engine_reached() {
    // F8: a successful discovery is a successful test, latency included.
    let (base, _seen) = serve(|_| Reply::Json(200, json!({ "data": [{ "id": "m1" }] }))).await;
    let h = Harness::new("discover-probe", settings_for(&format!("{base}/v1"), json!({})));
    let app = h.app.handle().clone();

    let found = ai_discover_models(app.clone(), h.state(), "e1".into()).await.unwrap();
    assert_eq!(found.info.ok, Some(true));
    assert!(found.info.latency_ms.is_some());
    let listed = &ai_list_engines(app, h.state()).await.unwrap()[0];
    assert_eq!((listed.ok, listed.latency_ms.is_some()), (Some(true), true));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_and_discover_report_status_and_remember_it_for_the_engine_list() {
    let (base, seen) = serve(|req| {
        if req.headers.get("authorization").map(String::as_str) == Some("Bearer good") {
            Reply::Json(200, json!({ "data": [{ "id": "m1" }, { "id": "m2" }] }))
        } else {
            Reply::Json(401, json!({ "error": { "message": "nope" } }))
        }
    })
    .await;
    let h = Harness::new("status", settings_for(&format!("{base}/v1"), json!({})));
    let app = h.app.handle().clone();

    let before = ai_list_engines(app.clone(), h.state()).await.unwrap();
    assert_eq!((before[0].ok, before[0].is_local, before[0].has_key), (None, true, false));

    let failed = ai_test_engine(app.clone(), h.state(), "e1".into()).await.unwrap();
    assert_eq!(failed.ok, Some(false));
    assert!(failed.error.unwrap().contains("nope"));
    let rejected = ai_discover_models(app.clone(), h.state(), "e1".into()).await.unwrap_err();
    assert_eq!(rejected.code, ErrorCode::Auth);

    ai_set_secret(h.state(), "e1".into(), Some("good".into())).await.unwrap();
    let ok = ai_test_engine(app.clone(), h.state(), "e1".into()).await.unwrap();
    assert_eq!((ok.ok, ok.has_key, ok.error), (Some(true), true, None));
    assert!(ok.latency_ms.is_some());
    let found = ai_discover_models(app.clone(), h.state(), "e1".into()).await.unwrap();
    let ids: Vec<&str> = found.models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, vec!["m1", "m2"]);
    assert_eq!(found.info.ok, Some(true));
    assert_eq!(ai_list_engines(app.clone(), h.state()).await.unwrap()[0].ok, Some(true));
    // Discovery on a local server also asks for `/models/status` (oMLX's loaded state).
    assert!(seen.lock().unwrap().iter().all(|r| r.path == "/v1/models" || r.path == "/v1/models/status"));

    assert_eq!(ai_test_engine(app.clone(), h.state(), "nope".into()).await.unwrap_err().code, ErrorCode::ModelNotFound);
    assert_eq!(ai_discover_models(app, h.state(), "nope".into()).await.unwrap_err().code, ErrorCode::ModelNotFound);
}

// ── Setup wizard commands (T1) ──────────────────────────────────────────────

fn candidate(preset: &str, base_url: &str) -> detect::DetectCandidate {
    detect::DetectCandidate { preset_id: preset.into(), base_url: base_url.into() }
}

/// An address nothing listens on.
async fn dead_url() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    drop(listener);
    url
}

/// A server that accepts connections and never says a word.
async fn silent_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let mut held = Vec::new();
        loop {
            let Ok((socket, _)) = listener.accept().await else { return };
            held.push(socket);
        }
    });
    url
}

#[tokio::test(flavor = "multi_thread")]
async fn ai_detect_local_servers_answers_one_probe_per_candidate_in_order_and_asks_again_every_time() {
    let (lms, seen) = serve(|_| Reply::Json(200, json!({ "data": [{ "id": "a", "type": "llm" }, { "id": "e", "type": "embeddings" }] }))).await;
    let dead = dead_url().await;
    let h = Harness::new("detect-order", settings_for(&format!("{lms}/v1"), json!({})));
    let lms_url = format!("{lms}/v1");

    let probes = ai_detect_local_servers(h.state(), vec![candidate("ollama", &dead), candidate("lmstudio", &lms_url)]).await.unwrap();
    let wire = serde_json::to_value(&probes).unwrap();
    // Core's AiLocalServerProbe, camelCase; a silent address carries no models or latency.
    assert_eq!(wire[0], json!({ "presetId": "ollama", "baseUrl": dead, "ok": false }));
    assert_eq!((wire[1]["presetId"].clone(), wire[1]["ok"].clone(), wire[1]["models"].clone()), (json!("lmstudio"), json!(true), json!(1)));
    assert!(wire[1]["latencyMs"].is_u64());
    assert_eq!(seen.lock().unwrap()[0].path, "/api/v0/models");
    assert_eq!(seen.lock().unwrap()[0].method, "GET");

    // Nothing is remembered: a second look is a second request.
    ai_detect_local_servers(h.state(), vec![candidate("lmstudio", &lms_url)]).await.unwrap();
    assert_eq!(seen.lock().unwrap().len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn ai_detect_local_servers_caps_a_silent_address_at_the_timeout_and_answers_the_others_meanwhile() {
    let silent = silent_server().await;
    let (fast, _) = serve(|_| Reply::Json(200, json!({ "models": [{ "name": "llama3" }] }))).await;
    let h = Harness::new("detect-timeout", settings_for(&format!("{fast}/v1"), json!({})));

    let started = std::time::Instant::now();
    let probes = ai_detect_local_servers(
        h.state(),
        vec![candidate("lmstudio", &format!("{silent}/v1")), candidate("ollama", &format!("{fast}/v1"))],
    )
    .await
    .unwrap();
    let elapsed = started.elapsed();

    assert!(!probes[0].ok && probes[0].models.is_none() && probes[0].latency_ms.is_none());
    assert!(probes[1].ok && probes[1].models == Some(1));
    // Both ran at once, so the whole look took one cap, not two, and not the 30 s a stuck server would hold.
    assert!(elapsed >= detect::DETECT_TIMEOUT - Duration::from_millis(100), "gave up too early: {elapsed:?}");
    assert!(elapsed < detect::DETECT_TIMEOUT + Duration::from_millis(1200), "waited too long: {elapsed:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn ai_detect_local_servers_makes_no_request_for_what_is_not_a_local_preset_and_looks_at_32_at_most() {
    let (fast, seen) = serve(|_| Reply::Json(200, json!({ "models": [] }))).await;
    let h = Harness::new("detect-refuse", settings_for(&format!("{fast}/v1"), json!({})));

    let refused = ai_detect_local_servers(
        h.state(),
        vec![
            candidate("anthropic", "https://api.anthropic.com"),
            candidate("custom", &format!("{fast}/v1")),
            candidate("ollama", "file:///etc/passwd"),
            candidate("ollama", "http://"),
            candidate("", ""),
        ],
    )
    .await
    .unwrap();
    assert_eq!(refused.iter().map(|p| p.preset_id.as_str()).collect::<Vec<_>>(), vec!["anthropic", "custom", "ollama", "ollama", ""]);
    assert!(refused.iter().all(|p| !p.ok));
    assert!(seen.lock().unwrap().is_empty());

    let many = (0..40).map(|_| candidate("ollama", &format!("{fast}/v1"))).collect();
    assert_eq!(ai_detect_local_servers(h.state(), many).await.unwrap().len(), 32);
}

#[tokio::test(flavor = "multi_thread")]
async fn ai_detect_local_servers_does_not_send_a_key_to_a_server_that_did_not_ask_for_one() {
    // The first GET carries no key at all, whatever the preset could supply.
    let (omlx, seen) = serve(|_| Reply::Json(200, json!({ "data": [{ "id": "m" }] }))).await;
    let h = Harness::new("detect-nokey", settings_for(&format!("{omlx}/v1"), json!({})));
    let probes = ai_detect_local_servers(h.state(), vec![candidate("omlx", &format!("{omlx}/v1"))]).await.unwrap();
    assert!(probes[0].ok);
    let requests = seen.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(!requests[0].headers.contains_key("authorization"));
}

#[tokio::test(flavor = "multi_thread")]
async fn ai_hardware_info_answers_cores_shape_and_the_same_answer_every_time() {
    let first = ai_hardware_info().await.unwrap();
    let wire = serde_json::to_value(&first).unwrap();
    for key in ["arch", "platform", "totalMemoryBytes", "appleSilicon"] {
        assert!(wire.get(key).is_some(), "missing {key}");
    }
    assert!(wire["totalMemoryBytes"].as_u64().unwrap() > 0);
    assert!(["darwin", "win32", "linux"].contains(&wire["platform"].as_str().unwrap()));
    assert_eq!(first.apple_silicon, cfg!(all(target_os = "macos", target_arch = "aarch64")));
    if first.apple_silicon {
        // The GPU shares the memory, so the card reads as the whole of it.
        let gpu = first.gpu.clone().expect("apple gpu");
        assert_eq!((gpu.vendor.as_str(), gpu.vram_bytes), ("apple", Some(first.total_memory_bytes)));
    }
    assert_eq!(ai_hardware_info().await.unwrap(), first);
}

// ── "Allow once" over a chat turn (the twin of test/unit/ai-consent-turn.test.ts) ──

/// A cloud engine that really lives on the loopback server, and a base with a
/// name for the dialog to find.
fn turn_settings(base: &str) -> Value {
    json!({
        "ai.allowCloud": true,
        "ai.engines": [
            { "id": "cloud", "name": "Cloud", "kind": "openai", "baseUrl": format!("{base}/v1"), "locality": "cloud", "models": [{ "id": "gpt", "enabled": true }] },
            { "id": "other", "name": "Other", "kind": "openai", "baseUrl": format!("{base}/v1"), "locality": "cloud", "models": [{ "id": "gpt", "enabled": true }] },
            { "id": "here", "name": "Here", "kind": "openai", "baseUrl": format!("{base}/v1"), "locality": "local", "models": [{ "id": "gpt", "enabled": true }] },
        ],
        "ai.docBases": [{ "id": "b", "name": "Handbook", "roots": ["/tmp/mikedown-handbook"], "enabled": true, "allowCloud": true }],
    })
}

fn turn_request(id: &str, turn: &str) -> Value {
    json!({
        "requestId": id, "feature": "chat", "task": "docs",
        "route": { "engineId": "cloud", "modelId": "gpt" },
        "messages": [{ "role": "user", "content": "pages" }],
        "turn": { "id": turn, "sends": "docsBase", "baseIds": ["b"], "isLocal": false },
    })
}

fn claim(turn: &str) -> TurnClaim {
    serde_json::from_value(json!({ "id": turn, "sends": "docsBase", "baseIds": ["b"], "isLocal": false })).unwrap()
}

async fn ask_for_turn(h: &Harness, turn: &str) -> Answer {
    ai_request_cloud_consent(
        h.app.handle().clone(),
        h.window.clone(),
        h.state(),
        "cloud".to_string(),
        Some("chat".to_string()),
        Some("docsBase".to_string()),
        Some(vec!["b".to_string()]),
        Some(turn.to_string()),
    )
    .await
    .unwrap()
}

impl Harness {
    fn answer_dialogs(&self, answer: Answer) {
        *self.state().dialog_answer.lock().unwrap() = answer;
    }

    fn dialogs(&self) -> Vec<String> {
        self.state().dialogs.lock().unwrap().clone()
    }

    /// One request of a turn, to the end of its events.
    async fn finish(&self, body: Value) -> Result<&'static str, AiError> {
        let channel = channel_id(body["requestId"].as_str().unwrap()).unwrap();
        let mut rx = self.listen(&channel);
        self.complete(body).await?;
        loop {
            match next(&mut rx).await {
                ("token", _) => {}
                (kind, _) => return Ok(kind),
            }
        }
    }
}

async fn turn_harness(tag: &str) -> (Harness, Arc<Mutex<Vec<Recorded>>>) {
    let chunks = chunks_of(&sse_fixture("openai-chat-stream.json"));
    let (base, seen) = serve(move |_| Reply::Sse(chunks.clone())).await;
    (Harness::new(tag, turn_settings(&base)), seen)
}

#[tokio::test(flavor = "multi_thread")]
async fn allow_once_covers_a_three_hop_turn_and_asks_once() {
    let (h, seen) = turn_harness("turn-three").await;
    h.answer_dialogs(Answer::AllowOnce);
    assert_eq!(ask_for_turn(&h, "A").await, Answer::AllowOnce);
    for id in ["hop-1", "hop-2", "hop-3", "answer"] {
        assert_eq!(h.finish(turn_request(id, "A")).await.unwrap(), "done", "{id}");
    }
    assert_eq!(seen.lock().unwrap().len(), 4);
    let dialogs = h.dialogs();
    assert_eq!(dialogs.len(), 1, "one dialog for the whole turn");
    assert!(dialogs[0].contains("Handbook"), "{}", dialogs[0]);
    assert!(!consent_store::store_path(&h.data_dir).exists(), "Allow once is not stored");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_second_turn_asks_again() {
    let (h, _seen) = turn_harness("turn-second").await;
    h.answer_dialogs(Answer::AllowOnce);
    ask_for_turn(&h, "A").await;
    h.finish(turn_request("a1", "A")).await.unwrap();
    ai_end_turn(h.window.clone(), h.state(), "A".to_string());
    assert_eq!(h.dialogs().len(), 1);
    assert_eq!(ask_for_turn(&h, "B").await, Answer::AllowOnce);
    assert_eq!(h.dialogs().len(), 2);
    h.finish(turn_request("b1", "B")).await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn allow_for_the_folder_or_session_is_not_a_turn_grant_and_asks_once_as_before() {
    let (h, _seen) = turn_harness("turn-allow").await;
    h.answer_dialogs(Answer::Allow);
    assert_eq!(ask_for_turn(&h, "A").await, Answer::Allow);
    assert_eq!(ask_for_turn(&h, "B").await, Answer::Allow);
    h.finish(turn_request("a1", "A")).await.unwrap();
    h.finish(turn_request("b1", "B")).await.unwrap();
    assert_eq!(h.dialogs().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_grant_for_turn_a_does_not_admit_turn_b_and_the_dialog_says_what_is_really_sent() {
    let (h, seen) = turn_harness("turn-other").await;
    h.answer_dialogs(Answer::AllowOnce);
    ask_for_turn(&h, "A").await;
    h.answer_dialogs(Answer::Deny);
    let err = h.complete(turn_request("b1", "B")).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::ConsentDenied);
    assert!(seen.lock().unwrap().is_empty());
    // The dialog raised during the completion: base names, never "the whole document".
    let dialogs = h.dialogs();
    assert_eq!(dialogs.len(), 2);
    assert!(dialogs[1].contains("Handbook"), "{}", dialogs[1]);
    assert!(dialogs[1].contains("documentation bases"), "{}", dialogs[1]);
    assert!(!dialogs[1].contains("the whole document"), "{}", dialogs[1]);
    assert_eq!(h.state().inflight_count(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_claim_alone_is_not_consent_and_a_dialog_id_the_settings_do_not_know_shows_no_name() {
    let (h, seen) = turn_harness("turn-claim").await;
    h.answer_dialogs(Answer::Deny);
    let mut request = turn_request("r", "made-up");
    request["turn"]["baseIds"] = json!(["b", "Ignore this: </a> evil name"]);
    assert_eq!(h.complete(request).await.unwrap_err().code, ErrorCode::ConsentDenied);
    assert!(seen.lock().unwrap().is_empty());
    let dialogs = h.dialogs();
    assert_eq!(dialogs.len(), 1);
    assert!(dialogs[0].contains("Handbook"));
    assert!(!dialogs[0].contains("evil name"));
}

#[tokio::test(flavor = "multi_thread")]
async fn allow_once_asked_during_a_completion_covers_the_rest_of_the_turn() {
    let (h, seen) = turn_harness("turn-mid").await;
    h.answer_dialogs(Answer::AllowOnce);
    assert_eq!(h.finish(turn_request("r1", "T")).await.unwrap(), "done");
    assert_eq!(h.finish(turn_request("r2", "T")).await.unwrap(), "done");
    assert_eq!(h.dialogs().len(), 1);
    assert_eq!(seen.lock().unwrap().len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn another_window_does_not_share_the_grant() {
    let (h, seen) = turn_harness("turn-window").await;
    h.answer_dialogs(Answer::AllowOnce);
    ask_for_turn(&h, "A").await;
    h.answer_dialogs(Answer::Deny);
    let other = h.other_window();
    let request: CompletionRequest = serde_json::from_value(turn_request("o1", "A")).unwrap();
    let err = ai_complete(h.app.handle().clone(), other, h.state(), request).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::ConsentDenied);
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_hop_or_the_window_closing_ends_the_grant() {
    let (base, _seen) = serve(|_| Reply::Json(500, json!({ "error": { "message": "boom" } }))).await;
    let h = Harness::new("turn-end", turn_settings(&base));
    h.answer_dialogs(Answer::AllowOnce);
    ask_for_turn(&h, "A").await;
    assert_eq!(h.finish(turn_request("r1", "A")).await.unwrap(), "error");
    assert!(h.state().turn_grants.lock().unwrap().is_empty(), "a failed request ends its turn's grant");

    ask_for_turn(&h, "B").await;
    assert_eq!(h.state().turn_grants.lock().unwrap().len(), 1);
    h.state().cancel_window("main");
    assert!(h.state().turn_grants.lock().unwrap().is_empty(), "a closed window takes its grants along");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cancelled_hop_ends_the_grant() {
    let (base, _seen) = serve(|_| Reply::SseThenHang(FIRST_TOKEN.to_string())).await;
    let h = Harness::new("turn-cancel", turn_settings(&base));
    h.answer_dialogs(Answer::AllowOnce);
    ask_for_turn(&h, "A").await;
    let mut rx = h.listen("r1");
    h.complete(turn_request("r1", "A")).await.unwrap();
    assert_eq!(next(&mut rx).await.0, "token");
    assert!(ai_cancel(h.window.clone(), h.state(), "r1".to_string()));
    assert_eq!(next(&mut rx).await.0, "error");
    assert!(h.state().turn_grants.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn forgetting_the_consent_ends_the_grant() {
    let (h, _seen) = turn_harness("turn-forget").await;
    h.answer_dialogs(Answer::AllowOnce);
    ask_for_turn(&h, "A").await;
    ai_forget_consent(h.app.handle().clone(), h.window.clone(), h.state(), "cloud".to_string()).await.unwrap();
    assert!(h.state().turn_grants.lock().unwrap().is_empty());
    ask_for_turn(&h, "B").await;
    ai_forget_engine_consents(h.app.handle().clone(), h.state(), vec!["cloud".to_string()]).await.unwrap();
    assert!(h.state().turn_grants.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_local_engine_re_pointed_to_the_cloud_under_the_same_id_fails_the_pin() {
    let (h, seen) = turn_harness("turn-pin").await;
    // Routed while local; "cloud" is what the settings say now.
    let mut moved = turn_request("r1", "T");
    moved["turn"]["isLocal"] = json!(true);
    let err = h.complete(moved).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::Unknown);
    assert!(err.message.contains("moved between local and cloud"), "{}", err.message);
    assert!(h.dialogs().is_empty(), "it fails before any dialog");
    // And the other way.
    let mut back = turn_request("r2", "T");
    back["route"]["engineId"] = json!("here");
    let err = h.complete(back).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::Unknown);
    assert!(seen.lock().unwrap().is_empty());
    // A local engine still routed as local runs, with nothing asked.
    let mut local = turn_request("r3", "T");
    local["route"]["engineId"] = json!("here");
    local["turn"]["isLocal"] = json!(true);
    assert_eq!(h.finish(local).await.unwrap(), "done");
    assert!(h.dialogs().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_request_outside_a_turn_behaves_as_before() {
    let (h, seen) = turn_harness("turn-none").await;
    let engine = find_engine(&load_config(h.app.handle()).unwrap(), "cloud").unwrap().clone();
    h.state().remember_consent(&h.data_dir, None, &engine, Answer::AllowOnce);
    assert_eq!(h.finish(completion("r1", "cloud", "gpt")).await.unwrap(), "done");
    // Used up, and no dialog raised: it fails closed, as it always has.
    assert_eq!(h.complete(completion("r2", "cloud", "gpt")).await.unwrap_err().code, ErrorCode::ConsentDenied);
    assert!(h.dialogs().is_empty());
    assert_eq!(seen.lock().unwrap().len(), 1);
}

#[test]
fn a_grant_fits_one_engine_one_scope_one_set_of_bases_and_one_turn_only() {
    let state = AiState::new();
    let cloud = cloud_engine("cloud", "https://api.example.com/v1");
    let bases = vec!["b".to_string(), "c".to_string()];
    let grant = |turn: &str| state.grant_turn("main", turn, &cloud, Some("chat"), Some("docsBase"), &bases);
    let both = |turn: &str| -> TurnClaim {
        serde_json::from_value(json!({ "id": turn, "sends": "docsBase", "baseIds": ["c", "b", "c"], "isLocal": false })).unwrap()
    };

    grant("A");
    assert!(state.use_turn_grant("main", &cloud, "chat", &both("A")), "the order and repeats of the ids do not matter");
    assert!(state.use_turn_grant("main", &cloud, "chat", &both("A")), "and it is not used up");
    assert!(!state.use_turn_grant("main", &cloud, "chat", &both("B")), "another turn");
    assert!(state.use_turn_grant("main", &cloud, "chat", &both("A")), "which leaves A's alone");
    assert!(!state.use_turn_grant("other", &cloud, "chat", &both("A")), "another window");

    // Each of these ends it too.
    let check = |engine: &EngineConfig, feature: &str, claim: TurnClaim, why: &str| {
        grant("A");
        assert!(!state.use_turn_grant("main", engine, feature, &claim), "{why}");
        assert!(!state.use_turn_grant("main", &cloud, "chat", &both("A")), "{why}: the mismatch ended it");
    };
    check(&cloud_engine("other", "https://api.example.com/v1"), "chat", both("A"), "another engine");
    check(&cloud_engine("cloud", "https://elsewhere.example.com/v1"), "chat", both("A"), "the engine points elsewhere now");
    check(&cloud, "rewrite", both("A"), "another feature");
    check(&cloud, "chat", claim("A"), "a different set of bases");
    let mut scope = both("A");
    scope.sends = Some("selection".to_string());
    check(&cloud, "chat", scope, "another scope");

    grant("A");
    for use_n in 0..TURN_GRANT_MAX_USES {
        assert!(state.use_turn_grant("main", &cloud, "chat", &both("A")), "use {use_n}");
    }
    assert!(!state.use_turn_grant("main", &cloud, "chat", &both("A")), "past what one turn can use");
    assert_eq!(TURN_GRANT_MAX_USES, 11, "core's AI_TURN_GRANT_MAX_USES");

    grant("A");
    state.end_turn("main", "A");
    assert!(!state.use_turn_grant("main", &cloud, "chat", &both("A")));
}

#[test]
fn allow_once_for_a_turn_and_for_the_next_completion_do_not_mix() {
    let base = temp_dir("turn-mix-base");
    let state = AiState::new();
    let cloud = cloud_engine("cloud", "https://api.example.com/v1");

    // The next completion's grant, from a rewrite's dialog, says nothing about base pages.
    state.remember_consent(&base, None, &cloud, Answer::AllowOnce);
    assert_eq!(state.take_turn_consent(&base, None, "main", &cloud, "chat", &claim("T")), None);
    assert_eq!(state.take_consent(&base, None, &cloud), Some(Answer::AllowOnce), "and the turn did not spend it");

    // A turn's grant is for that turn's requests alone.
    state.grant_turn("main", "T", &cloud, Some("chat"), Some("docsBase"), &["b".to_string()]);
    assert_eq!(state.take_consent(&base, None, &cloud), None);
    assert_eq!(state.take_turn_consent(&base, None, "main", &cloud, "chat", &claim("T")), Some(Answer::AllowOnce));
    assert_eq!(state.take_turn_consent(&base, None, "main", &cloud, "chat", &claim("T")), Some(Answer::AllowOnce), "and more than once");
    assert!(cloud_gate(Locality::Cloud, true, Some(Answer::AllowOnce)).is_ok());
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn the_pin_gate_compares_the_locality_either_way_and_a_claim_is_bounded() {
    let local: TurnClaim = serde_json::from_value(json!({ "id": "T", "isLocal": true })).unwrap();
    let no_word: TurnClaim = serde_json::from_value(json!({ "id": "T" })).unwrap();
    assert!(turn_locality_gate(Some(&local), Locality::Local, "e").is_ok());
    assert!(turn_locality_gate(Some(&local), Locality::Cloud, "e").is_err());
    assert!(turn_locality_gate(Some(&claim("T")), Locality::Local, "e").is_err());
    assert!(turn_locality_gate(Some(&no_word), Locality::Cloud, "e").is_ok());
    assert!(turn_locality_gate(None, Locality::Cloud, "e").is_ok());

    assert!(check_turn_claim(&claim("T")).is_ok());
    assert!(check_turn_claim(&claim("")).is_err());
    assert!(check_turn_claim(&claim(&"x".repeat(201))).is_err());
    let many: TurnClaim = serde_json::from_value(json!({ "id": "T", "baseIds": vec!["b"; 51] })).unwrap();
    assert!(check_turn_claim(&many).is_err());
}
