//! AI inference engines (see `ai-inference-engines-plan.md`, M4).
//!
//! All network traffic to an AI engine goes through this module and nowhere
//! else: the webview never sees an API key or opens a socket to an engine. It
//! calls these commands through `src/host/aiApi.ts`.
//!
//! - `ai_complete(request) -> channel id` returns at once and runs the request
//!   on its own task. Text deltas stream to the calling window as
//!   `ai-token:<id>` events, then exactly one `ai-done:<id>` (the
//!   `AiCompletionResult`) or `ai-error:<id>` (`{ code, message }`). The id is
//!   the request id with characters Tauri does not allow in event names
//!   replaced by `_`, so the webview can listen before it invokes. The
//!   request's optional `requestOverrides` (the popover's thinking dial) merge
//!   over the model's own when the body is built, so the request wins.
//! - `ai_cancel(id)` stops one of the calling window's requests; closing a
//!   window cancels all of its requests.
//! - `ai_list_engines`, `ai_test_engine`, `ai_discover_models`: engine status
//!   and discovery. The webview owns the saved model list and merges the
//!   discovered models with core's capability heuristics.
//! - `ai_set_secret(id, key)`: the OS keychain (service `net.iadev.mikedown`,
//!   account = engine id). Keys never come back out.
//! - `ai_request_cloud_consent(id)`: a native dialog (not webview UI, so a
//!   shared folder cannot restyle it away).
//!
//! Engines come from the global `<app-data>/settings.json` only (`ai.engines`,
//! OPEN-4): a folder's `.mikedown/settings.json` can never add an endpoint,
//! flip `ai.allowCloud` or redefine `ai.localNetworks`. The webview names a
//! route (engine id, model id); this module looks both up itself and runs the
//! cloud gate again (defence in depth): a cloud engine needs the global
//! `ai.allowCloud` and the user's consent for the window's folder, stored as
//! `ai.consent.<engineId>` in that folder's settings file.

pub mod discovery;
pub mod errors;
pub mod locality;
pub mod model;
pub mod providers;
pub mod request_log;
pub mod requests;
pub mod secrets;
pub mod sse;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use tokio::sync::watch;

use self::errors::{AiError, ErrorCode};
use self::locality::{default_local_networks, engine_locality, host_of_url, Locality};
use self::model::{
    CompletionRequest, DiscoveryResult, DoneEvent, EngineConfig, EngineInfo, ErrorEvent, ServedBy, TokenEvent,
};
use self::secrets::{resolve_key_with_file, KeyLookup, KeySource, KeychainStore, SecretStore};
use super::multiwindow::WindowRegistry;
use super::settings::{read_settings, settings_path, write_settings};

// ── Settings the Rust side needs ────────────────────────────────────────────

/// The slice of `ai.*` this module reads from the global settings file.
#[derive(Clone, Debug)]
pub struct AiConfig {
    pub allow_cloud: bool,
    pub local_networks: Vec<String>,
    pub engines: Vec<EngineConfig>,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self { allow_cloud: false, local_networks: default_local_networks(), engines: Vec::new() }
    }
}

/// `ai.*` out of a flat settings object (`"ai.engines": [...]`), or a nested
/// `"ai": { engines }`. Missing or malformed pieces fall back to defaults; an
/// engine that does not parse (an unknown kind from a newer version, no base
/// URL) is skipped, never an error.
pub fn parse_ai_config(text: Option<&str>) -> AiConfig {
    let mut config = AiConfig::default();
    let Some(Value::Object(root)) = text.and_then(|t| serde_json::from_str::<Value>(t).ok()) else {
        return config;
    };
    let nested = root.get("ai").and_then(Value::as_object);
    let get = |key: &str| root.get(&format!("ai.{key}")).or_else(|| nested.and_then(|n| n.get(key)));
    if let Some(Value::Bool(b)) = get("allowCloud") {
        config.allow_cloud = *b;
    }
    if let Some(Value::Array(nets)) = get("localNetworks") {
        config.local_networks = nets.iter().filter_map(|n| n.as_str()).map(str::trim).filter(|n| !n.is_empty()).map(str::to_string).collect();
    }
    if let Some(Value::Array(engines)) = get("engines") {
        let mut seen = std::collections::HashSet::new();
        for raw in engines {
            if let Ok(engine) = serde_json::from_value::<EngineConfig>(raw.clone()) {
                if !engine.id.is_empty() && seen.insert(engine.id.clone()) {
                    config.engines.push(engine);
                }
            }
        }
    }
    config
}

fn load_config<R: Runtime>(app: &AppHandle<R>) -> Result<AiConfig, AiError> {
    let base = app.path().app_data_dir().map_err(|e| AiError::unknown(e.to_string()))?;
    let file = settings_path(&base, "global", None).map_err(AiError::unknown)?;
    let read = read_settings(&file).map_err(AiError::unknown)?;
    Ok(parse_ai_config(read.text.as_deref()))
}

// ── Cloud gate and consent ──────────────────────────────────────────────────

fn consent_key(engine_id: &str) -> String {
    format!("ai.consent.{engine_id}")
}

/// Whether `<folder>/.mikedown/settings.json` records consent for the engine.
pub fn read_folder_consent(folder: &Path, engine_id: &str) -> bool {
    let Ok(file) = settings_path(folder, "folder", Some(folder)) else { return false };
    let Ok(read) = read_settings(&file) else { return false };
    let Some(Value::Object(map)) = read.text.as_deref().and_then(|t| serde_json::from_str::<Value>(t).ok()) else {
        return false;
    };
    map.get(&consent_key(engine_id)) == Some(&Value::Bool(true))
}

/// Record consent in the folder's settings file, keeping every other key. A
/// file that is not a JSON object is left alone (the settings banner owns
/// repairing it).
pub fn write_folder_consent(folder: &Path, engine_id: &str) -> Result<(), String> {
    let file = settings_path(folder, "folder", Some(folder))?;
    let read = read_settings(&file)?;
    let mut map = match read.text.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        None => serde_json::Map::new(),
        Some(text) => match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(map)) => map,
            _ => return Err("this folder's settings file is damaged, so the choice was not saved".to_string()),
        },
    };
    map.insert(consent_key(engine_id), Value::Bool(true));
    let text = format!("{}\n", serde_json::to_string_pretty(&Value::Object(map)).map_err(|e| e.to_string())?);
    write_settings(&file, &text).map(|_| ())
}

/// The cloud gate. `consent`: Some(true) granted, Some(false) declined this
/// session, None never asked.
pub fn cloud_gate(locality: Locality, allow_cloud: bool, consent: Option<bool>) -> Result<(), AiError> {
    if locality == Locality::Local {
        return Ok(());
    }
    if !allow_cloud {
        return Err(AiError::new(ErrorCode::CloudBlocked, "Cloud engines are turned off (Allow cloud in AI settings)."));
    }
    if consent != Some(true) {
        return Err(AiError::new(ErrorCode::ConsentDenied, "Sending text to this cloud engine has not been allowed for this folder."));
    }
    Ok(())
}

/// A name Tauri accepts in an event (`[A-Za-z0-9_-]`), derived from the
/// request id. The same mapping is in `src/host/aiApi.ts`.
pub fn channel_id(request_id: &str) -> Result<String, AiError> {
    if request_id.is_empty() || request_id.len() > 128 {
        return Err(AiError::unknown("The request id must be 1 to 128 characters."));
    }
    Ok(request_id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect())
}

// ── State ───────────────────────────────────────────────────────────────────

struct Inflight {
    window: String,
    cancel: watch::Sender<bool>,
}

#[derive(Clone)]
struct CachedProbe {
    ok: bool,
    latency_ms: u64,
    error: Option<String>,
}

/// Managed state: the HTTP client, the secret store, in-flight requests (per
/// window), the probe cache and this session's consent answers.
pub struct AiState {
    client: reqwest::Client,
    secrets: Arc<dyn SecretStore>,
    inflight: Mutex<HashMap<String, Inflight>>,
    probes: Mutex<HashMap<String, CachedProbe>>,
    /// (folder or "", engine id) to the answer given this session.
    consent: Mutex<HashMap<(String, String), bool>>,
    /// One consent dialog at a time.
    consent_dialog: tokio::sync::Mutex<()>,
    /// The last key-file problem logged per engine, so status polls say it once.
    key_file_logged: Mutex<HashMap<String, String>>,
}

impl AiState {
    pub fn new() -> Self {
        Self::with_store(Arc::new(KeychainStore))
    }

    pub fn with_store(secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            client: providers::build_client(),
            secrets,
            inflight: Mutex::new(HashMap::new()),
            probes: Mutex::new(HashMap::new()),
            consent: Mutex::new(HashMap::new()),
            consent_dialog: tokio::sync::Mutex::new(()),
            key_file_logged: Mutex::new(HashMap::new()),
        }
    }

    fn cancel_where(&self, keep: impl Fn(&str, &Inflight) -> bool) -> usize {
        let map = self.inflight.lock().unwrap();
        let mut n = 0;
        for (id, f) in map.iter() {
            if keep(id, f) {
                let _ = f.cancel.send(true);
                n += 1;
            }
        }
        n
    }

    /// Cancel every request a window started (the window closed).
    pub fn cancel_window(&self, label: &str) -> usize {
        self.cancel_where(|_, f| f.window == label)
    }

    #[cfg(test)]
    pub fn inflight_count(&self) -> usize {
        self.inflight.lock().unwrap().len()
    }

    fn session_key(folder: Option<&Path>, engine_id: &str) -> (String, String) {
        (folder.map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(), engine_id.to_string())
    }

    fn consent_state(&self, folder: Option<&Path>, engine_id: &str) -> Option<bool> {
        if let Some(answer) = self.consent.lock().unwrap().get(&Self::session_key(folder, engine_id)) {
            return Some(*answer);
        }
        folder.filter(|f| read_folder_consent(f, engine_id)).map(|_| true)
    }

    fn remember_consent(&self, folder: Option<&Path>, engine_id: &str, granted: bool) {
        self.consent.lock().unwrap().insert(Self::session_key(folder, engine_id), granted);
    }

    async fn key_for(&self, engine: &EngineConfig) -> (Option<String>, Option<String>) {
        let lookup = self.lookup_for(engine).await;
        (lookup.key, lookup.keychain_problem)
    }

    async fn lookup_for(&self, engine: &EngineConfig) -> KeyLookup {
        let store = self.secrets.clone();
        let id = engine.id.clone();
        let env_name = engine.api_key_env.clone();
        let key_file = engine.api_key_file.clone();
        let lookup = tauri::async_runtime::spawn_blocking(move || {
            resolve_key_with_file(store.as_ref(), &id, env_name.as_deref(), key_file.as_ref(), &|n| std::env::var(n).ok())
        })
        .await;
        let Ok(lookup) = lookup else {
            return KeyLookup { key: None, source: None, keychain_problem: Some("the key lookup failed".to_string()), file_problem: None };
        };
        self.log_key_file_problem(engine, lookup.file_problem.as_deref());
        lookup
    }

    /// One log line per distinct key-file failure; never the key or the file's contents.
    fn log_key_file_problem(&self, engine: &EngineConfig, problem: Option<&str>) {
        let mut logged = self.key_file_logged.lock().unwrap();
        match (problem, &engine.api_key_file) {
            (Some(why), Some(spec)) => {
                let line = format!("{}: key file {} not used ({why})", engine.id, spec.path);
                if logged.get(&engine.id) != Some(&line) {
                    eprintln!("[mikedown ai] {line}");
                    logged.insert(engine.id.clone(), line);
                }
            }
            _ => {
                logged.remove(&engine.id);
            }
        }
    }

    fn cached_info(&self, engine: &EngineConfig, config: &AiConfig, key: &KeyLookup) -> EngineInfo {
        let cached = self.probes.lock().unwrap().get(&engine.id).cloned();
        EngineInfo {
            engine_id: engine.id.clone(),
            ok: cached.as_ref().map(|c| c.ok),
            is_local: engine_locality(&engine.locality, &engine.base_url, &config.local_networks) == Locality::Local,
            has_key: key.key.is_some(),
            key_source: key.source.and_then(KeySource::wire_name),
            latency_ms: cached.as_ref().map(|c| c.latency_ms),
            error: cached.and_then(|c| c.error),
        }
    }

    fn store_probe(&self, engine_id: &str, ok: bool, latency_ms: u64, error: Option<String>) {
        self.probes.lock().unwrap().insert(engine_id.to_string(), CachedProbe { ok, latency_ms, error });
    }
}

impl Default for AiState {
    fn default() -> Self {
        Self::new()
    }
}

/// A window closed: stop everything it had running.
pub fn cancel_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(state) = app.try_state::<AiState>() {
        state.cancel_window(label);
    }
}

fn window_folder<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<PathBuf> {
    app.try_state::<WindowRegistry>()?.folder_of(label)
}

fn find_engine<'a>(config: &'a AiConfig, engine_id: &str) -> Result<&'a EngineConfig, AiError> {
    config
        .engines
        .iter()
        .find(|e| e.id == engine_id)
        .ok_or_else(|| AiError::new(ErrorCode::ModelNotFound, "That engine is not in your AI settings."))
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ai_complete<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, AiState>,
    request: CompletionRequest,
) -> Result<String, AiError> {
    let channel = channel_id(&request.request_id)?;
    let label = window.label().to_string();
    let config = load_config(&app)?;

    let route = request.route.clone().ok_or_else(|| AiError::unknown("The request names no engine and model."))?;
    let engine = find_engine(&config, &route.engine_id)?.clone();
    if !engine.enabled {
        return Err(AiError::new(ErrorCode::ModelNotFound, "That engine is turned off in AI settings."));
    }
    let model = engine
        .models
        .iter()
        .find(|m| m.id == route.model_id && m.enabled)
        .ok_or_else(|| AiError::new(ErrorCode::ModelNotFound, "That model is not enabled on this engine."))?
        .clone();

    let locality = engine_locality(&engine.locality, &engine.base_url, &config.local_networks);
    let folder = window_folder(&app, &label);
    cloud_gate(locality, config.allow_cloud, state.consent_state(folder.as_deref(), &engine.id))?;

    let (api_key, _keychain_problem) = state.key_for(&engine).await;
    let served = ServedBy {
        engine_id: engine.id.clone(),
        engine_name: engine.display_name().to_string(),
        model_id: model.id.clone(),
        is_local: locality == Locality::Local,
    };

    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let mut inflight = state.inflight.lock().unwrap();
        if inflight.contains_key(&channel) {
            return Err(AiError::unknown("A request with this id is already running."));
        }
        inflight.insert(channel.clone(), Inflight { window: label.clone(), cancel: cancel_tx });
    }

    let client = state.client.clone();
    let started = Instant::now();
    let thinking = request_log::thinking_log_parts(engine.kind, model.request_overrides.as_ref(), request.request_overrides.as_ref(), request.max_tokens);
    let log_served = served.clone();
    let task_app = app.clone();
    let task_channel = channel.clone();
    tauri::async_runtime::spawn(async move {
        let request_id = request.request_id.clone();
        let token_event = format!("ai-token:{task_channel}");
        let emitter = task_app.clone();
        let target = label.clone();
        let mut on_token = |delta: &str| {
            let _ = emitter.emit_to(target.as_str(), token_event.as_str(), TokenEvent { request_id: request_id.clone(), delta: delta.to_string() });
        };
        let outcome = providers::complete(&client, &engine, api_key.as_deref(), &model, &request, served, &cancel_rx, &mut on_token).await;
        if let Some(state) = task_app.try_state::<AiState>() {
            state.inflight.lock().unwrap().remove(&task_channel);
        }
        let finish = match &outcome {
            Ok(result) => format!("{:?}", result.finish_reason).to_lowercase(),
            Err(error) if error.code == ErrorCode::Cancelled => "cancelled".to_string(),
            Err(error) => format!("error {}", error.code.as_str()),
        };
        let usage = outcome.as_ref().ok().and_then(|r| r.usage);
        eprintln!(
            "[mikedown ai] {}",
            request_log::format_request_log(&request.feature, &request.task, &log_served, started.elapsed().as_millis(), &finish, &thinking, usage.as_ref())
        );
        match outcome {
            Ok(result) => {
                let _ = task_app.emit_to(label.as_str(), format!("ai-done:{task_channel}").as_str(), DoneEvent { request_id: request.request_id.clone(), result });
            }
            Err(error) => {
                let event = ErrorEvent { request_id: request.request_id.clone(), code: error.code, message: error.message };
                let _ = task_app.emit_to(label.as_str(), format!("ai-error:{task_channel}").as_str(), event);
            }
        }
    });
    Ok(channel)
}

/// Cancel one of the calling window's requests. A request that already
/// finished (or belongs to another window) is not an error.
#[tauri::command]
pub fn ai_cancel<R: Runtime>(window: WebviewWindow<R>, state: State<'_, AiState>, id: String) -> bool {
    let Ok(channel) = channel_id(&id) else { return false };
    let label = window.label().to_string();
    state.cancel_where(|key, f| key == channel && f.window == label) > 0
}

#[tauri::command]
pub async fn ai_list_engines<R: Runtime>(app: AppHandle<R>, state: State<'_, AiState>) -> Result<Vec<EngineInfo>, AiError> {
    let config = load_config(&app)?;
    let mut out = Vec::with_capacity(config.engines.len());
    for engine in &config.engines {
        let key = state.lookup_for(engine).await;
        out.push(state.cached_info(engine, &config, &key));
    }
    Ok(out)
}

/// Test connection. Works for any engine, cloud-blocked or not: it is the
/// user clicking, and only the key and an empty request leave the machine.
#[tauri::command]
pub async fn ai_test_engine<R: Runtime>(app: AppHandle<R>, state: State<'_, AiState>, id: String) -> Result<EngineInfo, AiError> {
    let config = load_config(&app)?;
    let engine = find_engine(&config, &id)?;
    let key = state.lookup_for(engine).await;
    let (_keep_alive, cancel) = watch::channel(false);
    let outcome = providers::probe(&state.client, engine, key.key.as_deref(), &cancel).await;
    state.store_probe(&engine.id, outcome.ok, outcome.latency_ms, outcome.error.as_ref().map(|e| e.message.clone()));
    Ok(state.cached_info(engine, &config, &key))
}

/// List the models the endpoint serves (capabilities as the endpoint
/// described them; the webview adds heuristics and merges into the saved
/// engine). A failure rejects with the `AiError`, and the probe cache records it.
#[tauri::command]
pub async fn ai_discover_models<R: Runtime>(app: AppHandle<R>, state: State<'_, AiState>, id: String) -> Result<DiscoveryResult, AiError> {
    let config = load_config(&app)?;
    let engine = find_engine(&config, &id)?;
    let key = state.lookup_for(engine).await;
    let (_keep_alive, cancel) = watch::channel(false);
    let started = Instant::now();
    match providers::list_models(&state.client, engine, key.key.as_deref(), &cancel).await {
        Ok(models) => {
            state.store_probe(&engine.id, true, started.elapsed().as_millis() as u64, None);
            Ok(DiscoveryResult { info: state.cached_info(engine, &config, &key), models })
        }
        Err(error) => {
            state.store_probe(&engine.id, false, started.elapsed().as_millis() as u64, Some(error.message.clone()));
            Err(error)
        }
    }
}

/// Store (or with null or an empty string, delete) an engine's key in the OS
/// keychain. The key is never read back to the webview.
#[tauri::command]
pub async fn ai_set_secret(state: State<'_, AiState>, id: String, api_key: Option<String>) -> Result<(), AiError> {
    if id.trim().is_empty() || id.len() > 200 {
        return Err(AiError::unknown("The engine id is missing."));
    }
    let store = state.secrets.clone();
    let key = api_key.filter(|k| !k.trim().is_empty());
    tauri::async_runtime::spawn_blocking(move || match key {
        Some(k) => store.set(&id, k.trim()),
        None => store.delete(&id),
    })
    .await
    .map_err(|e| AiError::unknown(e.to_string()))?
    .map_err(|e| AiError::unknown(format!("The keychain refused the change: {e}")))
}

/// Ask the user, in a native dialog, whether this window's folder may send
/// text to a cloud engine. Returns the stored answer without asking when there
/// is one. "Not now" is remembered for the session only.
#[tauri::command]
pub async fn ai_request_cloud_consent<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, AiState>,
    id: String,
) -> Result<bool, AiError> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let config = load_config(&app)?;
    let engine = find_engine(&config, &id)?.clone();
    if engine_locality(&engine.locality, &engine.base_url, &config.local_networks) == Locality::Local {
        return Ok(true);
    }
    if !config.allow_cloud {
        return Err(AiError::new(ErrorCode::CloudBlocked, "Cloud engines are turned off (Allow cloud in AI settings)."));
    }
    let folder = window_folder(&app, window.label());
    if let Some(answer) = state.consent_state(folder.as_deref(), &engine.id) {
        return Ok(answer);
    }

    // One dialog at a time; a second request that waited sees the first answer.
    let _turn = state.consent_dialog.lock().await;
    if let Some(answer) = state.consent_state(folder.as_deref(), &engine.id) {
        return Ok(answer);
    }
    let host = host_of_url(&engine.base_url).unwrap_or_else(|| engine.base_url.clone());
    let scope = if folder.is_some() { "this folder" } else { "this session" };
    let text = format!(
        "{} ({host}) is a cloud engine.\n\nIf you allow it, the text you ask the AI about (for Rewrite: your selection and the paragraph around it) is sent over the internet to {host}.\n\nAllow it for {scope}?",
        engine.display_name()
    );
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(text)
        .title("Send text to a cloud AI engine?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(format!("Allow for {scope}"), "Not now".to_string()))
        .parent(&window)
        .show(move |allowed| {
            let _ = tx.send(allowed);
        });
    let granted = rx.await.unwrap_or(false);
    state.remember_consent(folder.as_deref(), &engine.id, granted);
    if granted {
        if let Some(dir) = folder.as_deref() {
            let saved = super::fs::ensure_allowed(&app, dir).map_err(|e| e.to_string()).and_then(|_| write_folder_consent(dir, &engine.id));
            if let Err(why) = saved {
                // The answer still holds for this session.
                eprintln!("[mikedown ai] could not store consent for {}: {why}", dir.display());
            }
        }
    }
    Ok(granted)
}

#[cfg(test)]
mod tests;
