//! Per-directory file watching for the folder tree (M3).
//!
//! The tree watches only the directories that are expanded (plan: Large
//! folders), each non-recursively. Every change is emitted to the webview as
//! an `fs-changed` event `{ kind, path, dir }`; the tree re-lists `dir` and
//! the folder `.md` index drops its cache.
//!
//! Native events (FSEvents on macOS, ReadDirectoryChangesW on Windows) are the
//! default. When the native watcher cannot be created, refuses the directory,
//! or reports an error later (network drives, some cloud folders), that
//! directory falls back to polling every 2 s (edge case 10).
//! `MIKEDOWN_WATCH_POLL=1` forces polling, for testing the fallback.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::event::{EventKind, ModifyKind};
use notify::{Config, Event, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const POLL_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct FsChanged {
    /// `create`, `remove`, `rename`, `modify` or `any`.
    pub kind: &'static str,
    pub path: String,
    /// The watched directory the change belongs to.
    pub dir: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Native,
    Poll,
}

enum Handle {
    Native(#[allow(dead_code)] RecommendedWatcher),
    Poll(#[allow(dead_code)] PollWatcher),
}

/// What a watcher reports: a change, or a native failure that should switch
/// the directory to polling.
pub enum Signal {
    Change(FsChanged),
    Failed(String),
}

#[derive(Default)]
pub struct Watchers {
    map: Mutex<HashMap<PathBuf, Handle>>,
}

/// Map a notify event kind to the event's `kind`. Access events are dropped.
pub fn kind_of(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Remove(_) => Some("remove"),
        EventKind::Modify(ModifyKind::Name(_)) => Some("rename"),
        EventKind::Modify(ModifyKind::Metadata(_)) => None,
        EventKind::Modify(_) => Some("modify"),
        EventKind::Access(_) => None,
        EventKind::Any | EventKind::Other => Some("any"),
    }
}

fn changes(event: &Event, dir: &Path) -> Vec<FsChanged> {
    let Some(kind) = kind_of(&event.kind) else { return Vec::new() };
    let dir_s = dir.to_string_lossy().into_owned();
    if event.paths.is_empty() {
        return vec![FsChanged { kind, path: dir_s.clone(), dir: dir_s }];
    }
    event
        .paths
        .iter()
        .map(|p| FsChanged { kind, path: p.to_string_lossy().into_owned(), dir: dir_s.clone() })
        .collect()
}

fn force_poll() -> bool {
    std::env::var_os("MIKEDOWN_WATCH_POLL").is_some_and(|v| v == "1")
}

/// Start watching `dir` (non-recursive). `prefer` picks native or polling;
/// native falls back to polling when it cannot start. Independent of Tauri so
/// the tests drive it directly.
fn start<F>(dir: &Path, prefer: Mode, on_signal: F) -> Result<(Handle, Mode), String>
where
    F: Fn(Signal) + Send + Sync + Clone + 'static,
{
    let owned = dir.to_path_buf();
    if prefer == Mode::Native {
        let cb = on_signal.clone();
        let d = owned.clone();
        let native = RecommendedWatcher::new(
            move |res: notify::Result<Event>| match res {
                Ok(event) => {
                    for change in changes(&event, &d) {
                        cb(Signal::Change(change));
                    }
                }
                Err(e) => cb(Signal::Failed(e.to_string())),
            },
            Config::default(),
        );
        if let Ok(mut w) = native {
            if w.watch(dir, RecursiveMode::NonRecursive).is_ok() {
                return Ok((Handle::Native(w), Mode::Native));
            }
        }
    }
    let cb = on_signal;
    let d = owned;
    let mut poll = PollWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                for change in changes(&event, &d) {
                    cb(Signal::Change(change));
                }
            }
        },
        Config::default().with_poll_interval(POLL_INTERVAL),
    )
    .map_err(|e| format!("{}: {e}", dir.display()))?;
    poll.watch(dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok((Handle::Poll(poll), Mode::Poll))
}

fn signal_handler<R: Runtime>(app: AppHandle<R>, dir: PathBuf) -> impl Fn(Signal) + Send + Sync + Clone + 'static {
    move |signal| match signal {
        Signal::Change(change) => {
            let _ = app.emit("fs-changed", change);
        }
        Signal::Failed(reason) => {
            // Swap to polling off the watcher's own thread: dropping a native
            // watcher from inside its callback would wait on itself.
            let app = app.clone();
            let dir = dir.clone();
            std::thread::spawn(move || {
                eprintln!("[mikedown] native watch failed for {} ({reason}); polling every 2 s", dir.display());
                let state = app.state::<Watchers>();
                let handler = signal_handler(app.clone(), dir.clone());
                if let Ok((handle, _)) = start(&dir, Mode::Poll, handler) {
                    if let Ok(mut map) = state.map.lock() {
                        if map.contains_key(&dir) {
                            map.insert(dir.clone(), handle);
                        }
                    }
                }
                // The tree re-lists, in case the failure swallowed changes.
                let d = dir.to_string_lossy().into_owned();
                let _ = app.emit("fs-changed", FsChanged { kind: "any", path: d.clone(), dir: d });
            });
        }
    }
}

/// Watch one expanded directory. Returns `"native"` or `"poll"`. Watching a
/// directory twice is a no-op.
#[tauri::command]
pub fn watch<R: Runtime>(app: AppHandle<R>, state: State<'_, Watchers>, dir: PathBuf) -> Result<Mode, String> {
    super::fs::ensure_allowed(&app, &dir)?;
    let mut map = state.map.lock().map_err(|_| "watcher state poisoned".to_string())?;
    if let Some(existing) = map.get(&dir) {
        return Ok(match existing {
            Handle::Native(_) => Mode::Native,
            Handle::Poll(_) => Mode::Poll,
        });
    }
    let prefer = if force_poll() { Mode::Poll } else { Mode::Native };
    let (handle, mode) = start(&dir, prefer, signal_handler(app.clone(), dir.clone()))?;
    map.insert(dir, handle);
    Ok(mode)
}

#[tauri::command]
pub fn unwatch(state: State<'_, Watchers>, dir: PathBuf) -> Result<(), String> {
    let removed = state.map.lock().map_err(|_| "watcher state poisoned".to_string())?.remove(&dir);
    drop(removed);
    Ok(())
}

/// Stop every watcher (the window opened another folder).
#[tauri::command]
pub fn unwatch_all(state: State<'_, Watchers>) -> Result<(), String> {
    let drained: Vec<Handle> = state
        .map
        .lock()
        .map_err(|_| "watcher state poisoned".to_string())?
        .drain()
        .map(|(_, h)| h)
        .collect();
    drop(drained);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mikedown-watch-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Canonical form: FSEvents reports /private/var/... for /var/...
        dir.canonicalize().unwrap()
    }

    /// Start a watcher, create a file, and return how long the matching
    /// event took.
    fn latency(mode: Mode) -> (Mode, Duration) {
        let dir = temp_dir(match mode { Mode::Native => "native", Mode::Poll => "poll" });
        let (tx, rx) = mpsc::channel::<FsChanged>();
        let tx = std::sync::Arc::new(Mutex::new(tx));
        let cb = {
            let tx = tx.clone();
            move |s: Signal| {
                if let Signal::Change(c) = s {
                    let _ = tx.lock().unwrap().send(c);
                }
            }
        };
        let (handle, got_mode) = start(&dir, mode, cb).unwrap();
        // Poll watchers take their first snapshot on start; let it settle.
        std::thread::sleep(Duration::from_millis(if got_mode == Mode::Poll { 300 } else { 100 }));
        let file = dir.join("created.md");
        let t0 = Instant::now();
        std::fs::write(&file, b"# hi\n").unwrap();
        let deadline = t0 + Duration::from_secs(6);
        let mut seen = None;
        while Instant::now() < deadline {
            if let Ok(c) = rx.recv_timeout(Duration::from_millis(50)) {
                if c.path.ends_with("created.md") {
                    seen = Some(t0.elapsed());
                    break;
                }
            }
        }
        drop(handle);
        let _ = std::fs::remove_dir_all(&dir);
        (got_mode, seen.expect("no event for the created file"))
    }

    #[test]
    fn native_watcher_reports_a_new_file_quickly() {
        let (mode, elapsed) = latency(Mode::Native);
        assert_eq!(mode, Mode::Native);
        eprintln!("native watcher latency: {elapsed:?}");
        assert!(elapsed < Duration::from_secs(2), "{elapsed:?}");
    }

    #[test]
    fn polling_fallback_reports_a_new_file_within_one_interval() {
        let (mode, elapsed) = latency(Mode::Poll);
        assert_eq!(mode, Mode::Poll);
        eprintln!("poll watcher latency: {elapsed:?}");
        assert!(elapsed < POLL_INTERVAL + Duration::from_millis(1500), "{elapsed:?}");
    }

    #[test]
    fn kinds_map_to_the_event_names() {
        use notify::event::{AccessKind, CreateKind, MetadataKind, ModifyKind, RemoveKind, RenameMode};
        assert_eq!(kind_of(&EventKind::Create(CreateKind::File)), Some("create"));
        assert_eq!(kind_of(&EventKind::Remove(RemoveKind::Any)), Some("remove"));
        assert_eq!(kind_of(&EventKind::Modify(ModifyKind::Name(RenameMode::Any))), Some("rename"));
        assert_eq!(kind_of(&EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any))), Some("modify"));
        assert_eq!(kind_of(&EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any))), None);
        assert_eq!(kind_of(&EventKind::Access(AccessKind::Any)), None);
        assert_eq!(kind_of(&EventKind::Any), Some("any"));
    }
}
