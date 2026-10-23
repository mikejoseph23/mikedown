//! Files the OS asks the app to open: command-line arguments (`open -a
//! MikeDown file.md`, Windows file associations, `tauri dev -- file.md`), the
//! macOS `open-file` event (`RunEvent::Opened`, a double-click while the app
//! runs or a Dock drop) and a second launch handed over by the single-instance
//! plugin.
//!
//! All three feed one queue, per window. Until a window's webview has called
//! `frontend_ready` the paths wait in it (a double-click that starts the app
//! arrives before the page is up); afterwards each batch is pushed as a
//! `mikedown:open-files` event to that window. Which window a path belongs
//! to is decided by `multiwindow::route_paths` (edge case 6): the window
//! whose folder contains it, the window already showing it, or a new one.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::multiwindow::{self, Target, WindowRegistry};

pub const OPEN_FILES_EVENT: &str = "mikedown:open-files";

#[derive(Default)]
pub struct LaunchQueue {
    inner: Mutex<HashMap<String, QueueState>>,
}

#[derive(Default)]
struct QueueState {
    ready: bool,
    pending: Vec<PathBuf>,
}

/// Turn process arguments into absolute file paths: flags (`-psn_…`, `--foo`)
/// are skipped, relative paths resolve against `cwd`.
pub fn paths_from_args<I>(args: I, cwd: Option<&Path>) -> Vec<PathBuf>
where
    I: IntoIterator<Item = String>,
{
    let mut out = Vec::new();
    for arg in args {
        if arg.is_empty() || arg.starts_with('-') {
            continue;
        }
        let p = PathBuf::from(&arg);
        let abs = if p.is_absolute() {
            p
        } else if let Some(cwd) = cwd {
            cwd.join(p)
        } else {
            continue;
        };
        out.push(abs);
    }
    out
}

/// Hand paths to one window, now or when its page is ready. Each path is
/// allowed in the fs and asset scopes first: the user chose it, so it is as
/// good as a dialog pick.
pub fn queue_for<R: Runtime>(app: &AppHandle<R>, label: &str, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    for p in &paths {
        super::fs::allow_document(app, p);
    }
    let queue = app.state::<LaunchQueue>();
    let mut map = queue.inner.lock().unwrap();
    let state = map.entry(label.to_string()).or_default();
    if state.ready {
        let payload: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        let _ = app.emit_to(label, OPEN_FILES_EVENT, payload);
    } else {
        state.pending.extend(paths);
    }
    drop(map);
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Route paths from the OS to the right windows (edge case 6). Before any
/// window has reported (first launch) everything goes to `main`.
pub fn queue_open<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let windows = app.state::<WindowRegistry>().snapshot();
    let main_ready = {
        let queue = app.state::<LaunchQueue>();
        let map = queue.inner.lock().unwrap();
        map.get("main").map(|s| s.ready).unwrap_or(false)
    };
    if windows.is_empty() || !main_ready {
        queue_for(app, "main", paths);
        return;
    }
    for routed in multiwindow::route_paths(&windows, &paths) {
        match routed.target {
            Target::Window(label) => queue_for(app, &label, routed.paths),
            Target::NewWindow => {
                if let Err(e) = multiwindow::create_window(app, None, routed.paths.clone()) {
                    eprintln!("MikeDown: could not open a window: {e}");
                    queue_for(app, "main", routed.paths);
                }
            }
        }
    }
}

/// Called once by a window's webview after it mounted the editor. Returns
/// the files that arrived for it before that; later ones come as
/// `mikedown:open-files` events.
#[tauri::command]
pub fn frontend_ready<R: Runtime>(app: AppHandle<R>, window: tauri::WebviewWindow<R>) -> Vec<String> {
    let queue = app.state::<LaunchQueue>();
    let mut map = queue.inner.lock().unwrap();
    let state = map.entry(window.label().to_string()).or_default();
    state.ready = true;
    state
        .pending
        .drain(..)
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// A window closed: forget its queue so a later window with the same label
/// starts clean.
pub fn forget<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(queue) = app.try_state::<LaunchQueue>() {
        queue.inner.lock().unwrap().remove(label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_flags_and_resolves_relative_paths() {
        let cwd = PathBuf::from("/work");
        let got = paths_from_args(
            vec![
                "-psn_0_12345".to_string(),
                "--inspect".to_string(),
                "notes/todo.md".to_string(),
                "/abs/readme.md".to_string(),
                String::new(),
            ],
            Some(&cwd),
        );
        assert_eq!(
            got,
            vec![PathBuf::from("/work/notes/todo.md"), PathBuf::from("/abs/readme.md")]
        );
    }

    #[test]
    fn relative_paths_need_a_cwd() {
        assert!(paths_from_args(vec!["x.md".to_string()], None).is_empty());
    }
}
