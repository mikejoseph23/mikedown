//! Self-update (M10, edge case 17; engine reworked in U1) over
//! `tauri-plugin-updater`.
//!
//! The endpoints, public key and Windows install mode come from
//! `tauri.conf.json` (`plugins.updater`); nothing here can point the updater
//! somewhere else at run time. A staging endpoint for testing is a build-time
//! config overlay (`src-tauri/tauri.staging.conf.json`), never a shipped switch.
//!
//! - `updater_claim(intervalMs)`: one check per interval for the whole app.
//!   Every window asks on its tick; only the first ask after the interval
//!   wins, so a second window never repeats the check.
//! - `updater_check(manual)`: asks the endpoints. A newer release becomes the
//!   pending update and is announced to every window
//!   (`mikedown:update-available`), unless a silent check finds it skipped or
//!   snoozed (`<app-data>/updater-state.json`). A manual check clears both
//!   first. While a download or install is running a check does not touch the
//!   network or the pending update.
//! - `updater_download()`: downloads and verifies (minisign + signed version)
//!   the pending update, emitting `mikedown:update-progress` (about 10/s) and
//!   `mikedown:update-state`. The verified bytes are kept for the session, so
//!   a cancelled quit dialog does not download again.
//! - `updater_install()`: downloads if needed, runs the OS code-signing check
//!   (`updater_verify`), then the quit handshake so every window gets its
//!   dirty-file dialog and writes its session. Approved: `installing` is
//!   emitted, then install and restart. Cancelled: back to `ready`.
//! - `updater_skip(version)`, `updater_snooze(days)`, `updater_status()`.
//! - `updater_log(line)`: the webview's own entries (an invoke that failed).
//!
//! Every outcome is written to `<app-data>/logs/updater.log`; the webview
//! decides whether the user hears about it (silent checks swallow errors).
//!
//! Channel: `MIKEDOWN_CHANNEL=store` (runtime env, or baked in at build time)
//! leaves the plugin uninitialized and makes every command a quiet no-op.

use std::fs as stdfs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const UPDATE_AVAILABLE_EVENT: &str = "mikedown:update-available";
pub const UPDATE_PROGRESS_EVENT: &str = "mikedown:update-progress";
pub const UPDATE_STATE_EVENT: &str = "mikedown:update-state";
/// The log rolls over to `updater.log.1` past this size.
const LOG_MAX_BYTES: u64 = 256 * 1024;
const STATE_FILE: &str = "updater-state.json";
/// Remind Me Later.
pub const DEFAULT_SNOOZE_DAYS: u32 = 14;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
/// Progress events are throttled to about 10 per second.
const PROGRESS_INTERVAL_MS: u64 = 100;

pub const CHANNEL_DIRECT: &str = "direct";
pub const CHANNEL_STORE: &str = "store";

/// Distribution channel: `store` only when `MIKEDOWN_CHANNEL=store` (read at
/// run time first, then the value baked in at build time); anything else is
/// `direct`.
pub fn channel() -> &'static str {
    channel_from(std::env::var("MIKEDOWN_CHANNEL").ok().as_deref().or(option_env!("MIKEDOWN_CHANNEL")))
}

pub fn channel_from(value: Option<&str>) -> &'static str {
    match value.map(str::trim) {
        Some(v) if v.eq_ignore_ascii_case(CHANNEL_STORE) => CHANNEL_STORE,
        _ => CHANNEL_DIRECT,
    }
}

/// What survives a restart (`<app-data>/updater-state.json`).
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PersistedState {
    pub skipped_version: Option<String>,
    /// Unix ms; silent checks stay quiet until then.
    pub snooze_until: Option<u64>,
    /// Unix ms of the last completed check (silent or manual).
    pub last_checked_at: Option<u64>,
    /// `upToDate`, `available`, `suppressed`, or `error`.
    pub last_result: Option<String>,
}

/// Read the state file. Missing is an empty state. Corrupt is an empty state
/// plus a message for the log.
pub fn read_state(path: &Path) -> (PersistedState, Option<String>) {
    match stdfs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<PersistedState>(&text) {
            Ok(s) => (s, None),
            Err(e) => (PersistedState::default(), Some(format!("{STATE_FILE} is corrupt ({e}); starting empty"))),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (PersistedState::default(), None),
        Err(e) => (PersistedState::default(), Some(format!("{STATE_FILE} unreadable ({e}); starting empty"))),
    }
}

/// Write a temp file, then rename over the target, so a crash never leaves
/// half a file.
pub fn write_state(path: &Path, state: &PersistedState) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        stdfs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(state).map_err(std::io::Error::other)?;
    {
        let mut f = stdfs::File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }
    stdfs::rename(&tmp, path)
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Suppression {
    Skipped,
    Snoozed,
}

/// Why a silent check must stay quiet about `version`, if it must.
pub fn suppression(state: &PersistedState, version: &str, now_ms: u64) -> Option<Suppression> {
    if state.skipped_version.as_deref() == Some(version) {
        return Some(Suppression::Skipped);
    }
    if state.snooze_until.is_some_and(|until| now_ms < until) {
        return Some(Suppression::Snoozed);
    }
    None
}

/// A manual check starts clean: no skip, no snooze.
pub fn clear_suppression(state: &mut PersistedState) {
    state.skipped_version = None;
    state.snooze_until = None;
}

/// Throttle for download progress events: the first chunk, then at most one
/// per interval, and always the final chunk.
pub struct ProgressThrottle {
    last_ms: Option<u64>,
    interval_ms: u64,
}

impl ProgressThrottle {
    pub fn new(interval_ms: u64) -> Self {
        Self { last_ms: None, interval_ms }
    }
    pub fn should_emit(&mut self, now_ms: u64, downloaded: u64, total: Option<u64>) -> bool {
        let done = total.is_some_and(|t| downloaded >= t);
        let due = match self.last_ms {
            None => true,
            Some(t) => now_ms.saturating_sub(t) >= self.interval_ms,
        };
        if done || due {
            self.last_ms = Some(now_ms);
            true
        } else {
            false
        }
    }
}

/// Controller phase mirrored to every window (`mikedown:update-state`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Available,
    Downloading,
    Verifying,
    Ready,
    Installing,
    Failed,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Available => "available",
            Phase::Downloading => "downloading",
            Phase::Verifying => "verifying",
            Phase::Ready => "ready",
            Phase::Installing => "installing",
            Phase::Failed => "failed",
        }
    }
    /// A download or install is running: checks must not disturb it.
    pub fn busy(self) -> bool {
        matches!(self, Phase::Downloading | Phase::Verifying | Phase::Installing)
    }
}

struct Cached {
    version: String,
    bytes: Arc<Vec<u8>>,
}

pub struct UpdaterState {
    last_check_ms: Mutex<Option<u64>>,
    pending: Mutex<Option<Update>>,
    cached: Mutex<Option<Cached>>,
    phase: Mutex<Phase>,
    installing: AtomicBool,
    /// Serializes read-modify-write of the state file.
    file_lock: Mutex<()>,
}

impl Default for UpdaterState {
    fn default() -> Self {
        Self {
            last_check_ms: Mutex::new(None),
            pending: Mutex::new(None),
            cached: Mutex::new(None),
            phase: Mutex::new(Phase::Idle),
            installing: AtomicBool::new(false),
            file_lock: Mutex::new(()),
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct StateEvent {
    state: &'static str,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatus {
    pub phase: &'static str,
    pub version: Option<String>,
    pub channel: &'static str,
    pub last_checked_at: Option<u64>,
    pub last_result: Option<String>,
    pub skipped_version: Option<String>,
    pub snooze_until: Option<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// True when a check is due: never checked, or `interval_ms` has passed since
/// the last claim. A winning claim records `now_ms`.
pub fn claim(last: &mut Option<u64>, now_ms: u64, interval_ms: u64) -> bool {
    match *last {
        Some(t) if now_ms.saturating_sub(t) < interval_ms => false,
        _ => {
            *last = Some(now_ms);
            true
        }
    }
}

/// `2026-10-23T21:40:05Z` from Unix milliseconds (UTC, no chrono dependency).
pub fn iso_utc(ms: u64) -> String {
    let secs = ms / 1000;
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    // Howard Hinnant's civil_from_days.
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if mo <= 2 { 1 } else { 0 };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Append one timestamped line to `<dir>/updater.log`, rolling the file over
/// to `updater.log.1` once it passes `max_bytes`. Never fails loudly: the
/// updater's errors are logged and swallowed, and so are the log's own.
pub fn append_log(dir: &Path, line: &str, now_ms: u64, max_bytes: u64) -> std::io::Result<PathBuf> {
    stdfs::create_dir_all(dir)?;
    let path = dir.join("updater.log");
    if stdfs::metadata(&path).map(|m| m.len() > max_bytes).unwrap_or(false) {
        let _ = stdfs::rename(&path, dir.join("updater.log.1"));
    }
    let mut f = stdfs::OpenOptions::new().create(true).append(true).open(&path)?;
    let clean = line.replace(['\r', '\n'], " ");
    writeln!(f, "{} {}", iso_utc(now_ms), clean)?;
    Ok(path)
}

fn log_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("logs"))
}

pub fn log<R: Runtime>(app: &AppHandle<R>, line: &str) {
    if let Some(dir) = log_dir(app) {
        let _ = append_log(&dir, line, now_ms(), LOG_MAX_BYTES);
    }
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(STATE_FILE))
}

/// Load the persisted state (logging a corrupt file), let `f` change it, and
/// write it back atomically when `f` returns true. Returns the state after.
fn update_persisted<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterState,
    f: impl FnOnce(&mut PersistedState) -> bool,
) -> PersistedState {
    let _guard = state.file_lock.lock().unwrap();
    let Some(path) = state_path(app) else { return PersistedState::default() };
    let (mut s, warning) = read_state(&path);
    if let Some(w) = warning {
        log(app, &w);
    }
    if f(&mut s) {
        if let Err(e) = write_state(&path, &s) {
            log(app, &format!("could not write {STATE_FILE}: {e}"));
        }
    }
    s
}

fn load_persisted<R: Runtime>(app: &AppHandle<R>, state: &UpdaterState) -> PersistedState {
    update_persisted(app, state, |_| false)
}

fn record_check<R: Runtime>(app: &AppHandle<R>, state: &UpdaterState, result: &str) {
    update_persisted(app, state, |s| {
        s.last_checked_at = Some(now_ms());
        s.last_result = Some(result.to_string());
        true
    });
}

fn info_of(update: &Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|d| d.to_string()),
    }
}

fn pending_version(state: &UpdaterState) -> Option<String> {
    state.pending.lock().unwrap().as_ref().map(|u| u.version.clone())
}

fn phase(state: &UpdaterState) -> Phase {
    *state.phase.lock().unwrap()
}

fn set_phase<R: Runtime>(app: &AppHandle<R>, state: &UpdaterState, next: Phase, error: Option<String>) {
    *state.phase.lock().unwrap() = next;
    let _ = app.emit(
        UPDATE_STATE_EVENT,
        StateEvent { state: next.as_str(), version: pending_version(state), error },
    );
}

#[tauri::command]
pub fn updater_claim(state: State<'_, UpdaterState>, interval_ms: u64) -> bool {
    if channel() == CHANNEL_STORE {
        return false;
    }
    claim(&mut state.last_check_ms.lock().unwrap(), now_ms(), interval_ms)
}

#[tauri::command]
pub fn updater_log<R: Runtime>(app: AppHandle<R>, line: String) {
    log(&app, &format!("[webview] {line}"));
}

#[tauri::command]
pub async fn updater_check<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdaterState>,
    manual: bool,
) -> Result<Option<UpdateInfo>, String> {
    let kind = if manual { "manual" } else { "silent" };
    if channel() == CHANNEL_STORE {
        return Ok(None);
    }
    // A download or install in flight owns the pending update; do not touch it.
    if phase(&state).busy() {
        log(&app, &format!("check ({kind}): skipped, {} in progress", phase(&state).as_str()));
        return Ok(state.pending.lock().unwrap().as_ref().map(info_of));
    }
    if manual {
        update_persisted(&app, &state, |s| {
            let had = s.skipped_version.is_some() || s.snooze_until.is_some();
            clear_suppression(s);
            had
        });
    }
    let current = app.package_info().version.to_string();
    log(&app, &format!("check ({kind}) from {current}"));
    let updater = app.updater().map_err(|e| {
        log(&app, &format!("check ({kind}) failed to start: {e}"));
        e.to_string()
    })?;
    match updater.check().await {
        Ok(Some(update)) => {
            let info = info_of(&update);
            log(&app, &format!("check ({kind}): {} available ({})", info.version, update.download_url));
            if !manual {
                let persisted = load_persisted(&app, &state);
                if let Some(why) = suppression(&persisted, &info.version, now_ms()) {
                    let label = match why {
                        Suppression::Skipped => "skipped by the user",
                        Suppression::Snoozed => "snoozed",
                    };
                    log(&app, &format!("check (silent): {} not announced, {label}", info.version));
                    record_check(&app, &state, "suppressed");
                    return Ok(None);
                }
            }
            // Keep a verified download of this same version; drop one of another.
            let keep = state.cached.lock().unwrap().as_ref().is_some_and(|c| c.version == info.version);
            if !keep {
                *state.cached.lock().unwrap() = None;
            }
            *state.pending.lock().unwrap() = Some(update);
            set_phase(&app, &state, if keep { Phase::Ready } else { Phase::Available }, None);
            let _ = app.emit(UPDATE_AVAILABLE_EVENT, info.clone());
            record_check(&app, &state, "available");
            Ok(Some(info))
        }
        Ok(None) => {
            log(&app, &format!("check ({kind}): up to date"));
            record_check(&app, &state, "upToDate");
            Ok(None)
        }
        Err(e) => {
            log(&app, &format!("check ({kind}) failed: {e}"));
            record_check(&app, &state, "error");
            Err(e.to_string())
        }
    }
}

/// The pending update, if a check found one this session.
#[tauri::command]
pub fn updater_pending(state: State<'_, UpdaterState>) -> Option<UpdateInfo> {
    state.pending.lock().unwrap().as_ref().map(info_of)
}

/// "Skip This Version": silent checks stay quiet about `version` for good.
#[tauri::command]
pub fn updater_skip<R: Runtime>(app: AppHandle<R>, state: State<'_, UpdaterState>, version: String) {
    log(&app, &format!("skip {version}"));
    update_persisted(&app, &state, |s| {
        s.skipped_version = Some(version.clone());
        true
    });
    // A skipped update is no longer pending, unless it is mid-flight.
    if !phase(&state).busy() && pending_version(&state).as_deref() == Some(version.as_str()) {
        *state.pending.lock().unwrap() = None;
        *state.cached.lock().unwrap() = None;
        set_phase(&app, &state, Phase::Idle, None);
    }
}

/// "Remind Me Later": silent checks stay quiet for `days` (default 14).
#[tauri::command]
pub fn updater_snooze<R: Runtime>(app: AppHandle<R>, state: State<'_, UpdaterState>, days: Option<u32>) {
    let days = days.unwrap_or(DEFAULT_SNOOZE_DAYS);
    let until = now_ms() + u64::from(days) * DAY_MS;
    log(&app, &format!("snooze {days} days (until {})", iso_utc(until)));
    update_persisted(&app, &state, |s| {
        s.snooze_until = Some(until);
        true
    });
}

/// Everything the Settings "Last checked" line and the UI controller need.
#[tauri::command]
pub fn updater_status<R: Runtime>(app: AppHandle<R>, state: State<'_, UpdaterState>) -> UpdaterStatus {
    let p = load_persisted(&app, &state);
    UpdaterStatus {
        phase: phase(&state).as_str(),
        version: pending_version(&state),
        channel: channel(),
        last_checked_at: p.last_checked_at,
        last_result: p.last_result,
        skipped_version: p.skipped_version,
        snooze_until: p.snooze_until,
    }
}

/// Download and verify the pending update. Returns when it is `ready`. A call
/// while a download is already running waits for that one instead of starting
/// another.
async fn ensure_downloaded<R: Runtime>(app: &AppHandle<R>, state: &UpdaterState) -> Result<Arc<Vec<u8>>, String> {
    let Some(update) = state.pending.lock().unwrap().clone() else {
        return Err("No update is pending.".into());
    };
    if let Some(c) = state.cached.lock().unwrap().as_ref() {
        if c.version == update.version {
            return Ok(c.bytes.clone());
        }
    }
    // Someone else is downloading: wait for them.
    while matches!(phase(state), Phase::Downloading | Phase::Verifying) {
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(100)))
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(c) = state.cached.lock().unwrap().as_ref() {
        if c.version == update.version {
            return Ok(c.bytes.clone());
        }
    }
    log(app, &format!("download {}: {}", update.version, update.download_url));
    set_phase(app, state, Phase::Downloading, None);
    let mut downloaded: u64 = 0;
    let mut throttle = ProgressThrottle::new(PROGRESS_INTERVAL_MS);
    let progress_app = app.clone();
    let finish_app = app.clone();
    let result = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                if throttle.should_emit(now_ms(), downloaded, total) {
                    let _ = progress_app.emit(UPDATE_PROGRESS_EVENT, ProgressEvent { downloaded, total });
                }
            },
            move || {
                let st = finish_app.state::<UpdaterState>();
                set_phase(&finish_app, &st, Phase::Verifying, None);
            },
        )
        .await;
    match result {
        Ok(bytes) => {
            log(app, &format!("download {}: complete, {} bytes, signature verified", update.version, bytes.len()));
            let bytes = Arc::new(bytes);
            *state.cached.lock().unwrap() = Some(Cached { version: update.version.clone(), bytes: bytes.clone() });
            set_phase(app, state, Phase::Ready, None);
            Ok(bytes)
        }
        Err(e) => {
            let msg = e.to_string();
            log(app, &format!("download {}: download or signature check failed: {msg}", update.version));
            set_phase(app, state, Phase::Failed, Some(msg.clone()));
            Err(msg)
        }
    }
}

/// Download and verify the pending update without installing it.
#[tauri::command]
pub async fn updater_download<R: Runtime>(app: AppHandle<R>, state: State<'_, UpdaterState>) -> Result<(), String> {
    if channel() == CHANNEL_STORE {
        return Ok(());
    }
    ensure_downloaded(&app, &state).await.map(|_| ())
}

#[tauri::command]
pub async fn updater_install<R: Runtime>(app: AppHandle<R>, state: State<'_, UpdaterState>) -> Result<(), String> {
    if channel() == CHANNEL_STORE {
        return Ok(());
    }
    let Some(update) = state.pending.lock().unwrap().clone() else {
        return Err("No update is pending.".into());
    };
    if state.installing.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let bytes = match ensure_downloaded(&app, &state).await {
        Ok(b) => b,
        Err(e) => {
            state.installing.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    let version = update.version.clone();

    // The OS-level code-signing check, before any window is asked to close.
    let check_bytes = bytes.clone();
    let check = tauri::async_runtime::spawn_blocking(move || super::updater_verify::preinstall_check(&check_bytes))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match check {
        Ok(note) => log(&app, &format!("install {version}: pre-install check passed ({note})")),
        Err(e) => {
            state.installing.store(false, Ordering::SeqCst);
            log(&app, &format!("install {version}: pre-install check FAILED, refusing to install: {e}"));
            set_phase(&app, &state, Phase::Failed, Some(e.clone()));
            return Err(e);
        }
    }

    log(&app, &format!("install {version}: asking windows"));
    let on_cancel = {
        let app = app.clone();
        let version = version.clone();
        move || {
            let st = app.state::<UpdaterState>();
            st.installing.store(false, Ordering::SeqCst);
            log(&app, &format!("install {version}: cancelled at the dirty-file dialog"));
            set_phase(&app, &st, Phase::Ready, None);
        }
    };
    super::multiwindow::request_quit_then(
        &app,
        move |app| {
            let st = app.state::<UpdaterState>();
            // Before the plugin runs the installer (on Windows it exits the
            // process right after launching it), so the UI can say so.
            set_phase(app, &st, Phase::Installing, None);
            match update.install(bytes.as_slice()) {
                Ok(()) => {
                    log(app, &format!("install {version}: installed, restarting"));
                    app.request_restart();
                }
                Err(e) => {
                    log(app, &format!("install {version}: install failed: {e}"));
                    set_phase(app, &st, Phase::Failed, Some(e.to_string()));
                    // Every window already agreed to close; quitting is what the
                    // user asked for, and the next launch can check again.
                    app.exit(0);
                }
            }
        },
        on_cancel,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mikedown-updater-{name}-{}", std::process::id()));
        let _ = stdfs::remove_dir_all(&d);
        stdfs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn claim_first_then_interval() {
        let mut last = None;
        assert!(claim(&mut last, 1_000, 10_000));
        assert!(!claim(&mut last, 5_000, 10_000));
        assert!(!claim(&mut last, 10_999, 10_000));
        assert!(claim(&mut last, 11_000, 10_000));
        assert_eq!(last, Some(11_000));
    }

    #[test]
    fn claim_survives_clock_going_back() {
        let mut last = Some(50_000);
        assert!(!claim(&mut last, 40_000, 10_000));
    }

    #[test]
    fn claim_four_hour_cadence() {
        let four_h = 4 * 60 * 60 * 1000;
        let mut last = None;
        assert!(claim(&mut last, 10_000, four_h));
        assert!(!claim(&mut last, 10_000 + four_h - 1, four_h));
        assert!(claim(&mut last, 10_000 + four_h, four_h));
    }

    #[test]
    fn iso_dates() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1_761_255_605_000), "2025-10-23T21:40:05Z");
        assert_eq!(iso_utc(951_782_400_000), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn log_appends_and_rolls_over() {
        let dir = std::env::temp_dir().join(format!("mikedown-updater-log-{}", std::process::id()));
        let _ = stdfs::remove_dir_all(&dir);
        let p = append_log(&dir, "one\nline", 0, 64).unwrap();
        append_log(&dir, "two", 1000, 64).unwrap();
        let text = stdfs::read_to_string(&p).unwrap();
        assert_eq!(text, "1970-01-01T00:00:00Z one line\n1970-01-01T00:00:01Z two\n");
        append_log(&dir, &"x".repeat(80), 2000, 64).unwrap();
        append_log(&dir, "after", 3000, 64).unwrap();
        assert!(dir.join("updater.log.1").exists());
        assert_eq!(stdfs::read_to_string(&p).unwrap(), "1970-01-01T00:00:03Z after\n");
        let _ = stdfs::remove_dir_all(&dir);
    }

    #[test]
    fn state_missing_reads_empty_silently() {
        let d = temp("missing");
        let (s, warn) = read_state(&d.join(STATE_FILE));
        assert_eq!(s, PersistedState::default());
        assert!(warn.is_none());
        let _ = stdfs::remove_dir_all(&d);
    }

    #[test]
    fn state_round_trips_atomically() {
        let d = temp("roundtrip");
        let path = d.join("nested").join(STATE_FILE);
        let s = PersistedState {
            skipped_version: Some("0.3.0".into()),
            snooze_until: Some(123),
            last_checked_at: Some(456),
            last_result: Some("upToDate".into()),
        };
        write_state(&path, &s).unwrap();
        assert!(!path.with_extension("json.tmp").exists(), "temp file is renamed away");
        let (back, warn) = read_state(&path);
        assert_eq!(back, s);
        assert!(warn.is_none());
        // Overwrite works (rename over an existing file).
        write_state(&path, &PersistedState::default()).unwrap();
        assert_eq!(read_state(&path).0, PersistedState::default());
        let text = stdfs::read_to_string(&path).unwrap();
        assert!(text.contains("skippedVersion"), "camelCase keys: {text}");
        let _ = stdfs::remove_dir_all(&d);
    }

    #[test]
    fn state_corrupt_reads_empty_and_warns() {
        let d = temp("corrupt");
        let path = d.join(STATE_FILE);
        stdfs::write(&path, "{ not json").unwrap();
        let (s, warn) = read_state(&path);
        assert_eq!(s, PersistedState::default());
        assert!(warn.unwrap().contains("corrupt"));
        let _ = stdfs::remove_dir_all(&d);
    }

    #[test]
    fn state_partial_file_fills_defaults() {
        let d = temp("partial");
        let path = d.join(STATE_FILE);
        stdfs::write(&path, r#"{"skippedVersion":"1.0.0","somethingNew":1}"#).unwrap();
        let (s, warn) = read_state(&path);
        assert_eq!(s.skipped_version.as_deref(), Some("1.0.0"));
        assert_eq!(s.snooze_until, None);
        assert!(warn.is_none());
        let _ = stdfs::remove_dir_all(&d);
    }

    #[test]
    fn skip_filters_only_that_version() {
        let s = PersistedState { skipped_version: Some("0.2.0".into()), ..Default::default() };
        assert_eq!(suppression(&s, "0.2.0", 0), Some(Suppression::Skipped));
        assert_eq!(suppression(&s, "0.3.0", 0), None);
    }

    #[test]
    fn snooze_filters_until_the_deadline() {
        let s = PersistedState { snooze_until: Some(1_000), ..Default::default() };
        assert_eq!(suppression(&s, "9.9.9", 999), Some(Suppression::Snoozed));
        assert_eq!(suppression(&s, "9.9.9", 1_000), None);
        assert_eq!(suppression(&PersistedState::default(), "1.0.0", 5), None);
    }

    #[test]
    fn manual_check_clears_skip_and_snooze_but_keeps_history() {
        let mut s = PersistedState {
            skipped_version: Some("0.2.0".into()),
            snooze_until: Some(u64::MAX),
            last_checked_at: Some(7),
            last_result: Some("suppressed".into()),
        };
        clear_suppression(&mut s);
        assert_eq!(suppression(&s, "0.2.0", 0), None);
        assert_eq!(s.last_checked_at, Some(7));
    }

    #[test]
    fn snooze_default_is_fourteen_days() {
        assert_eq!(DEFAULT_SNOOZE_DAYS, 14);
        assert_eq!(u64::from(DEFAULT_SNOOZE_DAYS) * DAY_MS, 1_209_600_000);
    }

    #[test]
    fn progress_is_throttled_but_final_chunk_always_emits() {
        let mut t = ProgressThrottle::new(100);
        assert!(t.should_emit(0, 10, Some(1000)));
        assert!(!t.should_emit(50, 20, Some(1000)));
        assert!(!t.should_emit(99, 30, Some(1000)));
        assert!(t.should_emit(100, 40, Some(1000)));
        assert!(!t.should_emit(120, 50, Some(1000)));
        assert!(t.should_emit(121, 1000, Some(1000)), "the last chunk is never dropped");
        // Unknown total: only the interval gates.
        let mut u = ProgressThrottle::new(100);
        assert!(u.should_emit(0, 1, None));
        assert!(!u.should_emit(10, 2, None));
        assert!(u.should_emit(200, 3, None));
    }

    #[test]
    fn channel_defaults_to_direct() {
        assert_eq!(channel_from(None), CHANNEL_DIRECT);
        assert_eq!(channel_from(Some("")), CHANNEL_DIRECT);
        assert_eq!(channel_from(Some("direct")), CHANNEL_DIRECT);
        assert_eq!(channel_from(Some("beta")), CHANNEL_DIRECT);
        assert_eq!(channel_from(Some("store")), CHANNEL_STORE);
        assert_eq!(channel_from(Some(" Store ")), CHANNEL_STORE);
    }

    #[test]
    fn phases_name_and_busy() {
        assert_eq!(Phase::Verifying.as_str(), "verifying");
        assert!(Phase::Downloading.busy() && Phase::Verifying.busy() && Phase::Installing.busy());
        assert!(!Phase::Idle.busy() && !Phase::Available.busy() && !Phase::Ready.busy() && !Phase::Failed.busy());
    }
}
