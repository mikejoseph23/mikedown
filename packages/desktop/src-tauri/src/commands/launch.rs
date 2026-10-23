//! Files the OS asks the app to open: command-line arguments (`open -a
//! MikeDown file.md`, Windows file associations, `tauri dev -- file.md`), the
//! macOS `open-file` event (`RunEvent::Opened`, a double-click while the app
//! runs or a Dock drop) and a second launch handed over by the single-instance
//! plugin.
//!
//! All three feed one queue. Until the webview has called `frontend_ready` the
//! paths wait in it (a double-click that starts the app arrives before the
//! page is up); afterwards each batch is pushed as a `mikedown:open-files`
//! event. Window routing across several windows (edge case 6) lands in M4.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const OPEN_FILES_EVENT: &str = "mikedown:open-files";

#[derive(Default)]
pub struct LaunchQueue {
    inner: Mutex<QueueState>,
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

/// Hand paths to the webview, now or when it is ready. Each path is allowed
/// in the fs and asset scopes first: the user chose it, so it is as good as a
/// dialog pick.
pub fn queue_open<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    for p in &paths {
        super::fs::allow_document(app, p);
    }
    let queue = app.state::<LaunchQueue>();
    let mut state = queue.inner.lock().unwrap();
    if state.ready {
        let payload: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        let _ = app.emit_to("main", OPEN_FILES_EVENT, payload);
    } else {
        state.pending.extend(paths);
    }
    drop(state);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Called once by the webview after it mounted the editor. Returns the files
/// that arrived before that; later ones come as `mikedown:open-files` events.
#[tauri::command]
pub fn frontend_ready<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    let queue = app.state::<LaunchQueue>();
    let mut state = queue.inner.lock().unwrap();
    state.ready = true;
    state
        .pending
        .drain(..)
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
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
