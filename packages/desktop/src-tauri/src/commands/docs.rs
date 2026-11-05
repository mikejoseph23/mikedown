//! Documentation bases on Desktop (workspace RAG, M6): the Rust side of
//! `host.docs`. The chat panel's loop (core, `packages/core/src/ai/docs/`)
//! navigates a base by section id; this module is where ids meet the disk.
//!
//! - `docs_list_bases()`: every configured base with its health (roots found,
//!   home, file count, oversize skipped, cap). Rebuilds the enabled bases'
//!   indexes, so it doubles as the manager page's Refresh.
//! - `docs_index(base_id)`: the base's index (pages with ids, titles, headings
//!   and links; no bodies), built on first use, kept in memory, dropped when a
//!   watcher sees a change or after a minute.
//! - `docs_read_sections(base_id, ids)`: bodies for section or page ids, capped
//!   at 24 KB each. Ids are looked up in this module's own index and mapped to
//!   the path the walker found; no path is ever built from the text of an id
//!   (S1). Every read canonicalizes the file and refuses anything outside the
//!   canonical root (compared by path components), anything that is not a
//!   regular `.md`/`.markdown` file, and anything over 1 MiB (S2).
//! - `docs_keyword_search(base_id, query)`: the shared ranking (`rules.rs`,
//!   ported from `ai/docs/keyword.ts`) over the same checked reads.
//! - `docs_watch(base_id)` / `docs_unwatch(base_id)`: a recursive watcher per
//!   root, kept here (the folder tree's `unwatch_all` cannot stop it). A change
//!   drops the base's cached index and emits `docs-changed { baseId }`.
//! - `docs_sync_roots()`: adds the roots that pass validation to the fs scope.
//!
//! Every command takes a base id and resolves the roots from the global
//! `<app-data>/settings.json` itself (S4, A9): the webview never names a
//! folder, a root the settings do not list is refused, and a folder's
//! `.mikedown/settings.json` is never read. Disabled bases are refused.
//!
//! S11: the fs scope is the allow-list for the webview's own file commands
//! (opening a cited page). A base root outside `$HOME` is added to it, at
//! startup and when bases are saved, and Tauri's scope has no read-only mode,
//! so such a root is readable and writable for the session
//! (`capabilities/default.json` says so).

pub mod markdown;
pub mod rules;

#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};
use std::fs as stdfs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::RecursiveMode;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use tauri_plugin_fs::FsExt;

use self::markdown::{extract_links, frontmatter_title, headings_with_offsets, split_sections};
use self::rules::{
    build_docs_index, cap_section_text, cmp_section_refs, docs_page_id, docs_root_labels, docs_section_id, keyword_terms,
    parse_docs_id, rank_keyword_sections, utf16_len, DocsIndexOut, IndexInput, KeywordSection, PageInput, SectionRef, DOCS_KEYWORD_TOP,
    DOCS_MAX_FILES, DOCS_MAX_FILE_BYTES, DOCS_MAX_IDS_PER_READ, DOCS_MAX_SECTION_BYTES,
};
use super::fs::{decode, is_mikedown_temp, walk_markdown};
use super::settings::{read_settings, settings_path};
use super::watcher::{force_poll, is_network_path, start_with, Handle, Mode, Signal};

/// Hidden folders and `node_modules` are never indexed (S3).
const SHOW_HIDDEN: bool = false;

/// How long a built index is trusted without a watcher event.
const INDEX_TTL: Duration = Duration::from_secs(60);

// ── Bases from the global settings ──────────────────────────────────────────

/// One configured base, as this module reads it. Mirrors core's `AiDocBase`
/// after `parseDocBases`; the webview already validated what it saved, but the
/// file can be edited by hand, so the same rules run here.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocBase {
    pub id: String,
    pub name: String,
    pub roots: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_file: Option<String>,
    pub allow_cloud: bool,
    pub enabled: bool,
}

fn is_markdown_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// `checkDocRoot`: an absolute, normalized folder path (POSIX, drive or UNC),
/// no `${...}` token, not a filesystem root, not named like a markdown file.
/// Pure string work; the caller still checks the folder on disk. The result
/// keeps the style it came in (a drive letter is upper-cased, a Windows path
/// uses `\`).
pub fn check_doc_root(raw: &str) -> Option<String> {
    let text = rules::js_trim(raw);
    if text.is_empty() || text.contains("${") || text.chars().any(|c| (c as u32) < 0x20) {
        return None;
    }
    let b = text.as_bytes();
    let is_sep = |c: char| c == '\\' || c == '/';
    let (prefix, rest, windows, unc): (String, &str, bool, bool);
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') {
        prefix = format!("{}:", (b[0] as char).to_ascii_uppercase());
        rest = &text[2..];
        windows = true;
        unc = false;
    } else if let Some(after) = text.strip_prefix("\\\\") {
        let server: String = after.chars().take_while(|c| !is_sep(*c)).collect();
        let after_server = &after[server.len()..];
        let seps: usize = after_server.chars().take_while(|c| is_sep(*c)).map(char::len_utf8).sum();
        let after_seps = &after_server[seps..];
        let share: String = after_seps.chars().take_while(|c| !is_sep(*c)).collect();
        if server.is_empty() || seps == 0 || share.is_empty() {
            return None;
        }
        prefix = format!("\\\\{server}\\{share}");
        rest = &after_seps[share.len()..];
        windows = true;
        unc = true;
    } else if text.starts_with('/') {
        prefix = String::new();
        rest = text;
        windows = false;
        unc = false;
    } else {
        return None;
    }
    let mut segments: Vec<&str> = Vec::new();
    let sep_ok = |c: char| if windows { is_sep(c) } else { c == '/' };
    for segment in rest.split(sep_ok) {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            segments.pop();
        } else {
            segments.push(segment);
        }
    }
    if segments.is_empty() && !unc {
        return None;
    }
    if segments.last().is_some_and(|last| is_markdown_name(last)) {
        return None;
    }
    Some(if windows {
        format!("{prefix}\\{}", segments.join("\\")).trim_end_matches('\\').to_string()
    } else {
        format!("/{}", segments.join("/"))
    })
}

/// The key two roots are compared by: case-insensitive for Windows paths only.
pub fn doc_root_key(path: &str) -> String {
    let b = path.as_bytes();
    let windows = (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')) || path.starts_with("\\\\");
    if windows {
        path.to_lowercase()
    } else {
        path.to_string()
    }
}

/// `normalizeDocHomeFile`: a markdown file name or a relative path under the
/// root, with `/` separators; None when `raw` is not one.
pub fn normalize_home_file(raw: &str) -> Option<String> {
    let text = rules::js_trim(raw).replace('\\', "/");
    let b = text.as_bytes();
    if text.is_empty() || text.contains("${") || text.starts_with('/') || (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':') {
        return None;
    }
    if text.chars().any(|c| (c as u32) < 0x20) {
        return None;
    }
    let segments: Vec<&str> = text.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
    if segments.is_empty() || segments.contains(&"..") {
        return None;
    }
    let joined = segments.join("/");
    is_markdown_name(&joined).then_some(joined)
}

fn last_segment(path: &str) -> String {
    path.split(['/', '\\']).filter(|s| !s.is_empty()).next_back().unwrap_or(path).to_string()
}

/// `ai.docBases` out of a settings object (flat `"ai.docBases"` or nested
/// `"ai": { "docBases" }`), as `parseDocBases` reads it. A base with no id (the
/// webview gives it one on its first save), a repeated id, no valid root, or a
/// root another base already lists is dropped; a bad `homeFile` is dropped and
/// the base kept.
pub fn parse_doc_bases(settings: &Value) -> Vec<DocBase> {
    let Some(root) = settings.as_object() else { return Vec::new() };
    let nested = root.get("ai").and_then(Value::as_object);
    let raw = root.get("ai.docBases").or_else(|| nested.and_then(|n| n.get("docBases")));
    let Some(Value::Array(entries)) = raw else { return Vec::new() };
    let mut bases: Vec<DocBase> = Vec::new();
    let mut ids: HashSet<String> = HashSet::new();
    let mut root_keys: HashSet<String> = HashSet::new();
    for entry in entries {
        let Some(obj) = entry.as_object() else { continue };
        let Some(Value::Array(raw_roots)) = obj.get("roots") else { continue };
        let mut roots: Vec<String> = Vec::new();
        for candidate in raw_roots {
            let Some(path) = candidate.as_str().and_then(check_doc_root) else { continue };
            if root_keys.insert(doc_root_key(&path)) {
                roots.push(path);
            }
        }
        if roots.is_empty() {
            continue;
        }
        let id = obj.get("id").and_then(Value::as_str).map(str::trim).unwrap_or("");
        if id.is_empty() || !ids.insert(id.to_string()) {
            continue;
        }
        let name = obj.get("name").and_then(Value::as_str).map(rules::js_trim).filter(|n| !n.is_empty()).map(str::to_string);
        let name = name.unwrap_or_else(|| last_segment(&roots[0]));
        let home_file = obj.get("homeFile").and_then(Value::as_str).and_then(normalize_home_file);
        bases.push(DocBase {
            id: id.to_string(),
            name,
            roots,
            home_file,
            allow_cloud: obj.get("allowCloud").and_then(Value::as_bool) == Some(true),
            enabled: obj.get("enabled").and_then(Value::as_bool) != Some(false),
        });
    }
    bases
}

/// The bases of the global `settings.json` under `app_data`, and nothing else:
/// this never takes a folder, so a repo's `.mikedown/settings.json` cannot
/// supply or redirect a base (S4).
pub fn bases_from_app_data(app_data: &Path) -> Result<Vec<DocBase>, String> {
    let file = settings_path(app_data, "global", None)?;
    let read = read_settings(&file)?;
    let value = read.text.as_deref().and_then(|t| serde_json::from_str::<Value>(t).ok()).unwrap_or(Value::Null);
    Ok(parse_doc_bases(&value))
}

fn load_bases<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<DocBase>, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    bases_from_app_data(&base)
}

/// A base the request may use: configured (A9), enabled.
fn resolve_base<R: Runtime>(app: &AppHandle<R>, base_id: &str) -> Result<DocBase, String> {
    pick_base(load_bases(app)?, base_id)
}

/// `resolve_base` over a list of bases already read from the global settings.
pub fn pick_base(bases: Vec<DocBase>, base_id: &str) -> Result<DocBase, String> {
    let base = bases.into_iter().find(|b| b.id == base_id).ok_or_else(|| "That documentation base is not in your settings.".to_string())?;
    if !base.enabled {
        return Err(format!("The documentation base “{}” is turned off.", base.name));
    }
    Ok(base)
}

/// Names for base ids, from the global settings: unknown ids are dropped, an id
/// repeated keeps its first place. The consent dialog shows these, so webview
/// text never reaches the native modal (A3).
pub fn base_names_for_ids(bases: &[DocBase], ids: &[String]) -> Vec<String> {
    let mut seen: HashSet<&str> = HashSet::new();
    ids.iter()
        .filter(|id| seen.insert(id.as_str()))
        .filter_map(|id| bases.iter().find(|b| &b.id == id).map(|b| b.name.clone()))
        .collect()
}

/// `base_names_for_ids` against the global settings; a read failure gives no names.
pub fn consent_base_names<R: Runtime>(app: &AppHandle<R>, ids: &[String]) -> Vec<String> {
    load_bases(app).map(|bases| base_names_for_ids(&bases, ids)).unwrap_or_default()
}

// ── Containment (S2, A9) ────────────────────────────────────────────────────

fn component_text(c: Component) -> String {
    let s = c.as_os_str().to_string_lossy().into_owned();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

/// `file` is `root` or below it, compared by whole path components (so
/// `/docs-evil` is not under `/docs`), case-insensitively on Windows only.
/// Both paths must already be canonical.
pub fn is_within(root: &Path, file: &Path) -> bool {
    let mut r = root.components();
    let mut f = file.components();
    loop {
        match (r.next(), f.next()) {
            (None, _) => return true,
            (Some(_), None) => return false,
            (Some(a), Some(b)) => {
                if component_text(a) != component_text(b) {
                    return false;
                }
            }
        }
    }
}

/// The path the walker listed for `rel_path` under a canonical root. `rel_path`
/// is a validated relative path with `/` separators.
pub fn indexed_path(canonical_root: &Path, rel_path: &str) -> PathBuf {
    let mut path = canonical_root.to_path_buf();
    for part in rel_path.split('/') {
        path.push(part);
    }
    path
}

/// `a` and `b` are the same path, component by component (case-insensitive on Windows only).
fn same_path(a: &Path, b: &Path) -> bool {
    let mut x = a.components();
    let mut y = b.components();
    loop {
        match (x.next(), y.next()) {
            (None, None) => return true,
            (Some(p), Some(q)) if component_text(p) == component_text(q) => {}
            _ => return false,
        }
    }
}

/// A checked read of `file`, which must be `canonical_root` joined with the
/// index's relative path (`indexed_path`): canonicalize, stay under the
/// canonical root, be a `.md`/`.markdown` file, resolve to exactly the path
/// that was given (so a file swapped for a link, even one that points inside
/// the root, and a parent folder swapped for a link are both refused), be a
/// regular file, and be at most 1 MiB. Returns the decoded text.
pub fn read_checked(canonical_root: &Path, file: &Path) -> Result<String, String> {
    let canonical = stdfs::canonicalize(file).map_err(|e| e.to_string())?;
    if !is_within(canonical_root, &canonical) {
        return Err("outside the documentation folder".to_string());
    }
    if !canonical.file_name().is_some_and(|n| is_markdown_name(&n.to_string_lossy())) {
        return Err("not a markdown file".to_string());
    }
    if !same_path(&canonical, file) {
        return Err("not the file that was indexed".to_string());
    }
    let meta = stdfs::metadata(&canonical).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a regular file".to_string());
    }
    if meta.len() > DOCS_MAX_FILE_BYTES {
        return Err("over the size cap".to_string());
    }
    // The size can change between the check and the read; cap the read too.
    let mut bytes = Vec::new();
    stdfs::File::open(&canonical).map_err(|e| e.to_string())?.take(DOCS_MAX_FILE_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > DOCS_MAX_FILE_BYTES {
        return Err("over the size cap".to_string());
    }
    Ok(decode(&bytes).text)
}

// ── The index of one base ───────────────────────────────────────────────────

/// A root as the last walk saw it.
#[derive(Clone, Debug)]
pub struct RootInfo {
    pub configured: String,
    pub label: String,
    /// The canonical folder; None when the root is missing or not a folder.
    pub canonical: Option<PathBuf>,
    pub file_count: usize,
    pub oversize_skipped: u64,
    pub cap_reached: bool,
}

/// Where a page lives: under configured root number `root`, at the page's
/// `rel_path` (a read joins them again, on the root as it is then; see `indexed_path`).
#[derive(Clone, Debug)]
pub struct PageFile {
    pub root: usize,
}

/// A built index plus the private map from ids to paths (S1): the webview gets
/// `out` only.
#[derive(Debug)]
pub struct BaseIndex {
    key: String,
    built: Instant,
    pub out: DocsIndexOut,
    pub roots: Vec<RootInfo>,
    pub files: HashMap<String, PageFile>,
    pages: HashMap<String, usize>,
}

/// What a cached index was built from: a base whose roots or home file changed
/// in the settings is rebuilt.
fn config_key(base: &DocBase) -> String {
    format!("{}\u{1}{}", base.roots.join("\u{0}"), base.home_file.as_deref().unwrap_or(""))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn rel_path_of(root: &Path, file: &Path) -> Option<String> {
    let rel = file.strip_prefix(root).ok()?;
    let mut parts: Vec<&str> = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_str()?),
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// Walk and parse a base (S3, S9). `walk_markdown` skips symlinks, hidden
/// folders, `.mikedown` and `node_modules`, and stops at the file cap, which is
/// shared by the whole base; the cap is reported per root. Oversize files are
/// skipped and counted. Blocking: run it off the main thread.
pub fn build_base_index(base: &DocBase) -> BaseIndex {
    let labels = docs_root_labels(&base.roots);
    let mut roots: Vec<RootInfo> = Vec::new();
    let mut inputs: Vec<PageInput> = Vec::new();
    let mut located: HashMap<String, PageFile> = HashMap::new();
    let mut walked = 0usize;
    for (i, configured) in base.roots.iter().enumerate() {
        let canonical = stdfs::canonicalize(configured).ok().filter(|p| p.is_dir());
        let mut info = RootInfo {
            configured: configured.clone(),
            label: labels[i].clone(),
            canonical: canonical.clone(),
            file_count: 0,
            oversize_skipped: 0,
            cap_reached: false,
        };
        if let Some(root) = canonical {
            let remaining = DOCS_MAX_FILES.saturating_sub(walked);
            if remaining == 0 {
                info.cap_reached = true;
            } else {
                let mut paths = walk_markdown(&root, SHOW_HIDDEN, remaining);
                if paths.len() >= remaining {
                    info.cap_reached = true;
                }
                walked += paths.len();
                paths.sort();
                for path in paths {
                    let Some(rel) = rel_path_of(&root, &path) else { continue };
                    let Ok(meta) = stdfs::metadata(&path) else { continue };
                    if meta.len() > DOCS_MAX_FILE_BYTES {
                        info.oversize_skipped += 1;
                        continue;
                    }
                    let Ok(text) = read_checked(&root, &path) else { continue };
                    inputs.push(PageInput {
                        root: labels[i].clone(),
                        rel_path: rel.clone(),
                        title: frontmatter_title(&text),
                        headings: headings_with_offsets(&text).into_iter().map(|h| (h.level, h.text)).collect(),
                        links: extract_links(&text),
                        chars: utf16_len(&text),
                    });
                    located.insert(docs_page_id(&labels[i], &rel), PageFile { root: i });
                    info.file_count += 1;
                }
            }
        }
        roots.push(info);
    }
    let found_labels: Vec<String> = roots.iter().filter(|r| r.canonical.is_some()).map(|r| r.label.clone()).collect();
    let truncated = roots.iter().any(|r| r.cap_reached);
    let oversize: u64 = roots.iter().map(|r| r.oversize_skipped).sum();
    let out = build_docs_index(&IndexInput {
        base_id: &base.id,
        root_labels: &found_labels,
        home_file: base.home_file.as_deref(),
        pages: &inputs,
        truncated,
        oversize_skipped: oversize,
        built_at: now_ms(),
    });
    let files: HashMap<String, PageFile> = out.pages.iter().filter_map(|p| located.remove(&p.id).map(|f| (p.id.clone(), f))).collect();
    let pages: HashMap<String, usize> = out.pages.iter().enumerate().map(|(i, p)| (p.id.clone(), i)).collect();
    BaseIndex { key: config_key(base), built: Instant::now(), out, roots, files, pages }
}

impl BaseIndex {
    fn active(&self) -> bool {
        self.roots.iter().any(|r| r.canonical.is_some())
    }

    /// The canonical root `root` points at, looked up again now so a root that
    /// was swapped for a link since the walk is judged by where it points today.
    fn canonical_root(&self, root: usize) -> Option<PathBuf> {
        let info = self.roots.get(root)?;
        stdfs::canonicalize(&info.configured).ok().filter(|p| p.is_dir())
    }
}

/// `readSections`: bodies for section or page ids. Ids this index does not know
/// are left out, as is a read that fails a containment check. Order follows
/// `ids`; a repeated id is read once.
pub fn read_sections(index: &BaseIndex, ids: &[String]) -> Vec<SectionOut> {
    let mut out: Vec<SectionOut> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    let mut roots: HashMap<usize, Option<PathBuf>> = HashMap::new();
    let mut texts: HashMap<String, Option<String>> = HashMap::new();
    for id in ids.iter().take(DOCS_MAX_IDS_PER_READ) {
        if !seen.insert(id.as_str()) {
            continue;
        }
        let Some((page_id, slug)) = parse_docs_id(id, |p| index.files.contains_key(p)) else { continue };
        let (Some(file), Some(&page_at)) = (index.files.get(&page_id), index.pages.get(&page_id)) else { continue };
        let page = &index.out.pages[page_at];
        let root = roots.entry(file.root).or_insert_with(|| index.canonical_root(file.root));
        let Some(root) = root.as_ref() else { continue };
        let text = texts.entry(page_id.clone()).or_insert_with(|| read_checked(root, &indexed_path(root, &page.rel_path)).ok());
        let Some(text) = text.as_deref() else { continue };
        let (heading, body) = match slug {
            None => (None, text),
            Some(slug) => match split_sections(text).into_iter().find(|s| s.heading.as_ref().is_some_and(|h| h.2 == slug)) {
                Some(section) => (section.heading.map(|h| h.1), section.text),
                None => continue,
            },
        };
        let (capped, truncated) = cap_section_text(body, DOCS_MAX_SECTION_BYTES);
        out.push(SectionOut {
            id: id.clone(),
            page_id: page_id.clone(),
            title: page.title.clone(),
            rel_path: page.rel_path.clone(),
            heading,
            text: capped,
            truncated,
        });
    }
    out
}

/// `keywordSearch`: the shared ranking over every page's sections, read through
/// the same checked path as `read_sections`. Bodies are read per file and
/// dropped; only scored refs are kept.
pub fn keyword_search(index: &BaseIndex, query: &str) -> Vec<SectionRef> {
    let terms = keyword_terms(query);
    if terms.is_empty() {
        return Vec::new();
    }
    let mut roots: HashMap<usize, Option<PathBuf>> = HashMap::new();
    let mut refs: Vec<SectionRef> = Vec::new();
    for page in &index.out.pages {
        let Some(file) = index.files.get(&page.id) else { continue };
        let root = roots.entry(file.root).or_insert_with(|| index.canonical_root(file.root));
        let Some(root) = root.as_ref() else { continue };
        let Ok(text) = read_checked(root, &indexed_path(root, &page.rel_path)) else { continue };
        let sections: Vec<KeywordSection> = split_sections(&text)
            .into_iter()
            .map(|s| match s.heading {
                Some((_, heading, slug)) => KeywordSection {
                    id: docs_section_id(&page.id, &slug),
                    page_id: page.id.clone(),
                    title: page.title.clone(),
                    rel_path: page.rel_path.clone(),
                    heading: Some(heading),
                    text: s.text.to_string(),
                },
                None => KeywordSection {
                    id: page.id.clone(),
                    page_id: page.id.clone(),
                    title: page.title.clone(),
                    rel_path: page.rel_path.clone(),
                    heading: None,
                    text: s.text.to_string(),
                },
            })
            .collect();
        // The shared ranking, one file at a time; the merge below uses its comparator.
        refs.extend(rank_keyword_sections(query, &sections, usize::MAX));
    }
    refs.sort_by(cmp_section_refs);
    refs.truncate(DOCS_KEYWORD_TOP);
    refs
}

// ── Wire shapes ─────────────────────────────────────────────────────────────

/// `AiDocsSection`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SectionOut {
    pub id: String,
    pub page_id: String,
    pub title: String,
    pub rel_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    pub text: String,
    pub truncated: bool,
}

/// `AiDocRootStatus`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RootStatusOut {
    pub root: String,
    pub label: String,
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_path: Option<String>,
    pub file_count: usize,
    pub oversize_skipped: u64,
    pub cap_reached: bool,
}

/// `AiDocBaseStatus`. `brokenLinks` is left out here on purpose: `docsHost.ts` fills it from
/// `docs_index` with core's link resolver, so the resolution rules live in one place.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BaseStatusOut {
    pub base: DocBase,
    pub active: bool,
    pub roots: Vec<RootStatusOut>,
    pub file_count: usize,
    pub oversize_skipped: u64,
    pub roots_missing: usize,
    pub cap_reached: bool,
}

/// Health of a base from its (possibly empty) index. A disabled base is not
/// walked: its roots are only checked for existence.
pub fn base_status(base: &DocBase, index: Option<&BaseIndex>) -> BaseStatusOut {
    let labels = docs_root_labels(&base.roots);
    let mut roots: Vec<RootStatusOut> = Vec::new();
    for (i, configured) in base.roots.iter().enumerate() {
        let mut status = RootStatusOut {
            root: configured.clone(),
            label: labels[i].clone(),
            found: stdfs::metadata(configured).map(|m| m.is_dir()).unwrap_or(false),
            home: None,
            home_path: None,
            file_count: 0,
            oversize_skipped: 0,
            cap_reached: false,
        };
        if let Some(index) = index {
            if let Some(info) = index.roots.get(i) {
                status.found = info.canonical.is_some();
                status.file_count = info.file_count;
                status.oversize_skipped = info.oversize_skipped;
                status.cap_reached = info.cap_reached;
            }
            if status.found {
                if let Some(home) = index.out.homes.iter().find(|h| h.root == status.label) {
                    status.home = Some(home.kind);
                    status.home_path = home.page_id.as_ref().and_then(|pid| index.pages.get(pid)).map(|at| index.out.pages[*at].rel_path.clone());
                }
            }
        }
        roots.push(status);
    }
    let missing = roots.iter().filter(|r| !r.found).count();
    BaseStatusOut {
        base: base.clone(),
        active: base.enabled && roots.iter().any(|r| r.found),
        file_count: roots.iter().map(|r| r.file_count).sum(),
        oversize_skipped: roots.iter().map(|r| r.oversize_skipped).sum(),
        roots_missing: missing,
        cap_reached: roots.iter().any(|r| r.cap_reached),
        roots,
    }
}

// ── State ───────────────────────────────────────────────────────────────────

/// A recursive watcher per root of one base, shared by the windows that asked.
#[derive(Default)]
struct WatchSet {
    windows: HashSet<String>,
    handles: HashMap<PathBuf, Handle>,
}

#[derive(Default)]
pub struct DocsState {
    indexes: Mutex<HashMap<String, Arc<BaseIndex>>>,
    /// Bumped by every invalidation, so a build that raced one is not cached.
    generation: AtomicU64,
    watchers: Mutex<HashMap<String, WatchSet>>,
    /// How many times a base has been walked (tests count them; nothing reads it otherwise).
    walks: AtomicU64,
}

impl DocsState {
    fn cached(&self, base_id: &str, key: &str) -> Option<Arc<BaseIndex>> {
        let map = self.indexes.lock().ok()?;
        let hit = map.get(base_id)?;
        (hit.key == key && hit.built.elapsed() < INDEX_TTL).then(|| hit.clone())
    }

    fn store(&self, base_id: &str, index: Arc<BaseIndex>, generation: u64) {
        if self.generation.load(Ordering::SeqCst) != generation {
            return;
        }
        if let Ok(mut map) = self.indexes.lock() {
            map.insert(base_id.to_string(), index);
        }
    }

    /// Drop a base's cached index (a watcher saw a change).
    pub fn invalidate(&self, base_id: &str) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut map) = self.indexes.lock() {
            map.remove(base_id);
        }
    }

    fn forget_all(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut map) = self.indexes.lock() {
            map.clear();
        }
    }
}

async fn index_of(state: &DocsState, base: DocBase, force: bool) -> Result<Arc<BaseIndex>, String> {
    let key = config_key(&base);
    if !force {
        if let Some(hit) = state.cached(&base.id, &key) {
            return Ok(hit);
        }
    }
    let generation = state.generation.load(Ordering::SeqCst);
    state.walks.fetch_add(1, Ordering::SeqCst);
    let id = base.id.clone();
    let built = tauri::async_runtime::spawn_blocking(move || build_base_index(&base)).await.map_err(|e| e.to_string())?;
    let built = Arc::new(built);
    state.store(&id, built.clone(), generation);
    Ok(built)
}

async fn active_index(state: &DocsState, base: DocBase) -> Result<Arc<BaseIndex>, String> {
    let name = base.name.clone();
    let index = index_of(state, base, false).await?;
    if !index.active() {
        return Err(format!("No folder of the documentation base “{name}” was found."));
    }
    Ok(index)
}

// ── Commands ────────────────────────────────────────────────────────────────

/// `docs_list_bases`, on the bases already read from the settings. A plain call
/// (`refresh == false`) is cheap: an enabled base is walked only when it has no
/// index yet or its cached one is stale (a watcher invalidated it, the TTL ran
/// out, its roots changed in the settings, or a root appeared or vanished since
/// the walk); otherwise the last known health is reported. `refresh == true`
/// walks every enabled base. A disabled base is never walked.
async fn list_bases_with(state: &DocsState, bases: Vec<DocBase>, refresh: bool) -> Result<Vec<BaseStatusOut>, String> {
    let mut out = Vec::with_capacity(bases.len());
    for base in bases {
        if !base.enabled {
            out.push(base_status(&base, None));
            continue;
        }
        let mut force = refresh;
        if !force {
            if let Some(hit) = state.cached(&base.id, &config_key(&base)) {
                // A root that appeared or vanished since the walk: judge it afresh.
                force = base.roots.iter().enumerate().any(|(i, root)| {
                    let exists = stdfs::metadata(root).map(|m| m.is_dir()).unwrap_or(false);
                    hit.roots.get(i).map(|r| r.canonical.is_some() != exists).unwrap_or(true)
                });
            }
        }
        let index = index_of(state, base.clone(), force).await?;
        out.push(base_status(&base, Some(&index)));
    }
    Ok(out)
}

/// Every configured base with its health, read from the global settings on each
/// call (so `enabled`, `allowCloud` and renames are current). The chat calls it
/// once per turn without `refresh`; the manager page calls it with
/// `refresh: true` when it opens and on Refresh.
#[tauri::command]
pub async fn docs_list_bases<R: Runtime>(app: AppHandle<R>, state: State<'_, DocsState>, refresh: Option<bool>) -> Result<Vec<BaseStatusOut>, String> {
    let bases = load_bases(&app)?;
    list_bases_with(&state, bases, refresh.unwrap_or(false)).await
}

/// The base's index: pages with ids, titles, headings and links; no bodies.
#[tauri::command]
pub async fn docs_index<R: Runtime>(app: AppHandle<R>, state: State<'_, DocsState>, base_id: String) -> Result<DocsIndexOut, String> {
    let base = resolve_base(&app, &base_id)?;
    Ok(active_index(&state, base).await?.out.clone())
}

/// Bodies for section or page ids, capped at 24 KB each (S1, S2, S12).
#[tauri::command]
pub async fn docs_read_sections<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocsState>,
    base_id: String,
    ids: Vec<String>,
) -> Result<Vec<SectionOut>, String> {
    let base = resolve_base(&app, &base_id)?;
    let index = active_index(&state, base).await?;
    tauri::async_runtime::spawn_blocking(move || read_sections(&index, &ids)).await.map_err(|e| e.to_string())
}

/// The shared keyword ranking over the base's sections: ids and labels only.
#[tauri::command]
pub async fn docs_keyword_search<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocsState>,
    base_id: String,
    query: String,
) -> Result<Vec<SectionRef>, String> {
    let base = resolve_base(&app, &base_id)?;
    let index = active_index(&state, base).await?;
    tauri::async_runtime::spawn_blocking(move || keyword_search(&index, &query)).await.map_err(|e| e.to_string())
}

/// Allow every base root that passes validation in the fs scope (S11). Called
/// at startup and after bases are saved. Returns how many roots were allowed.
pub fn allow_roots<R: Runtime>(app: &AppHandle<R>) -> usize {
    let Ok(bases) = load_bases(app) else { return 0 };
    let mut allowed = 0;
    for root in bases.iter().flat_map(|b| b.roots.iter()) {
        // `check_doc_root` already passed; the folder must exist too.
        if stdfs::metadata(root).map(|m| m.is_dir()).unwrap_or(false) && app.fs_scope().allow_directory(root, true).is_ok() {
            allowed += 1;
        }
    }
    allowed
}

#[tauri::command]
pub fn docs_sync_roots<R: Runtime>(app: AppHandle<R>, state: State<'_, DocsState>) -> usize {
    // The bases may just have changed: no cached index outlives that.
    state.forget_all();
    allow_roots(&app)
}

// ── Watching ────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DocsChanged {
    base_id: String,
}

/// A change worth dropping the index for: not under a hidden folder or
/// `node_modules` (the walker skips those), not one of the app's own temp
/// files, and for plain modifications only a markdown file.
fn relevant(root: &Path, kind: &str, path: &str) -> bool {
    let path = Path::new(path);
    let Ok(rel) = path.strip_prefix(root) else { return true };
    let comps: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    if let Some((name, dirs)) = comps.split_last() {
        if dirs.iter().any(|d| d.starts_with('.') || d == "node_modules") || is_mikedown_temp(name) {
            return false;
        }
    }
    kind != "modify" || path.file_name().is_some_and(|n| is_markdown_name(&n.to_string_lossy()))
}

fn start_root_watch<R: Runtime>(app: &AppHandle<R>, base_id: &str, root: &Path, prefer: Mode) -> Result<Handle, String> {
    let handler = watch_handler(app.clone(), base_id.to_string(), root.to_path_buf());
    start_with(root, prefer, RecursiveMode::Recursive, handler).map(|(handle, _)| handle)
}

fn watch_handler<R: Runtime>(app: AppHandle<R>, base_id: String, root: PathBuf) -> impl Fn(Signal) + Send + Sync + Clone + 'static {
    move |signal| match signal {
        Signal::Change(change) => {
            if !relevant(&root, change.kind, &change.path) {
                return;
            }
            app.state::<DocsState>().invalidate(&base_id);
            let _ = app.emit("docs-changed", DocsChanged { base_id: base_id.clone() });
        }
        Signal::Failed(reason) => {
            app.state::<DocsState>().invalidate(&base_id);
            let _ = app.emit("docs-changed", DocsChanged { base_id: base_id.clone() });
            // Swap to polling off the watcher's own thread: dropping a native
            // watcher from inside its callback would wait on itself.
            let (app, base_id, root) = (app.clone(), base_id.clone(), root.clone());
            std::thread::spawn(move || {
                eprintln!("[mikedown] native watch failed for {} ({reason}); polling every 2 s", root.display());
                if let Ok(handle) = start_root_watch(&app, &base_id, &root, Mode::Poll) {
                    if let Ok(mut map) = app.state::<DocsState>().watchers.lock() {
                        if let Some(set) = map.get_mut(&base_id) {
                            if set.handles.contains_key(&root) {
                                set.handles.insert(root, handle);
                            }
                        }
                    }
                }
            });
        }
    }
}

/// Watch every found root of a base, recursively (one watcher per root, never
/// the whole workspace). A second window asking for the same base shares the
/// watchers. Returns how many roots are watched.
#[tauri::command]
pub fn docs_watch<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, DocsState>,
    base_id: String,
) -> Result<usize, String> {
    let base = resolve_base(&app, &base_id)?;
    let mut map = state.watchers.lock().map_err(|_| "watcher state poisoned".to_string())?;
    let set = map.entry(base.id.clone()).or_default();
    set.windows.insert(window.label().to_string());
    for configured in &base.roots {
        let Some(root) = stdfs::canonicalize(configured).ok().filter(|p| p.is_dir()) else { continue };
        if set.handles.contains_key(&root) {
            continue;
        }
        let prefer = if force_poll() || is_network_path(&root) { Mode::Poll } else { Mode::Native };
        set.handles.insert(root.clone(), start_root_watch(&app, &base.id, &root, prefer)?);
    }
    Ok(set.handles.len())
}

fn drop_window(state: &DocsState, label: &str, only_base: Option<&str>) {
    let drained: Vec<Handle> = {
        let Ok(mut map) = state.watchers.lock() else { return };
        let mut drained = Vec::new();
        let ids: Vec<String> = map.keys().filter(|k| only_base.map_or(true, |b| b == k.as_str())).cloned().collect();
        for id in ids {
            let empty = match map.get_mut(&id) {
                Some(set) => {
                    set.windows.remove(label);
                    set.windows.is_empty()
                }
                None => false,
            };
            if empty {
                if let Some(set) = map.remove(&id) {
                    drained.extend(set.handles.into_values());
                }
            }
        }
        drained
    };
    drop(drained);
}

/// This window no longer needs the base's watchers; the last window out stops them.
#[tauri::command]
pub fn docs_unwatch<R: Runtime>(window: WebviewWindow<R>, state: State<'_, DocsState>, base_id: String) -> Result<(), String> {
    drop_window(&state, window.label(), Some(&base_id));
    Ok(())
}

/// A closed window stops needing its bases' watchers.
pub fn forget_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(state) = app.try_state::<DocsState>() {
        drop_window(&state, label, None);
    }
}
