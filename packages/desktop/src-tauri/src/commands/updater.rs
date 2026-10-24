//! Self-update (M10, edge case 17) over `tauri-plugin-updater`.
//!
//! The endpoint, public key and Windows install mode come from
//! `tauri.conf.json` (`plugins.updater`); nothing here can point the updater
//! somewhere else at run time. A staging endpoint for testing is a build-time
//! config overlay (`src-tauri/tauri.staging.conf.json`), never a shipped switch.
//!
//! - `updater_claim(intervalMs)`: one check per interval for the whole app.
//!   Every window asks on launch and hourly; only the first ask after the
//!   interval wins, so a second window never repeats the launch check.
//! - `updater_check(manual)`: asks the endpoint. A newer release is kept as the
//!   pending update and announced to every window (`mikedown:update-available`).
//!   Every outcome is written to `<app-data>/logs/updater.log`; the webview
//!   decides whether the user hears about it (silent checks swallow errors).
//! - `updater_install()`: downloads the pending update (the plugin verifies the
//!   minisign signature, and with `requireSignedVersion` the signed version),
//!   then runs the quit handshake so every window gets its dirty-file dialog
//!   and writes its session. Approved: install and restart. Cancelled: the
//!   app keeps running and the update stays pending.
//! - `updater_log(line)`: the webview's own entries (an invoke that failed).

use std::fs as stdfs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const UPDATE_AVAILABLE_EVENT: &str = "mikedown:update-available";
/// The log rolls over to `updater.log.1` past this size.
const LOG_MAX_BYTES: u64 = 256 * 1024;

#[derive(Default)]
pub struct UpdaterState {
    last_check_ms: Mutex<Option<u64>>,
    pending: Mutex<Option<Update>>,
    installing: AtomicBool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
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

fn info_of(update: &Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|d| d.to_string()),
    }
}

#[tauri::command]
pub fn updater_claim(state: State<'_, UpdaterState>, interval_ms: u64) -> bool {
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
            *state.pending.lock().unwrap() = Some(update);
            let _ = app.emit(UPDATE_AVAILABLE_EVENT, info.clone());
            Ok(Some(info))
        }
        Ok(None) => {
            log(&app, &format!("check ({kind}): up to date"));
            Ok(None)
        }
        Err(e) => {
            log(&app, &format!("check ({kind}) failed: {e}"));
            Err(e.to_string())
        }
    }
}

/// The pending update, if a check found one this session.
#[tauri::command]
pub fn updater_pending(state: State<'_, UpdaterState>) -> Option<UpdateInfo> {
    state.pending.lock().unwrap().as_ref().map(info_of)
}

#[tauri::command]
pub async fn updater_install<R: Runtime>(app: AppHandle<R>, state: State<'_, UpdaterState>) -> Result<(), String> {
    let Some(update) = state.pending.lock().unwrap().clone() else {
        return Err("No update is pending.".into());
    };
    if state.installing.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    log(&app, &format!("install {}: downloading {}", update.version, update.download_url));
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(b) => b,
        Err(e) => {
            state.installing.store(false, Ordering::SeqCst);
            log(&app, &format!("install {}: download or signature check failed: {e}", update.version));
            return Err(e.to_string());
        }
    };
    log(&app, &format!("install {}: downloaded {} bytes, signature verified; asking windows", update.version, bytes.len()));
    let version = update.version.clone();
    let on_cancel = {
        let app = app.clone();
        let version = version.clone();
        move || {
            app.state::<UpdaterState>().installing.store(false, Ordering::SeqCst);
            log(&app, &format!("install {version}: cancelled at the dirty-file dialog"));
        }
    };
    super::multiwindow::request_quit_then(
        &app,
        move |app| match update.install(&bytes) {
            Ok(()) => {
                log(app, &format!("install {version}: installed, restarting"));
                app.request_restart();
            }
            Err(e) => {
                log(app, &format!("install {version}: install failed: {e}"));
                // Every window already agreed to close; quitting is what the
                // user asked for, and the next launch can check again.
                app.exit(0);
            }
        },
        on_cancel,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
