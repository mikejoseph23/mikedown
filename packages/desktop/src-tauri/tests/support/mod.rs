//! Shared by the updater tests: a tiny local HTTP server, a deterministic
//! signed payload, and a mock-runtime app with the updater plugin configured
//! like the shipped one (same endpoint list shape, `requireSignedVersion`),
//! except for the public key (a test key; the matching private key is not kept).
//!
//! Included by `tests/updater_staging.rs` (`mod support;`) and by the unit
//! tests in `src/commands/updater/flow_tests.rs` (`#[path]`), so any item may
//! be unused in one of them.
#![allow(dead_code)]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Version the fixture signature is bound to (`--app-version 9.9.9`).
pub const SIGNED_VERSION: &str = "9.9.9";
pub const TEST_SIGNATURE: &str = include_str!("../fixtures/update-test.sig");
pub const TEST_PUBKEY: &str = include_str!("../fixtures/update-test.pub");
pub const PAYLOAD_LEN: usize = 64 * 1024;

/// The bytes the fixture signature covers.
pub fn payload() -> Vec<u8> {
    (0..PAYLOAD_LEN).map(|i| ((i * 31 + 7) % 251) as u8).collect()
}

pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
    /// Send half the body, wait this long, send the rest (progress needs time).
    pub pause_mid_body: Option<Duration>,
}

impl Response {
    pub fn ok(body: impl Into<Vec<u8>>) -> Self {
        Self { status: 200, body: body.into(), pause_mid_body: None }
    }
    pub fn not_found() -> Self {
        Self { status: 404, body: b"not found".to_vec(), pause_mid_body: None }
    }
}

pub struct Server {
    pub base: String,
    /// Request paths in arrival order.
    pub requests: Arc<Mutex<Vec<String>>>,
}

impl Server {
    pub fn paths(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}

fn handle(mut stream: TcpStream, route: &(dyn Fn(&str) -> Response + Send + Sync), log: &Mutex<Vec<String>>) {
    let _ = stream.set_nodelay(true);
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
    log.lock().unwrap().push(path.clone());
    let res = route(&path);
    let reason = if res.status == 200 { "OK" } else { "Not Found" };
    let header = format!(
        "HTTP/1.1 {} {reason}\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        res.status,
        res.body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    match res.pause_mid_body {
        Some(pause) => {
            let mid = res.body.len() / 2;
            let _ = stream.write_all(&res.body[..mid]);
            let _ = stream.flush();
            std::thread::sleep(pause);
            let _ = stream.write_all(&res.body[mid..]);
        }
        None => {
            let _ = stream.write_all(&res.body);
        }
    }
    let _ = stream.flush();
}

/// Serve `route(path)` on 127.0.0.1 until the test process ends.
pub fn serve(route: impl Fn(&str) -> Response + Send + Sync + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let route: Arc<dyn Fn(&str) -> Response + Send + Sync> = Arc::new(route);
    let log = requests.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let route = route.clone();
            let log = log.clone();
            std::thread::spawn(move || handle(stream, route.as_ref(), &log));
        }
    });
    Server { base: format!("http://127.0.0.1:{port}"), requests }
}

/// An update manifest for `version`, with an entry for every target the app
/// ships on, all pointing at `url` and signed with the fixture signature.
pub fn manifest(version: &str, url: &str) -> Vec<u8> {
    let entry = serde_json::json!({ "signature": TEST_SIGNATURE.trim(), "url": url });
    serde_json::json!({
        "version": version,
        "notes": "Test release",
        "pub_date": "2026-01-01T00:00:00Z",
        "platforms": {
            "darwin-aarch64": entry, "darwin-x86_64": entry,
            "windows-x86_64": entry, "linux-x86_64": entry
        }
    })
    .to_string()
    .into_bytes()
}

/// A manifest that has no entry for any target this test can run on.
pub fn manifest_without_this_target(version: &str, url: &str) -> Vec<u8> {
    let entry = serde_json::json!({ "signature": TEST_SIGNATURE.trim(), "url": url });
    serde_json::json!({ "version": version, "platforms": { "plan9-riscv64": entry } }).to_string().into_bytes()
}

/// The shipped endpoint list (`tauri.conf.json`) with the host swapped for `base`.
pub fn shipped_endpoints(base: &str) -> Vec<String> {
    let conf: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json parses");
    conf["plugins"]["updater"]["endpoints"]
        .as_array()
        .expect("endpoints")
        .iter()
        .map(|e| e.as_str().unwrap().replace("https://www.iadev.net/mikedown", base))
        .collect()
}

/// Prefix of every `mock_app` identifier; cleanup refuses any app-data dir without it.
pub const TEST_IDENTIFIER_PREFIX: &str = "com.interappdev.mikedown.test.";

/// A mock-runtime app at version `current` with the updater plugin pointed at `endpoints`.
/// `mock_context` leaves the identifier empty, which makes `app_data_dir()` the whole
/// `~/Library/Application Support`; each app gets its own identifier instead.
pub fn mock_app(current: &str, endpoints: &[String]) -> tauri::App<tauri::test::MockRuntime> {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
    ctx.config_mut().identifier = format!("{TEST_IDENTIFIER_PREFIX}{}.{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst));
    ctx.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": TEST_PUBKEY.trim(),
            "endpoints": endpoints,
            "dangerousInsecureTransportProtocol": true,
            "requireSignedVersion": true
        }),
    );
    ctx.package_info_mut().version = current.parse().expect("version");
    tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(ctx)
        .expect("mock app")
}
