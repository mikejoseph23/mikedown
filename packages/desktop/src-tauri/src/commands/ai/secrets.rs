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
