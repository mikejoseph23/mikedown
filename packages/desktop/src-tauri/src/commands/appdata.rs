//! Per-user app data (M4): hot-exit backups and per-window session files,
//! both under the OS app-data folder (`~/Library/Application Support/MikeDown`,
//! `%APPDATA%\MikeDown`).
//!
//! Backups (edge cases 7–8): `backups/<sha256 of key>.md` holds a dirty
//! buffer, `backups/index.json` maps the hash to `{ path, untitledId, folder,
//! savedAt }`. The key is the document's path, or `untitled:<id>` for an
//! unsaved document. The webview writes each dirty buffer ~1 s debounced,
//! removes the entry on save and on tab close, and lists the leftovers on
//! launch to restore them into dirty tabs.
//!
//! Sessions (edge case 28): `sessions/<window label>.json`, opaque JSON the
//! webview owns (folder, tabs, pane layout, expanded directories, cursors).
//!
//! `AppDataStore` is the pure part (a base directory); the commands bind it to
//! the app's data dir. Index updates are serialised by a mutex since several
//! windows write backups concurrently.

use std::collections::BTreeMap;
use std::fs as stdfs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};

use super::fs::atomic_write;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupMeta {
    /// The document's path, or null for an unsaved document.
    #[serde(default)]
    pub path: Option<String>,
    /// Identity of an unsaved document (its session tab refers to it).
    #[serde(default)]
    pub untitled_id: Option<String>,
    /// The window's folder when the backup was written, for the restore.
    #[serde(default)]
    pub folder: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupIndexEntry {
    #[serde(flatten)]
    pub meta: BackupMeta,
    /// Unix milliseconds of the last write.
    pub saved_at: f64,
}

/// What `backup_list` hands the webview: the index entry plus the text.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub key: String,
    #[serde(flatten)]
    pub meta: BackupMeta,
    pub saved_at: f64,
    pub text: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntry {
    pub label: String,
    pub data: serde_json::Value,
}

pub struct AppDataStore {
    base: PathBuf,
    lock: Mutex<()>,
}

pub fn hash_key(key: &str) -> String {
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    format!("{:x}", h.finalize())
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn io_err(path: &Path, e: &io::Error) -> String {
    format!("{}: {e}", path.display())
}

/// Window labels become file names; keep them to a safe alphabet.
pub fn safe_label(label: &str) -> String {
    let s: String = label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if s.is_empty() {
        "window".to_string()
    } else {
        s
    }
}

impl AppDataStore {
    pub fn new(base: PathBuf) -> Self {
        Self { base, lock: Mutex::new(()) }
    }

    fn backups_dir(&self) -> PathBuf {
        self.base.join("backups")
    }

    fn sessions_dir(&self) -> PathBuf {
        self.base.join("sessions")
    }

    fn index_path(&self) -> PathBuf {
        self.backups_dir().join("index.json")
    }

    fn read_index(&self) -> BTreeMap<String, BackupIndexEntry> {
        let path = self.index_path();
        let Ok(bytes) = stdfs::read(&path) else {
            return BTreeMap::new();
        };
        // A corrupt index is treated as empty; the backup files still exist
        // and are listed by scanning the folder (see `list_backups`).
        serde_json::from_slice(&bytes).unwrap_or_default()
    }

    fn write_index(&self, index: &BTreeMap<String, BackupIndexEntry>) -> Result<(), String> {
        let path = self.index_path();
        let json = serde_json::to_vec_pretty(index).map_err(|e| e.to_string())?;
        atomic_write(&path, &json).map_err(|e| io_err(&path, &e))
    }

    /// Write (or overwrite) the backup for `key`.
    pub fn write_backup(&self, key: &str, text: &str, meta: BackupMeta) -> Result<String, String> {
        let _guard = self.lock.lock().unwrap();
        let dir = self.backups_dir();
        stdfs::create_dir_all(&dir).map_err(|e| io_err(&dir, &e))?;
        let hash = hash_key(key);
        let file = dir.join(format!("{hash}.md"));
        atomic_write(&file, text.as_bytes()).map_err(|e| io_err(&file, &e))?;
        let mut index = self.read_index();
        index.insert(hash.clone(), BackupIndexEntry { meta, saved_at: now_ms() });
        self.write_index(&index)?;
        Ok(hash)
    }

    /// Remove the backup for `key` (a save, a tab close, a discard). Missing is fine.
    pub fn remove_backup(&self, key: &str) -> Result<(), String> {
        let _guard = self.lock.lock().unwrap();
        let hash = hash_key(key);
        let file = self.backups_dir().join(format!("{hash}.md"));
        match stdfs::remove_file(&file) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(io_err(&file, &e)),
        }
        let mut index = self.read_index();
        if index.remove(&hash).is_some() {
            self.write_index(&index)?;
        }
        Ok(())
    }

    /// Every backup on disk with its text. Index entries whose file vanished
    /// are dropped; files the index does not know are listed with empty
    /// metadata so a buffer is never silently lost.
    pub fn list_backups(&self) -> Result<Vec<BackupEntry>, String> {
        let _guard = self.lock.lock().unwrap();
        let dir = self.backups_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut index = self.read_index();
        let mut out = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        let mut pruned = false;
        for (hash, entry) in index.clone() {
            let file = dir.join(format!("{hash}.md"));
            match stdfs::read_to_string(&file) {
                Ok(text) => {
                    seen.insert(hash.clone());
                    out.push(BackupEntry { key: hash, meta: entry.meta, saved_at: entry.saved_at, text });
                }
                Err(_) => {
                    index.remove(&hash);
                    pruned = true;
                }
            }
        }
        if let Ok(entries) = stdfs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let Some(hash) = name.strip_suffix(".md") else { continue };
                if seen.contains(hash) || hash.len() != 64 {
                    continue;
                }
                if let Ok(text) = stdfs::read_to_string(entry.path()) {
                    let saved_at = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs_f64() * 1000.0)
                        .unwrap_or(0.0);
                    out.push(BackupEntry { key: hash.to_string(), meta: BackupMeta::default(), saved_at, text });
                }
            }
        }
        if pruned {
            self.write_index(&index)?;
        }
        out.sort_by(|a, b| a.saved_at.partial_cmp(&b.saved_at).unwrap_or(std::cmp::Ordering::Equal));
        Ok(out)
    }

    pub fn write_session(&self, label: &str, data: &serde_json::Value) -> Result<(), String> {
        let dir = self.sessions_dir();
        stdfs::create_dir_all(&dir).map_err(|e| io_err(&dir, &e))?;
        let file = dir.join(format!("{}.json", safe_label(label)));
        let json = serde_json::to_vec_pretty(data).map_err(|e| e.to_string())?;
        atomic_write(&file, &json).map_err(|e| io_err(&file, &e))
    }

    pub fn read_session(&self, label: &str) -> Option<serde_json::Value> {
        let file = self.sessions_dir().join(format!("{}.json", safe_label(label)));
        let bytes = stdfs::read(file).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub fn remove_session(&self, label: &str) -> Result<(), String> {
        let file = self.sessions_dir().join(format!("{}.json", safe_label(label)));
        match stdfs::remove_file(&file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(io_err(&file, &e)),
        }
    }

    pub fn list_sessions(&self) -> Vec<SessionEntry> {
        let dir = self.sessions_dir();
        let Ok(entries) = stdfs::read_dir(&dir) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(label) = name.strip_suffix(".json") else { continue };
            if let Some(data) = self.read_session(label) {
                out.push(SessionEntry { label: label.to_string(), data });
            }
        }
        out.sort_by(|a, b| a.label.cmp(&b.label));
        out
    }
}

/// The app's store, created lazily from the app-data dir.
pub struct AppData(pub Mutex<Option<AppDataStore>>);

impl Default for AppData {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

fn with_store<R: Runtime, T>(
    app: &AppHandle<R>,
    f: impl FnOnce(&AppDataStore) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<AppData>();
    let mut guard = state.0.lock().unwrap();
    if guard.is_none() {
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
        *guard = Some(AppDataStore::new(base));
    }
    f(guard.as_ref().unwrap())
}

#[tauri::command]
pub fn backup_write<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    text: String,
    meta: BackupMeta,
) -> Result<String, String> {
    with_store(&app, |s| s.write_backup(&key, &text, meta))
}

#[tauri::command]
pub fn backup_remove<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    with_store(&app, |s| s.remove_backup(&key))
}

#[tauri::command]
pub fn backup_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<BackupEntry>, String> {
    with_store(&app, |s| s.list_backups())
}

#[tauri::command]
pub fn session_write<R: Runtime>(app: AppHandle<R>, label: String, data: serde_json::Value) -> Result<(), String> {
    with_store(&app, |s| s.write_session(&label, &data))
}

#[tauri::command]
pub fn session_read<R: Runtime>(app: AppHandle<R>, label: String) -> Result<Option<serde_json::Value>, String> {
    with_store(&app, |s| Ok(s.read_session(&label)))
}

#[tauri::command]
pub fn session_remove<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    with_store(&app, |s| s.remove_session(&label))
}

#[tauri::command]
pub fn session_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<SessionEntry>, String> {
    with_store(&app, |s| Ok(s.list_sessions()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(tag: &str) -> AppDataStore {
        let dir = std::env::temp_dir().join(format!("mikedown-appdata-{tag}-{}", std::process::id()));
        let _ = stdfs::remove_dir_all(&dir);
        stdfs::create_dir_all(&dir).unwrap();
        AppDataStore::new(dir)
    }

    fn meta(path: &str) -> BackupMeta {
        BackupMeta { path: Some(path.to_string()), untitled_id: None, folder: Some("/n".to_string()) }
    }

    #[test]
    fn hash_is_sha256_hex() {
        assert_eq!(hash_key("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn write_list_remove_round_trip() {
        let store = temp_store("roundtrip");
        let hash = store.write_backup("/n/a.md", "# A\n\nedited\n", meta("/n/a.md")).unwrap();
        assert_eq!(hash, hash_key("/n/a.md"));
        store.write_backup("untitled:u1", "draft", BackupMeta { untitled_id: Some("u1".into()), ..Default::default() }).unwrap();

        let list = store.list_backups().unwrap();
        assert_eq!(list.len(), 2);
        let a = list.iter().find(|e| e.meta.path.as_deref() == Some("/n/a.md")).unwrap();
        assert_eq!(a.text, "# A\n\nedited\n");
        assert_eq!(a.meta.folder.as_deref(), Some("/n"));
        assert!(a.saved_at > 0.0);
        let u = list.iter().find(|e| e.meta.untitled_id.as_deref() == Some("u1")).unwrap();
        assert_eq!(u.text, "draft");

        // Overwrite keeps one entry, with the new text.
        store.write_backup("/n/a.md", "newer", meta("/n/a.md")).unwrap();
        let list = store.list_backups().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list.iter().find(|e| e.key == hash).unwrap().text, "newer");

        store.remove_backup("/n/a.md").unwrap();
        store.remove_backup("/n/never-written.md").unwrap();
        let list = store.list_backups().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].meta.untitled_id.as_deref(), Some("u1"));
        // The index on disk agrees.
        let index = store.read_index();
        assert_eq!(index.len(), 1);
        assert!(!store.backups_dir().join(format!("{hash}.md")).exists());
    }

    #[test]
    fn index_entry_without_a_file_is_pruned_and_orphan_files_are_listed() {
        let store = temp_store("prune");
        let hash = store.write_backup("/n/a.md", "a", meta("/n/a.md")).unwrap();
        stdfs::remove_file(store.backups_dir().join(format!("{hash}.md"))).unwrap();
        let orphan = hash_key("/n/orphan.md");
        stdfs::write(store.backups_dir().join(format!("{orphan}.md")), "orphan text").unwrap();
        // Something that is not a backup file is ignored.
        stdfs::write(store.backups_dir().join("notes.md"), "x").unwrap();

        let list = store.list_backups().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].key, orphan);
        assert_eq!(list[0].text, "orphan text");
        assert_eq!(list[0].meta, BackupMeta::default());
        assert!(store.read_index().is_empty());
    }

    #[test]
    fn corrupt_index_does_not_lose_backup_files() {
        let store = temp_store("corrupt");
        let hash = store.write_backup("/n/a.md", "kept", meta("/n/a.md")).unwrap();
        stdfs::write(store.index_path(), b"{ not json").unwrap();
        let list = store.list_backups().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].key, hash);
        assert_eq!(list[0].text, "kept");
        // Writing again repairs the index.
        store.write_backup("/n/a.md", "kept2", meta("/n/a.md")).unwrap();
        assert_eq!(store.read_index().len(), 1);
    }

    #[test]
    fn empty_store_lists_nothing() {
        let store = temp_store("empty");
        assert!(store.list_backups().unwrap().is_empty());
        assert!(store.list_sessions().is_empty());
        assert!(store.read_session("main").is_none());
        store.remove_session("main").unwrap();
    }

    #[test]
    fn sessions_round_trip_per_label() {
        let store = temp_store("sessions");
        let main = serde_json::json!({ "folder": "/n", "tabs": ["/n/a.md"] });
        let w2 = serde_json::json!({ "folder": null, "tabs": ["/x/b.md"] });
        store.write_session("main", &main).unwrap();
        store.write_session("w-2", &w2).unwrap();
        assert_eq!(store.read_session("main"), Some(main.clone()));
        let all = store.list_sessions();
        assert_eq!(all.iter().map(|s| s.label.as_str()).collect::<Vec<_>>(), vec!["main", "w-2"]);
        store.remove_session("w-2").unwrap();
        assert_eq!(store.list_sessions().len(), 1);
        // Overwrite replaces.
        let main2 = serde_json::json!({ "folder": "/m" });
        store.write_session("main", &main2).unwrap();
        assert_eq!(store.read_session("main"), Some(main2));
    }

    #[test]
    fn labels_are_made_safe_for_file_names() {
        assert_eq!(safe_label("main"), "main");
        assert_eq!(safe_label("w-2"), "w-2");
        assert_eq!(safe_label("../etc/passwd"), "___etc_passwd");
        assert_eq!(safe_label(""), "window");
    }
}
