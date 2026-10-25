//! API keys. They live in the OS keychain (service `net.iadev.mikedown`,
//! account = engine id) and never reach the webview or `settings.json`; the
//! webview only learns `hasKey`.
//!
//! Lookup order for a request: the stored key, then the environment variable
//! named by the engine's `apiKeyEnv`, then the engine's `apiKeyFile`, then no
//! key. A Dock or Finder launch on macOS has a sparse environment (no shell
//! profile), so an `apiKeyEnv` that works in a terminal may be unset here; the
//! key file (oMLX's `~/.omlx/settings.json`) does not depend on the
//! environment. Or store the key in the Settings modal.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::model::ApiKeyFile;

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

/// A key file bigger than this is not read.
pub const KEY_FILE_MAX_BYTES: u64 = 64 * 1024;

pub const KEYCHAIN_SERVICE: &str = "net.iadev.mikedown";

/// Where keys are kept. The app uses the keychain; tests use memory.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    /// Deleting a key that is not there is not an error.
    fn delete(&self, account: &str) -> Result<(), String>;
}

pub struct KeychainStore;

impl KeychainStore {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, account).map_err(|e| e.to_string())
    }
}

impl SecretStore for KeychainStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        Self::entry(account)?.set_password(secret).map_err(|e| e.to_string())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// In-memory store for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

/// The key for an engine: stored first, then `apiKeyEnv` (non-empty), else None.
/// A keychain failure is treated as "no stored key" so a locked keychain does
/// not hide a working environment variable; the error is returned alongside.
pub fn resolve_key(
    store: &dyn SecretStore,
    engine_id: &str,
    api_key_env: Option<&str>,
    env: &dyn Fn(&str) -> Option<String>,
) -> (Option<String>, Option<String>) {
    let (stored, problem) = match store.get(engine_id) {
        Ok(v) => (v.filter(|k| !k.is_empty()), None),
        Err(e) => (None, Some(e)),
    };
    if stored.is_some() {
        return (stored, problem);
    }
    let from_env = api_key_env
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .and_then(env)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    (from_env, problem)
}

/// The user's home folder from the environment (`HOME`, else `USERPROFILE`).
pub fn home_from_env(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    ["HOME", "USERPROFILE"].iter().filter_map(|n| env(n)).find(|v| !v.trim().is_empty()).map(PathBuf::from)
}

/// The string at `json_path` (dotted) in the file `spec` names. Only a regular
/// file under `home` (after resolving `~` and symlinks) is read, at most 64 KB.
/// The error says why the source gave no key and never holds the key or the
/// file's contents.
pub fn read_key_file(spec: &ApiKeyFile, home: &Path) -> Result<String, String> {
    let raw = spec.path.trim();
    let json_path = spec.json_path.trim();
    if raw.is_empty() || json_path.is_empty() {
        return Err("the key file needs a path and a JSON path".into());
    }
    let home = fs::canonicalize(home).map_err(|e| format!("home folder unavailable ({})", e.kind()))?;
    let expanded = if raw == "~" {
        home.clone()
    } else if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        home.join(rest)
    } else {
        PathBuf::from(raw)
    };
    if !expanded.is_absolute() {
        return Err("not an absolute path".into());
    }
    let resolved = fs::canonicalize(&expanded).map_err(|e| e.kind().to_string())?;
    if resolved == home || !resolved.starts_with(&home) {
        return Err("outside the home folder".into());
    }
    let file = fs::File::open(&resolved).map_err(|e| e.kind().to_string())?;
    let meta = file.metadata().map_err(|e| e.kind().to_string())?;
    if !meta.is_file() {
        return Err("not a regular file".into());
    }
    if meta.len() > KEY_FILE_MAX_BYTES {
        return Err("file too large".into());
    }
    let mut text = String::new();
    file.take(KEY_FILE_MAX_BYTES + 1).read_to_string(&mut text).map_err(|e| e.kind().to_string())?;
    if text.len() as u64 > KEY_FILE_MAX_BYTES {
        return Err("file too large".into());
    }
    let mut value: Value = serde_json::from_str(&text).map_err(|_| "not valid JSON".to_string())?;
    for part in json_path.split('.') {
        value = match value {
            Value::Object(mut map) => map.remove(part).ok_or_else(|| "no string at the JSON path".to_string())?,
            _ => return Err("no string at the JSON path".into()),
        };
    }
    match value {
        Value::String(s) if !s.trim().is_empty() => Ok(s.trim().to_string()),
        _ => Err("no string at the JSON path".into()),
    }
}

/// The result of a full key lookup: the key (if any), a keychain failure, and
/// why the key file gave nothing (only set when the file was consulted).
pub struct KeyLookup {
    pub key: Option<String>,
    pub keychain_problem: Option<String>,
    pub file_problem: Option<String>,
}

/// `resolve_key`, then the key file when the stored key and the variable both gave nothing.
pub fn resolve_key_with_file(
    store: &dyn SecretStore,
    engine_id: &str,
    api_key_env: Option<&str>,
    key_file: Option<&ApiKeyFile>,
    env: &dyn Fn(&str) -> Option<String>,
) -> KeyLookup {
    let (key, keychain_problem) = resolve_key(store, engine_id, api_key_env, env);
    if key.is_some() {
        return KeyLookup { key, keychain_problem, file_problem: None };
    }
    let Some(spec) = key_file else {
        return KeyLookup { key: None, keychain_problem, file_problem: None };
    };
    let outcome = home_from_env(env).ok_or_else(|| "no home folder".to_string()).and_then(|home| read_key_file(spec, &home));
    match outcome {
        Ok(k) => KeyLookup { key: Some(k), keychain_problem, file_problem: None },
        Err(why) => KeyLookup { key: None, keychain_problem, file_problem: Some(why) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_with(name: &'static str, value: &'static str) -> impl Fn(&str) -> Option<String> {
        move |n| (n == name).then(|| value.to_string())
    }

    #[test]
    fn a_stored_key_beats_the_environment() {
        let store = MemoryStore::default();
        store.set("omlx", "stored").unwrap();
        let (key, _) = resolve_key(&store, "omlx", Some("OMLX_API_KEY"), &env_with("OMLX_API_KEY", "from-env"));
        assert_eq!(key.as_deref(), Some("stored"));
    }

    #[test]
    fn the_environment_variable_is_the_fallback() {
        let store = MemoryStore::default();
        let (key, _) = resolve_key(&store, "omlx", Some("OMLX_API_KEY"), &env_with("OMLX_API_KEY", " from-env "));
        assert_eq!(key.as_deref(), Some("from-env"));
        // Unset, empty or unnamed variables give no key.
        assert_eq!(resolve_key(&store, "omlx", Some("OTHER"), &env_with("OMLX_API_KEY", "x")).0, None);
        assert_eq!(resolve_key(&store, "omlx", Some("OMLX_API_KEY"), &env_with("OMLX_API_KEY", "  ")).0, None);
        assert_eq!(resolve_key(&store, "omlx", None, &env_with("OMLX_API_KEY", "x")).0, None);
    }

    #[test]
    fn deleting_clears_the_key_and_is_idempotent() {
        let store = MemoryStore::default();
        store.set("a", "k").unwrap();
        store.delete("a").unwrap();
        store.delete("a").unwrap();
        assert_eq!(store.get("a").unwrap(), None);
    }

    struct Locked;
    impl SecretStore for Locked {
        fn get(&self, _: &str) -> Result<Option<String>, String> { Err("keychain locked".into()) }
        fn set(&self, _: &str, _: &str) -> Result<(), String> { Err("keychain locked".into()) }
        fn delete(&self, _: &str) -> Result<(), String> { Err("keychain locked".into()) }
    }

    #[test]
    fn a_locked_keychain_still_allows_the_environment_fallback() {
        let (key, problem) = resolve_key(&Locked, "omlx", Some("K"), &env_with("K", "env"));
        assert_eq!(key.as_deref(), Some("env"));
        assert_eq!(problem.as_deref(), Some("keychain locked"));
    }

    /// A throwaway "home" and "elsewhere" folder pair; the tests never touch the real `~`.
    mod key_file {
        use super::*;
        use std::sync::atomic::{AtomicU32, Ordering};

        static NEXT: AtomicU32 = AtomicU32::new(0);

        struct Dirs {
            root: PathBuf,
            home: PathBuf,
            outside: PathBuf,
        }

        impl Dirs {
            fn new() -> Self {
                let n = NEXT.fetch_add(1, Ordering::SeqCst);
                let root = std::env::temp_dir().join(format!("mikedown-keyfile-{}-{n}", std::process::id()));
                let _ = fs::remove_dir_all(&root);
                let home = root.join("home");
                let outside = root.join("outside");
                fs::create_dir_all(home.join(".omlx")).unwrap();
                fs::create_dir_all(&outside).unwrap();
                Dirs { root, home, outside }
            }

            fn write(&self, rel: &str, body: &str) -> PathBuf {
                let p = self.home.join(rel);
                fs::write(&p, body).unwrap();
                p
            }

            fn env(&self) -> impl Fn(&str) -> Option<String> + '_ {
                move |n| (n == "HOME").then(|| self.home.to_string_lossy().into_owned())
            }
        }

        impl Drop for Dirs {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.root);
            }
        }

        fn spec(path: &str, json_path: &str) -> ApiKeyFile {
            ApiKeyFile { path: path.into(), json_path: json_path.into() }
        }

        fn omlx() -> ApiKeyFile {
            spec("~/.omlx/settings.json", "auth.api_key")
        }

        #[test]
        fn reads_the_string_at_the_json_path_after_expanding_the_tilde() {
            let d = Dirs::new();
            d.write(".omlx/settings.json", r#"{"auth":{"api_key":" sk-file "},"other":1}"#);
            assert_eq!(read_key_file(&omlx(), &d.home).as_deref(), Ok("sk-file"));
            // An absolute path under home works too.
            let abs = d.home.join(".omlx/settings.json");
            assert_eq!(read_key_file(&spec(abs.to_str().unwrap(), "auth.api_key"), &d.home).as_deref(), Ok("sk-file"));
        }

        #[test]
        fn the_order_is_stored_then_variable_then_file() {
            let d = Dirs::new();
            d.write(".omlx/settings.json", r#"{"auth":{"api_key":"from-file"}}"#);
            let store = MemoryStore::default();
            let env = |n: &str| match n {
                "HOME" => Some(d.home.to_string_lossy().into_owned()),
                "OMLX_API_KEY" => Some("from-env".to_string()),
                _ => None,
            };
            let file = omlx();
            store.set("omlx", "stored").unwrap();
            assert_eq!(resolve_key_with_file(&store, "omlx", Some("OMLX_API_KEY"), Some(&file), &env).key.as_deref(), Some("stored"));
            store.delete("omlx").unwrap();
            assert_eq!(resolve_key_with_file(&store, "omlx", Some("OMLX_API_KEY"), Some(&file), &env).key.as_deref(), Some("from-env"));
            let no_var = d.env();
            let lookup = resolve_key_with_file(&store, "omlx", Some("OMLX_API_KEY"), Some(&file), &no_var);
            assert_eq!((lookup.key.as_deref(), lookup.file_problem), (Some("from-file"), None));
            // No file spec: no key, and no problem to report.
            let none = resolve_key_with_file(&store, "omlx", Some("OMLX_API_KEY"), None, &no_var);
            assert_eq!((none.key, none.file_problem), (None, None));
        }

        #[test]
        fn a_missing_file_bad_json_and_a_non_string_give_no_key() {
            let d = Dirs::new();
            assert!(read_key_file(&omlx(), &d.home).is_err(), "missing file");
            d.write(".omlx/settings.json", "{ not json");
            assert_eq!(read_key_file(&omlx(), &d.home), Err("not valid JSON".to_string()));
            d.write(".omlx/settings.json", r#"{"auth":{"api_key":42}}"#);
            assert_eq!(read_key_file(&omlx(), &d.home), Err("no string at the JSON path".to_string()));
            d.write(".omlx/settings.json", r#"{"auth":{"api_key":"  "}}"#);
            assert!(read_key_file(&omlx(), &d.home).is_err(), "blank string");
            d.write(".omlx/settings.json", r#"{"auth":["x"]}"#);
            assert!(read_key_file(&omlx(), &d.home).is_err(), "array in the path");
            assert!(read_key_file(&spec("", "a"), &d.home).is_err());
            assert!(read_key_file(&spec("~/x", " "), &d.home).is_err());
        }

        #[test]
        fn a_file_outside_home_is_refused() {
            let d = Dirs::new();
            let elsewhere = d.outside.join("k.json");
            fs::write(&elsewhere, r#"{"auth":{"api_key":"nope"}}"#).unwrap();
            assert_eq!(read_key_file(&spec(elsewhere.to_str().unwrap(), "auth.api_key"), &d.home), Err("outside the home folder".to_string()));
            assert!(read_key_file(&spec("relative/k.json", "a"), &d.home).is_err(), "relative paths are refused");
            // `..` climbing out of home resolves outside it.
            assert_eq!(read_key_file(&spec("~/../outside/k.json", "auth.api_key"), &d.home), Err("outside the home folder".to_string()));
        }

        #[cfg(unix)]
        #[test]
        fn a_symlink_escaping_home_is_refused_and_one_inside_is_followed() {
            let d = Dirs::new();
            let target = d.outside.join("k.json");
            fs::write(&target, r#"{"auth":{"api_key":"nope"}}"#).unwrap();
            std::os::unix::fs::symlink(&target, d.home.join(".omlx/settings.json")).unwrap();
            assert_eq!(read_key_file(&omlx(), &d.home), Err("outside the home folder".to_string()));

            d.write("real.json", r#"{"auth":{"api_key":"inside"}}"#);
            std::os::unix::fs::symlink(d.home.join("real.json"), d.home.join("link.json")).unwrap();
            assert_eq!(read_key_file(&spec("~/link.json", "auth.api_key"), &d.home).as_deref(), Ok("inside"));
        }

        #[test]
        fn a_directory_and_an_oversize_file_are_refused() {
            let d = Dirs::new();
            assert_eq!(read_key_file(&spec("~/.omlx", "a"), &d.home), Err("not a regular file".to_string()));
            let padding = " ".repeat(KEY_FILE_MAX_BYTES as usize);
            d.write(".omlx/settings.json", &format!(r#"{{"auth":{{"api_key":"big"}}}}{padding}"#));
            assert_eq!(read_key_file(&omlx(), &d.home), Err("file too large".to_string()));
        }

        #[test]
        fn a_problem_never_contains_the_key_or_the_file_text() {
            let d = Dirs::new();
            d.write(".omlx/settings.json", r#"{"auth":{"api_key":{"secret":"sk-leak"}}}"#);
            let why = read_key_file(&omlx(), &d.home).unwrap_err();
            assert!(!why.contains("sk-leak") && !why.contains("secret"), "{why}");
            d.write(".omlx/settings.json", "sk-leak not json");
            let why = read_key_file(&omlx(), &d.home).unwrap_err();
            assert!(!why.contains("sk-leak"), "{why}");
        }

        #[test]
        fn engine_config_reads_the_key_file_and_treats_a_malformed_one_as_absent() {
            use super::super::super::model::EngineConfig;
            let good: EngineConfig = serde_json::from_value(serde_json::json!({
                "id": "e", "kind": "openai-compatible", "baseUrl": "http://127.0.0.1:8000/v1",
                "apiKeyFile": { "path": "~/.omlx/settings.json", "jsonPath": "auth.api_key" }
            }))
            .unwrap();
            assert_eq!(good.api_key_file, Some(omlx()));
            for bad in [serde_json::json!({ "path": "~/x" }), serde_json::json!("~/x"), serde_json::json!(7), serde_json::Value::Null] {
                let e: EngineConfig = serde_json::from_value(serde_json::json!({
                    "id": "e", "kind": "openai-compatible", "baseUrl": "http://x/v1", "apiKeyFile": bad
                }))
                .unwrap();
                assert_eq!(e.api_key_file, None);
            }
        }

        #[test]
        fn home_comes_from_home_then_userprofile() {
            let env = |n: &str| match n {
                "HOME" => Some(" ".to_string()),
                "USERPROFILE" => Some("C:\\Users\\mike".to_string()),
                _ => None,
            };
            assert_eq!(home_from_env(&env), Some(PathBuf::from("C:\\Users\\mike")));
            assert_eq!(home_from_env(&|_| None), None);
        }
    }

    /// The real `KeychainStore` wrapper on the `keyring` crate's mock
    /// credentials (no OS keychain). The crate's stock mock keeps a secret
    /// inside each `Entry` only, and the wrapper makes a fresh `Entry` per
    /// call, so this builder hands every (service, account) the same mock
    /// credential, the way a real keychain would.
    mod keychain {
        use super::*;
        use keyring::credential::{Credential, CredentialApi, CredentialBuilderApi};
        use keyring::mock::MockCredential;
        use std::any::Any;
        use std::sync::{Arc, Once, OnceLock};

        type Shared = Mutex<HashMap<(String, String), Arc<MockCredential>>>;

        fn shared() -> &'static Shared {
            static SHARED: OnceLock<Shared> = OnceLock::new();
            SHARED.get_or_init(Default::default)
        }

        struct Handle(Arc<MockCredential>);

        impl CredentialApi for Handle {
            fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
                self.0.set_secret(secret)
            }
            fn get_secret(&self) -> keyring::Result<Vec<u8>> {
                self.0.get_secret()
            }
            fn delete_credential(&self) -> keyring::Result<()> {
                self.0.delete_credential()
            }
            fn as_any(&self) -> &dyn Any {
                self
            }
        }

        struct Builder;

        impl CredentialBuilderApi for Builder {
            fn build(&self, _target: Option<&str>, service: &str, user: &str) -> keyring::Result<Box<Credential>> {
                let mut all = shared().lock().unwrap();
                let credential = all.entry((service.to_string(), user.to_string())).or_default().clone();
                Ok(Box::new(Handle(credential)))
            }
            fn as_any(&self) -> &dyn Any {
                self
            }
        }

        /// Replace the default builder once per test process. No other test in
        /// this crate creates a keyring entry (they use `MemoryStore`).
        fn install() {
            static ONCE: Once = Once::new();
            ONCE.call_once(|| keyring::set_default_credential_builder(Box::new(Builder)));
        }

        /// Make the next call on (service, account) fail the way a locked
        /// keychain does.
        fn fail_next(account: &str, error: keyring::Error) {
            let all = shared().lock().unwrap();
            let credential = all.get(&(KEYCHAIN_SERVICE.to_string(), account.to_string())).expect("entry was created");
            credential.inner.lock().unwrap().borrow_mut().error = Some(error);
        }

        #[test]
        fn keys_round_trip_under_the_mikedown_service_and_the_engine_id() {
            install();
            let store = KeychainStore;
            assert_eq!(store.get("kc-omlx").unwrap(), None, "no entry is none, not an error");
            store.set("kc-omlx", "sk-1").unwrap();
            assert_eq!(store.get("kc-omlx").unwrap().as_deref(), Some("sk-1"));
            store.set("kc-omlx", "sk-2").unwrap();
            assert_eq!(store.get("kc-omlx").unwrap().as_deref(), Some("sk-2"), "set replaces");
            assert_eq!(store.get("kc-other").unwrap(), None, "accounts are separate");

            let all = shared().lock().unwrap();
            assert!(all.contains_key(&("net.iadev.mikedown".to_string(), "kc-omlx".to_string())));
        }

        #[test]
        fn deleting_removes_the_key_and_a_missing_key_is_not_an_error() {
            install();
            let store = KeychainStore;
            store.set("kc-del", "k").unwrap();
            store.delete("kc-del").unwrap();
            assert_eq!(store.get("kc-del").unwrap(), None);
            store.delete("kc-del").unwrap();
            store.delete("kc-never-set").unwrap();
        }

        #[test]
        fn keychain_failures_surface_as_messages_and_resolve_key_falls_back_to_the_environment() {
            install();
            let store = KeychainStore;
            store.set("kc-locked", "stored").unwrap();

            fail_next("kc-locked", keyring::Error::NoStorageAccess("keychain locked".into()));
            let err = store.get("kc-locked").unwrap_err();
            assert!(err.contains("keychain locked"), "{err}");
            fail_next("kc-locked", keyring::Error::PlatformFailure("denied".into()));
            assert!(store.set("kc-locked", "new").is_err());
            fail_next("kc-locked", keyring::Error::PlatformFailure("denied".into()));
            assert!(store.delete("kc-locked").is_err());
            assert_eq!(store.get("kc-locked").unwrap().as_deref(), Some("stored"), "a failed set or delete changes nothing");

            fail_next("kc-locked", keyring::Error::NoStorageAccess("keychain locked".into()));
            let (key, problem) = resolve_key(&store, "kc-locked", Some("K"), &env_with("K", "from-env"));
            assert_eq!(key.as_deref(), Some("from-env"));
            assert!(problem.unwrap().contains("keychain locked"));
            let (key, problem) = resolve_key(&store, "kc-locked", Some("K"), &env_with("K", "from-env"));
            assert_eq!((key.as_deref(), problem), (Some("stored"), None), "the stored key wins once the keychain answers");
        }
    }
}
