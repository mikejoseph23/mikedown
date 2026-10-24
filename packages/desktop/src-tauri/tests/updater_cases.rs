//! Headless updater cases, run by `deploy/updater-staging-test.sh --headless`
//! (macOS) and `deploy/updater-staging-test.ps1` (Windows). All `#[ignore]`d:
//! they need the staging server and artifacts the scripts build.
//!
//! The real engine under test: `src/commands/updater.rs` and
//! `updater_verify.rs` are compiled into this test crate by path, so
//! `updater_check`, `updater_download`, `updater_skip`, the state file, the
//! log and the pre-install check are the shipped code, driving the real
//! `tauri-plugin-updater` (shipped public key, `requireSignedVersion`) on
//! Tauri's mock runtime against a static server on 127.0.0.1. The install
//! tests use the plugin directly with `executable_path` pointed at a COPY of
//! the old app, because the controller's install would replace the running
//! test binary.
//!
//! Every case prints one line the scripts parse:
//!   [case] <name>: PASS|FAIL|SKIP <detail>
//!
//! Env (set by the scripts):
//!   MIKEDOWN_E2E_BASE        http://127.0.0.1:<port>   scenario folders live under it
//!   MIKEDOWN_E2E_DEAD_PORT   a port nothing listens on (the offline case)
//!   MIKEDOWN_E2E_CURRENT     N, the running version
//!   MIKEDOWN_E2E_EXPECT      N+1
//!   MIKEDOWN_E2E_GOOD_FILE   file name of the good N+1 payload (for URL checks)
//!   MIKEDOWN_E2E_PRECHECK_OK    path of a payload the OS check must accept
//!   MIKEDOWN_E2E_PRECHECK_BAD   `label=path;label=path` payloads it must refuse
//!   MIKEDOWN_E2E_INSTALL_APP    (macOS) copy of N's .app to update in place
//!   MIKEDOWN_E2E_LEGACY_APP     (macOS) copy of the real 0.1.0 .app
//!   MIKEDOWN_E2E_LEGACY_CONF    (macOS) JSON file: 0.1.0's `plugins.updater` as it shipped
//!   MIKEDOWN_E2E_WIN_INSTALL_EXE (Windows) installed N's exe, for the install hand-over

#![allow(dead_code, unused_imports)]

#[path = "../src/commands"]
mod commands {
    pub mod multiwindow {
        use tauri::{AppHandle, Runtime};
        /// The controller's install path is never driven from this harness
        /// (it would replace the running test binary's own bundle).
        pub fn request_quit_then<R, F, C>(_app: &AppHandle<R>, _then: F, _on_cancel: C)
        where
            R: Runtime,
            F: FnOnce(&AppHandle<R>) + Send + 'static,
            C: FnOnce() + Send + 'static,
        {
            unimplemented!("the staging harness never installs through the controller");
        }
    }
    #[path = "updater_verify.rs"]
    pub mod updater_verify;
    #[path = "updater.rs"]
    pub mod updater;
}

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::test::MockRuntime;
use tauri::{Listener, Manager};
use tauri_plugin_updater::UpdaterExt;

use commands::updater::{self, UpdaterState};

const PROD_BASE: &str = "https://www.iadev.net/mikedown/";

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is not set (run the deploy/updater-staging-test script)"))
}
fn env_opt(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn shipped_conf() -> Value {
    serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json parses")
}

/// Print the line the scripts read; true when the case passed.
fn report(name: &str, outcome: Result<String, String>) -> bool {
    match outcome {
        Ok(d) => {
            println!("[case] {name}: PASS {d}");
            true
        }
        Err(e) => {
            println!("[case] {name}: FAIL {e}");
            false
        }
    }
}
fn skip(name: &str, why: &str) {
    println!("[case] {name}: SKIP {why}");
}
fn ensure(cond: bool, msg: impl FnOnce() -> String) -> Result<(), String> {
    if cond { Ok(()) } else { Err(msg()) }
}

struct Harness {
    app: tauri::App<MockRuntime>,
    available: Arc<AtomicUsize>,
    data_dir: PathBuf,
}

impl Harness {
    fn log(&self) -> String {
        std::fs::read_to_string(self.data_dir.join("logs").join("updater.log")).unwrap_or_default()
    }
    fn events(&self) -> usize {
        self.available.load(Ordering::SeqCst)
    }
    fn check(&self, manual: bool) -> Result<Option<updater::UpdateInfo>, String> {
        let st = self.app.state::<UpdaterState>();
        tauri::async_runtime::block_on(updater::updater_check(self.app.handle().clone(), st, manual))
    }
    fn download(&self) -> Result<(), String> {
        let st = self.app.state::<UpdaterState>();
        tauri::async_runtime::block_on(updater::updater_download(self.app.handle().clone(), st))
    }
    fn status(&self) -> updater::UpdaterStatus {
        updater::updater_status(self.app.handle().clone(), self.app.state::<UpdaterState>())
    }
    fn state_file(&self) -> Value {
        std::fs::read_to_string(self.data_dir.join("updater-state.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or(Value::Null)
    }
}

/// The updater config as shipped (or as 0.1.0 shipped it), with the production
/// base swapped for `new_base`. Endpoint ORDER and template are the shipped ones.
fn updater_conf(shipped: &Value, new_base: &str) -> Value {
    let mut u = shipped.clone();
    let eps: Vec<Value> = u["endpoints"]
        .as_array()
        .expect("endpoints")
        .iter()
        .map(|e| Value::String(e.as_str().unwrap().replace(PROD_BASE, new_base)))
        .collect();
    u["endpoints"] = Value::Array(eps);
    u["dangerousInsecureTransportProtocol"] = json!(true);
    u
}

fn harness(case: &str, updater_conf: Value, current: &str) -> Harness {
    let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
    ctx.config_mut().identifier = format!("com.interappdev.mikedown.e2e.{case}");
    ctx.config_mut().plugins.0.insert("updater".into(), updater_conf);
    ctx.package_info_mut().version = current.parse().expect("current version");
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(UpdaterState::default())
        .build(ctx)
        .expect("mock app");
    let data_dir = app.path().app_data_dir().expect("app data dir");
    let _ = std::fs::remove_dir_all(&data_dir);
    let available = Arc::new(AtomicUsize::new(0));
    let counter = available.clone();
    app.listen(updater::UPDATE_AVAILABLE_EVENT, move |_| {
        counter.fetch_add(1, Ordering::SeqCst);
    });
    Harness { app, available, data_dir }
}

fn scenario(case: &str, name: &str, current: &str) -> Harness {
    let base = format!("{}/{name}/", env("MIKEDOWN_E2E_BASE"));
    harness(case, updater_conf(&shipped_conf()["plugins"]["updater"], &base), current)
}

// ---------------------------------------------------------------- checks

#[test]
#[ignore]
fn shipped_config() {
    let ok = report("shipped-config", (|| {
        let u = &shipped_conf()["plugins"]["updater"];
        let eps: Vec<&str> = u["endpoints"].as_array().ok_or("no endpoints")?.iter().filter_map(|e| e.as_str()).collect();
        ensure(
            eps == [
                "https://www.iadev.net/mikedown/latest-{{target}}-{{arch}}.json",
                "https://www.iadev.net/mikedown/latest.json",
            ],
            || format!("endpoints are {eps:?}"),
        )?;
        ensure(u["requireSignedVersion"] == json!(true), || "requireSignedVersion is not true".into())?;
        ensure(u["windows"]["installMode"] == json!("quiet"), || "windows installMode is not quiet".into())?;
        Ok("per-target then latest.json, requireSignedVersion on, windows quiet".into())
    })());
    assert!(ok);
}

fn good_update(h: &Harness, what: &str) -> Result<String, String> {
    let expect = env("MIKEDOWN_E2E_EXPECT");
    let info = h.check(false)?.ok_or_else(|| format!("no update offered ({what})"))?;
    ensure(info.version == expect, || format!("offered {} not {expect}", info.version))?;
    ensure(h.events() == 1, || format!("{} availability events, expected 1", h.events()))?;
    h.download().map_err(|e| format!("download refused: {e}"))?;
    let st = h.status();
    ensure(st.phase == "ready", || format!("phase is {}, expected ready", st.phase))?;
    ensure(h.log().contains("signature verified"), || "log has no 'signature verified' line".into())?;
    Ok(format!("{} -> {} downloaded and verified ({what})", info.current_version, info.version))
}

#[test]
#[ignore]
fn n_to_next_via_per_target_file() {
    let ok = report("per-target N to N+1", good_update(&scenario("pertarget", "pertarget", &env("MIKEDOWN_E2E_CURRENT")), "per-target file; the 9.9.9 decoy latest.json was ignored"));
    assert!(ok);
}

#[test]
#[ignore]
fn per_target_404_falls_back_to_latest_json() {
    let ok = report("per-target 404 falls back to latest.json", good_update(&scenario("fallback", "fallback", &env("MIKEDOWN_E2E_CURRENT")), "latest.json"));
    assert!(ok);
}

fn must_refuse(case: &str, scenario_name: &str, log_needle: &str) -> Result<String, String> {
    let h = scenario(case, scenario_name, &env("MIKEDOWN_E2E_CURRENT"));
    let info = h.check(false)?.ok_or("manifest was not even offered, so the download check never ran")?;
    let err = match h.download() {
        Ok(()) => return Err(format!("{} DOWNLOADED AND VERIFIED, it must be refused", info.version)),
        Err(e) => e,
    };
    let st = h.status();
    ensure(st.phase == "failed", || format!("phase is {}, expected failed", st.phase))?;
    ensure(h.log().contains(log_needle), || format!("log lacks '{log_needle}'"))?;
    Ok(format!("refused: {err}"))
}

#[test]
#[ignore]
fn tampered_artifact_is_rejected() {
    assert!(report("tampered artifact rejected", must_refuse("tampered", "tampered", "signature check failed")));
}

#[test]
#[ignore]
fn manifest_signed_with_another_key_is_rejected() {
    assert!(report("manifest signed with a different key rejected", must_refuse("wrongkey", "wrongkey", "signature check failed")));
}

#[test]
#[ignore]
fn replayed_older_artifact_is_rejected() {
    assert!(report("replay (N artifact under N+1 version) rejected", must_refuse("replay", "replay", "signature check failed")));
}

fn offers_nothing(case: &str, scenario_name: &str, what: &str) -> Result<String, String> {
    let h = scenario(case, scenario_name, &env("MIKEDOWN_E2E_CURRENT"));
    let r = h.check(false)?;
    ensure(r.is_none(), || format!("offered {:?}", r.map(|i| i.version)))?;
    ensure(h.events() == 0, || "an availability event fired".into())?;
    ensure(h.status().last_result.as_deref() == Some("upToDate"), || format!("last result {:?}", h.status().last_result))?;
    ensure(updater::updater_pending(h.app.state::<UpdaterState>()).is_none(), || "a pending update exists".into())?;
    Ok(format!("{what}: nothing offered, no event"))
}

#[test]
#[ignore]
fn downgrade_offers_nothing() {
    assert!(report("downgrade offers nothing", offers_nothing("downgrade", "downgrade", "manifest 0.0.1 below the running version")));
    assert!(report("same version offers nothing", offers_nothing("same", "same", "manifest equals the running version")));
}

#[test]
#[ignore]
fn offline_logs_and_stays_silent() {
    let ok = report("offline logs and stays silent", (|| {
        let base = format!("http://127.0.0.1:{}/offline/", env("MIKEDOWN_E2E_DEAD_PORT"));
        let h = harness("offline", updater_conf(&shipped_conf()["plugins"]["updater"], &base), &env("MIKEDOWN_E2E_CURRENT"));
        let r = h.check(false);
        ensure(r.is_err(), || "check did not fail with the server down".into())?;
        ensure(h.events() == 0, || "an availability event fired".into())?;
        ensure(h.log().contains("check (silent) failed"), || format!("log: {}", h.log().trim()))?;
        ensure(h.status().last_result.as_deref() == Some("error"), || format!("last result {:?}", h.status().last_result))?;
        ensure(h.status().phase == "idle", || format!("phase {}", h.status().phase))?;
        Ok("check failed, one log line, no event, phase stays idle".into())
    })());
    assert!(ok);
}

#[test]
#[ignore]
fn skipped_and_snoozed_versions_are_not_announced() {
    let expect = env("MIKEDOWN_E2E_EXPECT");
    let a = report("skipped version not announced on a silent check", (|| {
        let h = scenario("skip", "pertarget", &env("MIKEDOWN_E2E_CURRENT"));
        updater::updater_skip(h.app.handle().clone(), h.app.state::<UpdaterState>(), expect.clone());
        let r = h.check(false)?;
        ensure(r.is_none(), || "a skipped version was announced".into())?;
        ensure(h.events() == 0, || "an availability event fired".into())?;
        ensure(h.log().contains("not announced, skipped by the user"), || "log lacks the skip line".into())?;
        ensure(h.state_file()["skippedVersion"] == json!(expect), || format!("state file: {}", h.state_file()))?;
        // A manual check clears the skip and announces.
        let m = h.check(true)?.ok_or("manual check did not offer it")?;
        ensure(m.version == expect && h.events() == 1, || "manual check did not announce once".into())?;
        ensure(h.status().skipped_version.is_none(), || "manual check kept the skip".into())?;
        Ok("silent: quiet and logged; manual: announced, skip cleared".into())
    })());
    let b = report("snoozed check not announced on a silent check", (|| {
        let h = scenario("snooze", "pertarget", &env("MIKEDOWN_E2E_CURRENT"));
        updater::updater_snooze(h.app.handle().clone(), h.app.state::<UpdaterState>(), Some(1));
        let r = h.check(false)?;
        ensure(r.is_none() && h.events() == 0, || "a snoozed version was announced".into())?;
        ensure(h.log().contains("not announced, snoozed"), || "log lacks the snooze line".into())?;
        Ok("silent check quiet during the snooze".into())
    })());
    assert!(a & b);
}

// ------------------------------------------------- OS pre-install check

#[test]
#[ignore]
fn preinstall_check_accepts_ours_and_refuses_the_rest() {
    let mut all = true;
    let name = if cfg!(windows) { "Authenticode pre-check" } else { "codesign pre-check" };
    match env_opt("MIKEDOWN_E2E_PRECHECK_OK") {
        Some(p) => {
            let bytes = std::fs::read(&p).expect("read payload");
            all &= report(&format!("{name} accepts the genuine payload"), commands::updater_verify::preinstall_check(&bytes));
        }
        None => skip(&format!("{name} accepts the genuine payload"), "MIKEDOWN_E2E_PRECHECK_OK not set"),
    }
    for item in env_opt("MIKEDOWN_E2E_PRECHECK_BAD").unwrap_or_default().split(';').filter(|s| !s.is_empty()) {
        let (label, path) = item.split_once('=').expect("label=path");
        let bytes = std::fs::read(path).expect("read payload");
        let outcome = match commands::updater_verify::preinstall_check(&bytes) {
            Ok(note) => Err(format!("ACCEPTED ({note}), it must be refused")),
            Err(e) => Ok(format!("refused: {e}")),
        };
        all &= report(&format!("{name} refuses {label}"), outcome);
    }
    assert!(all);
}

// ---------------------------------------------------------- real installs

/// Plugin-direct install over a COPY of the old app (macOS). `conf` is the
/// updater config the old build shipped with.
#[cfg(target_os = "macos")]
fn install_over(name: &str, case: &str, conf: Value, scenario_name: &str, app_path: &str, current: &str) -> bool {
    use tauri_plugin_updater::UpdaterExt;
    report(name, (|| {
        let expect = env("MIKEDOWN_E2E_EXPECT");
        let base = format!("{}/{scenario_name}/", env("MIKEDOWN_E2E_BASE"));
        let h = harness(case, updater_conf(&conf, &base), current);
        let app_path = PathBuf::from(app_path);
        let exe = app_path.join("Contents/MacOS/mikedown-desktop");
        ensure(exe.exists(), || format!("{} missing", exe.display()))?;
        let updater = h.app.updater_builder().executable_path(&exe).build().map_err(|e| e.to_string())?;
        let update = tauri::async_runtime::block_on(updater.check())
            .map_err(|e| format!("check failed: {e}"))?
            .ok_or("no update offered")?;
        ensure(update.version == expect, || format!("offered {}", update.version))?;
        let bytes = tauri::async_runtime::block_on(update.download(|_, _| {}, || {})).map_err(|e| format!("download: {e}"))?;
        let note = commands::updater_verify::preinstall_check(&bytes).map_err(|e| format!("pre-install check: {e}"))?;
        update.install(&bytes).map_err(|e| format!("install: {e}"))?;
        let plist = std::fs::read_to_string(app_path.join("Contents/Info.plist")).map_err(|e| e.to_string())?;
        ensure(plist.contains(&format!("<string>{expect}</string>")), || format!("installed app does not report {expect}"))?;
        let status = std::process::Command::new("codesign")
            .args(["--verify", "--deep", "--strict"])
            .arg(&app_path)
            .status()
            .map_err(|e| e.to_string())?;
        ensure(status.success(), || "installed app fails codesign --verify".into())?;
        Ok(format!("{current} -> {expect} at {} ({note}); codesign --verify OK", app_path.display()))
    })())
}

#[test]
#[ignore]
fn install_n_to_next_per_target() {
    #[cfg(target_os = "macos")]
    {
        let conf = shipped_conf()["plugins"]["updater"].clone();
        assert!(install_over(
            "install N to N+1 over the staging N copy (per-target file)",
            "install",
            conf,
            "pertarget",
            &env("MIKEDOWN_E2E_INSTALL_APP"),
            &env("MIKEDOWN_E2E_CURRENT"),
        ));
    }
    #[cfg(not(target_os = "macos"))]
    skip("install N to N+1 (macOS)", "not macOS");
}

#[test]
#[ignore]
fn install_over_real_0_1_0_through_the_legacy_path() {
    #[cfg(target_os = "macos")]
    {
        let conf: Value = serde_json::from_str(&std::fs::read_to_string(env("MIKEDOWN_E2E_LEGACY_CONF")).expect("legacy conf"))
            .expect("legacy conf json");
        let eps = conf["endpoints"].as_array().expect("endpoints");
        assert_eq!(eps.len(), 1, "0.1.0 shipped exactly one endpoint");
        assert!(eps[0].as_str().unwrap().ends_with("/latest.json"));
        assert!(install_over(
            "continuity: real 0.1.0 app updates through the legacy latest.json path",
            "legacy",
            conf,
            "legacy",
            &env("MIKEDOWN_E2E_LEGACY_APP"),
            "0.1.0",
        ));
    }
    #[cfg(not(target_os = "macos"))]
    skip("continuity (macOS)", "not macOS");
}

/// Windows: check, download, verify, run the OS check, then hand the payload
/// to the NSIS installer in `quiet` mode. The plugin exits this process right
/// after launching the installer, so the script judges the outcome by what is
/// installed and running afterwards.
#[test]
#[ignore]
fn windows_install_hand_over() {
    #[cfg(windows)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let scenario_name = env_opt("MIKEDOWN_E2E_WIN_SCENARIO").unwrap_or_else(|| "pertarget".into());
        let conf = match env_opt("MIKEDOWN_E2E_LEGACY_CONF") {
            Some(p) => serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap(),
            None => shipped_conf()["plugins"]["updater"].clone(),
        };
        let current = env("MIKEDOWN_E2E_CURRENT");
        let expect = env("MIKEDOWN_E2E_EXPECT");
        let base = format!("{}/{scenario_name}/", env("MIKEDOWN_E2E_BASE"));
        let h = harness("winInstall", updater_conf(&conf, &base), &current);
        let exe = PathBuf::from(env("MIKEDOWN_E2E_WIN_INSTALL_EXE"));
        let updater = h.app.updater_builder().executable_path(&exe).build().expect("updater");
        let update = tauri::async_runtime::block_on(updater.check()).expect("check").expect("an update is offered");
        assert_eq!(update.version, expect);
        let bytes = tauri::async_runtime::block_on(update.download(|_, _| {}, || {})).expect("download and verify");
        match commands::updater_verify::preinstall_check(&bytes) {
            Ok(note) => println!("[e2e] pre-install check passed: {note}"),
            Err(e) => {
                println!("[e2e] pre-install check REFUSED: {e}");
                std::process::exit(3);
            }
        }
        println!("[e2e] handing {} bytes to the installer (quiet); this process is about to exit", bytes.len());
        update.install(&bytes).expect("install");
    }
    #[cfg(not(windows))]
    skip("windows install hand-over", "not Windows");
}
