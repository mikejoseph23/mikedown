//! Recent folders and files (M8, edge case 18) and the bundled welcome
//! document (edge case 29).
//!
//! `<app-data>/recents.json` is one JSON object the webview owns
//! (`src/app/recents.ts`: `{ version, firstRunDone, folders: [{ path,
//! missingCount, lastOpened }], files: [...] }`). This module reads and
//! writes it atomically and answers the two questions the webview cannot
//! answer through the fs scope: which listed paths are gone (a recent entry
//! may sit outside the scope until it is opened again), and may a listed
//! path be opened (`recents_allow` extends the scope only for paths the file
//! actually lists, so the webview cannot use it to probe or open anything
//! else).
//!
//! The welcome document is compiled into the binary from
//! `resources/welcome.md` and copied to `<app-data>/Welcome to MikeDown.md`
//! when asked for, so the user's edits never touch the app bundle (which is
//! signed). An unmodified older copy is refreshed with the current text; an
//! edited copy is left alone. `welcome.sha256` remembers what was written.

use std::fs as stdfs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

use super::fs::atomic_write;

pub const WELCOME_MD: &str = include_str!("../../resources/welcome.md");
pub const WELCOME_NAME: &str = "Welcome to MikeDown.md";
const WELCOME_MARKER: &str = "welcome.sha256";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentsFile {
    /// The file's text, or null when it does not exist yet (first run).
    pub text: Option<String>,
    /// Listed paths that do not exist right now.
    pub missing: Vec<String>,
}

pub fn recents_path(base: &Path) -> PathBuf {
    base.join("recents.json")
}

/// Every path listed under `folders` and `files`. Unknown shapes list nothing.
pub fn listed_paths(text: &str) -> Vec<String> {
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for key in ["folders", "files"] {
        if let Some(serde_json::Value::Array(items)) = map.get(key) {
            for item in items {
                if let Some(p) = item.get("path").and_then(|p| p.as_str()) {
                    out.push(p.to_string());
                }
            }
        }
    }
    out
}

pub fn read_recents(file: &Path) -> Result<RecentsFile, String> {
    match stdfs::read(file) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes).into_owned();
            let missing = listed_paths(&text)
                .into_iter()
                .filter(|p| !Path::new(p).exists())
                .collect();
            Ok(RecentsFile { text: Some(text), missing })
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(RecentsFile { text: None, missing: Vec::new() }),
        Err(e) => Err(format!("{}: {e}", file.display())),
    }
}

pub fn write_recents(file: &Path, text: &str) -> Result<(), String> {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(_)) => {}
        Ok(_) => return Err("recents must be a JSON object".to_string()),
        Err(e) => return Err(format!("recents are not valid JSON: {e}")),
    }
    if let Some(dir) = file.parent() {
        stdfs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    atomic_write(file, text.as_bytes()).map_err(|e| format!("{}: {e}", file.display()))
}

/// True when `path` is one of the listed entries (exact match).
pub fn is_listed(file: &Path, path: &str) -> bool {
    stdfs::read_to_string(file)
        .map(|text| listed_paths(&text).iter().any(|p| p == path))
        .unwrap_or(false)
}

fn sha_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

/// Copy the bundled welcome text into `base` unless the user edited their
/// copy. Returns the copy's path.
pub fn ensure_welcome(base: &Path, bundled: &str) -> Result<PathBuf, String> {
    let target = base.join(WELCOME_NAME);
    let marker = base.join(WELCOME_MARKER);
    let bundled_hash = sha_hex(bundled.as_bytes());
    let write_fresh = |target: &Path| -> Result<(), String> {
        stdfs::create_dir_all(base).map_err(|e| format!("{}: {e}", base.display()))?;
        atomic_write(target, bundled.as_bytes()).map_err(|e| format!("{}: {e}", target.display()))?;
        atomic_write(&marker, bundled_hash.as_bytes()).map_err(|e| format!("{}: {e}", marker.display()))
    };
    match stdfs::read(&target) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => write_fresh(&target)?,
        Err(e) => return Err(format!("{}: {e}", target.display())),
        Ok(current) => {
            let current_hash = sha_hex(&current);
            if current_hash != bundled_hash {
                let written = stdfs::read_to_string(&marker).unwrap_or_default();
                if written.trim() == current_hash {
                    // Our own older copy, untouched: refresh it.
                    write_fresh(&target)?;
                }
            }
        }
    }
    Ok(target)
}

fn base_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recents_read<R: Runtime>(app: AppHandle<R>) -> Result<RecentsFile, String> {
    read_recents(&recents_path(&base_dir(&app)?))
}

#[tauri::command]
pub fn recents_write<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    write_recents(&recents_path(&base_dir(&app)?), &text)
}

/// Extend the fs and asset scopes to a listed recent entry (a folder
/// recursively, a file with its folder, as a dialog pick would), so it opens
/// after a restart even when it sits outside the home folder.
#[tauri::command]
pub fn recents_allow<R: Runtime>(app: AppHandle<R>, path: String) -> Result<bool, String> {
    if !is_listed(&recents_path(&base_dir(&app)?), &path) {
        return Ok(false);
    }
    let p = PathBuf::from(&path);
    if p.is_dir() {
        let _ = app.fs_scope().allow_directory(&p, true);
        let _ = app.asset_protocol_scope().allow_directory(&p, true);
    } else {
        super::fs::allow_document(&app, &p);
    }
    Ok(true)
}

/// The welcome document's path in app data (copied from the bundle on demand).
#[tauri::command]
pub fn welcome_file<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let path = ensure_welcome(&base_dir(&app)?, WELCOME_MD)?;
    super::fs::allow_document(&app, &path);
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mikedown-recents-{tag}-{}", std::process::id()));
        let _ = stdfs::remove_dir_all(&dir);
        stdfs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_reads_as_first_run() {
        let dir = temp_dir("first");
        let got = read_recents(&recents_path(&dir)).unwrap();
        assert_eq!(got, RecentsFile { text: None, missing: vec![] });
    }

    #[test]
    fn write_then_read_reports_missing_paths() {
        let dir = temp_dir("rw");
        let present = dir.join("notes");
        stdfs::create_dir_all(&present).unwrap();
        let gone = dir.join("gone.md");
        let text = serde_json::json!({
            "version": 1,
            "firstRunDone": true,
            "folders": [{ "path": present.to_string_lossy(), "missingCount": 0, "lastOpened": 1 }],
            "files": [{ "path": gone.to_string_lossy(), "missingCount": 2, "lastOpened": 2 }],
        })
        .to_string();
        let file = recents_path(&dir);
        write_recents(&file, &text).unwrap();
        let got = read_recents(&file).unwrap();
        assert_eq!(got.text.as_deref(), Some(text.as_str()));
        assert_eq!(got.missing, vec![gone.to_string_lossy().into_owned()]);
        assert!(is_listed(&file, &present.to_string_lossy()));
        assert!(!is_listed(&file, "/etc/passwd"));
    }

    #[test]
    fn write_refuses_non_objects_and_keeps_the_old_file() {
        let dir = temp_dir("bad");
        let file = recents_path(&dir);
        write_recents(&file, r#"{"version":1,"folders":[],"files":[]}"#).unwrap();
        assert!(write_recents(&file, "[1,2]").is_err());
        assert!(write_recents(&file, "{not json").is_err());
        assert_eq!(stdfs::read_to_string(&file).unwrap(), r#"{"version":1,"folders":[],"files":[]}"#);
    }

    #[test]
    fn corrupt_file_lists_nothing() {
        assert!(listed_paths("{oops").is_empty());
        assert!(listed_paths(r#"{"folders":"x"}"#).is_empty());
        assert_eq!(listed_paths(r#"{"files":[{"path":"/a.md"},{"nope":1}]}"#), vec!["/a.md".to_string()]);
    }

    #[test]
    fn welcome_is_copied_refreshed_when_untouched_and_kept_when_edited() {
        let dir = temp_dir("welcome");
        let p = ensure_welcome(&dir, "v1").unwrap();
        assert_eq!(p, dir.join(WELCOME_NAME));
        assert_eq!(stdfs::read_to_string(&p).unwrap(), "v1");
        // A new bundled version replaces an untouched copy.
        ensure_welcome(&dir, "v2").unwrap();
        assert_eq!(stdfs::read_to_string(&p).unwrap(), "v2");
        // The user's edit survives the next version.
        stdfs::write(&p, "my notes").unwrap();
        ensure_welcome(&dir, "v3").unwrap();
        assert_eq!(stdfs::read_to_string(&p).unwrap(), "my notes");
    }

    #[test]
    fn bundled_welcome_is_a_real_cheat_sheet() {
        for needle in ["# Welcome to MikeDown", "Slash commands", "| ", "[!NOTE]", "[[", "Keyboard shortcuts"] {
            assert!(WELCOME_MD.contains(needle), "welcome.md lacks {needle}");
        }
    }
}
