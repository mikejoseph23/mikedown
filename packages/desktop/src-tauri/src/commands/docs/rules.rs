//! The documentation-base contract, ported from `packages/core/src/ai/docs/`
//! (`util.ts`, `index.ts`, `home.ts`, `keyword.ts`, `caps.ts`). The rules are
//! written down in those files' header comments; the shared fixtures in
//! `test/ai-fixtures/docs/` hold the cases both hosts must pass, byte for
//! byte. Nothing here leans on locale behaviour or a Unicode table beyond what
//! the header comments name:
//!
//! - case folding is ASCII only (`A-Z` to `a-z`, nothing else changes);
//! - "whitespace" for slugs and keyword tokens is an explicit list;
//! - comparison is by code point, which is Rust's `str` order (UTF-8 bytes);
//! - lengths JavaScript reports in UTF-16 units (`chars`) are counted the same.
//!
//! Pure: no file system, no Tauri.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

// ── Caps (caps.ts) ──────────────────────────────────────────────────────────

/// Markdown files indexed per base. The walk stops at this many.
pub const DOCS_MAX_FILES: usize = 5000;
/// Bytes per file; a bigger file is skipped and counted in health.
pub const DOCS_MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Bytes per section sent to a model; the host cuts at this and sets `truncated`.
pub const DOCS_MAX_SECTION_BYTES: usize = 24 * 1024;
/// Sections the keyword fallback returns.
pub const DOCS_KEYWORD_TOP: usize = 20;
/// Terms the keyword fallback uses from one query.
pub const DOCS_KEYWORD_MAX_TERMS: usize = 12;
/// Headings and links kept per page in the index.
pub const DOCS_MAX_HEADINGS_PER_PAGE: usize = 1000;
pub const DOCS_MAX_LINKS_PER_PAGE: usize = 1000;
/// Ids one `docs_read_sections` call looks at (anything past this is ignored).
pub const DOCS_MAX_IDS_PER_READ: usize = 200;

// ── Text helpers (util.ts) ──────────────────────────────────────────────────

/// `foldAscii`: ASCII `A-Z` become `a-z`, every other code point is unchanged.
pub fn fold_ascii(text: &str) -> String {
    text.to_ascii_lowercase()
}

/// Non-ASCII code points that count as whitespace for slugs and keyword tokens.
const NON_ASCII_SPACE: [u32; 19] = [
    0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
    0x205f, 0x3000,
];

/// `isDocsSpace`: ASCII whitespace (space, tab, LF, VT, FF, CR) plus the fixed list.
pub fn is_docs_space(cp: u32) -> bool {
    cp == 0x20 || (0x09..=0x0d).contains(&cp) || NON_ASCII_SPACE.contains(&cp)
}

pub fn is_ascii_alnum(cp: u32) -> bool {
    (48..=57).contains(&cp) || (65..=90).contains(&cp) || (97..=122).contains(&cp)
}

/// JavaScript's `String.prototype.trim` whitespace: WhiteSpace plus LineTerminator
/// (TAB, VT, FF, SP, NBSP, ZWNBSP, any Zs, LF, CR, LS, PS). Rust's `trim` differs
/// on U+0085 (Rust trims it, JS does not) and U+FEFF (JS trims it, Rust does not).
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | '\u{20}' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

/// `text.trim()` as JavaScript does it.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// Length in UTF-16 units, which is what JavaScript calls a string's length.
pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `capSectionText`: cut to at most `max_bytes` UTF-8 bytes on a code point
/// boundary; the flag says whether anything was cut.
pub fn cap_section_text(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_string(), false);
    }
    let mut cut = max_bytes;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    (text[..cut].to_string(), true)
}

// ── Root labels, slugs, ids (index.ts) ──────────────────────────────────────

fn label_base(root: &str) -> String {
    let last = root.split(['/', '\\']).filter(|s| !s.is_empty()).next_back();
    let name = match last {
        None | Some(".") | Some("..") => "root",
        Some(n) => n,
    };
    name.chars().map(|c| if c == '#' || (c as u32) < 0x20 || c as u32 == 0x7f { '_' } else { c }).collect()
}

/// `docsRootLabels`: one unique label per root, in the order given.
pub fn docs_root_labels(roots: &[String]) -> Vec<String> {
    let mut taken: HashSet<String> = HashSet::new();
    let mut out = Vec::with_capacity(roots.len());
    for root in roots {
        let base = label_base(root);
        let mut label = base.clone();
        let mut n = 2;
        while taken.contains(&label) {
            label = format!("{base}-{n}");
            n += 1;
        }
        taken.insert(label.clone());
        out.push(label);
    }
    out
}

/// `docsSlug`: the base slug of one heading text, before duplicate suffixes.
pub fn docs_slug(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        let cp = ch as u32;
        if cp < 0x80 {
            if (65..=90).contains(&cp) {
                out.push((cp as u8 + 32) as char);
            } else if is_ascii_alnum(cp) || cp == 0x5f || cp == 0x2d {
                out.push(ch);
            } else if is_docs_space(cp) {
                out.push('-');
            }
        } else if is_docs_space(cp) {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    if out.is_empty() {
        "section".to_string()
    } else {
        out
    }
}

/// `docsSlugs`: unique slugs for a page's heading texts, in document order.
pub fn docs_slugs<S: AsRef<str>>(texts: &[S]) -> Vec<String> {
    let mut used: HashSet<String> = HashSet::new();
    texts
        .iter()
        .map(|text| {
            let base = docs_slug(text.as_ref());
            let mut slug = base.clone();
            let mut n = 1;
            while used.contains(&slug) {
                slug = format!("{base}-{n}");
                n += 1;
            }
            used.insert(slug.clone());
            slug
        })
        .collect()
}

pub fn docs_page_id(root_label: &str, rel_path: &str) -> String {
    format!("{root_label}/{rel_path}")
}

pub fn docs_section_id(page_id: &str, slug: &str) -> String {
    format!("{page_id}#{slug}")
}

/// `parseDocsId`: the whole id is tried as a page first (a file name may hold a
/// `#`), then the part before the last `#`. None unless the page is one the
/// host's own index knows (S1): never build a path from anything else.
pub fn parse_docs_id<F: Fn(&str) -> bool>(id: &str, has_page: F) -> Option<(String, Option<String>)> {
    if has_page(id) {
        return Some((id.to_string(), None));
    }
    let hash = id.rfind('#')?;
    if hash == 0 {
        return None;
    }
    let (page_id, slug) = (&id[..hash], &id[hash + 1..]);
    if slug.is_empty() || !has_page(page_id) {
        return None;
    }
    Some((page_id.to_string(), Some(slug.to_string())))
}

/// `isSafeRelPath`: non-empty, relative, no empty, `.` or `..` segment, no NUL.
pub fn is_safe_rel_path(rel_path: &str) -> bool {
    if rel_path.is_empty() || rel_path.starts_with('/') || rel_path.contains('\0') {
        return false;
    }
    rel_path.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

/// `docsFileStem`: the file name without `.md` / `.markdown` (any case).
pub fn docs_file_stem(rel_path: &str) -> String {
    let name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    let lower = fold_ascii(name);
    if lower.ends_with(".markdown") {
        return name[..name.len() - 9].to_string();
    }
    if lower.ends_with(".md") {
        return name[..name.len() - 3].to_string();
    }
    name.to_string()
}

// ── Index (index.ts, home.ts) ───────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DocsHeading {
    pub id: String,
    pub level: u8,
    pub text: String,
    pub slug: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DocsLink {
    pub target: String,
    pub text: String,
    pub kind: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocsPage {
    pub id: String,
    pub root: String,
    pub rel_path: String,
    pub title: String,
    pub headings: Vec<DocsHeading>,
    pub links: Vec<DocsLink>,
    pub chars: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocsHome {
    pub root: String,
    pub kind: &'static str,
    pub page_id: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DocsRootLabel {
    pub label: String,
}

/// `AiDocsIndex`, as the webview receives it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocsIndexOut {
    pub base_id: String,
    pub roots: Vec<DocsRootLabel>,
    pub pages: Vec<DocsPage>,
    pub homes: Vec<DocsHome>,
    pub truncated: bool,
    pub oversize_skipped: u64,
    pub built_at: u64,
}

/// A page as the host extracts it: no id, no slugs, no body (`AiDocsPageInput`).
#[derive(Clone, Debug)]
pub struct PageInput {
    pub root: String,
    pub rel_path: String,
    pub title: Option<String>,
    pub headings: Vec<(u8, String)>,
    pub links: Vec<DocsLink>,
    pub chars: usize,
}

fn build_page(input: &PageInput, id: String) -> DocsPage {
    let kept: Vec<&(u8, String)> = input.headings.iter().filter(|(_, t)| !js_trim(t).is_empty()).take(DOCS_MAX_HEADINGS_PER_PAGE).collect();
    let texts: Vec<&str> = kept.iter().map(|(_, t)| t.as_str()).collect();
    let slugs = docs_slugs(&texts);
    let headings: Vec<DocsHeading> = kept
        .iter()
        .zip(slugs)
        .map(|((level, text), slug)| DocsHeading {
            id: docs_section_id(&id, &slug),
            level: (*level).clamp(1, 6),
            text: text.clone(),
            slug,
        })
        .collect();
    let fm = input.title.as_deref().map(js_trim).unwrap_or("");
    let title = if !fm.is_empty() {
        fm.to_string()
    } else if let Some(first) = headings.first() {
        first.text.clone()
    } else {
        docs_file_stem(&input.rel_path)
    };
    DocsPage {
        id,
        root: input.root.clone(),
        rel_path: input.rel_path.clone(),
        title,
        headings,
        links: input.links.iter().take(DOCS_MAX_LINKS_PER_PAGE).cloned().collect(),
        chars: input.chars,
    }
}

/// `findPage` of `home.ts`: exact path first, else the first ASCII-case-insensitive match.
fn find_page<'a>(pages: &'a [DocsPage], root: &str, rel_path: &str) -> Option<&'a DocsPage> {
    let folded = fold_ascii(rel_path);
    let mut insensitive: Option<&DocsPage> = None;
    for p in pages {
        if p.root != root {
            continue;
        }
        if p.rel_path == rel_path {
            return Some(p);
        }
        if insensitive.is_none() && fold_ascii(&p.rel_path) == folded {
            insensitive = Some(p);
        }
    }
    insensitive
}

/// `chooseDocsHomes`: override, `INDEX.md`, `README.md`, else the map.
pub fn choose_docs_homes(root_labels: &[String], pages: &[DocsPage], home_file: Option<&str>) -> Vec<DocsHome> {
    root_labels
        .iter()
        .map(|root| {
            let steps: [(&'static str, Option<&str>); 3] = [("override", home_file), ("index", Some("INDEX.md")), ("readme", Some("README.md"))];
            for (kind, rel) in steps {
                let Some(rel) = rel.filter(|r| !r.is_empty()) else { continue };
                if let Some(page) = find_page(pages, root, rel) {
                    return DocsHome { root: root.clone(), kind, page_id: Some(page.id.clone()) };
                }
            }
            DocsHome { root: root.clone(), kind: "map", page_id: None }
        })
        .collect()
}

pub struct IndexInput<'a> {
    pub base_id: &'a str,
    /// Roots that were found, in configured order, with their labels.
    pub root_labels: &'a [String],
    pub home_file: Option<&'a str>,
    pub pages: &'a [PageInput],
    pub truncated: bool,
    pub oversize_skipped: u64,
    pub built_at: u64,
}

/// `buildDocsIndex`: ids, unique slugs, titles, deduped and sorted pages (a
/// page with an unknown root label or unsafe rel path is dropped; for a repeated
/// id the first in sorted order wins), the file cap and each root's home.
pub fn build_docs_index(input: &IndexInput) -> DocsIndexOut {
    let mut root_order: HashMap<&str, usize> = HashMap::new();
    for (i, label) in input.root_labels.iter().enumerate() {
        root_order.entry(label.as_str()).or_insert(i);
    }
    let mut usable: Vec<&PageInput> =
        input.pages.iter().filter(|p| root_order.contains_key(p.root.as_str()) && is_safe_rel_path(&p.rel_path)).collect();
    usable.sort_by(|a, b| root_order[a.root.as_str()].cmp(&root_order[b.root.as_str()]).then_with(|| a.rel_path.cmp(&b.rel_path)));
    let mut seen: HashSet<String> = HashSet::new();
    let mut pages: Vec<DocsPage> = Vec::new();
    let mut truncated = input.truncated;
    for p in usable {
        let id = docs_page_id(&p.root, &p.rel_path);
        if seen.contains(&id) {
            continue;
        }
        if pages.len() >= DOCS_MAX_FILES {
            truncated = true;
            break;
        }
        seen.insert(id.clone());
        pages.push(build_page(p, id));
    }
    let homes = choose_docs_homes(input.root_labels, &pages, input.home_file);
    DocsIndexOut {
        base_id: input.base_id.to_string(),
        roots: input.root_labels.iter().map(|l| DocsRootLabel { label: l.clone() }).collect(),
        pages,
        homes,
        truncated,
        oversize_skipped: input.oversize_skipped,
        built_at: input.built_at,
    }
}

// ── Keyword ranking (keyword.ts) ────────────────────────────────────────────

/// Words that carry no meaning in a question (`DOCS_STOP_WORDS`).
pub const DOCS_STOP_WORDS: [&str; 40] = [
    "a", "about", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i", "in", "is", "it", "me", "my",
    "of", "on", "or", "our", "should", "that", "the", "this", "to", "was", "we", "what", "when", "where", "which", "who", "why", "with",
    "you",
];

/// `keywordTerms`: fold and split a query into ranking terms.
pub fn keyword_terms(query: &str) -> Vec<String> {
    let folded = fold_ascii(query);
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in folded.chars() {
        let cp = ch as u32;
        let in_token = if cp >= 0x80 { !is_docs_space(cp) } else { is_ascii_alnum(cp) || cp == 0x5f };
        if in_token {
            cur.push(ch);
        } else if !cur.is_empty() {
            tokens.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    let meaningful: Vec<&String> = tokens.iter().filter(|t| !DOCS_STOP_WORDS.contains(&t.as_str())).collect();
    let pool: Vec<&String> = if meaningful.is_empty() { tokens.iter().collect() } else { meaningful };
    let mut seen: HashSet<&str> = HashSet::new();
    let mut out = Vec::new();
    for t in pool {
        if !seen.insert(t.as_str()) {
            continue;
        }
        out.push(t.clone());
        if out.len() >= DOCS_KEYWORD_MAX_TERMS {
            break;
        }
    }
    out
}

/// `countOccurrences`: non-overlapping occurrences of `term` in `text`, left to right.
pub fn count_occurrences(text: &str, term: &str) -> usize {
    if term.is_empty() {
        return 0;
    }
    let mut n = 0;
    let mut from = 0;
    while let Some(at) = text[from..].find(term) {
        n += 1;
        from += at + term.len();
    }
    n
}

/// A section as the host scans it (`DocsKeywordSection`).
#[derive(Clone, Debug)]
pub struct KeywordSection {
    pub id: String,
    pub page_id: String,
    pub title: String,
    pub rel_path: String,
    pub heading: Option<String>,
    pub text: String,
}

/// `AiDocsSectionRef`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SectionRef {
    pub id: String,
    pub page_id: String,
    pub title: String,
    pub rel_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    pub score: u32,
}

/// `scoreKeywordSection`: 0 is no match.
pub fn score_keyword_section(terms: &[String], section: &KeywordSection) -> u32 {
    if terms.is_empty() {
        return 0;
    }
    let heading = fold_ascii(section.heading.as_deref().unwrap_or(""));
    let title = fold_ascii(&section.title);
    let path = fold_ascii(&section.rel_path);
    let text = fold_ascii(&section.text);
    let mut score = 0u32;
    for term in terms {
        let in_heading = heading.contains(term.as_str());
        let in_title = title.contains(term.as_str());
        let in_path = path.contains(term.as_str());
        let occurrences = count_occurrences(&text, term);
        if in_heading {
            score += 10;
        }
        if in_title {
            score += 3;
        }
        if in_path {
            score += 2;
        }
        score += occurrences.min(5) as u32;
        if in_heading || in_title || in_path || occurrences > 0 {
            score += 6;
        }
    }
    score
}

/// `rankKeywordSections`: scored, ordered (score descending, then id by code
/// point), at most `limit`.
pub fn rank_keyword_sections(query: &str, sections: &[KeywordSection], limit: usize) -> Vec<SectionRef> {
    let terms = keyword_terms(query);
    if terms.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<SectionRef> = Vec::new();
    for s in sections {
        let score = score_keyword_section(&terms, s);
        if score == 0 {
            continue;
        }
        scored.push(SectionRef {
            id: s.id.clone(),
            page_id: s.page_id.clone(),
            title: s.title.clone(),
            rel_path: s.rel_path.clone(),
            heading: s.heading.clone(),
            score,
        });
    }
    scored.sort_by(cmp_section_refs);
    scored.truncate(limit);
    scored
}

/// The ranking order: score descending, then id ascending by code point. Rust's
/// `str` order is by UTF-8 bytes, which is code point order. The host merges
/// per-file results with the same comparator.
pub fn cmp_section_refs(a: &SectionRef, b: &SectionRef) -> std::cmp::Ordering {
    b.score.cmp(&a.score).then_with(|| a.id.cmp(&b.id))
}
