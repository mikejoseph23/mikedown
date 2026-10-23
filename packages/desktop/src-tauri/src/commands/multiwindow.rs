//! Several windows (M4, edge cases 5–7): which window a file opens in, new
//! windows, and the quit handshake.
//!
//! Every window reports its folder and open files (`report_window_state`).
//! A path the OS hands over (`launch.rs`) is routed with `route_paths`: a
//! window whose folder contains the file gets it as a tab, a window that
//! already shows the file is focused, anything else opens a new window
//! (`new_window`), which gets the paths through the launch queue once its
//! page is up.
//!
//! Quit: Cmd+Q, the app menu's Quit item and File > Exit all run
//! `request_quit`. It asks each window in turn (`mikedown:quit-requested`)
//! and waits for its `quit_reply`; one Cancel stops the quit, otherwise the
//! app exits. The native macOS Quit item (`terminate:`) would skip this, so
//! `menu.rs` replaces it with a plain item.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const QUIT_REQUESTED_EVENT: &str = "mikedown:quit-requested";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    #[serde(default)]
    pub folder: Option<PathBuf>,
    #[serde(default)]
    pub files: Vec<PathBuf>,
}

#[derive(Default)]
pub struct WindowRegistry {
    windows: Mutex<BTreeMap<String, WindowInfo>>,
    next_label: AtomicUsize,
}

impl WindowRegistry {
    pub fn set(&self, label: &str, info: WindowInfo) {
        self.windows.lock().unwrap().insert(label.to_string(), info);
    }

    pub fn remove(&self, label: &str) {
        self.windows.lock().unwrap().remove(label);
    }

    pub fn snapshot(&self) -> Vec<(String, WindowInfo)> {
        self.windows.lock().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    /// `w-1`, `w-2`, … never reused within a run. Labels the session store
    /// hands back on launch are registered so a later counter never collides.
    pub fn fresh_label(&self) -> String {
        loop {
            let n = self.next_label.fetch_add(1, Ordering::SeqCst) + 1;
            let label = format!("w-{n}");
            let mut windows = self.windows.lock().unwrap();
            if !windows.contains_key(&label) {
                windows.insert(label.clone(), WindowInfo::default());
                return label;
            }
        }
    }

    pub fn reserve_label(&self, label: &str) {
        self.windows.lock().unwrap().entry(label.to_string()).or_default();
    }
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Target {
    Window(String),
    NewWindow,
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Routed {
    pub target: Target,
    pub paths: Vec<PathBuf>,
}

fn is_inside(dir: &Path, path: &Path) -> bool {
    path.starts_with(dir)
}

/// Edge case 6. `windows` are in label order; the first match wins. A folder
/// goes to the window that has it open, otherwise to a new window. Files
/// that no window can take share one new window.
pub fn route_paths(windows: &[(String, WindowInfo)], paths: &[PathBuf]) -> Vec<Routed> {
    let mut out: Vec<Routed> = Vec::new();
    fn push(out: &mut Vec<Routed>, target: Target, path: PathBuf) {
        if let Some(r) = out.iter_mut().find(|r| r.target == target) {
            r.paths.push(path);
        } else {
            out.push(Routed { target, paths: vec![path] });
        }
    }
    for path in paths {
        let is_dir = path.is_dir();
        let hit = windows.iter().find(|(_, info)| match &info.folder {
            Some(folder) if is_dir => folder == path,
            Some(folder) => is_inside(folder, path),
            None => false,
        });
        if let Some((label, _)) = hit {
            push(&mut out, Target::Window(label.clone()), path.clone());
            continue;
        }
        if !is_dir {
            if let Some((label, _)) = windows.iter().find(|(_, info)| info.files.iter().any(|f| f == path)) {
                push(&mut out, Target::Window(label.clone()), path.clone());
                continue;
            }
        }
        if is_dir {
            // Each folder is its own window.
            out.push(Routed { target: Target::NewWindow, paths: vec![path.clone()] });
        } else {
            push(&mut out, Target::NewWindow, path.clone());
        }
    }
    out
}

/// A window the webview reports its state from. Called on folder open/close
/// and whenever the set of open files changes.
#[tauri::command]
pub fn report_window_state<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    folder: Option<String>,
    files: Vec<String>,
) {
    let info = WindowInfo {
        folder: folder.map(PathBuf::from),
        files: files.into_iter().map(PathBuf::from).collect(),
    };
    app.state::<WindowRegistry>().set(window.label(), info);
}

/// Open another window. `label` restores a session's window (its session
/// file is read by that label); otherwise a fresh `w-N`. `paths` are queued
/// for it and arrive through `frontend_ready`.
pub fn create_window<R: Runtime>(
    app: &AppHandle<R>,
    label: Option<String>,
    paths: Vec<PathBuf>,
) -> Result<String, String> {
    let registry = app.state::<WindowRegistry>();
    let label = match label {
        Some(l) if app.get_webview_window(&l).is_none() => {
            registry.reserve_label(&l);
            l
        }
        _ => registry.fresh_label(),
    };
    registry.reserve_label(&label);
    super::launch::queue_for(app, &label, paths);
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title("MikeDown")
        .inner_size(1200.0, 800.0)
        .min_inner_size(640.0, 480.0);
    builder.build().map_err(|e| e.to_string())?;
    Ok(label)
}

#[tauri::command]
pub fn new_window<R: Runtime>(app: AppHandle<R>, label: Option<String>, paths: Option<Vec<String>>) -> Result<String, String> {
    let paths = paths.unwrap_or_default().into_iter().map(PathBuf::from).collect();
    create_window(&app, label, paths)
}

#[tauri::command]
pub fn window_count<R: Runtime>(app: AppHandle<R>) -> usize {
    app.webview_windows().len()
}

// ── Quit ───────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct QuitState {
    /// Every window agreed; the next `ExitRequested` goes through.
    pub approved: AtomicBool,
    /// A handshake is running; a second Cmd+Q while the dialog is up is ignored.
    pub in_progress: AtomicBool,
    reply: Mutex<Option<Sender<bool>>>,
}

/// How long a window may take to answer. The dialog is modal and the user
/// may think; a webview that is gone is skipped by the window check.
const REPLY_TIMEOUT: Duration = Duration::from_secs(60 * 60);

/// The window that has keyboard focus, if any (`is_focused` is per window;
/// Tauri's `get_focused_window` sits behind its unstable feature).
pub fn focused_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
}

/// Ask every window, one at a time, then exit. Safe to call from any thread.
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    {
        let state = app.state::<QuitState>();
        if state.approved.load(Ordering::SeqCst) {
            app.exit(0);
            return;
        }
        if state.in_progress.swap(true, Ordering::SeqCst) {
            return;
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let proceed = handshake(&app);
        if proceed {
            app.state::<QuitState>().approved.store(true, Ordering::SeqCst);
            app.exit(0);
        }
    });
}

/// Emit `mikedown:quit-requested` to each window and collect the answers.
/// True when every window agreed (or went away).
fn handshake<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<QuitState>();
    let mut labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    // The focused window first: that is where the user pressed Cmd+Q.
    if let Some(f) = focused_label(app) {
        labels.sort_by_key(|x| if *x == f { 0 } else { 1 });
    }
    let mut proceed = true;
    for label in labels {
        let Some(window) = app.get_webview_window(&label) else { continue };
        let (tx, rx) = channel::<bool>();
        *state.reply.lock().unwrap() = Some(tx);
        let _ = window.set_focus();
        if window.emit(QUIT_REQUESTED_EVENT, ()).is_err() {
            continue;
        }
        match rx.recv_timeout(REPLY_TIMEOUT) {
            Ok(true) => {}
            Ok(false) => {
                proceed = false;
                break;
            }
            // The window went away (closed itself) or never answered.
            Err(RecvTimeoutError::Disconnected) => {}
            Err(RecvTimeoutError::Timeout) => {
                proceed = false;
                break;
            }
        }
    }
    *state.reply.lock().unwrap() = None;
    state.in_progress.store(false, Ordering::SeqCst);
    proceed
}

/// The webview's answer to `mikedown:quit-requested`: true to go on quitting.
#[tauri::command]
pub fn quit_reply<R: Runtime>(app: AppHandle<R>, proceed: bool) {
    let state = app.state::<QuitState>();
    let tx = state.reply.lock().unwrap().clone();
    if let Some(tx) = tx {
        let _ = tx.send(proceed);
    }
}

/// Cmd+Q / File > Exit from the webview's own key handler or the menu.
#[tauri::command]
pub fn request_quit_cmd<R: Runtime>(app: AppHandle<R>) {
    request_quit(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(label: &str, folder: Option<&str>, files: &[&str]) -> (String, WindowInfo) {
        (
            label.to_string(),
            WindowInfo {
                folder: folder.map(PathBuf::from),
                files: files.iter().map(PathBuf::from).collect(),
            },
        )
    }

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn file_inside_an_open_folder_goes_to_that_window() {
        let windows = vec![win("main", Some("/n"), &[]), win("w-1", Some("/other"), &[])];
        let routed = route_paths(&windows, &[p("/n/sub/a.md")]);
        assert_eq!(routed, vec![Routed { target: Target::Window("main".into()), paths: vec![p("/n/sub/a.md")] }]);
    }

    #[test]
    fn a_file_a_window_already_shows_is_focused_there() {
        let windows = vec![win("main", None, &["/x/lone.md"])];
        let routed = route_paths(&windows, &[p("/x/lone.md")]);
        assert_eq!(routed[0].target, Target::Window("main".into()));
    }

    #[test]
    fn unrouted_files_share_one_new_window() {
        let windows = vec![win("main", Some("/n"), &[])];
        let routed = route_paths(&windows, &[p("/x/a.md"), p("/y/b.md"), p("/n/c.md")]);
        assert_eq!(routed.len(), 2);
        assert_eq!(routed[0], Routed { target: Target::NewWindow, paths: vec![p("/x/a.md"), p("/y/b.md")] });
        assert_eq!(routed[1], Routed { target: Target::Window("main".into()), paths: vec![p("/n/c.md")] });
    }

    #[test]
    fn a_prefix_that_is_not_a_folder_boundary_does_not_match() {
        let windows = vec![win("main", Some("/n"), &[])];
        let routed = route_paths(&windows, &[p("/notes/a.md")]);
        assert_eq!(routed[0].target, Target::NewWindow);
    }

    #[test]
    fn labels_are_fresh_and_reserved_ones_are_skipped() {
        let reg = WindowRegistry::default();
        reg.reserve_label("w-1");
        assert_eq!(reg.fresh_label(), "w-2");
        assert_eq!(reg.fresh_label(), "w-3");
        reg.set("main", WindowInfo { folder: Some(p("/n")), files: vec![] });
        assert_eq!(reg.snapshot().len(), 4);
        reg.remove("w-2");
        assert_eq!(reg.snapshot().len(), 3);
    }
}
