//! Markdown reading for the documentation bases: frontmatter, headings,
//! sections and outgoing links. A port of `headingsWithOffsets` and
//! `frontmatterEndOffset` (`packages/core/src/ai/documentBudget.ts`) and
//! `splitDocsSections` (`ai/docs/sections.ts`), so a section id means the same
//! thing on both hosts (`test/ai-fixtures/docs/sections.json`). Offsets are
//! byte offsets here (JavaScript counts UTF-16 units); the section texts are
//! the same.
//!
//! The regular expressions the TypeScript uses are written out by hand to keep
//! the crate list unchanged. Where a regex has a quirk the port keeps it:
//!
//! - `.` does not match `\r`, U+2028 or U+2029, so a heading line that holds
//!   one of them after its `#`s is not a heading;
//! - an empty frontmatter block (`---` directly followed by `---`) is not
//!   frontmatter, because the pattern needs a newline between the fences;
//! - `trim()` is JavaScript's (`rules::js_trim`).

use super::rules::{docs_slugs, is_js_space, js_trim, DocsLink};

#[derive(Clone, Copy)]
struct Line<'a> {
    text: &'a str,
    start: usize,
}

/// Offset just past the leading frontmatter block (0 when there is none).
/// `^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)`
pub fn frontmatter_end(md: &str) -> usize {
    let bytes = md.as_bytes();
    if !md.starts_with("---") {
        return 0;
    }
    let mut p = 3;
    while p < bytes.len() && (bytes[p] == b' ' || bytes[p] == b'\t') {
        p += 1;
    }
    if p < bytes.len() && bytes[p] == b'\r' {
        p += 1;
    }
    if p >= bytes.len() || bytes[p] != b'\n' {
        return 0;
    }
    p += 1;
    // The closing fence is the first line (from p on) that is `---` or `...`
    // followed by optional blanks and the end of the line or of the text. The
    // newline before it must be at or after p.
    let mut j = p;
    while j < bytes.len() {
        if bytes[j] == b'\n' {
            let rest = &md[j + 1..];
            if rest.starts_with("---") || rest.starts_with("...") {
                let mut k = j + 1 + 3;
                while k < bytes.len() && (bytes[k] == b' ' || bytes[k] == b'\t') {
                    k += 1;
                }
                if k == bytes.len() {
                    return k;
                }
                if bytes[k] == b'\n' {
                    return k + 1;
                }
                if bytes[k] == b'\r' && k + 1 < bytes.len() && bytes[k + 1] == b'\n' {
                    return k + 2;
                }
            }
        }
        j += 1;
    }
    0
}

fn split_lines(md: &str, from: usize) -> Vec<Line<'_>> {
    let mut lines = Vec::new();
    let mut pos = from;
    while pos < md.len() {
        let end = md[pos..].find('\n').map(|i| pos + i);
        let stop = end.unwrap_or(md.len());
        let raw = &md[pos..stop];
        lines.push(Line { text: raw.strip_suffix('\r').unwrap_or(raw), start: pos });
        pos = match end {
            Some(e) => e + 1,
            None => md.len(),
        };
    }
    lines
}

/// `^ {0,3}(`{3,}|~{3,})`: the fence character and run length, if the line opens one.
fn fence_open(line: &str) -> Option<(char, usize)> {
    let rest = strip_indent(line)?;
    let c = rest.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = rest.chars().take_while(|x| *x == c).count();
    (n >= 3).then_some((c, n))
}

/// `^ {0,3}(`{3,}|~{3,})[ \t]*$`
fn fence_close(line: &str) -> Option<(char, usize)> {
    let (c, n) = fence_open(line)?;
    let after = &strip_indent(line)?[n..];
    after.chars().all(|x| x == ' ' || x == '\t').then_some((c, n))
}

/// The line without up to three leading spaces; None when it has four or more.
fn strip_indent(line: &str) -> Option<&str> {
    let spaces = line.bytes().take_while(|b| *b == b' ').count();
    if spaces > 3 {
        return None;
    }
    Some(&line[spaces..])
}

/// Per line: true when the line is inside a fenced code block (fence lines included).
fn fence_mask(lines: &[Line]) -> Vec<bool> {
    let mut mask = Vec::with_capacity(lines.len());
    let mut fence: Option<(char, usize)> = None;
    for line in lines {
        match fence {
            None => {
                if let Some(open) = fence_open(line.text) {
                    fence = Some(open);
                    mask.push(true);
                } else {
                    mask.push(false);
                }
            }
            Some((fc, flen)) => {
                mask.push(true);
                if let Some((c, n)) = fence_close(line.text) {
                    if c == fc && n >= flen {
                        fence = None;
                    }
                }
            }
        }
    }
    mask
}

/// `^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$` then `.replace(/[ \t]+#+$/, '').trim()`:
/// the level and text of an ATX heading line, None for anything else or an empty text.
fn heading_of(line: &str) -> Option<(u8, String)> {
    let rest = strip_indent(line)?;
    let hashes = rest.bytes().take_while(|b| *b == b'#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let after = &rest[hashes..];
    let body = after.trim_start_matches([' ', '\t']);
    if body.len() == after.len() {
        return None; // `[ \t]+` needs at least one blank
    }
    // `.` stops at a line terminator, and `$` is the end of the input.
    if body.chars().any(|c| matches!(c, '\r' | '\u{2028}' | '\u{2029}')) {
        return None;
    }
    let body = body.trim_end_matches([' ', '\t']);
    let stripped = body.trim_end_matches('#');
    let text = if stripped.len() < body.len() && stripped.ends_with([' ', '\t']) {
        stripped.trim_end_matches([' ', '\t'])
    } else {
        body
    };
    let text = js_trim(text);
    if text.is_empty() {
        None
    } else {
        Some((hashes as u8, text.to_string()))
    }
}

/// A heading with the offsets of its line.
#[derive(Clone, Debug, PartialEq)]
pub struct HeadingAt {
    pub level: u8,
    pub text: String,
    pub start: usize,
}

/// `headingsWithOffsets`: heading levels, texts and line offsets, skipping
/// frontmatter and fenced code.
pub fn headings_with_offsets(md: &str) -> Vec<HeadingAt> {
    let lines = split_lines(md, frontmatter_end(md));
    let mask = fence_mask(&lines);
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if mask[i] {
            continue;
        }
        if let Some((level, text)) = heading_of(line.text) {
            out.push(HeadingAt { level, text, start: line.start });
        }
    }
    out
}

/// One section of a file (`DocsMarkdownSection`).
#[derive(Clone, Debug, PartialEq)]
pub struct MdSection<'a> {
    /// `(level, text, slug)`; None for the preamble.
    pub heading: Option<(u8, String, String)>,
    pub text: &'a str,
}

/// `splitDocsSections`: the preamble (when there is non-blank text before the
/// first heading, after the frontmatter) and one section per heading, each
/// running to the next heading of any level.
pub fn split_sections(md: &str) -> Vec<MdSection<'_>> {
    let headings = headings_with_offsets(md);
    let texts: Vec<&str> = headings.iter().map(|h| h.text.as_str()).collect();
    let slugs = docs_slugs(&texts);
    let mut out = Vec::new();
    let first_start = headings.first().map(|h| h.start).unwrap_or(md.len());
    let fm = frontmatter_end(md);
    let body_from = fm.min(first_start);
    // A heading can only start after the frontmatter, so `fm <= first_start`
    // whenever there is one; the min keeps the slice valid for a file that is
    // all frontmatter.
    let preamble_body = &md[body_from..first_start];
    if !js_trim(preamble_body).is_empty() {
        out.push(MdSection { heading: None, text: &md[..first_start] });
    }
    for (i, h) in headings.iter().enumerate() {
        let end = headings.get(i + 1).map(|n| n.start).unwrap_or(md.len());
        out.push(MdSection { heading: Some((h.level, h.text.clone(), slugs[i].clone())), text: &md[h.start..end] });
    }
    out
}

/// The frontmatter `title:` value, when there is one: the first top-level
/// `title:` line of the block, with matching quotes removed. No multi-line values.
pub fn frontmatter_title(md: &str) -> Option<String> {
    let end = frontmatter_end(md);
    if end == 0 {
        return None;
    }
    let block = &md[..end];
    for line in block.lines().skip(1) {
        let line = line.trim_end_matches('\r');
        let Some(value) = line.strip_prefix("title:") else { continue };
        let mut value = value.trim();
        if value.is_empty() || value.starts_with('|') || value.starts_with('>') {
            return None;
        }
        for q in ['"', '\''] {
            if value.len() >= 2 && value.starts_with(q) && value.ends_with(q) {
                value = value[1..value.len() - 1].trim();
                break;
            }
        }
        return (!value.is_empty()).then(|| value.to_string());
    }
    None
}

// ── Links ───────────────────────────────────────────────────────────────────

fn is_scheme(href: &str) -> bool {
    // /^[A-Za-z][A-Za-z0-9+.-]+:/ (two or more characters before the colon, so `C:` is a drive)
    let mut chars = href.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    let mut n = 1;
    for c in chars {
        if c == ':' {
            return n >= 2;
        }
        if !(c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')) {
            return false;
        }
        n += 1;
    }
    false
}

/// `\s` as JavaScript means it inside a regex.
fn is_re_space(c: char) -> bool {
    is_js_space(c)
}

/// One `[text](dest "title")` starting at `chars[at]` (a `[`), as the backlink
/// regex reads it. Returns the text, the destination and the index after the `)`.
fn markdown_link_at(chars: &[char], at: usize) -> Option<(String, String, usize)> {
    let mut i = at + 1;
    let text_start = i;
    while i < chars.len() && chars[i] != ']' {
        i += 1;
    }
    if i >= chars.len() || i + 1 >= chars.len() || chars[i + 1] != '(' {
        return None;
    }
    let text: String = chars[text_start..i].iter().collect();
    let mut j = i + 2;
    while j < chars.len() && is_re_space(chars[j]) {
        j += 1;
    }
    // Destination: `<...>` first, else a run of characters that are not `)` or space.
    let mut candidates: Vec<(usize, usize)> = Vec::new();
    if j < chars.len() && chars[j] == '<' {
        if let Some(close) = (j + 1..chars.len()).find(|k| chars[*k] == '>') {
            candidates.push((j, close + 1));
        }
    }
    let mut k = j;
    while k < chars.len() && chars[k] != ')' && !is_re_space(chars[k]) {
        k += 1;
    }
    if k > j {
        candidates.push((j, k));
    }
    for (d_start, d_end) in candidates {
        let dest: String = chars[d_start..d_end].iter().collect();
        let mut m = d_end;
        // Optional title after at least one blank.
        let blanks_start = m;
        while m < chars.len() && is_re_space(chars[m]) {
            m += 1;
        }
        let mut tails: Vec<usize> = vec![blanks_start];
        if m > blanks_start && m < chars.len() {
            let title_end = match chars[m] {
                '"' => (m + 1..chars.len()).find(|x| chars[*x] == '"'),
                '\'' => (m + 1..chars.len()).find(|x| chars[*x] == '\''),
                '(' => (m + 1..chars.len()).find(|x| chars[*x] == ')'),
                _ => None,
            };
            if let Some(te) = title_end {
                tails.insert(0, te + 1);
            }
        }
        for tail in tails {
            let mut e = tail;
            while e < chars.len() && is_re_space(chars[e]) {
                e += 1;
            }
            if e < chars.len() && chars[e] == ')' {
                return Some((text, dest, e + 1));
            }
        }
    }
    None
}

/// `\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]` at `chars[at]`: the inner
/// text (`Name#Heading|alias` as written), the alias if any, and the end index.
fn wikilink_at(chars: &[char], at: usize) -> Option<(String, Option<String>, usize)> {
    if chars.get(at) != Some(&'[') || chars.get(at + 1) != Some(&'[') {
        return None;
    }
    let mut i = at + 2;
    let name_start = i;
    while i < chars.len() && !matches!(chars[i], ']' | '|' | '#') {
        i += 1;
    }
    if i == name_start {
        return None;
    }
    if i < chars.len() && chars[i] == '#' {
        i += 1;
        while i < chars.len() && !matches!(chars[i], ']' | '|') {
            i += 1;
        }
    }
    let mut alias: Option<String> = None;
    if i < chars.len() && chars[i] == '|' {
        let a_start = i + 1;
        i = a_start;
        while i < chars.len() && chars[i] != ']' {
            i += 1;
        }
        alias = Some(chars[a_start..i].iter().collect());
    }
    if i + 1 < chars.len() && chars[i] == ']' && chars[i + 1] == ']' {
        let inner: String = chars[at + 2..i].iter().collect();
        return Some((inner, alias, i + 2));
    }
    None
}

const MAX_LINK_TEXT_CHARS: usize = 120;

fn clip(text: &str) -> String {
    js_trim(text).chars().take(MAX_LINK_TEXT_CHARS).collect()
}

/// Outgoing links of a page as written (`AiDocsLink`): inline markdown links
/// (not images, not external) and `[[wikilinks]]`, in line order, markdown
/// before wikilinks on a line. Frontmatter and fenced code are skipped. Core
/// resolves them (`ai/docs/links.ts`); a `#fragment`-only link is kept.
pub fn extract_links(md: &str) -> Vec<DocsLink> {
    let lines = split_lines(md, frontmatter_end(md));
    let mask = fence_mask(&lines);
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if mask[i] || !line.text.contains('[') {
            continue;
        }
        let chars: Vec<char> = line.text.chars().collect();
        let mut at = 0;
        while at < chars.len() {
            if chars[at] == '[' {
                if let Some((text, dest, end)) = markdown_link_at(&chars, at) {
                    let is_image = at > 0 && chars[at - 1] == '!';
                    let href = js_trim(dest.trim_start_matches('<').trim_end_matches('>')).to_string();
                    if !is_image && !href.is_empty() && !is_scheme(&href) && !href.starts_with("//") {
                        out.push(DocsLink { target: href, text: clip(&text), kind: "markdown" });
                    }
                    at = end;
                    continue;
                }
            }
            at += 1;
        }
        let mut at = 0;
        while at < chars.len() {
            if chars[at] == '[' {
                if let Some((inner, alias, end)) = wikilink_at(&chars, at) {
                    let target = js_trim(&inner).to_string();
                    let name = inner.split(['#', '|']).next().unwrap_or("");
                    if !js_trim(name).is_empty() {
                        let text = alias.as_deref().map(js_trim).filter(|a| !a.is_empty()).map(clip).unwrap_or_else(|| clip(name));
                        out.push(DocsLink { target, text, kind: "wikilink" });
                    }
                    at = end;
                    continue;
                }
            }
            at += 1;
        }
    }
    out
}
