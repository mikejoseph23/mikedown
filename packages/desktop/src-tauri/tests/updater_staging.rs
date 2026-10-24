//! Headless end-to-end updater test (M10), run by
//! `deploy/updater-staging-test.sh --headless`. Ignored in a plain
//! `cargo test`: it needs a staging server and a built N+1.
//!
//! Drives the real `tauri-plugin-updater` with the shipped public key and
//! `requireSignedVersion`, on Tauri's mock runtime: check the staging
//! `latest.json`, download, verify the minisign signature and the signed
//! version, install over a COPY of version N's `.app`, then confirm the copy
//! now reports N+1 and is still validly code-signed.
//!
//! Env: MIKEDOWN_E2E_ENDPOINT (http://127.0.0.1:<port>/latest.json),
//! MIKEDOWN_E2E_APP (path to the N copy's MikeDown.app),
//! MIKEDOWN_E2E_CURRENT (N), MIKEDOWN_E2E_EXPECT (N+1).

use std::path::PathBuf;

use tauri_plugin_updater::UpdaterExt;

mod support;

// ---------------------------------------------------------------------------
// T1: endpoint behavior on the mock runtime against a local server. These run
// in a plain `cargo test` (no staging build needed). They use the SHIPPED
// endpoint list with the host swapped, and a test public key.
// ---------------------------------------------------------------------------

mod endpoints {
    use super::support::{self, Response};
    use super::*;

    fn check(app: &tauri::App<tauri::test::MockRuntime>) -> tauri_plugin_updater::Result<Option<tauri_plugin_updater::Update>> {
        tauri::async_runtime::block_on(app.updater().expect("updater").check())
    }

    #[test]
    fn shipped_endpoints_try_the_per_target_manifest_first_then_latest_json() {
        let eps = support::shipped_endpoints("http://h");
        assert_eq!(eps, ["http://h/latest-{{target}}-{{arch}}.json", "http://h/latest.json"]);
    }

    #[test]
    fn per_target_404_falls_through_to_latest_json() {
        let server = support::serve(|path| match path {
            "/latest.json" => Response::ok(support::manifest("9.9.9", "http://127.0.0.1:9/never")),
            _ => Response::not_found(),
        });
        let app = support::mock_app("0.1.0", &support::shipped_endpoints(&server.base));
        let update = check(&app).expect("check succeeds").expect("an update is offered");
        assert_eq!(update.version, "9.9.9");
        let paths = server.paths();
        assert_eq!(paths.len(), 2, "{paths:?}");
        assert!(paths[0].starts_with("/latest-") && paths[0].ends_with(".json") && paths[0] != "/latest.json", "{paths:?}");
        assert!(!paths[0].contains("{{"), "the target and arch are filled in: {paths:?}");
        assert_eq!(paths[1], "/latest.json");
    }

    #[test]
    fn per_target_manifest_wins_and_latest_json_is_not_asked() {
        let server = support::serve(|path| {
            if path == "/latest.json" {Response::ok(support::manifest("1.0.0", "http://127.0.0.1:9/never"))}
            else {Response::ok(support::manifest("9.9.9", "http://127.0.0.1:9/never"))}
        });
        let app = support::mock_app("0.1.0", &support::shipped_endpoints(&server.base));
        let update = check(&app).unwrap().expect("offered");
        assert_eq!(update.version, "9.9.9");
        assert_eq!(server.paths().len(), 1);
    }

    #[test]
    fn up_to_date_is_not_an_error() {
        let server = support::serve(|_| Response::ok(support::manifest("0.1.0", "http://127.0.0.1:9/never")));
        let app = support::mock_app("0.1.0", &support::shipped_endpoints(&server.base));
        assert!(check(&app).expect("check succeeds").is_none());
    }

    #[test]
    fn manifest_missing_this_target_is_an_error() {
        let server = support::serve(|path| match path {
            "/latest.json" => Response::ok(support::manifest_without_this_target("9.9.9", "http://127.0.0.1:9/never")),
            _ => Response::not_found(),
        });
        let app = support::mock_app("0.1.0", &support::shipped_endpoints(&server.base));
        let err = check(&app).err().expect("a manifest without this platform fails the check").to_string();
        // The controller turns this into "unexpected response" on a manual check
        // (classifyCheckError) and stays silent on a silent one.
        println!("missing-target error text: {err}");
        assert!(err.contains("platform") || err.contains("target"), "{err}");
    }

    #[test]
    fn every_endpoint_404_is_an_error() {
        let server = support::serve(|_| Response::not_found());
        let app = support::mock_app("0.1.0", &support::shipped_endpoints(&server.base));
        assert!(check(&app).is_err());
        assert_eq!(server.paths().len(), 2, "both endpoints were tried");
    }

    #[test]
    fn a_dead_server_is_an_error() {
        // Nothing listens on this port.
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
        drop(l);
        let app = support::mock_app("0.1.0", &support::shipped_endpoints(&base));
        assert!(check(&app).is_err());
    }
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is not set (run deploy/updater-staging-test.sh)"))
}

#[test]
#[ignore]
fn staging_update_installs_over_version_n() {
    let endpoint = env("MIKEDOWN_E2E_ENDPOINT");
    let app_path = PathBuf::from(env("MIKEDOWN_E2E_APP"));
    let current = env("MIKEDOWN_E2E_CURRENT");
    let expect = env("MIKEDOWN_E2E_EXPECT");

    let conf: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json parses");
    let pubkey = conf["plugins"]["updater"]["pubkey"].as_str().expect("shipped pubkey").to_string();
    assert_eq!(conf["plugins"]["updater"]["requireSignedVersion"], serde_json::json!(true));

    let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
    ctx.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": pubkey,
            "endpoints": [endpoint],
            "dangerousInsecureTransportProtocol": true,
            "requireSignedVersion": true
        }),
    );
    ctx.package_info_mut().version = current.parse().expect("current version");
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(ctx)
        .expect("mock app");

    let exe = app_path.join("Contents/MacOS/mikedown-desktop");
    assert!(exe.exists(), "{} missing", exe.display());
    let updater = app.updater_builder().executable_path(&exe).build().expect("updater");

    let update = tauri::async_runtime::block_on(updater.check())
        .expect("check succeeds")
        .expect("an update is offered");
    assert_eq!(update.version, expect);
    println!("[e2e] check: {} -> {} at {}", update.current_version, update.version, update.download_url);

    let bytes = tauri::async_runtime::block_on(update.download(|_, _| {}, || {}))
        .expect("download and signature verification");
    println!("[e2e] downloaded {} bytes, signature and signed version verified", bytes.len());

    update.install(&bytes).expect("install");
    let plist = std::fs::read_to_string(app_path.join("Contents/Info.plist")).expect("Info.plist");
    assert!(
        plist.contains(&format!("<string>{expect}</string>")),
        "installed app does not report {expect}"
    );
    let status = std::process::Command::new("codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(&app_path)
        .status()
        .expect("codesign runs");
    assert!(status.success(), "installed app fails codesign --verify");
    println!("[e2e] installed {expect} over {current} at {}; codesign --verify --deep --strict OK", app_path.display());
}

#[test]
#[ignore]
fn tampered_payload_is_rejected() {
    // Same staging server, but MIKEDOWN_E2E_ENDPOINT points at a manifest
    // whose signature belongs to a different file.
    let Ok(endpoint) = std::env::var("MIKEDOWN_E2E_BAD_ENDPOINT") else { return };
    let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
    ctx.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": conf["plugins"]["updater"]["pubkey"],
            "endpoints": [endpoint],
            "dangerousInsecureTransportProtocol": true,
            "requireSignedVersion": true
        }),
    );
    ctx.package_info_mut().version = env("MIKEDOWN_E2E_CURRENT").parse().unwrap();
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(ctx)
        .unwrap();
    let update = tauri::async_runtime::block_on(app.updater().unwrap().check()).unwrap().expect("offered");
    let err = tauri::async_runtime::block_on(update.download(|_, _| {}, || {})).expect_err("must fail verification");
    println!("[e2e] tampered payload rejected: {err}");
}
