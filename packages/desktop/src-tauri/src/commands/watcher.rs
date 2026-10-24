//! Per-directory file watching for the folder tree (M3).
//!
//! The tree watches only the directories that are expanded (plan: Large
//! folders), each non-recursively. Every change is emitted to the webview as
//! an `fs-changed` event `{ kind, path, dir }`; the tree re-lists `dir` and
//! the folder `.md` index drops its cache.
//!
//! Native events (FSEvents on macOS, ReadDirectoryChangesW on Windows) are the
//! default. When the native watcher cannot be created, refuses the directory,
//! or reports an error later (some cloud folders), that directory falls back
//! to polling every 2 s (edge case 10). Network volumes (SMB, NFS, a Windows
//! UNC path or mapped drive) go straight to polling: measured on an SMB share,
//! FSEvents starts fine and then never reports a change made from another
//! machine, so waiting for a failure would leave the tree stale.
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

/// Whether `dir` lives on a network volume, where native change events do not
/// arrive for other machines' edits (edge 10).
pub fn is_network_path(dir: &Path) -> bool {
    network_path_impl(dir)
}

#[cfg(target_os = "macos")]
fn network_path_impl(dir: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = std::ffi::CString::new(dir.as_os_str().as_bytes()) else { return false };
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a valid NUL-terminated path and `st` a writable statfs.
    if unsafe { libc::statfs(c.as_ptr(), &mut st) } != 0 {
        return false;
    }
    (st.f_flags & libc::MNT_LOCAL as u32) == 0
}

#[cfg(all(unix, not(target_os = "macos")))]
fn network_path_impl(dir: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = std::ffi::CString::new(dir.as_os_str().as_bytes()) else { return false };
    let mut st: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: as above.
    if unsafe { libc::statfs(c.as_ptr(), &mut st) } != 0 {
        return false;
    }
    // SMB, CIFS, SMB2 and NFS super-block magic numbers.
    matches!(st.f_type as u64, 0x517B | 0xFF53_4D42 | 0xFE53_4D42 | 0x6969)
}

#[cfg(windows)]
fn network_path_impl(dir: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    extern "system" {
        fn GetDriveTypeW(root: *const u16) -> u32;
    }
    const DRIVE_REMOTE: u32 = 4;
    let text = dir.to_string_lossy().into_owned();
    // `\\?\UNC\server\share` and `\\server\share` are remote; `\\?\C:\` is local.
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        if rest.starts_with("UNC\\") {
            return true;
        }
    } else if text.starts_with(r"\\") || text.starts_with("//") {
        return true;
    }
    let plain = text.strip_prefix(r"\\?\").unwrap_or(&text);
    let mut chars = plain.chars();
    let (Some(letter), Some(':')) = (chars.next(), chars.next()) else { return false };
    let root: Vec<u16> = std::ffi::OsString::from(format!("{letter}:\\")).encode_wide().chain(std::iter::once(0)).collect();
    // SAFETY: `root` is NUL-terminated.
    unsafe { GetDriveTypeW(root.as_ptr()) == DRIVE_REMOTE }
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
    let prefer = if force_poll() || is_network_path(&dir) { Mode::Poll } else { Mode::Native };
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
    fn polling_fallback_reports_removal_and_a_case_only_rename() {
        let dir = temp_dir("poll-rename");
        std::fs::write(dir.join("gone.md"), b"x").unwrap();
        std::fs::write(dir.join("notes.md"), b"y").unwrap();
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
        let (handle, mode) = start(&dir, Mode::Poll, cb).unwrap();
        assert_eq!(mode, Mode::Poll);
        std::thread::sleep(Duration::from_millis(300));
        std::fs::remove_file(dir.join("gone.md")).unwrap();
        crate::commands::fs::rename_entry(&dir.join("notes.md"), &dir.join("Notes.md")).unwrap();
        let deadline = Instant::now() + Duration::from_secs(6);
        let (mut removed, mut renamed) = (false, false);
        while Instant::now() < deadline && !(removed && renamed) {
            if let Ok(c) = rx.recv_timeout(Duration::from_millis(50)) {
                removed |= c.path.ends_with("gone.md");
                renamed |= c.path.ends_with("notes.md") || c.path.ends_with("Notes.md");
            }
        }
        drop(handle);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(removed, "no event for the removed file");
        assert!(renamed, "no event for the case-only rename");
    }

    /// Manual check for network shares (edge 10). Ignored by default: set
    /// MIKEDOWN_SMB_DIR to a scratch folder on the share, MIKEDOWN_SMB_MODE to
    /// native or poll, run with --ignored, and create a file named
    /// external.md in that folder from another machine within 25 seconds.
    /// Prints which mode started and how long the event took.
    #[test]
    #[ignore]
    fn network_share_reports_a_file_created_elsewhere() {
        let dir = PathBuf::from(std::env::var("MIKEDOWN_SMB_DIR").expect("MIKEDOWN_SMB_DIR"));
        let prefer = if std::env::var("MIKEDOWN_SMB_MODE").as_deref() == Ok("poll") { Mode::Poll } else { Mode::Native };
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
        let (handle, mode) = start(&dir, prefer, cb).unwrap();
        eprintln!("WATCHING {} in mode {:?}, is_network_path={}", dir.display(), mode, is_network_path(&dir));
        let t0 = Instant::now();
        let mut seen = None;
        while t0.elapsed() < Duration::from_secs(25) {
            if let Ok(c) = rx.recv_timeout(Duration::from_millis(100)) {
                if c.path.ends_with("external.md") {
                    seen = Some(t0.elapsed());
                    break;
                }
            }
        }
        drop(handle);
        eprintln!("RESULT mode={:?} event_after={:?}", mode, seen);
        assert!(seen.is_some(), "no event for external.md in {:?} mode", mode);
    }

    #[test]
    fn a_local_temp_folder_is_not_a_network_path() {
        let dir = temp_dir("local-check");
        assert!(!is_network_path(&dir), "{}", dir.display());
        let _ = std::fs::remove_dir_all(&dir);
        // A path that does not exist cannot be classified, so it stays native.
        assert!(!is_network_path(Path::new("/definitely/not/a/real/path")));
    }

    /// Manual: MIKEDOWN_SMB_DIR on a mounted share must be classified remote.
    #[test]
    #[ignore]
    fn a_mounted_share_is_a_network_path() {
        let dir = PathBuf::from(std::env::var("MIKEDOWN_SMB_DIR").expect("MIKEDOWN_SMB_DIR"));
        assert!(is_network_path(&dir), "{}", dir.display());
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
