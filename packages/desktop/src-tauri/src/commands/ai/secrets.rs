//! API keys. They live in the OS keychain (service `net.iadev.mikedown`,
//! account = engine id) and never reach the webview or `settings.json`; the
//! webview only learns `hasKey`.
//!
//! Lookup order for a request: the stored key, then the environment variable
//! named by the engine's `apiKeyEnv`, then no key. Note for users: a Dock or
//! Finder launch on macOS has a sparse environment (no shell profile), so an
//! `apiKeyEnv` that works in a terminal may be unset here. Store the key in
//! the Settings modal instead.

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

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
}
