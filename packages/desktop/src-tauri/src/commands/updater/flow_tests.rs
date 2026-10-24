//! T1: the download path (`ensure_downloaded`) on Tauri's mock runtime against
//! a local server: progress events, state events, the verified-bytes cache and
//! a tampered payload. The signed fixture lives in `tests/fixtures`.

#[path = "../../../tests/support/mod.rs"]
mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tauri::{Listener, Manager};
use tauri_plugin_updater::UpdaterExt;

use super::*;
use support::Response;

struct Rig {
    app: tauri::App<tauri::test::MockRuntime>,
    server: support::Server,
    progress: Arc<Mutex<Vec<(u64, Option<u64>)>>>,
    states: Arc<Mutex<Vec<String>>>,
}

fn rig(payload: Vec<u8>) -> Rig {
    let url_base = Arc::new(Mutex::new(String::new()));
    let url_for_route = url_base.clone();
    let server = support::serve(move |path| match path {
        "/latest.json" => {
            let base = url_for_route.lock().unwrap().clone();
            Response::ok(support::manifest(support::SIGNED_VERSION, &format!("{base}/payload.bin")))
        }
        "/payload.bin" => Response { status: 200, body: payload.clone(), pause_mid_body: Some(Duration::from_millis(250)) },
        _ => Response::not_found(),
    });
    *url_base.lock().unwrap() = server.base.clone();
    let app = support::mock_app("0.1.0", &[format!("{}/latest.json", server.base)]);
    app.manage(UpdaterState::default());

    let progress = Arc::new(Mutex::new(Vec::new()));
    let states = Arc::new(Mutex::new(Vec::new()));
    let p = progress.clone();
    app.listen(UPDATE_PROGRESS_EVENT, move |e| {
        let v: Value = serde_json::from_str(e.payload()).unwrap();
        p.lock().unwrap().push((v["downloaded"].as_u64().unwrap(), v["total"].as_u64()));
    });
    let s = states.clone();
    app.listen(UPDATE_STATE_EVENT, move |e| {
        let v: Value = serde_json::from_str(e.payload()).unwrap();
        s.lock().unwrap().push(v["state"].as_str().unwrap().to_string());
    });
    Rig { app, server, progress, states }
}

/// Run the plugin's check and park the offered update as the pending one.
fn make_pending(r: &Rig) {
    let update = tauri::async_runtime::block_on(r.app.updater().unwrap().check())
        .expect("check")
        .expect("an update is offered");
    *r.app.state::<UpdaterState>().pending.lock().unwrap() = Some(update);
}

fn download(r: &Rig) -> Result<Arc<Vec<u8>>, String> {
    let handle = r.app.handle().clone();
    let state = r.app.state::<UpdaterState>();
    tauri::async_runtime::block_on(ensure_downloaded(&handle, &state))
}

fn settle() {
    // Event listeners run off-thread on the mock runtime.
    std::thread::sleep(Duration::from_millis(150));
}

fn cleanup(r: &Rig) {
    if let Ok(dir) = r.app.path().app_data_dir() {
        let _ = stdfs::remove_dir_all(dir);
    }
}

#[test]
fn progress_events_are_emitted_monotonic_and_end_at_the_total() {
    let r = rig(support::payload());
    make_pending(&r);
    let bytes = download(&r).expect("download and signature verification");
    assert_eq!(bytes.as_slice(), support::payload().as_slice());
    settle();

    let events = r.progress.lock().unwrap().clone();
    assert!(events.len() >= 2, "a pause mid-body gives at least a first and a final event: {events:?}");
    assert!(events.windows(2).all(|w| w[0].0 <= w[1].0), "monotonic: {events:?}");
    assert!(events.iter().all(|(d, t)| *t == Some(support::PAYLOAD_LEN as u64) && *d <= support::PAYLOAD_LEN as u64), "{events:?}");
    assert_eq!(events.last().unwrap().0, support::PAYLOAD_LEN as u64, "the final chunk is never dropped: {events:?}");
    // Throttled to about 10 per second, so a sub-second download is a handful at most.
    assert!(events.len() <= 12, "{events:?}");
    cleanup(&r);
}

#[test]
fn phases_go_downloading_verifying_ready() {
    let r = rig(support::payload());
    make_pending(&r);
    download(&r).unwrap();
    settle();
    assert_eq!(*r.states.lock().unwrap(), ["downloading", "verifying", "ready"]);
    assert_eq!(phase(&r.app.state::<UpdaterState>()), Phase::Ready);
    cleanup(&r);
}

#[test]
fn a_second_download_reuses_the_verified_bytes() {
    let r = rig(support::payload());
    make_pending(&r);
    download(&r).unwrap();
    let before = r.server.paths().iter().filter(|p| *p == "/payload.bin").count();
    assert_eq!(before, 1);
    let again = download(&r).unwrap();
    assert_eq!(again.len(), support::PAYLOAD_LEN);
    assert_eq!(r.server.paths().iter().filter(|p| *p == "/payload.bin").count(), 1, "no second download after a cancelled quit dialog");
    cleanup(&r);
}

#[test]
fn a_tampered_payload_fails_verification_and_lands_in_failed() {
    let mut bad = support::payload();
    bad[100] ^= 0xff;
    let r = rig(bad);
    make_pending(&r);
    let err = download(&r).expect_err("the signature does not match");
    assert!(!err.is_empty());
    settle();
    let states = r.states.lock().unwrap().clone();
    assert_eq!(states.last().map(String::as_str), Some("failed"), "{states:?}");
    assert!(r.app.state::<UpdaterState>().cached.lock().unwrap().is_none(), "nothing is cached from a bad download");
    cleanup(&r);
}

#[test]
fn download_without_a_pending_update_is_an_error() {
    let r = rig(support::payload());
    assert_eq!(download(&r).unwrap_err(), "No update is pending.");
    cleanup(&r);
}
