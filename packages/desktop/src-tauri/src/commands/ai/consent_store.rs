//! Where cloud consent answers live on Desktop: `<app-data>/ai-consent.json`,
//! one record per (canonical folder, engine id) with the engine's fingerprint,
//! the answer and when it was given. Nothing is written into the folder, so a
//! shared or synced folder cannot carry a consent to another machine or user.
//!
//! A record counts only while the engine's fingerprint (kind, base URL,
//! locality) matches; an engine edited to point somewhere else is "never
//! asked" again. Only `allow` and `never` are stored; "Not now" is a session
//! answer kept in memory by `AiState`.
//!
//! Older versions wrote `ai.consent.<engineId>: true` into
//! `<folder>/.mikedown/settings.json`. `lookup` reads that key once as a
//! migration: it becomes a record here and the key is removed from the folder
//! file. Nothing writes the old keys any more.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::model::EngineConfig;
use crate::commands::settings::{read_settings, settings_path, write_settings};

pub const FILE_NAME: &str = "ai-consent.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Answer {
    Allow,
    Never,
    /// Session only; never stored.
    NotNow,
}

impl Answer {
    pub fn is_stored(self) -> bool {
        matches!(self, Answer::Allow | Answer::Never)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub folder: String,
    pub engine_id: String,
    pub fingerprint: String,
    pub answer: Answer,
    /// Unix milliseconds.
    pub at: u64,
}

/// One consent as the settings UI lists it (`AiConsentRecord` in core).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedConsent {
    pub engine_id: String,
    pub answer: Answer,
    pub at: u64,
    pub scope: &'static str,
}

/// What the consent depends on: where the text goes. Not the key source, so
/// adding a key does not ask again.
pub fn fingerprint(engine: &EngineConfig) -> String {
    let kind = serde_json::to_value(engine.kind).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
    let url = engine.base_url.trim().trim_end_matches('/').to_ascii_lowercase();
    format!("{kind}\u{0}{url}\u{0}{}", engine.locality)
}

/// The folder as stored: canonical when it resolves, as given otherwise.
pub fn canonical_folder(folder: &Path) -> String {
    std::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf()).to_string_lossy().into_owned()
}

pub fn store_path(base: &Path) -> PathBuf {
    base.join(FILE_NAME)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Every stored record. A missing, damaged or newer-format file reads as empty.
fn read_all(base: &Path) -> Vec<Record> {
    let Ok(file) = read_settings(&store_path(base)) else { return Vec::new() };
    let Some(Value::Object(root)) = file.text.as_deref().and_then(|t| serde_json::from_str::<Value>(t).ok()) else {
        return Vec::new();
    };
    let Some(Value::Array(items)) = root.get("consents") else { return Vec::new() };
    items.iter().filter_map(|v| serde_json::from_value::<Record>(v.clone()).ok()).filter(|r| r.answer.is_stored()).collect()
}

fn write_all(base: &Path, records: &[Record]) -> Result<(), String> {
    let doc = serde_json::json!({ "version": 1, "consents": records });
    let text = format!("{}\n", serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?);
    write_settings(&store_path(base), &text).map(|_| ())
}

/// The stored answer for this folder and engine, if it still describes the
/// engine. A legacy `ai.consent.<id>: true` in the folder file is migrated
/// first.
pub fn lookup(base: &Path, folder: &Path, engine: &EngineConfig) -> Option<Answer> {
    let key = canonical_folder(folder);
    let print = fingerprint(engine);
    let found = read_all(base).into_iter().find(|r| r.folder == key && r.engine_id == engine.id);
    match found {
        Some(r) if r.fingerprint == print => Some(r.answer),
        // A stale record is as good as none; the next write replaces it.
        Some(_) => None,
        None => migrate_legacy(base, folder, engine),
    }
}

/// Store an answer (`allow` or `never`), replacing any record for the same
/// folder and engine. `NotNow` is not stored.
pub fn record(base: &Path, folder: &Path, engine: &EngineConfig, answer: Answer) -> Result<(), String> {
    if !answer.is_stored() {
        return Ok(());
    }
    let key = canonical_folder(folder);
    let mut records = read_all(base);
    records.retain(|r| !(r.folder == key && r.engine_id == engine.id));
    records.push(Record { folder: key, engine_id: engine.id.clone(), fingerprint: fingerprint(engine), answer, at: now_ms() });
    write_all(base, &records)
}

/// Remove the record for this folder and engine. True when there was one.
pub fn forget(base: &Path, folder: &Path, engine_id: &str) -> Result<bool, String> {
    let key = canonical_folder(folder);
    let mut records = read_all(base);
    let before = records.len();
    records.retain(|r| !(r.folder == key && r.engine_id == engine_id));
    if records.len() == before {
        return Ok(false);
    }
    write_all(base, &records)?;
    Ok(true)
}

/// The folder's records, newest first.
pub fn list(base: &Path, folder: &Path) -> Vec<ListedConsent> {
    let key = canonical_folder(folder);
    let mut out: Vec<ListedConsent> = read_all(base)
        .into_iter()
        .filter(|r| r.folder == key)
        .map(|r| ListedConsent { engine_id: r.engine_id, answer: r.answer, at: r.at, scope: "folder" })
        .collect();
    out.sort_by(|a, b| b.at.cmp(&a.at));
    out
}

fn legacy_key(engine_id: &str) -> String {
    format!("ai.consent.{engine_id}")
}

/// The old per-folder grant. Moves it into the app-data store and takes the
/// key out of the folder file; leaves it in place when it could not be stored
/// (it still counts, and is tried again next time).
fn migrate_legacy(base: &Path, folder: &Path, engine: &EngineConfig) -> Option<Answer> {
    let file = settings_path(folder, "folder", Some(folder)).ok()?;
    let read = read_settings(&file).ok()?;
    let Value::Object(mut map) = read.text.as_deref().and_then(|t| serde_json::from_str::<Value>(t).ok())? else {
        return None;
    };
    let key = legacy_key(&engine.id);
    if map.get(&key) != Some(&Value::Bool(true)) {
        return None;
    }
    if record(base, folder, engine, Answer::Allow).is_ok() {
        map.remove(&key);
        if let Ok(text) = serde_json::to_string_pretty(&Value::Object(map)) {
            // Best effort: a read-only folder keeps the old key, which is harmless.
            let _ = write_settings(&file, &format!("{text}\n"));
        }
    }
    Some(Answer::Allow)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mikedown-consent-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn engine(id: &str, url: &str) -> EngineConfig {
        serde_json::from_value(serde_json::json!({ "id": id, "kind": "openai", "baseUrl": url })).unwrap()
    }

    #[test]
    fn answers_are_stored_per_folder_and_engine_in_app_data() {
        let base = temp_dir("store-base");
        let a = temp_dir("store-a");
        let b = temp_dir("store-b");
        let claude = engine("claude", "https://api.anthropic.com/v1");
        assert_eq!(lookup(&base, &a, &claude), None);
        record(&base, &a, &claude, Answer::Allow).unwrap();
        assert_eq!(lookup(&base, &a, &claude), Some(Answer::Allow));
        assert_eq!(lookup(&base, &b, &claude), None, "another folder is asked separately");
        assert_eq!(lookup(&base, &a, &engine("openai", "https://api.openai.com/v1")), None, "another engine is not covered");
        record(&base, &a, &claude, Answer::Never).unwrap();
        assert_eq!(lookup(&base, &a, &claude), Some(Answer::Never), "a new answer replaces the old one");
        assert_eq!(list(&base, &a).len(), 1);
        assert!(!a.join(".mikedown").exists(), "nothing is written into the folder");
        for d in [base, a, b] {
            std::fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn not_now_is_never_stored() {
        let base = temp_dir("notnow-base");
        let dir = temp_dir("notnow-dir");
        let e = engine("claude", "https://api.anthropic.com/v1");
        record(&base, &dir, &e, Answer::NotNow).unwrap();
        assert!(!store_path(&base).exists());
        std::fs::remove_dir_all(base).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_engine_that_points_elsewhere_is_asked_again() {
        let base = temp_dir("print-base");
        let dir = temp_dir("print-dir");
        record(&base, &dir, &engine("e", "https://api.openai.com/v1"), Answer::Allow).unwrap();
        assert_eq!(lookup(&base, &dir, &engine("e", "https://api.openai.com/v1/")), Some(Answer::Allow), "a trailing slash is the same engine");
        assert_eq!(lookup(&base, &dir, &engine("e", "https://evil.example.com/v1")), None);
        // Answering again replaces the stale record.
        record(&base, &dir, &engine("e", "https://evil.example.com/v1"), Answer::Never).unwrap();
        assert_eq!(list(&base, &dir).len(), 1);
        assert_eq!(lookup(&base, &dir, &engine("e", "https://evil.example.com/v1")), Some(Answer::Never));
        std::fs::remove_dir_all(base).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn forgetting_removes_the_record() {
        let base = temp_dir("forget-base");
        let dir = temp_dir("forget-dir");
        let e = engine("claude", "https://api.anthropic.com/v1");
        assert!(!forget(&base, &dir, "claude").unwrap());
        record(&base, &dir, &e, Answer::Allow).unwrap();
        assert!(forget(&base, &dir, "claude").unwrap());
        assert_eq!(lookup(&base, &dir, &e), None);
        assert!(list(&base, &dir).is_empty());
        std::fs::remove_dir_all(base).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_damaged_store_reads_as_empty_and_is_replaced_on_the_next_answer() {
        let base = temp_dir("damaged-base");
        let dir = temp_dir("damaged-dir");
        std::fs::write(store_path(&base), "{ broken").unwrap();
        let e = engine("claude", "https://api.anthropic.com/v1");
        assert_eq!(lookup(&base, &dir, &e), None);
        record(&base, &dir, &e, Answer::Allow).unwrap();
        assert_eq!(lookup(&base, &dir, &e), Some(Answer::Allow));
        std::fs::remove_dir_all(base).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_old_folder_grant_is_migrated_once_and_removed_from_the_folder_file() {
        let base = temp_dir("legacy-base");
        let dir = temp_dir("legacy-dir");
        std::fs::create_dir_all(dir.join(".mikedown")).unwrap();
        let file = dir.join(".mikedown/settings.json");
        std::fs::write(&file, "{\n  \"versioning.keep\": 10,\n  \"ai.consent.claude\": true,\n  \"ai.consent.openai\": true\n}\n").unwrap();
        let claude = engine("claude", "https://api.anthropic.com/v1");

        assert_eq!(lookup(&base, &dir, &claude), Some(Answer::Allow));
        let json: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(json["versioning.keep"], 10, "other keys survive");
        assert!(json.get("ai.consent.claude").is_none(), "the migrated key is gone");
        assert_eq!(json["ai.consent.openai"], true, "an engine not asked about yet keeps its old key");
        // Now served from the store.
        assert_eq!(lookup(&base, &dir, &claude), Some(Answer::Allow));
        assert_eq!(list(&base, &dir).len(), 1);
        // A legacy `false` or a damaged folder file grants nothing.
        std::fs::write(&file, "{ broken").unwrap();
        assert_eq!(lookup(&base, &dir, &engine("openai", "https://api.openai.com/v1")), None);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{ broken");
        std::fs::remove_dir_all(base).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
}
