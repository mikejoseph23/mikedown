//! Updater endpoint behavior on Tauri's mock runtime against a local server.
//! Runs in a plain `cargo test` (no staging build needed). The ignored
//! staging cases (N to N+1, tampered, wrong key, replay, ...) live in
//! `tests/updater_cases.rs`, driven by `deploy/updater-staging-test.sh`.

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
