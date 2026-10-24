//! Version snapshots (M6, edge cases 1 and 3): the disk side of
//! `src/documents/versioning.ts`.
//!
//! The TypeScript side owns the policy (whether a save snapshots at all, the
//! snapshot's name, which old snapshots to prune). These commands only do the
//! IO, and refuse anything that is not a snapshot inside a
//! `.mikedown/versions/` mirror, so a bad argument can never delete or
//! overwrite a note:
//!
//! - `versions_list`: the snapshots in one file's mirror folder, oldest first.
//! - `versions_snapshot`: copy the file's bytes (as just written by a save)
//!   into the mirror under a new name, unless the file is over the size cap
//!   or byte-identical to the newest snapshot. `.mikedown/` is created here,
//!   on the first snapshot, and nowhere else.
//! - `versions_prune`: delete named snapshots (permanently; they are copies).
//! - `versions_move`: carry a mirror along when its file or folder is renamed
//!   or moved, merging into a mirror that already exists at the destination.

use std::fs as stdfs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::fs::{atomic_write, ensure_allowed};

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// `YYYYMMDDTHHMMSSZ.md`.
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Created,
    /// Same bytes as the newest snapshot: nothing written.
    Identical,
    /// Over the size cap (edge case 1): nothing written, no message.
    TooLarge,
}

/// `20261023T120000Z.md`: eight digits, `T`, six digits, `Z`, `.md`.
pub fn is_snapshot_name(name: &str) -> bool {
    let b = name.as_bytes();
    if b.len() != 19 || !name.ends_with(".md") {
        return false;
    }
    b[..8].iter().all(u8::is_ascii_digit) && b[8] == b'T' && b[9..15].iter().all(u8::is_ascii_digit) && b[15] == b'Z'
}

/// True when `dir` lies under a `.mikedown/versions/` folder (not the
/// `versions` folder itself).
pub fn is_versions_dir(dir: &Path) -> bool {
    let parts: Vec<&std::ffi::OsStr> = dir
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s),
            _ => None,
        })
        .collect();
    if dir.components().any(|c| matches!(c, Component::ParentDir)) {
        return false;
    }
    parts
        .windows(2)
        .enumerate()
        .any(|(i, w)| w[0] == ".mikedown" && w[1] == "versions" && i + 2 < parts.len())
}

fn invalid(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, msg.to_string())
}

/// Snapshots in `dir`, sorted by name (which is chronological). A missing
/// folder is an empty list; other entries are ignored.
pub fn list_snapshots(dir: &Path) -> io::Result<Vec<Snapshot>> {
    let mut out = Vec::new();
    let rd = match stdfs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e),
    };
    for entry in rd {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_snapshot_name(&name) {
            continue;
        }
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        out.push(Snapshot { path: entry.path().to_string_lossy().into_owned(), name, size: meta.len() });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Copy `file` into `dir/name` unless it is over `max_bytes` or identical to
/// `dir/newest`. Creates `dir` (and so `.mikedown/`) only when it writes.
pub fn snapshot_into(file: &Path, dir: &Path, name: &str, newest: Option<&str>, max_bytes: u64) -> io::Result<Outcome> {
    if !is_versions_dir(dir) {
        return Err(invalid("not a .mikedown/versions folder"));
    }
    if !is_snapshot_name(name) || newest.is_some_and(|n| !is_snapshot_name(n)) {
        return Err(invalid("not a snapshot name"));
    }
    let meta = stdfs::metadata(file)?;
    if !meta.is_file() {
        return Err(invalid("not a file"));
    }
    if meta.len() > max_bytes {
        return Ok(Outcome::TooLarge);
    }
    let bytes = stdfs::read(file)?;
    if let Some(newest) = newest {
        if let Ok(prev) = stdfs::read(dir.join(newest)) {
            if prev == bytes {
                return Ok(Outcome::Identical);
            }
        }
    }
    let target = dir.join(name);
    if target.exists() {
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, "a snapshot with that name already exists"));
    }
    stdfs::create_dir_all(dir)?;
    atomic_write(&target, &bytes)?;
    Ok(Outcome::Created)
}

/// Delete the named snapshots from `dir`. Names that are not snapshot names
/// are refused; names already gone are skipped. Returns how many went.
pub fn prune_snapshots(dir: &Path, names: &[String]) -> io::Result<u32> {
    if !is_versions_dir(dir) {
        return Err(invalid("not a .mikedown/versions folder"));
    }
    if let Some(bad) = names.iter().find(|n| !is_snapshot_name(n)) {
        return Err(invalid(&format!("not a snapshot name: {bad}")));
    }
    let mut removed = 0;
    for name in names {
        match stdfs::remove_file(dir.join(name)) {
            Ok(()) => removed += 1,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(removed)
}

/// Move the mirror `from` to `to` (both under `.mikedown/versions/`). When
/// `to` already exists the two merge: entries missing at the destination move
/// over, identical files are dropped, and a differing file of the same name
/// stays behind in `from` (which then survives, so nothing is lost).
pub fn move_mirror(from: &Path, to: &Path) -> io::Result<()> {
    if !is_versions_dir(from) || !is_versions_dir(to) {
        return Err(invalid("not a .mikedown/versions folder"));
    }
    if to.starts_with(from) && to != from {
        return Err(invalid("cannot move a folder into itself"));
    }
    if stdfs::symlink_metadata(from).is_err() || from == to {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        stdfs::create_dir_all(parent)?;
    }
    if stdfs::symlink_metadata(to).is_err() || super::fs::same_entry(from, to) {
        return super::fs::move_entry(from, to);
    }
    merge(from, to)
}

fn merge(from: &Path, to: &Path) -> io::Result<()> {
    let from_meta = stdfs::symlink_metadata(from)?;
    let to_meta = stdfs::symlink_metadata(to)?;
    if from_meta.is_dir() && to_meta.is_dir() {
        for entry in stdfs::read_dir(from)? {
            let entry = entry?;
            let dest = to.join(entry.file_name());
            if stdfs::symlink_metadata(&dest).is_err() {
                stdfs::rename(entry.path(), &dest)?;
            } else {
                merge(&entry.path(), &dest)?;
            }
        }
        // Gone when everything moved; kept when a conflict stayed behind.
        let _ = stdfs::remove_dir(from);
        return Ok(());
    }
    if from_meta.is_file() && to_meta.is_file() && stdfs::read(from)? == stdfs::read(to)? {
        stdfs::remove_file(from)?;
    }
    Ok(())
}

fn err(path: &Path, e: &io::Error) -> String {
    format!("{}: {e}", path.display())
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn versions_list<R: Runtime>(app: AppHandle<R>, dir: PathBuf) -> Result<Vec<Snapshot>, String> {
    ensure_allowed(&app, &dir)?;
    if !is_versions_dir(&dir) {
        return Err(format!("{} is not a versions folder", dir.display()));
    }
    list_snapshots(&dir).map_err(|e| err(&dir, &e))
}

#[tauri::command]
pub fn versions_snapshot<R: Runtime>(
    app: AppHandle<R>,
    file: PathBuf,
    dir: PathBuf,
    name: String,
    newest: Option<String>,
    max_bytes: u64,
) -> Result<Outcome, String> {
    ensure_allowed(&app, &file)?;
    ensure_allowed(&app, &dir)?;
    snapshot_into(&file, &dir, &name, newest.as_deref(), max_bytes).map_err(|e| err(&dir, &e))
}

#[tauri::command]
pub fn versions_prune<R: Runtime>(app: AppHandle<R>, dir: PathBuf, names: Vec<String>) -> Result<u32, String> {
    ensure_allowed(&app, &dir)?;
    prune_snapshots(&dir, &names).map_err(|e| err(&dir, &e))
}

#[tauri::command]
pub fn versions_move<R: Runtime>(app: AppHandle<R>, from: PathBuf, to: PathBuf) -> Result<(), String> {
    ensure_allowed(&app, &from)?;
    ensure_allowed(&app, &to)?;
    move_mirror(&from, &to).map_err(|e| err(&from, &e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mikedown-versions-{tag}-{}-{nanos}", std::process::id()));
        stdfs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn snapshot_names() {
        assert!(is_snapshot_name("20261023T120000Z.md"));
        assert!(!is_snapshot_name("20261023T120000Z.txt"));
        assert!(!is_snapshot_name("2026-10-23T120000Z.md"));
        assert!(!is_snapshot_name("../20261023T1200Z.md"));
        assert!(!is_snapshot_name("notes.md"));
    }

    #[test]
    fn versions_dir_detection() {
        assert!(is_versions_dir(Path::new("/n/.mikedown/versions/a.md")));
        assert!(is_versions_dir(Path::new("/n/.mikedown/versions/sub/a.md")));
        assert!(!is_versions_dir(Path::new("/n/.mikedown/versions")));
        assert!(!is_versions_dir(Path::new("/n/sub/a.md")));
        assert!(!is_versions_dir(Path::new("/n/.mikedown/versions/../../a.md")));
    }

    #[test]
    fn first_snapshot_creates_mikedown_then_identical_skips() {
        let root = tmp("snap");
        let file = root.join("a.md");
        stdfs::write(&file, b"# one\r\n").unwrap();
        let dir = root.join(".mikedown/versions/a.md");
        assert!(!root.join(".mikedown").exists());

        assert_eq!(snapshot_into(&file, &dir, "20261023T120000Z.md", None, 1024).unwrap(), Outcome::Created);
        assert_eq!(stdfs::read(dir.join("20261023T120000Z.md")).unwrap(), b"# one\r\n");

        // Same bytes as the newest snapshot: nothing new.
        let out = snapshot_into(&file, &dir, "20261023T120001Z.md", Some("20261023T120000Z.md"), 1024).unwrap();
        assert_eq!(out, Outcome::Identical);
        assert!(!dir.join("20261023T120001Z.md").exists());

        stdfs::write(&file, b"# two\r\n").unwrap();
        let out = snapshot_into(&file, &dir, "20261023T120002Z.md", Some("20261023T120000Z.md"), 1024).unwrap();
        assert_eq!(out, Outcome::Created);
        let names: Vec<String> = list_snapshots(&dir).unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(names, vec!["20261023T120000Z.md", "20261023T120002Z.md"]);
        stdfs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn too_large_writes_nothing_and_creates_no_folder() {
        let root = tmp("large");
        let file = root.join("big.md");
        stdfs::write(&file, vec![b'x'; 3 * 1024 * 1024]).unwrap();
        let dir = root.join(".mikedown/versions/big.md");
        let out = snapshot_into(&file, &dir, "20261023T120000Z.md", None, 2 * 1024 * 1024).unwrap();
        assert_eq!(out, Outcome::TooLarge);
        assert!(!root.join(".mikedown").exists());
        stdfs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn refuses_paths_outside_a_mirror_and_bad_names() {
        let root = tmp("refuse");
        let file = root.join("a.md");
        stdfs::write(&file, b"x").unwrap();
        assert!(snapshot_into(&file, &root, "20261023T120000Z.md", None, 1024).is_err());
        let dir = root.join(".mikedown/versions/a.md");
        assert!(snapshot_into(&file, &dir, "a.md", None, 1024).is_err());
        assert!(prune_snapshots(&root, &["20261023T120000Z.md".into()]).is_err());
        assert!(prune_snapshots(&dir, &["a.md".into()]).is_err());
        // An existing snapshot is never overwritten.
        snapshot_into(&file, &dir, "20261023T120000Z.md", None, 1024).unwrap();
        stdfs::write(&file, b"y").unwrap();
        assert!(snapshot_into(&file, &dir, "20261023T120000Z.md", None, 1024).is_err());
        assert_eq!(stdfs::read(dir.join("20261023T120000Z.md")).unwrap(), b"x");
        stdfs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn prune_deletes_only_named_snapshots() {
        let root = tmp("prune");
        let dir = root.join(".mikedown/versions/a.md");
        stdfs::create_dir_all(&dir).unwrap();
        for n in ["20261023T120000Z.md", "20261023T120001Z.md", "20261023T120002Z.md"] {
            stdfs::write(dir.join(n), n).unwrap();
        }
        stdfs::write(dir.join("notes.txt"), "keep").unwrap();
        let removed = prune_snapshots(&dir, &["20261023T120000Z.md".into(), "20261023T120001Z.md".into(), "20201023T120001Z.md".into()]).unwrap();
        assert_eq!(removed, 2);
        let names: Vec<String> = list_snapshots(&dir).unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(names, vec!["20261023T120002Z.md"]);
        assert!(dir.join("notes.txt").exists());
        stdfs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn list_of_missing_folder_is_empty() {
        let root = tmp("missing");
        assert!(list_snapshots(&root.join(".mikedown/versions/none.md")).unwrap().is_empty());
        stdfs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn move_carries_and_merges_mirrors() {
        let root = tmp("move");
        let a = root.join(".mikedown/versions/sub/a.md");
        stdfs::create_dir_all(&a).unwrap();
        stdfs::write(a.join("20261023T120000Z.md"), "one").unwrap();

        // Plain move into a folder that does not exist yet.
        let b = root.join(".mikedown/versions/other/deeper/b.md");
        move_mirror(&a, &b).unwrap();
        assert!(!a.exists());
        assert_eq!(stdfs::read_to_string(b.join("20261023T120000Z.md")).unwrap(), "one");

        // Merge into an existing mirror: a new name moves over, an identical
        // one is dropped, a differing one stays behind.
        let c = root.join(".mikedown/versions/c.md");
        stdfs::create_dir_all(&c).unwrap();
        stdfs::write(c.join("20261023T120000Z.md"), "one").unwrap();
        stdfs::write(b.join("20261023T130000Z.md"), "two").unwrap();
        stdfs::write(b.join("20261023T140000Z.md"), "mine").unwrap();
        stdfs::write(c.join("20261023T140000Z.md"), "theirs").unwrap();
        move_mirror(&b, &c).unwrap();
        let names: Vec<String> = list_snapshots(&c).unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(names, vec!["20261023T120000Z.md", "20261023T130000Z.md", "20261023T140000Z.md"]);
        assert_eq!(stdfs::read_to_string(c.join("20261023T140000Z.md")).unwrap(), "theirs");
        assert_eq!(stdfs::read_to_string(b.join("20261023T140000Z.md")).unwrap(), "mine");
        assert!(!b.join("20261023T120000Z.md").exists());

        // A missing source is a no-op (the file never had versions).
        move_mirror(&root.join(".mikedown/versions/none.md"), &root.join(".mikedown/versions/x.md")).unwrap();
        assert!(!root.join(".mikedown/versions/x.md").exists());
        assert!(move_mirror(&root.join("plain"), &c).is_err());
        stdfs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn case_only_rename_keeps_every_snapshot() {
        let root = tmp("case");
        let a = root.join(".mikedown/versions/notes.md");
        stdfs::create_dir_all(&a).unwrap();
        stdfs::write(a.join("20261023T120000Z.md"), "one").unwrap();
        let b = root.join(".mikedown/versions/Notes.md");
        move_mirror(&a, &b).unwrap();
        // Case-insensitive volumes (APFS, NTFS) and case-sensitive ones alike.
        assert_eq!(stdfs::read_to_string(b.join("20261023T120000Z.md")).unwrap(), "one");
        let names: Vec<String> = stdfs::read_dir(root.join(".mikedown/versions"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["Notes.md"]);
        stdfs::remove_dir_all(&root).unwrap();
    }
}
