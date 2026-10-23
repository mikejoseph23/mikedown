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
        }
        stdfs::rename(&tmp, path)
    })();

    if result.is_err() {
        let _ = stdfs::remove_file(&tmp);
    }
    result
}

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

// ── Scope ──────────────────────────────────────────────────────────────────

/// Refuse paths outside the capability's fs scope. Paths the user picked in a
/// dialog, double-clicked or passed on the command line are allowed by the
/// dialog plugin and `launch.rs` respectively.
fn ensure_allowed<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
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

/// Names in a directory (no recursion). An absent directory is an empty list
/// so the image pipeline can resolve a filename before creating the folder.
#[tauri::command]
pub fn list_dir<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<Vec<DirEntry>, String> {
    ensure_allowed(&app, &path)?;
    let entries = match stdfs::read_dir(&path) {
        Ok(it) => it,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(describe(&path, &e)),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir,
        });
    }
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
}
