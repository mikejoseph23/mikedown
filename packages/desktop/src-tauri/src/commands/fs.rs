//! File commands: read and write text with encoding, BOM and line-ending
//! detection, atomic writes, stat, directory listing and raw bytes for images.
//!
//! Every path is checked against the fs scope from `capabilities/default.json`
//! (`$HOME/**`, `$APPDATA/**`) plus whatever the dialog plugin and the launch
//! handler allowed at runtime, so the capability file stays the source of truth
//! even though the fs plugin's own commands are not used.

use std::fs as stdfs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::http::HeaderMap;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;
use tauri_plugin_shell::ShellExt;

const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    /// Not valid UTF-8. The text is a lossy decode for display; the file opens
    /// read-only (edge case 11) so the bytes are never rewritten.
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
}

/// What the editor gets back from `read_text`. `text` always uses `\n`; the
/// original line ending comes back as `eol` and is re-applied by `write_text`.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub text: String,
    pub encoding: Encoding,
    pub eol: Eol,
    pub mtime_ms: f64,
    pub read_only: bool,
    pub size: u64,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    pub exists: bool,
    pub is_file: bool,
    pub is_dir: bool,
    pub mtime_ms: f64,
    pub size: u64,
    pub read_only: bool,
}

#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct WriteOptions {
    pub eol: Eol,
    pub bom: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub mtime_ms: f64,
    pub size: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

// ── Pure helpers (unit-tested below) ───────────────────────────────────────

pub struct Decoded {
    pub text: String,
    pub encoding: Encoding,
    pub eol: Eol,
}

/// Split the BOM off, decode (lossily when the bytes are not UTF-8), detect
/// the dominant line ending and normalise the text to `\n`.
pub fn decode(bytes: &[u8]) -> Decoded {
    let (body, has_bom) = match bytes.strip_prefix(BOM) {
        Some(rest) => (rest, true),
        None => (bytes, false),
    };
    let (raw, valid) = match std::str::from_utf8(body) {
        Ok(s) => (s.to_string(), true),
        Err(_) => (String::from_utf8_lossy(body).into_owned(), false),
    };
    let encoding = if !valid {
        Encoding::Unknown
    } else if has_bom {
        Encoding::Utf8Bom
    } else {
        Encoding::Utf8
    };
    let eol = detect_eol(&raw);
    let text = if raw.contains('\r') { normalize_to_lf(&raw) } else { raw };
    Decoded { text, encoding, eol }
}

/// CRLF wins when at least as many lines end in `\r\n` as in a bare `\n`.
/// No newline at all means LF (the platform-neutral default for a new file).
pub fn detect_eol(text: &str) -> Eol {
    let crlf = text.matches("\r\n").count();
    let lf_total = text.matches('\n').count();
    if crlf > 0 && crlf >= lf_total - crlf {
        Eol::Crlf
    } else {
        Eol::Lf
    }
}

/// `\r\n` and lone `\r` both become `\n`.
pub fn normalize_to_lf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// The bytes `write_text` puts on disk for `text` (which is normalised to
/// `\n` first so a stray `\r` can never double up).
pub fn encode(text: &str, eol: Eol, bom: bool) -> Vec<u8> {
    let lf = if text.contains('\r') { normalize_to_lf(text) } else { text.to_string() };
    let body = match eol {
        Eol::Lf => lf,
        Eol::Crlf => lf.replace('\n', "\r\n"),
    };
    let mut out = Vec::with_capacity(body.len() + 3);
    if bom {
        out.extend_from_slice(BOM);
    }
    out.extend_from_slice(body.as_bytes());
    out
}

/// Write `bytes` to a temp file in the same directory, fsync it, carry the
/// original file's permissions over, then rename it over `path`. A crash
/// mid-write leaves the original untouched.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(
        ".{}.mikedown-{}-{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        nanos
    ));
    let original_perms = stdfs::metadata(path).ok().map(|m| m.permissions());

    let result = (|| {
        let mut file = stdfs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if let Some(perms) = original_perms {
            // Keep the mode of the file being replaced (owner/group bits on
            // unix; on Windows the read-only bit, which a read-only file
            // never reaches here with anyway).
            let _ = stdfs::set_permissions(&tmp, perms);
            // And its extended attributes (macOS Finder tags, per-file "Open
            // With", quarantine, ...), which a fresh temp file does not have.
            copy_xattrs(path, &tmp);
        }
        stdfs::rename(&tmp, path)
    })();

    if result.is_err() {
        let _ = stdfs::remove_file(&tmp);
    }
    result
}

/// Copy every extended attribute of `from` onto `to`, best effort: an
/// attribute the target filesystem refuses is skipped. No-op where the OS has
/// no xattrs (Windows: the read-only bit travels with the mode; alternate
/// data streams are not carried over).
#[cfg(unix)]
pub fn copy_xattrs(from: &Path, to: &Path) {
    let Ok(names) = xattr::list(from) else { return };
    for name in names {
        if let Ok(Some(value)) = xattr::get(from, &name) {
            let _ = xattr::set(to, &name, &value);
        }
    }
}

#[cfg(not(unix))]
pub fn copy_xattrs(_from: &Path, _to: &Path) {}

fn mtime_ms(meta: &stdfs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Read-only means the mode says so, or opening for write is refused
/// (permission denied on the file, a read-only volume, a locked file). The
/// probe never modifies the file.
fn is_read_only(path: &Path, meta: &stdfs::Metadata) -> bool {
    if meta.permissions().readonly() {
        return true;
    }
    match stdfs::OpenOptions::new().write(true).open(path) {
        Ok(_) => false,
        Err(e) => matches!(e.kind(), io::ErrorKind::PermissionDenied),
    }
}

fn describe(path: &Path, e: &io::Error) -> String {
    format!("{}: {}", path.display(), e)
}

// ── Tree helpers (pure, unit-tested below) ─────────────────────────────────

/// OS clutter that is never interesting in a notes tree.
const CLUTTER_FILES: &[&str] = &[".DS_Store", "Thumbs.db", "desktop.ini"];

/// Hidden by default (plan: Large folders): dotfolders, `node_modules`, and
/// OS clutter files. Dotfiles such as `.gitignore` stay visible.
pub fn is_hidden_entry(name: &str, is_dir: bool) -> bool {
    if is_dir {
        name.starts_with('.') || name == "node_modules"
    } else {
        CLUTTER_FILES.contains(&name)
    }
}

/// `atomic_write`'s and `rename`'s own temp files (`.name.mikedown-….tmp`).
pub fn is_mikedown_temp(name: &str) -> bool {
    name.starts_with('.') && name.ends_with(".tmp") && name.contains(".mikedown-")
}

/// Natural, case-insensitive order: `file2` before `file10`, `a` next to `A`.
/// Ties fall back to the plain order so the result is total.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (ac, bc): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let (mut i, mut j) = (0usize, 0usize);
    while i < ac.len() && j < bc.len() {
        if ac[i].is_ascii_digit() && bc[j].is_ascii_digit() {
            let si = i;
            while i < ac.len() && ac[i].is_ascii_digit() {
                i += 1;
            }
            let sj = j;
            while j < bc.len() && bc[j].is_ascii_digit() {
                j += 1;
            }
            let na: String = ac[si..i].iter().collect();
            let nb: String = bc[sj..j].iter().collect();
            let ta = na.trim_start_matches('0');
            let tb = nb.trim_start_matches('0');
            let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
            if ord != Ordering::Equal {
                return ord;
            }
            continue;
        }
        let la: String = ac[i].to_lowercase().collect();
        let lb: String = bc[j].to_lowercase().collect();
        let ord = la.cmp(&lb);
        if ord != Ordering::Equal {
            return ord;
        }
        i += 1;
        j += 1;
    }
    (ac.len() - i).cmp(&(bc.len() - j)).then_with(|| a.cmp(b))
}

/// Folders first, then natural order within each group.
pub fn sort_entries(entries: &mut [DirEntry]) {
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| natural_cmp(&a.name, &b.name)));
}

const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Longest full path Windows accepts without long-path support (MAX_PATH is
/// 260 including the terminating NUL). Edge case 25: no long paths in v1.
pub const WINDOWS_MAX_PATH: usize = 259;

/// Check one file or folder name before anything touches the disk. `windows`
/// adds Windows' rules (reserved device names, forbidden characters, trailing
/// dot or space). Errors are plain-language sentences for the UI.
pub fn validate_name(name: &str, windows: bool) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("The name cannot be empty.".into());
    }
    if name == "." || name == ".." {
        return Err(format!("“{name}” is not a valid name."));
    }
    if name.contains('/') || name.contains('\0') || (windows && name.contains('\\')) {
        return Err(format!("“{name}” cannot contain a slash."));
    }
    if windows {
        if let Some(c) = name.chars().find(|c| "<>:\"|?*".contains(*c) || (*c as u32) < 0x20) {
            let shown = if (c as u32) < 0x20 { "a control character".to_string() } else { format!("“{c}”") };
            return Err(format!("“{name}” cannot contain {shown} on Windows."));
        }
        if name.ends_with('.') || name.ends_with(' ') {
            return Err(format!("“{name}” cannot end with a dot or a space on Windows."));
        }
        let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
        if WINDOWS_RESERVED.contains(&stem.as_str()) {
            return Err(format!(
                "“{name}” uses a name Windows reserves for devices (CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9). Choose another name."
            ));
        }
    }
    Ok(())
}

/// `validate_name` on the last component plus Windows' path-length limit for
/// the whole path (`extra` = the longest relative path that will be created
/// beneath it, for folder copies and moves).
pub fn validate_target(path: &Path, extra: usize, windows: bool) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| format!("{} has no file name.", path.display()))?;
    validate_name(&name, windows)?;
    if windows {
        let len = path.as_os_str().to_string_lossy().encode_utf16().count() + extra;
        if len > WINDOWS_MAX_PATH {
            return Err(format!(
                "The full path would be {len} characters long; Windows allows at most {WINDOWS_MAX_PATH}. Use a shorter name or a folder nearer the top of the drive."
            ));
        }
    }
    Ok(())
}

fn check_target(path: &Path, extra: usize) -> Result<(), String> {
    validate_target(path, extra, cfg!(windows))
}

/// Longest relative path (in UTF-16 units, with its leading separator) under
/// `dir`, for the Windows length check of a folder copy or move. 0 for a file.
fn deepest_relative_len(dir: &Path) -> usize {
    fn walk(dir: &Path, prefix: usize, best: &mut usize) {
        let Ok(entries) = stdfs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let len = prefix + 1 + entry.file_name().to_string_lossy().encode_utf16().count();
            *best = (*best).max(len);
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                walk(&entry.path(), len, best);
            }
        }
    }
    let mut best = 0;
    if dir.is_dir() {
        walk(dir, 0, &mut best);
    }
    best
}

/// Same file or folder on disk (case-only renames on case-insensitive
/// volumes: `a.md` and `A.md` both resolve to it).
fn same_entry(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (stdfs::symlink_metadata(a), stdfs::symlink_metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        match (stdfs::canonicalize(a), stdfs::canonicalize(b)) {
            (Ok(x), Ok(y)) => x == y,
            _ => false,
        }
    }
}

fn temp_sibling(path: &Path, tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{name}.mikedown-{tag}-{}-{nanos}.tmp", std::process::id()))
}

/// Rename `from` to `to`. A case-only change (`notes.md` → `Notes.md`) goes
/// through a temp name in two steps so case-insensitive volumes (APFS, NTFS)
/// pick it up (edge case 25). Refuses to overwrite anything else.
pub fn rename_entry(from: &Path, to: &Path) -> io::Result<()> {
    if from == to {
        return Ok(());
    }
    if stdfs::symlink_metadata(from).is_err() {
        return Err(io::Error::new(io::ErrorKind::NotFound, "no such file or folder"));
    }
    if stdfs::symlink_metadata(to).is_ok() {
        if !same_entry(from, to) {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, "a file or folder with that name already exists"));
        }
        let tmp = temp_sibling(from, "rename");
        stdfs::rename(from, &tmp)?;
        if let Err(e) = stdfs::rename(&tmp, to) {
            let _ = stdfs::rename(&tmp, from);
            return Err(e);
        }
        return Ok(());
    }
    stdfs::rename(from, to)
}

/// Copy a file or folder tree, keeping modes and extended attributes.
pub fn copy_entry(from: &Path, to: &Path) -> io::Result<()> {
    let meta = stdfs::symlink_metadata(from)?;
    let ft = meta.file_type();
    if ft.is_symlink() {
        #[cfg(unix)]
        {
            let target = stdfs::read_link(from)?;
            return std::os::unix::fs::symlink(target, to);
        }
        #[cfg(not(unix))]
        {
            stdfs::copy(from, to)?;
            return Ok(());
        }
    }
    if ft.is_dir() {
        stdfs::create_dir(to)?;
        for entry in stdfs::read_dir(from)? {
            let entry = entry?;
            copy_entry(&entry.path(), &to.join(entry.file_name()))?;
        }
        let _ = stdfs::set_permissions(to, meta.permissions());
        copy_xattrs(from, to);
        return Ok(());
    }
    stdfs::copy(from, to)?;
    copy_xattrs(from, to);
    Ok(())
}

/// Move a file or folder. A plain rename when both sides share a volume
/// (xattrs travel with the inode); otherwise copy, then remove the original.
pub fn move_entry(from: &Path, to: &Path) -> io::Result<()> {
    if stdfs::symlink_metadata(to).is_ok() && !same_entry(from, to) {
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, "a file or folder with that name already exists"));
    }
    if to.starts_with(from) && to != from {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "cannot move a folder into itself"));
    }
    match rename_entry(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::CrossesDevices => {
            copy_entry(from, to)?;
            if stdfs::symlink_metadata(from)?.is_dir() {
                stdfs::remove_dir_all(from)
            } else {
                stdfs::remove_file(from)
            }
        }
        Err(e) => Err(e),
    }
}

/// Markdown files under `root`, recursively, for the folder index. Skips
/// `.mikedown/` always (version snapshots are not notes), hidden folders and
/// `node_modules` unless `show_hidden`, and symlinked folders (no cycles).
/// Stops at `limit` files.
pub fn walk_markdown(root: &Path, show_hidden: bool, limit: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = stdfs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            if ft.is_dir() {
                if name == ".mikedown" || (!show_hidden && is_hidden_entry(&name, true)) {
                    continue;
                }
                stack.push(entry.path());
            } else if ft.is_file() {
                let lower = name.to_ascii_lowercase();
                if lower.ends_with(".md") || lower.ends_with(".markdown") {
                    out.push(entry.path());
                    if out.len() >= limit {
                        return out;
                    }
                }
            }
        }
    }
    out
}

// ── Scope ──────────────────────────────────────────────────────────────────

/// Refuse paths outside the capability's fs scope. Paths the user picked in a
/// dialog, double-clicked or passed on the command line are allowed by the
/// dialog plugin and `launch.rs` respectively.
pub(crate) fn ensure_allowed<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
    if path.is_relative() {
        return Err(format!("{}: relative paths are not allowed", path.display()));
    }
    if app.fs_scope().is_allowed(path) {
        return Ok(());
    }
    // A file that does not exist yet (Save As into a folder the user picked,
    // an image folder about to be created) is allowed when its nearest
    // existing ancestor is.
    let mut cursor = path.parent();
    while let Some(dir) = cursor {
        if dir.exists() {
            if app.fs_scope().is_allowed(dir) {
                return Ok(());
            }
            break;
        }
        cursor = dir.parent();
    }
    Err(format!(
        "{} is outside the folders MikeDown may access (your home folder and files you picked).",
        path.display()
    ))
}

/// Let the webview display images that sit next to a document, and let the
/// image pipeline write into that document's folder.
pub fn allow_document<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    let _ = app.fs_scope().allow_file(path);
    let _ = app.asset_protocol_scope().allow_file(path);
    if let Some(dir) = path.parent() {
        let _ = app.fs_scope().allow_directory(dir, true);
        let _ = app.asset_protocol_scope().allow_directory(dir, true);
    }
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn read_text<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<TextFile, String> {
    ensure_allowed(&app, &path)?;
    let meta = stdfs::metadata(&path).map_err(|e| describe(&path, &e))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let bytes = stdfs::read(&path).map_err(|e| describe(&path, &e))?;
    let decoded = decode(&bytes);
    allow_document(&app, &path);
    Ok(TextFile {
        text: decoded.text,
        encoding: decoded.encoding,
        eol: decoded.eol,
        mtime_ms: mtime_ms(&meta),
        read_only: is_read_only(&path, &meta),
        size: meta.len(),
    })
}

#[tauri::command]
pub fn write_text<R: Runtime>(
    app: AppHandle<R>,
    path: PathBuf,
    text: String,
    options: WriteOptions,
) -> Result<WriteResult, String> {
    ensure_allowed(&app, &path)?;
    let bytes = encode(&text, options.eol, options.bom);
    atomic_write(&path, &bytes).map_err(|e| describe(&path, &e))?;
    allow_document(&app, &path);
    let meta = stdfs::metadata(&path).map_err(|e| describe(&path, &e))?;
    Ok(WriteResult { mtime_ms: mtime_ms(&meta), size: meta.len() })
}

#[tauri::command]
pub fn stat<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<Stat, String> {
    ensure_allowed(&app, &path)?;
    match stdfs::metadata(&path) {
        Ok(meta) => Ok(Stat {
            exists: true,
            is_file: meta.is_file(),
            is_dir: meta.is_dir(),
            mtime_ms: mtime_ms(&meta),
            size: meta.len(),
            read_only: meta.is_file() && is_read_only(&path, &meta),
        }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Stat::default()),
        Err(e) => Err(describe(&path, &e)),
    }
}

#[tauri::command]
pub fn exists<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<bool, String> {
    ensure_allowed(&app, &path)?;
    Ok(path.exists())
}

#[derive(Deserialize, Debug, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListOptions {
    /// Include dotfolders, `node_modules` and OS clutter files.
    #[serde(default)]
    pub show_hidden: bool,
}

/// Names in a directory (no recursion), folders first, natural order. An
/// absent directory is an empty list so the image pipeline can resolve a
/// filename before creating the folder. With `options` (the file tree) the
/// hidden entries are filtered out unless `showHidden`; without it (the image
/// pipeline, which needs every name to avoid a collision) nothing is.
/// MikeDown's own temp files are never listed.
#[tauri::command]
pub fn list_dir<R: Runtime>(
    app: AppHandle<R>,
    path: PathBuf,
    options: Option<ListOptions>,
) -> Result<Vec<DirEntry>, String> {
    ensure_allowed(&app, &path)?;
    list_dir_entries(&path, options)
}

pub fn list_dir_entries(path: &Path, options: Option<ListOptions>) -> Result<Vec<DirEntry>, String> {
    let entries = match stdfs::read_dir(path) {
        Ok(it) => it,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(describe(path, &e)),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_mikedown_temp(&name) {
            continue;
        }
        // Follow symlinks so a linked folder expands like a folder.
        let is_dir = match entry.file_type() {
            Ok(t) if t.is_symlink() => entry.path().is_dir(),
            Ok(t) => t.is_dir(),
            Err(_) => false,
        };
        if let Some(opts) = options {
            if !opts.show_hidden && is_hidden_entry(&name, is_dir) {
                continue;
            }
        }
        out.push(DirEntry { name, is_dir });
    }
    sort_entries(&mut out);
    Ok(out)
}

#[tauri::command]
pub fn mkdir<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &path)?;
    stdfs::create_dir_all(&path).map_err(|e| describe(&path, &e))
}

/// Raw file bytes (images for hashing, picked files to copy). The response is
/// an ArrayBuffer on the JS side.
#[tauri::command]
pub fn read_bytes<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<Response, String> {
    ensure_allowed(&app, &path)?;
    let bytes = stdfs::read(&path).map_err(|e| describe(&path, &e))?;
    Ok(Response::new(bytes))
}

fn header_path(headers: &HeaderMap, name: &str) -> Result<PathBuf, String> {
    let raw = headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("missing {name} header"))?;
    Ok(PathBuf::from(percent_decode(raw)))
}

/// `encodeURIComponent` inverse, enough for a file path header.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Write raw bytes (a pasted image). The body is the request's raw payload,
/// the destination is the `x-path` header (`encodeURIComponent`-encoded), so
/// megabytes of image never go through JSON.
#[tauri::command]
pub fn write_bytes<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<WriteResult, String> {
    let path = header_path(request.headers(), "x-path")?;
    ensure_allowed(&app, &path)?;
    let bytes: &[u8] = match request.body() {
        InvokeBody::Raw(b) => b.as_slice(),
        InvokeBody::Json(_) => return Err("write_bytes expects a raw body".into()),
    };
    if let Some(dir) = path.parent() {
        stdfs::create_dir_all(dir).map_err(|e| describe(dir, &e))?;
    }
    atomic_write(&path, bytes).map_err(|e| describe(&path, &e))?;
    let meta = stdfs::metadata(&path).map_err(|e| describe(&path, &e))?;
    Ok(WriteResult { mtime_ms: mtime_ms(&meta), size: meta.len() })
}

/// Open a path in the OS default application (non-text, non-image files).
/// `shell::open` is the plugin M0 registered; its successor (`opener`) is a
/// separate plugin the app does not ship yet.
#[allow(deprecated)]
#[tauri::command]
pub fn open_in_default_app<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &path)?;
    app.shell()
        .open(path.to_string_lossy().into_owned(), None)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Paths the webview may hand to `convertFileSrc` for a file it did not read
/// through `read_text` (the image viewer, a picked image kept in place).
#[tauri::command]
pub fn allow_asset<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &path)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| format!("{}: {e}", path.display()))
}

// ── Tree commands (M3) ─────────────────────────────────────────────────────

fn op_error(path: &Path, e: &io::Error) -> String {
    match e.kind() {
        io::ErrorKind::AlreadyExists => format!("“{}” already exists.", display_name(path)),
        io::ErrorKind::NotFound => format!("“{}” no longer exists.", display_name(path)),
        io::ErrorKind::PermissionDenied => format!("MikeDown is not allowed to change “{}”.", display_name(path)),
        _ => describe(path, e),
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// The folder a window opened (Open Folder, Open Containing Folder): the fs
/// and asset scopes cover everything beneath it, as a picked document's
/// folder does.
#[tauri::command]
pub fn allow_folder<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &path)?;
    if !path.is_dir() {
        return Err(format!("{} is not a folder", path.display()));
    }
    let _ = app.fs_scope().allow_directory(&path, true);
    let _ = app.asset_protocol_scope().allow_directory(&path, true);
    Ok(())
}

#[tauri::command]
pub fn rename<R: Runtime>(app: AppHandle<R>, from: PathBuf, to: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &from)?;
    ensure_allowed(&app, &to)?;
    check_target(&to, deepest_relative_len(&from))?;
    rename_entry(&from, &to).map_err(|e| op_error(&to, &e))
}

/// A new empty file; fails when the name is taken.
#[tauri::command]
pub fn create_file<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &path)?;
    check_target(&path, 0)?;
    stdfs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map(|_| ())
        .map_err(|e| op_error(&path, &e))
}

/// A new folder; fails when the name is taken (unlike `mkdir`, which is
/// `create_dir_all` for the image pipeline).
#[tauri::command]
pub fn create_dir<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &path)?;
    check_target(&path, 0)?;
    stdfs::create_dir(&path).map_err(|e| op_error(&path, &e))
}

/// Move a file or folder; creates the destination's parent folders (the
/// `.mikedown/versions/` mirror of a moved file may not exist yet).
#[tauri::command]
pub fn move_path<R: Runtime>(app: AppHandle<R>, from: PathBuf, to: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &from)?;
    ensure_allowed(&app, &to)?;
    check_target(&to, deepest_relative_len(&from))?;
    if to.starts_with(&from) && to != from {
        return Err("A folder cannot be moved into itself.".into());
    }
    if let Some(parent) = to.parent() {
        stdfs::create_dir_all(parent).map_err(|e| describe(parent, &e))?;
    }
    move_entry(&from, &to).map_err(|e| op_error(&to, &e))
}

#[tauri::command]
pub fn copy_path<R: Runtime>(app: AppHandle<R>, from: PathBuf, to: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &from)?;
    ensure_allowed(&app, &to)?;
    check_target(&to, deepest_relative_len(&from))?;
    if stdfs::symlink_metadata(&to).is_ok() {
        return Err(format!("“{}” already exists.", display_name(&to)));
    }
    if to.starts_with(&from) {
        return Err("A folder cannot be copied into itself.".into());
    }
    copy_entry(&from, &to).map_err(|e| op_error(&to, &e))
}

/// Move a file or folder to the OS Trash / Recycle Bin (edge case 21).
#[tauri::command]
pub fn trash<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &path)?;
    if stdfs::symlink_metadata(&path).is_err() {
        return Err(format!("“{}” no longer exists.", display_name(&path)));
    }
    move_to_trash(&path).map_err(|e| format!("Could not move “{}” to the Trash: {e}", display_name(&path)))
}

/// The OS Trash / Recycle Bin. On macOS through `NSFileManager.trashItemAtURL`
/// rather than the crate's default (AppleScript to Finder), which would ask
/// the user to let MikeDown control Finder on the first delete.
pub fn move_to_trash(path: &Path) -> Result<(), trash::Error> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::default();
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete(path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(path)
    }
}

/// Markdown files under a folder, for the folder `.md` index.
#[tauri::command]
pub fn list_markdown<R: Runtime>(
    app: AppHandle<R>,
    root: PathBuf,
    show_hidden: Option<bool>,
) -> Result<Vec<String>, String> {
    ensure_allowed(&app, &root)?;
    Ok(walk_markdown(&root, show_hidden.unwrap_or(false), 50_000)
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

/// Reveal in Finder / Explorer: the file manager opens on the parent folder
/// with the item selected.
#[tauri::command]
pub fn reveal_path<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &path)?;
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg("-R").arg(&path).spawn();
    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let result = std::process::Command::new("xdg-open")
        .arg(path.parent().unwrap_or(&path))
        .spawn();
    result.map(|_| ()).map_err(|e| describe(&path, &e))
}

#[derive(Serialize, Debug, Default)]
pub struct Modifiers {
    pub alt: bool,
}

/// Modifier keys held right now, read from the OS: a drop from Finder or
/// Explorer carries no key state into the webview, and Option/Alt inverts
/// move/copy (edge case 20).
#[tauri::command]
pub fn modifier_state() -> Modifiers {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSEvent, NSEventModifierFlags};
        let flags = NSEvent::modifierFlags_class();
        Modifiers { alt: flags.contains(NSEventModifierFlags::Option) }
    }
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetAsyncKeyState(v_key: i32) -> i16;
        }
        const VK_MENU: i32 = 0x12;
        // SAFETY: plain Win32 call with a constant virtual-key code.
        let state = unsafe { GetAsyncKeyState(VK_MENU) };
        Modifiers { alt: (state as u16 & 0x8000) != 0 }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Modifiers::default()
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mikedown-fs-{tag}-{}", std::process::id()));
        let _ = stdfs::remove_dir_all(&dir);
        stdfs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decodes_plain_utf8_lf() {
        let d = decode("# Hi\n\nline\n".as_bytes());
        assert_eq!(d.encoding, Encoding::Utf8);
        assert_eq!(d.eol, Eol::Lf);
        assert_eq!(d.text, "# Hi\n\nline\n");
    }

    #[test]
    fn decodes_bom_and_crlf_and_normalises_to_lf() {
        let mut bytes = BOM.to_vec();
        bytes.extend_from_slice("a\r\nb\r\n".as_bytes());
        let d = decode(&bytes);
        assert_eq!(d.encoding, Encoding::Utf8Bom);
        assert_eq!(d.eol, Eol::Crlf);
        assert_eq!(d.text, "a\nb\n");
    }

    #[test]
    fn mixed_line_endings_pick_the_majority() {
        assert_eq!(detect_eol("a\r\nb\r\nc\n"), Eol::Crlf);
        assert_eq!(detect_eol("a\nb\nc\r\n"), Eol::Lf);
        assert_eq!(detect_eol("a\r\nb\n"), Eol::Crlf, "a tie keeps CRLF");
        assert_eq!(detect_eol("no newline"), Eol::Lf);
        assert_eq!(detect_eol(""), Eol::Lf);
    }

    #[test]
    fn invalid_utf8_is_unknown_and_lossy() {
        let d = decode(&[0x48, 0x69, 0xFF, 0x0A]);
        assert_eq!(d.encoding, Encoding::Unknown);
        assert_eq!(d.text, "Hi\u{FFFD}\n");
        assert_eq!(d.eol, Eol::Lf);
    }

    #[test]
    fn latin1_bytes_are_unknown_not_bom() {
        // "café" in Latin-1: the 0xE9 byte is not valid UTF-8 on its own.
        let d = decode(&[0x63, 0x61, 0x66, 0xE9]);
        assert_eq!(d.encoding, Encoding::Unknown);
        assert_eq!(d.text, "caf\u{FFFD}");
    }

    #[test]
    fn encode_round_trips_crlf_and_bom() {
        let bytes = encode("a\nb\n", Eol::Crlf, true);
        let mut expected = BOM.to_vec();
        expected.extend_from_slice("a\r\nb\r\n".as_bytes());
        assert_eq!(bytes, expected);
        let back = decode(&bytes);
        assert_eq!(back.text, "a\nb\n");
        assert_eq!(back.eol, Eol::Crlf);
        assert_eq!(back.encoding, Encoding::Utf8Bom);
    }

    #[test]
    fn encode_never_doubles_a_stray_cr() {
        assert_eq!(encode("a\r\nb\n", Eol::Crlf, false), "a\r\nb\r\n".as_bytes());
        assert_eq!(encode("a\r\nb\n", Eol::Lf, false), "a\nb\n".as_bytes());
    }

    #[test]
    fn read_write_is_byte_identical_for_an_unchanged_file() {
        for original in ["\u{FEFF}# T\r\n\r\ntext\r\n", "# T\n\ntext\n", "x"] {
            let bytes = original.as_bytes();
            let d = decode(bytes);
            let bom = d.encoding == Encoding::Utf8Bom;
            assert_eq!(encode(&d.text, d.eol, bom), bytes, "{original:?}");
        }
    }

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp_file() {
        let dir = temp_dir("atomic");
        let path = dir.join("doc.md");
        stdfs::write(&path, b"old").unwrap();
        atomic_write(&path, b"new content").unwrap();
        assert_eq!(stdfs::read(&path).unwrap(), b"new content");
        let leftovers: Vec<_> = stdfs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(leftovers, vec!["doc.md".to_string()]);
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_the_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("mode");
        let path = dir.join("doc.md");
        stdfs::write(&path, b"old").unwrap();
        stdfs::set_permissions(&path, stdfs::Permissions::from_mode(0o640)).unwrap();
        atomic_write(&path, b"new").unwrap();
        let mode = stdfs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_creates_a_new_file() {
        let dir = temp_dir("new");
        let path = dir.join("fresh.md");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(stdfs::read(&path).unwrap(), b"hello");
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn read_only_probe_sees_the_mode_bit() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("ro");
        let path = dir.join("locked.md");
        stdfs::write(&path, b"x").unwrap();
        stdfs::set_permissions(&path, stdfs::Permissions::from_mode(0o444)).unwrap();
        let meta = stdfs::metadata(&path).unwrap();
        assert!(is_read_only(&path, &meta));
        stdfs::set_permissions(&path, stdfs::Permissions::from_mode(0o644)).unwrap();
        let meta = stdfs::metadata(&path).unwrap();
        assert!(!is_read_only(&path, &meta));
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lone_cr_line_endings_normalise_to_lf_and_detect_as_lf() {
        // Classic Mac endings: no `\r\n` pairs, so LF is what a save writes.
        let d = decode(b"a\rb\rc");
        assert_eq!(d.text, "a\nb\nc");
        assert_eq!(d.eol, Eol::Lf);
        assert_eq!(d.encoding, Encoding::Utf8);
    }

    #[test]
    fn bom_only_and_empty_files() {
        let d = decode(BOM);
        assert_eq!((d.text.as_str(), d.encoding, d.eol), ("", Encoding::Utf8Bom, Eol::Lf));
        assert_eq!(encode("", Eol::Lf, true), BOM);
        let e = decode(b"");
        assert_eq!((e.text.as_str(), e.encoding, e.eol), ("", Encoding::Utf8, Eol::Lf));
        assert!(encode("", Eol::Crlf, false).is_empty());
    }

    #[test]
    fn bom_followed_by_invalid_utf8_is_unknown() {
        let mut bytes = BOM.to_vec();
        bytes.extend_from_slice(&[0x61, 0xFF, 0x0D, 0x0A]);
        let d = decode(&bytes);
        assert_eq!(d.encoding, Encoding::Unknown);
        assert_eq!(d.eol, Eol::Crlf);
        assert_eq!(d.text, "a\u{FFFD}\n");
    }

    #[test]
    fn utf16_boms_are_not_utf8() {
        // UTF-16 LE / BE: shown read-only (lossy) rather than mangled on save.
        assert_eq!(decode(&[0xFF, 0xFE, 0x61, 0x00]).encoding, Encoding::Unknown);
        assert_eq!(decode(&[0xFE, 0xFF, 0x00, 0x61]).encoding, Encoding::Unknown);
    }

    #[test]
    fn a_crlf_inside_a_code_block_is_counted_like_any_other_line() {
        assert_eq!(detect_eol("```\r\ncode\r\n```\r\ntext\n"), Eol::Crlf);
    }

    /// The fixture files the TypeScript encoding test (test/encoding.test.ts)
    /// also uses: `decode` must produce `expected.json` (the `read_text`
    /// response the TS side mocks), and `encode` of that must give the file's
    /// bytes back, except for the non-UTF-8 file which is never rewritten.
    #[test]
    fn shared_fixtures_decode_to_expected_json_and_round_trip() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures/encoding");
        let expected: serde_json::Value =
            serde_json::from_slice(&stdfs::read(dir.join("expected.json")).unwrap()).unwrap();
        let map = expected.as_object().unwrap();
        assert!(map.len() >= 5, "fixtures missing");
        for (name, want) in map {
            let bytes = stdfs::read(dir.join(name)).unwrap();
            let d = decode(&bytes);
            assert_eq!(d.text, want["text"].as_str().unwrap(), "{name} text");
            assert_eq!(serde_json::to_value(d.encoding).unwrap(), want["encoding"], "{name} encoding");
            assert_eq!(serde_json::to_value(d.eol).unwrap(), want["eol"], "{name} eol");
            if d.encoding != Encoding::Unknown {
                let bom = d.encoding == Encoding::Utf8Bom;
                assert_eq!(encode(&d.text, d.eol, bom), bytes, "{name} round-trip");
            }
        }
    }

    #[test]
    fn percent_decode_handles_spaces_and_unicode() {
        assert_eq!(percent_decode("/a%20b/caf%C3%A9.md"), "/a b/café.md");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
        assert_eq!(percent_decode("end%2"), "end%2");
    }

    // ── M3: tree helpers and operations ────────────────────────────────────

    fn names(entries: &[DirEntry]) -> Vec<String> {
        entries.iter().map(|e| format!("{}{}", e.name, if e.is_dir { "/" } else { "" })).collect()
    }

    #[test]
    fn natural_order_compares_numbers_by_value_and_ignores_case() {
        let mut v = vec!["file10.md", "File2.md", "file1.md", "b.md", "A.md", "file02.md"];
        v.sort_by(|a, b| natural_cmp(a, b));
        // 2 and 02 tie on value; the plain order breaks the tie (upper case first).
        assert_eq!(v, vec!["A.md", "b.md", "file1.md", "File2.md", "file02.md", "file10.md"]);
        assert_eq!(natural_cmp("a", "a"), std::cmp::Ordering::Equal);
        assert_eq!(natural_cmp("x9", "x10"), std::cmp::Ordering::Less);
        assert_eq!(natural_cmp("Chapter 2", "chapter 10"), std::cmp::Ordering::Less);
    }

    #[test]
    fn list_dir_sorts_folders_first_and_filters_hidden_entries() {
        let dir = temp_dir("list");
        for f in ["note10.md", "note2.md", "Alpha.md", ".gitignore", ".DS_Store", ".x.md.mikedown-1-2.tmp"] {
            stdfs::write(dir.join(f), b"").unwrap();
        }
        for d in ["zeta", "Beta", ".git", "node_modules", ".mikedown"] {
            stdfs::create_dir(dir.join(d)).unwrap();
        }
        let tree = list_dir_entries(&dir, Some(ListOptions { show_hidden: false })).unwrap();
        assert_eq!(names(&tree), vec!["Beta/", "zeta/", ".gitignore", "Alpha.md", "note2.md", "note10.md"]);
        let all = list_dir_entries(&dir, Some(ListOptions { show_hidden: true })).unwrap();
        assert_eq!(
            names(&all),
            vec![".git/", ".mikedown/", "Beta/", "node_modules/", "zeta/", ".DS_Store", ".gitignore", "Alpha.md", "note2.md", "note10.md"]
        );
        // No options (the image pipeline): every name, still never our temp files.
        let raw = list_dir_entries(&dir, None).unwrap();
        assert_eq!(raw.len(), 10);
        assert!(list_dir_entries(&dir.join("missing"), None).unwrap().is_empty());
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_are_validated_with_windows_rules_on_request() {
        assert!(validate_name("notes.md", true).is_ok());
        assert!(validate_name("", false).is_err());
        assert!(validate_name("  ", false).is_err());
        assert!(validate_name("..", false).is_err());
        assert!(validate_name("a/b", false).is_err());
        // Windows only.
        for bad in ["CON", "con.md", "Nul.txt", "COM1", "lpt9.md", "aux .md", "a:b.md", "q?.md", "x*.md", "pipe|.md", "trail.", "trail "] {
            assert!(validate_name(bad, true).is_err(), "{bad} should be refused on Windows");
            assert!(validate_name(bad, false).is_ok() || bad.contains('/'), "{bad} is fine elsewhere");
        }
        assert!(validate_name("a\\b", true).is_err());
        assert!(validate_name("console.md", true).is_ok());
        assert!(validate_name("COM10.md", true).is_ok());
        let err = validate_name("CON.md", true).unwrap_err();
        assert!(err.contains("reserves"), "{err}");
    }

    #[test]
    fn windows_paths_over_259_characters_are_refused_before_touching_disk() {
        // Built with join so the last component parses on every host OS.
        let base = PathBuf::from(format!("C:/{}", "d".repeat(240)));
        let ok = base.join("n".repeat(10));
        assert!(validate_target(&ok, 0, true).is_ok(), "{} chars", ok.as_os_str().len());
        let long = base.join("n".repeat(30));
        let err = validate_target(&long, 0, true).unwrap_err();
        assert!(err.contains("at most 259"), "{err}");
        // A folder copy counts its deepest descendant.
        assert!(validate_target(&ok, 20, true).is_err());
        // Not enforced off Windows.
        assert!(validate_target(&long, 0, false).is_ok());
    }

    #[test]
    fn case_only_rename_changes_the_name_on_disk() {
        let dir = temp_dir("case");
        stdfs::write(dir.join("notes.md"), b"body").unwrap();
        rename_entry(&dir.join("notes.md"), &dir.join("Notes.md")).unwrap();
        let listed: Vec<String> = stdfs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(listed, vec!["Notes.md".to_string()]);
        assert_eq!(stdfs::read(dir.join("Notes.md")).unwrap(), b"body");
        // Folders too.
        stdfs::create_dir(dir.join("drafts")).unwrap();
        rename_entry(&dir.join("drafts"), &dir.join("Drafts")).unwrap();
        assert!(names(&list_dir_entries(&dir, None).unwrap()).contains(&"Drafts/".to_string()));
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rename_refuses_to_overwrite_another_file() {
        let dir = temp_dir("clobber");
        stdfs::write(dir.join("a.md"), b"a").unwrap();
        stdfs::write(dir.join("b.md"), b"b").unwrap();
        let err = rename_entry(&dir.join("a.md"), &dir.join("b.md")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(stdfs::read(dir.join("b.md")).unwrap(), b"b");
        assert!(rename_entry(&dir.join("gone.md"), &dir.join("c.md")).is_err());
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn move_and_copy_folders_and_refuse_moving_into_themselves() {
        let dir = temp_dir("move");
        stdfs::create_dir_all(dir.join("src/inner")).unwrap();
        stdfs::write(dir.join("src/inner/x.md"), b"x").unwrap();
        copy_entry(&dir.join("src"), &dir.join("copy")).unwrap();
        assert_eq!(stdfs::read(dir.join("copy/inner/x.md")).unwrap(), b"x");
        assert_eq!(stdfs::read(dir.join("src/inner/x.md")).unwrap(), b"x");
        let err = move_entry(&dir.join("src"), &dir.join("src/inner/src")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        stdfs::create_dir(dir.join("dest")).unwrap();
        move_entry(&dir.join("src"), &dir.join("dest/src")).unwrap();
        assert!(!dir.join("src").exists());
        assert_eq!(stdfs::read(dir.join("dest/src/inner/x.md")).unwrap(), b"x");
        let err = move_entry(&dir.join("copy"), &dir.join("dest/src")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn walk_markdown_skips_versions_hidden_and_node_modules() {
        let dir = temp_dir("walk");
        for f in ["a.md", "sub/b.markdown", "sub/deeper/c.MD", "sub/readme.txt", ".mikedown/versions/a.md/20261023T120000Z.md", ".obsidian/d.md", "node_modules/pkg/e.md"] {
            let p = dir.join(f);
            stdfs::create_dir_all(p.parent().unwrap()).unwrap();
            stdfs::write(p, b"").unwrap();
        }
        let mut found: Vec<String> = walk_markdown(&dir, false, 100)
            .into_iter()
            .map(|p| p.strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/"))
            .collect();
        found.sort();
        assert_eq!(found, vec!["a.md", "sub/b.markdown", "sub/deeper/c.MD"]);
        let with_hidden = walk_markdown(&dir, true, 100);
        assert_eq!(with_hidden.len(), 5, "hidden folders and node_modules, never .mikedown");
        assert_eq!(walk_markdown(&dir, true, 2).len(), 2);
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn temp_names_are_recognised() {
        assert!(is_mikedown_temp(".doc.md.mikedown-123-456.tmp"));
        assert!(is_mikedown_temp(".doc.md.mikedown-rename-1-2.tmp"));
        assert!(!is_mikedown_temp("doc.md"));
        assert!(!is_mikedown_temp(".hidden.tmp"));
    }

    /// Puts a real file in the user's Trash, so it only runs on request:
    /// `cargo test trash_moves -- --ignored`.
    #[test]
    #[ignore]
    fn trash_moves_a_file_out_of_its_folder() {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let dir = home.join("tmp-mikedown-m3").join("trash-check");
        stdfs::create_dir_all(&dir).unwrap();
        let file = dir.join(format!("mikedown-trash-check-{}.md", std::process::id()));
        stdfs::write(&file, b"# trash me\n").unwrap();
        move_to_trash(&file).unwrap();
        assert!(!file.exists());
        eprintln!("trashed {}", file.display());
    }

    #[cfg(unix)]
    fn set_tag(path: &Path) {
        xattr::set(path, "user.mikedown.test", b"tagged").unwrap();
    }

    #[cfg(unix)]
    fn tag_of(path: &Path) -> Option<Vec<u8>> {
        xattr::get(path, "user.mikedown.test").unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_extended_attributes() {
        let dir = temp_dir("xattr-save");
        let path = dir.join("doc.md");
        stdfs::write(&path, b"old").unwrap();
        set_tag(&path);
        atomic_write(&path, b"new").unwrap();
        assert_eq!(stdfs::read(&path).unwrap(), b"new");
        assert_eq!(tag_of(&path).as_deref(), Some(&b"tagged"[..]));
        stdfs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rename_move_and_copy_keep_extended_attributes() {
        let dir = temp_dir("xattr-ops");
        let a = dir.join("a.md");
        stdfs::write(&a, b"a").unwrap();
        set_tag(&a);
        rename_entry(&a, &dir.join("A.md")).unwrap();
        assert_eq!(tag_of(&dir.join("A.md")).as_deref(), Some(&b"tagged"[..]));
        stdfs::create_dir(dir.join("sub")).unwrap();
        move_entry(&dir.join("A.md"), &dir.join("sub/A.md")).unwrap();
        assert_eq!(tag_of(&dir.join("sub/A.md")).as_deref(), Some(&b"tagged"[..]));
        set_tag(&dir.join("sub"));
        copy_entry(&dir.join("sub"), &dir.join("sub2")).unwrap();
        assert_eq!(tag_of(&dir.join("sub2")).as_deref(), Some(&b"tagged"[..]), "folder xattrs");
        assert_eq!(tag_of(&dir.join("sub2/A.md")).as_deref(), Some(&b"tagged"[..]), "file xattrs");
        stdfs::remove_dir_all(&dir).unwrap();
    }
}
