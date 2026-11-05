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
//! - `ai_request_cloud_consent(id, feature?, sends?, baseIds?, turnId?)`: a native dialog with
//!   three answers (Allow for this folder / Allow once / Don't allow), not
//!   webview UI, so a shared folder cannot restyle it away. Its words come
//!   from `consent.rs`, the port of core's `aiConsentText`; `baseIds` (a
//!   documentation-base request) become names from the global settings.
//!   Resolves to `allow`, `allowOnce`, `deny`, or `never` (stored by an older version).
//!   With `turnId` (a chat turn), `allowOnce` is a grant held here for that
//!   window and turn: every request of the turn uses it (`request.turn`), and
//!   it never covers another turn, engine or set of bases. It ends with
//!   `ai_end_turn`, a failed or cancelled request, or the window closing.
//!   `ai_complete` raises the same dialog, with the request's real `sends` and
//!   base names, for a turn request nothing admits.
//! - `ai_list_consents()` and `ai_forget_consent(id)`: the window folder's
//!   stored answers and this session's "Don't allow", for the Cloud consents
//!   list on the AI tab.
//! - `ai_forget_engine_consents(ids)`: engines deleted from settings lose
//!   their answers in every folder (and this session's).
//! - `ai_detect_local_servers(candidates)`: which local presets answer at
//!   their addresses, for the setup UI (`detect.rs`). Only when asked.
//! - `ai_hardware_info()`: memory, CPU and GPU for the setup wizard's local
//!   hint (`hardware.rs`). Read once, cached for the session.
//!
//! Engines come from the global `<app-data>/settings.json` only (`ai.engines`,
//! OPEN-4): a folder's `.mikedown/settings.json` can never add an endpoint,
//! flip `ai.allowCloud` or redefine `ai.localNetworks`. The webview names a
//! route (engine id, model id); this module looks both up itself and runs the
//! cloud gate again (defence in depth): a cloud engine needs the global
//! `ai.allowCloud` and the user's consent for the window's folder, stored in
//! `<app-data>/ai-consent.json` (`consent_store.rs`), never in the folder.

pub mod consent;
pub mod consent_store;
pub mod detect;
pub mod discovery;
pub mod errors;
pub mod hardware;
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

use self::consent_store::Answer;
use self::errors::{AiError, ErrorCode};
use self::locality::{default_local_networks, engine_locality, host_of_url, Locality};
use self::model::{
    CompletionRequest, DiscoveryResult, DoneEvent, EngineConfig, EngineInfo, ErrorEvent, ModelConfig, ServedBy, TokenEvent, TurnClaim,
};
use self::secrets::{resolve_key_with_file, KeyLookup, KeySource, KeychainStore, SecretStore};
use super::multiwindow::WindowRegistry;
use super::settings::{read_settings, settings_path};

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

/// The cloud gate. `consent`: the stored or session answer for this folder
/// and engine, None when never asked.
pub fn cloud_gate(locality: Locality, allow_cloud: bool, consent: Option<Answer>) -> Result<(), AiError> {
    if locality == Locality::Local {
        return Ok(());
    }
    if !allow_cloud {
        return Err(AiError::new(ErrorCode::CloudBlocked, "Cloud engines are turned off (Allow cloud in AI settings)."));
    }
    match consent {
        Some(Answer::Allow | Answer::AllowOnce) => {}
        Some(Answer::Never) => {
            return Err(AiError::new(ErrorCode::ConsentDenied, "Sending text to this cloud engine was turned off for this folder."));
        }
        _ => {
            return Err(AiError::new(ErrorCode::ConsentDenied, "Sending text to this cloud engine has not been allowed for this folder."));
        }
    }
    Ok(())
}

/// The most requests one "Allow once" admits in a chat turn: a navigation call
/// and its one repair per hop, then the answer. The same number as core's
/// `AI_TURN_GRANT_MAX_USES`.
pub const TURN_GRANT_MAX_USES: u32 = 11;

const MAX_TURN_ID_LEN: usize = 200;
const MAX_TURN_BASE_IDS: usize = 50;

/// A turn's claim from the webview: bounded, like the bridge in VS Code.
fn check_turn_claim(claim: &TurnClaim) -> Result<(), AiError> {
    if claim.id.is_empty() || claim.id.len() > MAX_TURN_ID_LEN || claim.base_ids.len() > MAX_TURN_BASE_IDS {
        return Err(AiError::unknown("Malformed chat turn."));
    }
    Ok(())
}

/// F6: a turn's pin holds its engine's locality, and a change fails the
/// request, whichever way the engine moved.
pub fn turn_locality_gate(claim: Option<&TurnClaim>, locality: Locality, engine_name: &str) -> Result<(), AiError> {
    match claim.and_then(|c| c.is_local) {
        Some(was_local) if was_local != (locality == Locality::Local) => {
            Err(AiError::unknown(format!("{engine_name} moved between local and cloud during this turn. Ask again.")))
        }
        _ => Ok(()),
    }
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

/// A consent answer given this session, with the engine's fingerprint and
/// when (Unix milliseconds).
#[derive(Clone)]
struct SessionAnswer {
    fingerprint: String,
    answer: Answer,
    at: u64,
}

/// What the user answered "Allow once" to, for one chat turn in one window.
#[derive(Clone)]
struct TurnGrant {
    engine_id: String,
    fingerprint: String,
    feature: String,
    sends: String,
    base_ids: Vec<String>,
    uses: u32,
}

/// A set of base ids in a form two claims can be compared by.
fn base_id_set(ids: &[String]) -> Vec<String> {
    let mut set = ids.to_vec();
    set.sort();
    set.dedup();
    set
}

/// Managed state: the HTTP client, the secret store, in-flight requests (per
/// window), the probe cache and this session's consent answers.
pub struct AiState {
    client: reqwest::Client,
    secrets: Arc<dyn SecretStore>,
    inflight: Mutex<HashMap<String, Inflight>>,
    probes: Mutex<HashMap<String, CachedProbe>>,
    /// (folder or "", engine id) to the answer given this session ("Don't
    /// allow" and an unused "Allow once" live only here).
    consent: Mutex<HashMap<(String, String), SessionAnswer>>,
    /// (window label, turn id) to the "Allow once" given for that chat turn.
    turn_grants: Mutex<HashMap<(String, String), TurnGrant>>,
    /// Serialises reads and writes of the consent file.
    consent_io: Mutex<()>,
    /// One consent dialog at a time.
    consent_dialog: tokio::sync::Mutex<()>,
    /// The last key-file problem logged per engine, so status polls say it once.
    key_file_logged: Mutex<HashMap<String, String>>,
    /// Tests stand in for the native dialog: the bodies it was asked to show,
    /// and what it answers.
    #[cfg(test)]
    dialogs: Mutex<Vec<String>>,
    #[cfg(test)]
    dialog_answer: Mutex<Answer>,
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
            turn_grants: Mutex::new(HashMap::new()),
            consent_io: Mutex::new(()),
            consent_dialog: tokio::sync::Mutex::new(()),
            key_file_logged: Mutex::new(HashMap::new()),
            #[cfg(test)]
            dialogs: Mutex::new(Vec::new()),
            #[cfg(test)]
            dialog_answer: Mutex::new(Answer::Deny),
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

    /// Cancel every request a window started (the window closed). Its chat
    /// turns' "Allow once" grants end with it.
    pub fn cancel_window(&self, label: &str) -> usize {
        self.turn_grants.lock().unwrap().retain(|(window, _), _| window != label);
        self.cancel_where(|_, f| f.window == label)
    }

    #[cfg(test)]
    pub fn inflight_count(&self) -> usize {
        self.inflight.lock().unwrap().len()
    }

    fn session_key(folder: Option<&Path>, engine_id: &str) -> (String, String) {
        (folder.map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(), engine_id.to_string())
    }

    /// The answer that holds for this folder and engine: this session's, then
    /// the stored one. Either counts only while the engine's fingerprint
    /// still matches. An unused "Allow once" is not an answer to the next
    /// consent request (that one asks again); `take_consent` uses it up.
    fn consent_state(&self, base: &Path, folder: Option<&Path>, engine: &EngineConfig) -> Option<Answer> {
        let print = consent_store::fingerprint(engine);
        if let Some(seen) = self.consent.lock().unwrap().get(&Self::session_key(folder, &engine.id)) {
            if seen.fingerprint == print && seen.answer != Answer::AllowOnce {
                return Some(seen.answer);
            }
        }
        let folder = folder?;
        let _io = self.consent_io.lock().unwrap();
        consent_store::lookup(base, folder, engine)
    }

    /// The answer for a completion: an unused "Allow once" (used up here),
    /// else what `consent_state` says.
    fn take_consent(&self, base: &Path, folder: Option<&Path>, engine: &EngineConfig) -> Option<Answer> {
        let key = Self::session_key(folder, &engine.id);
        {
            let mut session = self.consent.lock().unwrap();
            if session.get(&key).is_some_and(|s| s.answer == Answer::AllowOnce) {
                let once = session.remove(&key).unwrap();
                if once.fingerprint == consent_store::fingerprint(engine) {
                    return Some(Answer::AllowOnce);
                }
            }
        }
        self.consent_state(base, folder, engine)
    }

    /// The user answered "Allow once" for this chat turn in this window.
    fn grant_turn(&self, window: &str, turn_id: &str, engine: &EngineConfig, feature: Option<&str>, sends: Option<&str>, base_ids: &[String]) {
        let grant = TurnGrant {
            engine_id: engine.id.clone(),
            fingerprint: consent_store::fingerprint(engine),
            feature: feature.unwrap_or_default().to_string(),
            sends: sends.unwrap_or_default().to_string(),
            base_ids: base_id_set(base_ids),
            uses: 0,
        };
        self.turn_grants.lock().unwrap().insert((window.to_string(), turn_id.to_string()), grant);
    }

    /// True when this window holds a grant for the claim's turn that fits it:
    /// same engine as it is now, same feature, same scope, same set of bases,
    /// and not used more often than one turn can. A claim that does not fit
    /// ends the grant.
    fn use_turn_grant(&self, window: &str, engine: &EngineConfig, feature: &str, claim: &TurnClaim) -> bool {
        let key = (window.to_string(), claim.id.clone());
        let mut grants = self.turn_grants.lock().unwrap();
        let Some(grant) = grants.get_mut(&key) else { return false };
        let fits = grant.engine_id == engine.id
            && grant.fingerprint == consent_store::fingerprint(engine)
            && grant.feature == feature
            && grant.sends == claim.sends.as_deref().unwrap_or_default()
            && grant.base_ids == base_id_set(&claim.base_ids)
            && grant.uses < TURN_GRANT_MAX_USES;
        if !fits {
            grants.remove(&key);
            return false;
        }
        grant.uses += 1;
        true
    }

    /// The answer for a request of a chat turn: this turn's grant, else what
    /// `consent_state` says. An "Allow once" given outside this turn never
    /// counts here, whatever the claim says.
    fn take_turn_consent(&self, base: &Path, folder: Option<&Path>, window: &str, engine: &EngineConfig, feature: &str, claim: &TurnClaim) -> Option<Answer> {
        if self.use_turn_grant(window, engine, feature, claim) {
            return Some(Answer::AllowOnce);
        }
        self.consent_state(base, folder, engine)
    }

    /// The turn is over: its grant, if any, is gone.
    fn end_turn(&self, window: &str, turn_id: &str) {
        self.turn_grants.lock().unwrap().remove(&(window.to_string(), turn_id.to_string()));
    }

    fn forget_turn_grants(&self, engine_ids: &[String]) {
        self.turn_grants.lock().unwrap().retain(|_, grant| !engine_ids.contains(&grant.engine_id));
    }

    /// Keep an answer for the session and, for `allow` in a folder window, in
    /// the app-data store.
    fn remember_consent(&self, base: &Path, folder: Option<&Path>, engine: &EngineConfig, answer: Answer) {
        let seen = SessionAnswer { fingerprint: consent_store::fingerprint(engine), answer, at: consent_store::now_ms() };
        self.consent.lock().unwrap().insert(Self::session_key(folder, &engine.id), seen);
        if let (Some(folder), true) = (folder, answer.is_stored()) {
            let _io = self.consent_io.lock().unwrap();
            if let Err(why) = consent_store::record(base, folder, engine, answer) {
                // The answer still holds for this session.
                eprintln!("[mikedown ai] could not store consent for {}: {why}", folder.display());
            }
        }
    }

    /// The folder's stored consents plus this session's "Don't allow" for
    /// engines that still have the fingerprint it was given for, newest first.
    fn list_consents(&self, base: &Path, folder: &Path, engines: &[EngineConfig]) -> Vec<consent_store::ListedConsent> {
        let mut out = {
            let _io = self.consent_io.lock().unwrap();
            consent_store::list(base, folder)
        };
        let session = self.consent.lock().unwrap();
        for engine in engines {
            let Some(seen) = session.get(&Self::session_key(Some(folder), &engine.id)) else { continue };
            if seen.answer == Answer::Deny && seen.fingerprint == consent_store::fingerprint(engine) && !out.iter().any(|c| c.engine_id == engine.id) {
                out.push(consent_store::ListedConsent { engine_id: engine.id.clone(), answer: Answer::Deny, at: seen.at, scope: "folder" });
            }
        }
        out.sort_by(|a, b| b.at.cmp(&a.at));
        out
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
            key_source: key.source.map(KeySource::wire_name),
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

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AiError> {
    app.path().app_data_dir().map_err(|e| AiError::unknown(e.to_string()))
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

/// What a request says it sends, for a consent dialog.
struct ConsentAsk<'a> {
    feature: Option<&'a str>,
    sends: Option<&'a str>,
    base_ids: &'a [String],
    /// A chat turn: "Allow once" becomes that turn's grant, not the next completion's.
    turn_id: Option<&'a str>,
}

/// The native dialog. Three buttons is all it has, so the policy link is
/// spelled out in the body.
#[cfg(not(test))]
async fn show_consent_dialog<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, text: consent::ConsentText) -> Answer {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

    let allow_label = text.allow.clone();
    let once_label = text.allow_once.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(text.body)
        .title(text.title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom(text.allow, text.allow_once, text.deny))
        .parent(window)
        .show_with_result(move |result| {
            let _ = tx.send(result);
        });
    match rx.await {
        Ok(MessageDialogResult::Custom(label)) if label == allow_label => Answer::Allow,
        Ok(MessageDialogResult::Custom(label)) if label == once_label => Answer::AllowOnce,
        Ok(MessageDialogResult::Yes) => Answer::Allow,
        Ok(MessageDialogResult::No) => Answer::AllowOnce,
        // "Don't allow", a closed dialog, an unknown label.
        _ => Answer::Deny,
    }
}

#[cfg(test)]
async fn show_consent_dialog<R: Runtime>(app: &AppHandle<R>, _window: &WebviewWindow<R>, text: consent::ConsentText) -> Answer {
    let state = app.state::<AiState>();
    state.dialogs.lock().unwrap().push(text.body);
    let answer = *state.dialog_answer.lock().unwrap();
    answer
}

/// Ask the user, one dialog at a time; a request that waited sees the first
/// answer if it holds. The words name the bases from the global settings, and
/// ids the settings do not list are dropped, so webview text never reaches the
/// native modal (A3).
async fn ask_consent<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    state: &AiState,
    base: &Path,
    folder: Option<&Path>,
    engine: &EngineConfig,
    ask: ConsentAsk<'_>,
) -> Answer {
    let _turn = state.consent_dialog.lock().await;
    if let Some(answer) = state.consent_state(base, folder, engine) {
        return answer;
    }
    let host = host_of_url(&engine.base_url).unwrap_or_else(|| engine.base_url.clone());
    let scope_word = if folder.is_some() { "folder" } else { "session" };
    let base_names = super::docs::consent_base_names(app, ask.base_ids);
    let text = consent::consent_text(engine.display_name(), &host, ask.feature, ask.sends, &base_names, scope_word);
    let answer = show_consent_dialog(app, window, text).await;
    match (answer, ask.turn_id) {
        (Answer::AllowOnce, Some(turn_id)) => state.grant_turn(window.label(), turn_id, engine, ask.feature, ask.sends, ask.base_ids),
        _ => state.remember_consent(base, folder, engine, answer),
    }
    answer
}

/// What `ai_complete` hands its task once the request may go.
struct Prepared {
    engine: EngineConfig,
    model: ModelConfig,
    is_local: bool,
    api_key: Option<String>,
    cancel_rx: watch::Receiver<bool>,
}

/// Everything before the request leaves: look up the route, register it for
/// cancelling, run the gates. The request's `route` names an engine, nothing
/// more. It goes only if the cloud gate passes on what this module holds.
async fn prepare_completion<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    state: &AiState,
    request: &CompletionRequest,
    channel: &str,
    label: &str,
) -> Result<Prepared, AiError> {
    let config = load_config(app)?;
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
    let claim = request.turn.as_ref();
    if let Some(claim) = claim {
        check_turn_claim(claim)?;
    }
    let locality = engine_locality(&engine.locality, &engine.base_url, &config.local_networks);
    turn_locality_gate(claim, locality, engine.display_name())?;

    // Registered first: a request waiting on a dialog can be cancelled too.
    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let mut inflight = state.inflight.lock().unwrap();
        if inflight.contains_key(channel) {
            return Err(AiError::unknown("A request with this id is already running."));
        }
        inflight.insert(channel.to_string(), Inflight { window: label.to_string(), cancel: cancel_tx });
    }
    let admitted = async {
        let folder = window_folder(app, label);
        let consent = if locality == Locality::Local {
            None
        } else if let Some(claim) = claim {
            let base = data_dir(app)?;
            match state.take_turn_consent(&base, folder.as_deref(), label, &engine, &request.feature, claim) {
                None if config.allow_cloud => {
                    let ask = ConsentAsk { feature: Some(&request.feature), sends: claim.sends.as_deref(), base_ids: &claim.base_ids, turn_id: Some(&claim.id) };
                    Some(ask_consent(app, window, state, &base, folder.as_deref(), &engine, ask).await)
                }
                held => held,
            }
        } else {
            state.take_consent(&data_dir(app)?, folder.as_deref(), &engine)
        };
        cloud_gate(locality, config.allow_cloud, consent)?;
        let (api_key, _keychain_problem) = state.key_for(&engine).await;
        if *cancel_rx.borrow() {
            return Err(AiError::new(ErrorCode::Cancelled, "Cancelled."));
        }
        Ok(api_key)
    }
    .await;
    match admitted {
        Ok(api_key) => Ok(Prepared { engine, model, is_local: locality == Locality::Local, api_key, cancel_rx }),
        Err(error) => {
            state.inflight.lock().unwrap().remove(channel);
            Err(error)
        }
    }
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
    let Prepared { engine, model, is_local, api_key, cancel_rx } = match prepare_completion(&app, &window, &state, &request, &channel, &label).await {
        Ok(prepared) => prepared,
        Err(error) => {
            // A failed request ends its turn, so it ends the turn's "Allow once" too.
            if let Some(claim) = &request.turn {
                state.end_turn(&label, &claim.id);
            }
            return Err(error);
        }
    };
    let served = ServedBy {
        engine_id: engine.id.clone(),
        engine_name: engine.display_name().to_string(),
        model_id: model.id.clone(),
        is_local,
    };

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
            if let (true, Some(claim)) = (outcome.is_err(), &request.turn) {
                state.end_turn(&label, &claim.id);
            }
        }
        let finish = match &outcome {
            Ok(result) => format!("{:?}", result.finish_reason).to_lowercase(),
            Err(error) if error.code == ErrorCode::Cancelled => "cancelled".to_string(),
            Err(error) => format!("error {}", error.code.as_str()),
        };
        let usage = outcome.as_ref().ok().and_then(|r| r.usage);
        let timing = outcome.as_ref().ok().and_then(|r| r.timing);
        eprintln!(
            "[mikedown ai] {}",
            request_log::format_request_log(
                &request.feature,
                &request.task,
                &log_served,
                started.elapsed().as_millis(),
                &finish,
                &thinking,
                usage.as_ref(),
                timing.as_ref()
            )
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
/// text to a cloud engine. Returns the stored answer, or this session's
/// "Don't allow", without asking. Three answers: "Allow for this folder" is
/// stored (in app data, with the engine's fingerprint); "Allow once" lets the
/// next completion for the engine through and is then used up, or with
/// `turn_id` lets that chat turn's requests through; "Don't allow"
/// (or closing the dialog) is remembered until the app quits. `feature` and
/// `sends` (core's `AiConsentAbout`) say what the request sends.
#[tauri::command]
pub async fn ai_request_cloud_consent<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, AiState>,
    id: String,
    feature: Option<String>,
    sends: Option<String>,
    base_ids: Option<Vec<String>>,
    turn_id: Option<String>,
) -> Result<Answer, AiError> {
    if turn_id.as_deref().is_some_and(|t| t.is_empty() || t.len() > MAX_TURN_ID_LEN) {
        return Err(AiError::unknown("Malformed chat turn."));
    }
    let config = load_config(&app)?;
    let engine = find_engine(&config, &id)?.clone();
    if engine_locality(&engine.locality, &engine.base_url, &config.local_networks) == Locality::Local {
        return Ok(Answer::Allow);
    }
    if !config.allow_cloud {
        return Err(AiError::new(ErrorCode::CloudBlocked, "Cloud engines are turned off (Allow cloud in AI settings)."));
    }
    let base = data_dir(&app)?;
    let folder = window_folder(&app, window.label());
    if let Some(answer) = state.consent_state(&base, folder.as_deref(), &engine) {
        return Ok(answer);
    }

    let base_ids = base_ids.unwrap_or_default();
    let ask = ConsentAsk { feature: feature.as_deref(), sends: sends.as_deref(), base_ids: &base_ids, turn_id: turn_id.as_deref() };
    Ok(ask_consent(&app, &window, &state, &base, folder.as_deref(), &engine, ask).await)
}

/// A chat turn is over (answered, refused, failed or cancelled): forget the
/// "Allow once" this window held for it. A turn with none is not an error.
#[tauri::command]
pub fn ai_end_turn<R: Runtime>(window: WebviewWindow<R>, state: State<'_, AiState>, turn_id: String) {
    state.end_turn(window.label(), &turn_id);
}

/// The cloud consents for this window's folder, newest first: the stored
/// ones and this session's "Don't allow" (so it can be forgotten without a
/// restart). A window with no folder has none (its answers last for the
/// session).
#[tauri::command]
pub async fn ai_list_consents<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, AiState>,
) -> Result<Vec<consent_store::ListedConsent>, AiError> {
    let Some(folder) = window_folder(&app, window.label()) else { return Ok(Vec::new()) };
    let base = data_dir(&app)?;
    let engines = load_config(&app)?.engines;
    Ok(state.list_consents(&base, &folder, &engines))
}

/// Forget this window's folder's answer for an engine (stored and session),
/// so the next request asks again.
#[tauri::command]
pub async fn ai_forget_consent<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, AiState>,
    id: String,
) -> Result<(), AiError> {
    let folder = window_folder(&app, window.label());
    state.consent.lock().unwrap().remove(&AiState::session_key(folder.as_deref(), &id));
    state.forget_turn_grants(std::slice::from_ref(&id));
    if let Some(folder) = folder {
        let base = data_dir(&app)?;
        let _io = state.consent_io.lock().unwrap();
        consent_store::forget(&base, &folder, &id).map_err(AiError::unknown)?;
    }
    Ok(())
}

/// Engines left `ai.engines`: drop their answers in every folder and in this
/// session, so an engine added later under the same id is asked again.
#[tauri::command]
pub async fn ai_forget_engine_consents<R: Runtime>(app: AppHandle<R>, state: State<'_, AiState>, ids: Vec<String>) -> Result<(), AiError> {
    if ids.is_empty() {
        return Ok(());
    }
    state.consent.lock().unwrap().retain(|(_, engine_id), _| !ids.contains(engine_id));
    state.forget_turn_grants(&ids);
    let base = data_dir(&app)?;
    let _io = state.consent_io.lock().unwrap();
    consent_store::forget_engines(&base, &ids).map_err(AiError::unknown)?;
    Ok(())
}

/// Look for local model servers (the first-run panel and the quick-start
/// cards ask; never in the background). One GET per candidate, 1.5 s each;
/// a preset's key (oMLX's key file) is sent only to its own address and only
/// after a 401. One result per candidate, in order; nothing is cached.
#[tauri::command]
pub async fn ai_detect_local_servers(state: State<'_, AiState>, candidates: Vec<detect::DetectCandidate>) -> Result<Vec<detect::LocalServerProbe>, AiError> {
    let client = state.client.clone();
    let key_for = |target: &detect::DetectTarget<'_>| detect::preset_key(target, &|n| std::env::var(n).ok());
    Ok(detect::detect_all(&client, candidates, detect::LOCAL_PRESETS, &key_for).await)
}

/// This machine's memory, CPU and GPU (core's `AiHardwareInfo`), for the
/// setup wizard. Read on the first call, cached and logged once.
#[tauri::command]
pub async fn ai_hardware_info() -> Result<hardware::HardwareInfo, AiError> {
    Ok(hardware::hardware_info().await)
}

#[cfg(test)]
mod tests;
