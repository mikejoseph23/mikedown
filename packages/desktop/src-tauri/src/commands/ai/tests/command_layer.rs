//! The Tauri commands themselves (`ai_complete`, `ai_cancel`, `ai_list_engines`,
//! `ai_test_engine`, `ai_discover_models`, `ai_set_secret`) on Tauri's mock
//! runtime, against the loopback server and an in-memory secret store. Events
//! are read the way the webview reads them: by listening on the window.

use tauri::test::MockRuntime;
use tauri::{Listener, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

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
async fn the_engine_list_says_when_a_key_is_stored_and_names_no_other_source() {
    let h = Harness::new("keysource", settings_for("http://127.0.0.1:9/v1", json!({})));
    let list = || async { serde_json::to_value(ai_list_engines(h.app.handle().clone(), h.state()).await.unwrap()).unwrap() };

    assert!(list().await[0].get("keySource").is_none(), "no key, no source");
    ai_set_secret(h.state(), "e1".into(), Some("sk-1".into())).await.unwrap();
    assert_eq!(list().await[0]["keySource"], "stored");
    ai_set_secret(h.state(), "e1".into(), None).await.unwrap();
    assert!(list().await[0].get("keySource").is_none());
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
    assert!(seen.lock().unwrap().iter().all(|r| r.path == "/v1/models"));

    assert_eq!(ai_test_engine(app.clone(), h.state(), "nope".into()).await.unwrap_err().code, ErrorCode::ModelNotFound);
    assert_eq!(ai_discover_models(app, h.state(), "nope".into()).await.unwrap_err().code, ErrorCode::ModelNotFound);
}
