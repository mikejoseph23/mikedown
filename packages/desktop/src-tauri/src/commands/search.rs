//! Folder search (M7, edge case 19).
//!
//! A plain-text walker and matcher over the markdown and text files of the
//! opened folder: no regex, `caseSensitive` and `wholeWord` options, the same
//! hidden / `node_modules` exclusions as the tree (`show_hidden` lifts them,
//! `.mikedown/` never searched), files over 2 MB and non-UTF-8 files skipped.
//!
//! `search_folder` returns at once and runs on its own thread. Matches stream
//! to the window that asked as `search-batch` events `{ id, matches }`, then
//! one `search-done` `{ id, summary }`. `search_cancel` stops a run between
//! files. The search is capped at `limit` matches (default 2,000); hitting it
//! sets `truncated`.
//!
//! Offsets are what the webview's strings use: `line` is 1-based, `column`
//! is the 1-based UTF-16 position of the match in the line, and
//! `matchStart` / `matchEnd` are UTF-16 offsets into `snippet`.

use std::collections::HashMap;
use std::fs as stdfs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State, WebviewWindow};

use super::fs::{decode, ensure_allowed, is_hidden_entry, Encoding};

/// Files larger than this are not searched.
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Default and maximum matches reported per search.
pub const DEFAULT_LIMIT: usize = 2_000;
/// A batch is sent at 50 matches, or after this long, whichever comes first.
const BATCH_SIZE: usize = 50;
const BATCH_INTERVAL: Duration = Duration::from_millis(40);
/// Snippet shape: characters of context before the match, and the cap.
const CONTEXT_BEFORE: usize = 40;
const SNIPPET_MAX: usize = 200;

/// Markdown plus the text extensions the app opens in source mode
/// (`documents/documentModel.ts`: MARKDOWN_EXTS and TEXT_EXTS). Files with no
/// extension are not searched.
const EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mkd", "mkdn", "mdx", "rmd", "txt", "text", "json", "jsonc", "json5",
    "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "csv", "tsv", "log", "xml", "html", "htm",
    "css", "scss", "less", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "rs", "go", "java",
    "kt", "swift", "c", "h", "cpp", "hpp", "cs", "sh", "zsh", "bash", "fish", "ps1", "bat", "cmd",
    "sql", "graphql", "gql", "diff", "patch", "gitignore", "editorconfig", "lock", "properties",
    "tex", "bib", "rst", "adoc", "org", "nfo",
];

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub show_hidden: bool,
    /// Matches to report before stopping; clamped to 1..=DEFAULT_LIMIT.
    pub limit: Option<usize>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub snippet: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    pub matches: usize,
    pub files_searched: usize,
    pub files_matched: usize,
    pub skipped_large: usize,
    pub truncated: bool,
    pub cancelled: bool,
    pub elapsed_ms: u64,
    pub first_result_ms: Option<u64>,
}

// ── Matcher ────────────────────────────────────────────────────────────────

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Substring matcher: exact, or case-folded (ASCII bytes fast path, per-char
/// simple lowercase otherwise), optionally restricted to whole words.
pub struct Matcher {
    query: String,
    folded: Vec<char>,
    ascii_fold: Option<Vec<u8>>,
    case_sensitive: bool,
    whole_word: bool,
}

fn fold(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

impl Matcher {
    /// `None` for an empty query.
    pub fn new(query: &str, case_sensitive: bool, whole_word: bool) -> Option<Self> {
        if query.is_empty() {
            return None;
        }
        Some(Self {
            query: query.to_string(),
            folded: query.chars().map(fold).collect(),
            ascii_fold: (!case_sensitive && query.is_ascii()).then(|| query.to_ascii_lowercase().into_bytes()),
            case_sensitive,
            whole_word,
        })
    }

    /// Byte ranges of every match in `line` (non-overlapping, left to right).
    pub fn find_all(&self, line: &str) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        let mut from = 0;
        while let Some((s, e)) = self.find_from(line, from) {
            out.push((s, e));
            from = e;
        }
        out
    }

    fn find_from(&self, line: &str, mut from: usize) -> Option<(usize, usize)> {
        while from <= line.len() {
            let (s, e) = self.raw_find(line, from)?;
            if !self.whole_word || self.is_whole_word(line, s, e) {
                return Some((s, e));
            }
            // Retry one character past this start so overlapping candidates are seen.
            from = s + line[s..].chars().next().map_or(1, char::len_utf8);
        }
        None
    }

    fn is_whole_word(&self, line: &str, s: usize, e: usize) -> bool {
        let before = line[..s].chars().next_back();
        let after = line[e..].chars().next();
        !before.is_some_and(is_word_char) && !after.is_some_and(is_word_char)
    }

    fn raw_find(&self, line: &str, from: usize) -> Option<(usize, usize)> {
        if self.case_sensitive {
            return line[from..].find(&self.query).map(|i| (from + i, from + i + self.query.len()));
        }
        if let Some(needle) = &self.ascii_fold {
            let hay = line.as_bytes();
            let n = needle.len();
            if hay.len() < n {
                return None;
            }
            let first = needle[0];
            let mut i = from;
            while i + n <= hay.len() {
                if hay[i].to_ascii_lowercase() == first
                    && hay[i..i + n].iter().zip(needle).all(|(h, q)| h.to_ascii_lowercase() == *q)
                {
                    return Some((i, i + n));
                }
                i += 1;
            }
            return None;
        }
        // Non-ASCII query: compare simple-lowercased characters.
        let chars: Vec<(usize, char)> = line[from..].char_indices().map(|(i, c)| (from + i, c)).collect();
        let n = self.folded.len();
        if chars.len() < n {
            return None;
        }
        for start in 0..=chars.len() - n {
            if (0..n).all(|k| fold(chars[start + k].1) == self.folded[k]) {
                let s = chars[start].0;
                let e = if start + n < chars.len() { chars[start + n].0 } else { line.len() };
                return Some((s, e));
            }
        }
        None
    }
}

/// A snippet around the byte range `s..e` of `line`, with offsets in UTF-16
/// units: `(snippet, match_start, match_end, column)`. Leading whitespace is
/// trimmed, long lines are cut around the match and marked with an ellipsis.
pub fn make_snippet(line: &str, s: usize, e: usize) -> (String, usize, usize, usize) {
    let utf16 = |t: &str| t.encode_utf16().count();
    let column = utf16(&line[..s]) + 1;
    let chars: Vec<char> = line.chars().collect();
    // Char indexes of the match.
    let ms = line[..s].chars().count();
    let me = ms + line[s..e].chars().count();
    let lead = chars.iter().take_while(|c| c.is_whitespace()).count().min(ms);
    let start = lead.max(ms.saturating_sub(CONTEXT_BEFORE));
    let mut end = chars.len().min(start + SNIPPET_MAX).max(me);
    while end > me && chars[end - 1].is_whitespace() {
        end -= 1;
    }
    let mut text = String::new();
    let prefix = start > lead;
    if prefix {
        text.push('…');
    }
    let head: String = chars[start..ms].iter().collect();
    let hit: String = chars[ms..me].iter().collect();
    let tail: String = chars[me..end].iter().collect();
    text.push_str(&head);
    let match_start = utf16(&text);
    text.push_str(&hit);
    let match_end = utf16(&text);
    text.push_str(&tail);
    if end < chars.iter().rposition(|c| !c.is_whitespace()).map_or(0, |i| i + 1) {
        text.push('…');
    }
    (text, match_start, match_end, column)
}

// ── Walker ─────────────────────────────────────────────────────────────────

fn searchable(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    // `.gitignore` and `.editorconfig` are all extension, which still matches.
    lower.rsplit_once('.').is_some_and(|(_, ext)| EXTENSIONS.contains(&ext))
}

/// Search one decoded text, appending to `out`. Returns false once `cap` is
/// reached (and sets `truncated`).
fn search_text(
    matcher: &Matcher,
    path: &str,
    text: &str,
    out: &mut Vec<SearchMatch>,
    counter: &mut usize,
    cap: usize,
    truncated: &mut bool,
    cancel: &AtomicBool,
) -> bool {
    for (idx, line) in text.split('\n').enumerate() {
        if idx % 2048 == 0 && cancel.load(Ordering::Relaxed) {
            return false;
        }
        for (s, e) in matcher.find_all(line) {
            if *counter >= cap {
                *truncated = true;
                return false;
            }
            let (snippet, match_start, match_end, column) = make_snippet(line, s, e);
            out.push(SearchMatch { path: path.to_string(), line: idx + 1, column, snippet, match_start, match_end });
            *counter += 1;
        }
    }
    true
}

/// Run a search synchronously, handing matches to `sink` in batches. The
/// command wrapper runs this on a thread; tests call it directly.
pub fn run_search(
    root: &Path,
    query: &str,
    options: &SearchOptions,
    cancel: &AtomicBool,
    sink: &mut dyn FnMut(Vec<SearchMatch>),
) -> SearchSummary {
    let started = Instant::now();
    let mut summary = SearchSummary::default();
    let Some(matcher) = Matcher::new(query, options.case_sensitive, options.whole_word) else {
        return summary;
    };
    let cap = options.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, DEFAULT_LIMIT);
    let mut batch: Vec<SearchMatch> = Vec::new();
    let mut last_flush = Instant::now();
    let mut sent_first = false;
    let mut total = 0usize;

    let mut flush = |batch: &mut Vec<SearchMatch>, summary: &mut SearchSummary, last_flush: &mut Instant, sent_first: &mut bool| {
        if batch.is_empty() {
            return;
        }
        if !*sent_first {
            summary.first_result_ms = Some(started.elapsed().as_millis() as u64);
            *sent_first = true;
        }
        sink(std::mem::take(batch));
        *last_flush = Instant::now();
    };

    // Depth-first, files of a folder before its subfolders, each sorted by name.
    let mut stack = vec![root.to_path_buf()];
    'walk: while let Some(dir) = stack.pop() {
        let Ok(read) = stdfs::read_dir(&dir) else { continue };
        let mut files: Vec<(String, PathBuf)> = Vec::new();
        let mut dirs: Vec<(String, PathBuf)> = Vec::new();
        for entry in read.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            if ft.is_dir() {
                if name == ".mikedown" || (!options.show_hidden && is_hidden_entry(&name, true)) {
                    continue;
                }
                dirs.push((name.to_lowercase(), entry.path()));
            } else if ft.is_file() && searchable(&name) && !(!options.show_hidden && is_hidden_entry(&name, false)) {
                files.push((name.to_lowercase(), entry.path()));
            }
        }
        files.sort_by(|a, b| a.0.cmp(&b.0));
        dirs.sort_by(|a, b| b.0.cmp(&a.0)); // popped in ascending order
        for (_, path) in files {
            if cancel.load(Ordering::Relaxed) {
                summary.cancelled = true;
                break 'walk;
            }
            let Ok(meta) = stdfs::metadata(&path) else { continue };
            if meta.len() > MAX_FILE_BYTES {
                summary.skipped_large += 1;
                continue;
            }
            let Ok(bytes) = stdfs::read(&path) else { continue };
            if bytes.iter().take(8192).any(|b| *b == 0) {
                continue;
            }
            let decoded = decode(&bytes);
            if decoded.encoding == Encoding::Unknown {
                continue;
            }
            summary.files_searched += 1;
            let before = total;
            let ok = search_text(
                &matcher,
                &path.to_string_lossy(),
                &decoded.text,
                &mut batch,
                &mut total,
                cap,
                &mut summary.truncated,
                cancel,
            );
            if total > before {
                summary.files_matched += 1;
            }
            // The first results go out at once; later ones in batches.
            if !batch.is_empty()
                && (!sent_first || batch.len() >= BATCH_SIZE || last_flush.elapsed() >= BATCH_INTERVAL)
            {
                flush(&mut batch, &mut summary, &mut last_flush, &mut sent_first);
            }
            if !ok {
                summary.cancelled = !summary.truncated && cancel.load(Ordering::Relaxed);
                break 'walk;
            }
        }
        stack.extend(dirs.into_iter().map(|(_, p)| p));
    }
    flush(&mut batch, &mut summary, &mut last_flush, &mut sent_first);
    summary.matches = total;
    summary.elapsed_ms = started.elapsed().as_millis() as u64;
    summary
}

// ── Commands ───────────────────────────────────────────────────────────────

/// Cancel flags of the searches in flight, by the id the webview chose.
#[derive(Default)]
pub struct Searches(Mutex<HashMap<u64, Arc<AtomicBool>>>);

#[derive(Serialize, Clone)]
struct BatchEvent {
    id: u64,
    matches: Vec<SearchMatch>,
}

#[derive(Serialize, Clone)]
struct DoneEvent {
    id: u64,
    summary: SearchSummary,
}

/// Start a search over `root`. Returns immediately; results arrive as
/// `search-batch` / `search-done` events on the calling window.
#[tauri::command]
pub fn search_folder<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    searches: State<'_, Searches>,
    id: u64,
    root: PathBuf,
    query: String,
    options: Option<SearchOptions>,
) -> Result<(), String> {
    ensure_allowed(&app, &root)?;
    let cancel = Arc::new(AtomicBool::new(false));
    searches.0.lock().map_err(|e| e.to_string())?.insert(id, cancel.clone());
    let options = options.unwrap_or_default();
    let label = window.label().to_string();
    std::thread::spawn(move || {
        let emitter = app.clone();
        let target = label.clone();
        let mut sink = move |matches: Vec<SearchMatch>| {
            let _ = emitter.emit_to(target.as_str(), "search-batch", BatchEvent { id, matches });
        };
        let summary = run_search(&root, &query, &options, &cancel, &mut sink);
        let _ = app.emit_to(label.as_str(), "search-done", DoneEvent { id, summary });
        if let Some(searches) = tauri::Manager::try_state::<Searches>(&app) {
            if let Ok(mut map) = searches.0.lock() {
                map.remove(&id);
            }
        }
    });
    Ok(())
}

/// Stop a running search; a no-op for an id that already finished.
#[tauri::command]
pub fn search_cancel(searches: State<'_, Searches>, id: u64) {
    if let Ok(map) = searches.0.lock() {
        if let Some(flag) = map.get(&id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mikedown-search-{tag}-{}", std::process::id()));
        let _ = stdfs::remove_dir_all(&dir);
        stdfs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        stdfs::create_dir_all(p.parent().unwrap()).unwrap();
        stdfs::write(p, text).unwrap();
    }

    fn search(root: &Path, query: &str, options: &SearchOptions) -> (Vec<SearchMatch>, SearchSummary) {
        let cancel = AtomicBool::new(false);
        let mut all = Vec::new();
        let summary = run_search(root, query, options, &cancel, &mut |b| all.extend(b));
        (all, summary)
    }

    fn rel(root: &Path, m: &SearchMatch) -> String {
        Path::new(&m.path).strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/")
    }

    #[test]
    fn matcher_case_insensitive_by_default_and_exact_when_asked() {
        let m = Matcher::new("note", false, false).unwrap();
        assert_eq!(m.find_all("Note a note NOTE"), vec![(0, 4), (7, 11), (12, 16)]);
        let m = Matcher::new("note", true, false).unwrap();
        assert_eq!(m.find_all("Note a note NOTE"), vec![(7, 11)]);
        assert!(Matcher::new("", false, false).is_none());
    }

    #[test]
    fn matcher_whole_word_excludes_partial_matches() {
        let m = Matcher::new("cat", false, true).unwrap();
        assert_eq!(m.find_all("cat concat cats cat_x (cat) cat"), vec![(0, 3), (23, 26), (28, 31)]);
        // A candidate rejected for its neighbours does not hide a later one.
        let m = Matcher::new("aa", false, true).unwrap();
        assert_eq!(m.find_all("aaa aa"), vec![(4, 6)]);
        // Unicode letters count as word characters.
        let m = Matcher::new("café", false, true).unwrap();
        assert_eq!(m.find_all("cafés café"), vec![(7, 12)]);
    }

    #[test]
    fn matcher_folds_non_ascii_case() {
        let m = Matcher::new("ÉCOLE", false, false).unwrap();
        let hay = "une école";
        let hits = m.find_all(hay);
        assert_eq!(hits.len(), 1);
        assert_eq!(&hay[hits[0].0..hits[0].1], "école");
    }

    #[test]
    fn snippet_offsets_are_utf16_and_survive_multibyte_text() {
        // 😀 is 2 UTF-16 units, é is 1; the match is "bar".
        let line = "😀é foo bar baz";
        let s = line.find("bar").unwrap();
        let (snippet, ms, me, column) = make_snippet(line, s, s + 3);
        assert_eq!(snippet, line);
        let units: Vec<u16> = snippet.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[ms..me]).unwrap(), "bar");
        // Column counts UTF-16 units in the original line: 2 + 1 + " foo " = 8, so 9.
        assert_eq!(column, 9);
    }

    #[test]
    fn snippet_trims_indent_and_cuts_long_lines() {
        let (snippet, ms, me, column) = make_snippet("    indented hit", 13, 16);
        assert_eq!(snippet, "indented hit");
        assert_eq!(&snippet[ms..me], "hit");
        assert_eq!(column, 14);

        let long = format!("{}needle{}", "a".repeat(100), "b".repeat(400));
        let s = long.find("needle").unwrap();
        let (snippet, ms, me, column) = make_snippet(&long, s, s + 6);
        assert!(snippet.starts_with('…') && snippet.ends_with('…'));
        assert!(snippet.chars().count() <= SNIPPET_MAX + 2);
        let units: Vec<u16> = snippet.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[ms..me]).unwrap(), "needle");
        assert_eq!(column, 101);
    }

    #[test]
    fn finds_lines_and_columns_across_files_in_order() {
        let root = temp_dir("basic");
        write(&root, "b.md", "nothing\nthe Target here\n");
        write(&root, "a.md", "target at start\n\n  and target again target\n");
        write(&root, "sub/c.txt", "deep target\n");
        write(&root, "sub/skip.rs.bak", "target\n");
        write(&root, "image.png", "target");
        let (found, summary) = search(&root, "target", &SearchOptions::default());
        let got: Vec<(String, usize, usize)> = found.iter().map(|m| (rel(&root, m), m.line, m.column)).collect();
        assert_eq!(
            got,
            vec![
                ("a.md".into(), 1, 1),
                ("a.md".into(), 3, 7),
                ("a.md".into(), 3, 20),
                ("b.md".into(), 2, 5),
                ("sub/c.txt".into(), 1, 6),
            ]
        );
        assert_eq!(summary.matches, 5);
        assert_eq!(summary.files_matched, 3);
        assert!(!summary.truncated && !summary.cancelled);
        assert_eq!(found[1].snippet, "and target again target");
        let _ = stdfs::remove_dir_all(&root);
    }

    #[test]
    fn excludes_hidden_and_node_modules_unless_show_hidden() {
        let root = temp_dir("hidden");
        for f in ["a.md", ".obsidian/b.md", "node_modules/pkg/c.md", "sub/d.md", ".git/e.md"] {
            write(&root, f, "needle\n");
        }
        write(&root, ".mikedown/versions/a.md/20261023T120000Z.md", "needle\n");
        let (found, _) = search(&root, "needle", &SearchOptions::default());
        let mut names: Vec<String> = found.iter().map(|m| rel(&root, m)).collect();
        names.sort();
        assert_eq!(names, vec!["a.md", "sub/d.md"]);

        let shown = SearchOptions { show_hidden: true, ..Default::default() };
        let (found, _) = search(&root, "needle", &shown);
        assert_eq!(found.len(), 5, "hidden folders and node_modules, never .mikedown");
        assert!(found.iter().all(|m| !rel(&root, m).starts_with(".mikedown")));
        let _ = stdfs::remove_dir_all(&root);
    }

    #[test]
    fn whole_word_option_applies_across_files() {
        let root = temp_dir("word");
        write(&root, "a.md", "category\ncat\nconcat cat.\n");
        let opts = SearchOptions { whole_word: true, ..Default::default() };
        let (found, _) = search(&root, "cat", &opts);
        let lines: Vec<usize> = found.iter().map(|m| m.line).collect();
        assert_eq!(lines, vec![2, 3]);
        assert_eq!(found[1].column, 8);
        let _ = stdfs::remove_dir_all(&root);
    }

    #[test]
    fn skips_files_over_2mb_binary_and_non_utf8() {
        let root = temp_dir("size");
        write(&root, "small.md", "needle\n");
        let big = format!("needle\n{}", "x".repeat(MAX_FILE_BYTES as usize));
        write(&root, "big.md", &big);
        stdfs::write(root.join("bin.txt"), b"needle\0\0\0").unwrap();
        stdfs::write(root.join("latin1.md"), b"needle \xe9\xe8\n").unwrap();
        let (found, summary) = search(&root, "needle", &SearchOptions::default());
        assert_eq!(found.len(), 1);
        assert_eq!(rel(&root, &found[0]), "small.md");
        assert_eq!(summary.skipped_large, 1);
        assert_eq!(summary.files_searched, 1);
        let _ = stdfs::remove_dir_all(&root);
    }

    #[test]
    fn crlf_and_bom_files_report_the_same_columns_as_the_editor() {
        let root = temp_dir("crlf");
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"first\r\nsecond needle\r\n");
        stdfs::write(root.join("a.md"), bytes).unwrap();
        let (found, _) = search(&root, "needle", &SearchOptions::default());
        assert_eq!((found[0].line, found[0].column, found[0].snippet.as_str()), (2, 8, "second needle"));
        let _ = stdfs::remove_dir_all(&root);
    }

    #[test]
    fn caps_at_the_limit_and_says_so() {
        let root = temp_dir("cap");
        let text = "hit\n".repeat(30);
        for i in 0..5 {
            write(&root, &format!("f{i}.md"), &text);
        }
        let opts = SearchOptions { limit: Some(100), ..Default::default() };
        let (found, summary) = search(&root, "hit", &opts);
        assert_eq!(found.len(), 100);
        assert!(summary.truncated);
        // Exactly at the limit is not truncated.
        let opts = SearchOptions { limit: Some(150), ..Default::default() };
        let (found, summary) = search(&root, "hit", &opts);
        assert_eq!(found.len(), 150);
        assert!(!summary.truncated);
        let _ = stdfs::remove_dir_all(&root);
    }

    #[test]
    fn cancellation_stops_between_files() {
        let root = temp_dir("cancel");
        for i in 0..40 {
            write(&root, &format!("f{i:02}.md"), "hit\n");
        }
        let cancel = AtomicBool::new(false);
        let mut seen = 0usize;
        let summary = run_search(&root, "hit", &SearchOptions::default(), &cancel, &mut |b| {
            seen += b.len();
            cancel.store(true, Ordering::Relaxed);
        });
        assert!(summary.cancelled);
        assert!(seen >= 1 && seen < 40, "stopped early after {seen} matches");
        let _ = stdfs::remove_dir_all(&root);
    }

    #[test]
    fn empty_query_finds_nothing() {
        let root = temp_dir("empty");
        write(&root, "a.md", "x\n");
        let (found, summary) = search(&root, "", &SearchOptions::default());
        assert!(found.is_empty() && summary.matches == 0);
        let _ = stdfs::remove_dir_all(&root);
    }

    /// Acceptance numbers (plan M7): 2,000 files, first results < 300 ms,
    /// complete < 2 s. Run `cargo test --release search_2000_files -- --nocapture`
    /// to see them; the bounds also hold in a debug build.
    #[test]
    fn search_2000_files_meets_the_budget() {
        let root = temp_dir("perf");
        let para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n";
        for i in 0..2000 {
            let mut text = format!("# Note {i}\n\n");
            for p in 0..40 {
                text.push_str(para);
                if (i + p) % 97 == 0 {
                    text.push_str("The quick brown fox mentions the zebrafish protocol here.\n");
                }
                text.push('\n');
            }
            write(&root, &format!("dir{:02}/note{i}.md", i % 40), &text);
        }
        for q in ["zebrafish", "lorem", "protocol", "qqqzzz"] {
            let cancel = AtomicBool::new(false);
            let t0 = Instant::now();
            let mut first: Option<Duration> = None;
            let mut n = 0usize;
            let summary = run_search(&root, q, &SearchOptions::default(), &cancel, &mut |b| {
                first.get_or_insert(t0.elapsed());
                n += b.len();
            });
            let total = t0.elapsed();
            println!(
                "[search-perf] {q:>10}: {} matches in {} files, first batch {:?}, complete {:?}, truncated {}",
                summary.matches, summary.files_matched, first.unwrap_or_default(), total, summary.truncated
            );
            assert!(first.map_or(true, |f| f < Duration::from_millis(300)), "first results for {q} took {first:?}");
            assert!(total < Duration::from_secs(2), "{q} took {total:?}");
            assert_eq!(n, summary.matches);
        }
        let _ = stdfs::remove_dir_all(&root);
    }
}
