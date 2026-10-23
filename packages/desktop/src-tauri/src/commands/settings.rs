//! Settings files (M5): the global `<app-data>/settings.json` and the optional
//! per-folder `<folder>/.mikedown/settings.json`. The webview parses, merges
//! and validates (`src/settings/`); this module only reads and writes the two
//! files. Reads never create anything. A write validates that the text is a
//! JSON object (so a bug cannot leave a file the next launch calls corrupt),
//! creates `.mikedown/` only when a folder file is written, and goes through
//! the same atomic write as documents.

use std::fs as stdfs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use super::fs::{atomic_write, ensure_allowed};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    /// Absolute path of the file (it may not exist yet).
    pub path: String,
    /// The file's text, or null when it does not exist.
    pub text: Option<String>,
}

/// Which file a scope names: `global` lives in `base`, `folder` in
/// `<folder>/.mikedown/`.
pub fn settings_path(base: &Path, scope: &str, folder: Option<&Path>) -> Result<PathBuf, String> {
    match scope {
        "global" => Ok(base.join("settings.json")),
        "folder" => {
            let folder = folder.ok_or_else(|| "a folder scope needs a folder".to_string())?;
            Ok(folder.join(".mikedown").join("settings.json"))
        }
        other => Err(format!("unknown settings scope \"{other}\"")),
    }
}

pub fn read_settings(file: &Path) -> Result<SettingsFile, String> {
    let path = file.to_string_lossy().into_owned();
    match stdfs::read(file) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes).into_owned();
            // A UTF-8 BOM from a hand edit is not part of the JSON.
            let text = text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text);
            Ok(SettingsFile { path, text: Some(text) })
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(SettingsFile { path, text: None }),
        Err(e) => Err(format!("{path}: {e}")),
    }
}

pub fn write_settings(file: &Path, text: &str) -> Result<SettingsFile, String> {
    let path = file.to_string_lossy().into_owned();
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(_)) => {}
        Ok(_) => return Err("settings must be a JSON object".to_string()),
        Err(e) => return Err(format!("settings are not valid JSON: {e}")),
    }
    if let Some(dir) = file.parent() {
        stdfs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    atomic_write(file, text.as_bytes()).map_err(|e| format!("{path}: {e}"))?;
    Ok(SettingsFile { path, text: Some(text.to_string()) })
}

fn resolve<R: Runtime>(app: &AppHandle<R>, scope: &str, folder: Option<PathBuf>) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if let Some(dir) = &folder {
        ensure_allowed(app, dir)?;
    }
    settings_path(&base, scope, folder.as_deref())
}

#[tauri::command]
pub fn settings_read<R: Runtime>(app: AppHandle<R>, scope: String, folder: Option<PathBuf>) -> Result<SettingsFile, String> {
    read_settings(&resolve(&app, &scope, folder)?)
}

#[tauri::command]
pub fn settings_write<R: Runtime>(
    app: AppHandle<R>,
    scope: String,
    folder: Option<PathBuf>,
    text: String,
) -> Result<SettingsFile, String> {
    write_settings(&resolve(&app, &scope, folder)?, &text)
}

/// Windows: Settings > Default apps. Elsewhere there is no URI to open; the
/// webview explains the Finder route instead.
#[tauri::command]
pub fn open_default_apps_settings() -> Result<bool, String> {
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mikedown-settings-{tag}-{}", std::process::id()));
        let _ = stdfs::remove_dir_all(&dir);
        stdfs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scopes_map_to_the_two_files() {
        let base = Path::new("/data/MikeDown");
        let folder = Path::new("/notes");
        assert_eq!(settings_path(base, "global", None).unwrap(), base.join("settings.json"));
        assert_eq!(
            settings_path(base, "folder", Some(folder)).unwrap(),
            folder.join(".mikedown").join("settings.json")
        );
        assert!(settings_path(base, "folder", None).is_err());
        assert!(settings_path(base, "elsewhere", None).is_err());
    }

    #[test]
    fn reading_a_missing_file_is_not_an_error_and_creates_nothing() {
        let dir = temp_dir("missing");
        let file = settings_path(&dir, "folder", Some(&dir)).unwrap();
        let read = read_settings(&file).unwrap();
        assert_eq!(read.text, None);
        assert!(!dir.join(".mikedown").exists());
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn writing_a_folder_file_creates_dot_mikedown_and_round_trips() {
        let dir = temp_dir("write");
        let file = settings_path(&dir, "folder", Some(&dir)).unwrap();
        write_settings(&file, "{\n  \"versioning.keep\": 10\n}\n").unwrap();
        assert!(dir.join(".mikedown").is_dir());
        let read = read_settings(&file).unwrap();
        assert_eq!(read.text.as_deref(), Some("{\n  \"versioning.keep\": 10\n}\n"));
        // Only the settings file, no temp leftovers.
        let names: Vec<_> = stdfs::read_dir(dir.join(".mikedown"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["settings.json".to_string()]);
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn invalid_or_non_object_text_is_rejected_and_the_file_is_untouched() {
        let dir = temp_dir("invalid");
        let file = settings_path(&dir, "global", None).unwrap();
        stdfs::write(&file, "{ broken").unwrap();
        assert!(write_settings(&file, "{ also broken").is_err());
        assert!(write_settings(&file, "[1, 2]").is_err());
        assert_eq!(stdfs::read_to_string(&file).unwrap(), "{ broken");
        // The hand-corrupted file reads back as it is; the webview decides.
        assert_eq!(read_settings(&file).unwrap().text.as_deref(), Some("{ broken"));
        // An explicit reset replaces it.
        write_settings(&file, "{}\n").unwrap();
        assert_eq!(stdfs::read_to_string(&file).unwrap(), "{}\n");
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_bom_from_a_hand_edit_is_dropped_on_read() {
        let dir = temp_dir("bom");
        let file = dir.join("settings.json");
        stdfs::write(&file, "\u{feff}{\"fontSize\": 18}").unwrap();
        assert_eq!(read_settings(&file).unwrap().text.as_deref(), Some("{\"fontSize\": 18}"));
        stdfs::remove_dir_all(&dir).unwrap();
    }
}
