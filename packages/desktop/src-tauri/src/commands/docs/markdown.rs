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

/// The frontmatter `title:` value, when there is one. The contract is shared
/// with `frontmatterTitle` (`src/ai/docsHost.ts`) through
/// `test/ai-fixtures/docs/titles.json`: the first line of the block that is
/// `title`, optional blanks and `:`; its value trimmed (JavaScript `trim`), one
/// pair of matching quotes removed and the inside trimmed again. An empty value
/// or a block scalar (`|`, `>`) has no title; no multi-line values.
pub fn frontmatter_title(md: &str) -> Option<String> {
    let end = frontmatter_end(md);
    if end == 0 {
        return None;
    }
    let block = &md[..end];
    for line in block.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let Some(rest) = line.strip_prefix("title") else { continue };
        let rest = rest.trim_start_matches([' ', '\t']);
        let Some(value) = rest.strip_prefix(':') else { continue };
        let mut value = js_trim(value);
        if value.is_empty() || value.starts_with('|') || value.starts_with('>') {
            return None;
        }
        for q in ['"', '\''] {
            if value.chars().count() >= 2 && value.starts_with(q) && value.ends_with(q) {
                value = js_trim(&value[1..value.len() - 1]);
                break;
            }
        }
        return (!value.is_empty()).then(|| value.to_string());
    }
    None
}

// ── Links ───────────────────────────────────────────────────────────────────
//
// The contract is `extractDocsLinks` in `src/ai/docsHost.ts`, shared through
// `test/ai-fixtures/docs/links.json`. Its two regular expressions are walked
// by hand here, character by character, with the same alternatives and the
// same limits (text up to 300 UTF-16 units, wikilink inner 1 to 300).

/// `\s` as JavaScript means it inside a regex.
fn is_re_space(c: char) -> bool {
    is_js_space(c)
}

fn units(chars: &[char]) -> usize {
    chars.iter().map(|c| c.len_utf16()).sum()
}

/// After a destination ending at `at`: `(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)`.
/// Returns the index after the `)`.
fn link_tail(chars: &[char], at: usize) -> Option<usize> {
    let skip_space = |mut i: usize| {
        while i < chars.len() && is_re_space(chars[i]) {
            i += 1;
        }
        i
    };
    let after_blanks = skip_space(at);
    if after_blanks > at && after_blanks < chars.len() && (chars[after_blanks] == '"' || chars[after_blanks] == '\'') {
        let quote = chars[after_blanks];
        if let Some(close) = (after_blanks + 1..chars.len()).find(|k| chars[*k] == quote) {
            let e = skip_space(close + 1);
            if e < chars.len() && chars[e] == ')' {
                return Some(e + 1);
            }
        }
    }
    (after_blanks < chars.len() && chars[after_blanks] == ')').then_some(after_blanks + 1)
}

/// `(!?)\[([^\]\n]{0,300})\]\(\s*(<[^>\n]*>|[^()\s]*)(?:\s+(?:"..."|'...'))?\s*\)` starting at
/// `chars[at]` (the `[`). The text, the destination as written and the index after the `)`.
fn markdown_link_at(chars: &[char], at: usize) -> Option<(String, String, usize)> {
    let text_start = at + 1;
    let close = (text_start..chars.len()).find(|i| chars[*i] == ']')?;
    if units(&chars[text_start..close]) > 300 || chars.get(close + 1) != Some(&'(') {
        return None;
    }
    let mut j = close + 2;
    while j < chars.len() && is_re_space(chars[j]) {
        j += 1;
    }
    let text: String = chars[text_start..close].iter().collect();
    if chars.get(j) == Some(&'<') {
        if let Some(gt) = (j + 1..chars.len()).find(|k| chars[*k] == '>') {
            if let Some(end) = link_tail(chars, gt + 1) {
                return Some((text, chars[j..=gt].iter().collect(), end));
            }
        }
    }
    let mut k = j;
    while k < chars.len() && !matches!(chars[k], '(' | ')') && !is_re_space(chars[k]) {
        k += 1;
    }
    let end = link_tail(chars, k)?;
    Some((text, chars[j..k].iter().collect(), end))
}

/// `\[\[([^[\]\n]{1,300})\]\]` at `chars[at]`: the inner text as written and the end index.
fn wikilink_at(chars: &[char], at: usize) -> Option<(String, usize)> {
    if chars.get(at) != Some(&'[') || chars.get(at + 1) != Some(&'[') {
        return None;
    }
    let start = at + 2;
    let mut i = start;
    while i < chars.len() && !matches!(chars[i], '[' | ']') {
        i += 1;
    }
    let n = units(&chars[start..i]);
    if n == 0 || n > 300 || chars.get(i) != Some(&']') || chars.get(i + 1) != Some(&']') {
        return None;
    }
    Some((chars[start..i].iter().collect(), i + 2))
}

const MAX_LINK_TEXT_CHARS: usize = 120;

fn clip(text: &str) -> String {
    js_trim(text).chars().take(MAX_LINK_TEXT_CHARS).collect()
}

/// Inline code spans (`` `[^`]*` ``) replaced by one space each, as the TypeScript does.
fn blank_code_spans(line: &str) -> Vec<char> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '`' {
            if let Some(close) = (i + 1..chars.len()).find(|k| chars[*k] == '`') {
                out.push(' ');
                i = close + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// Outgoing links of a page as written (`AiDocsLink`), in document order.
/// Skips frontmatter, fenced code, inline code and images; keeps external
/// links (core marks them) and a `#fragment`-only link; drops an empty target
/// and a wikilink with no name. Core resolves them (`ai/docs/links.ts`).
pub fn extract_links(md: &str) -> Vec<DocsLink> {
    let lines = split_lines(md, frontmatter_end(md));
    let mask = fence_mask(&lines);
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if mask[i] || !line.text.contains('[') {
            continue;
        }
        let chars = blank_code_spans(line.text);
        let mut found: Vec<(usize, DocsLink)> = Vec::new();
        // `(!?)` then `[`: a `!` directly before the bracket makes it an image, which is consumed whole.
        let mut at = 0;
        while at < chars.len() {
            let bang = chars[at] == '!' && chars.get(at + 1) == Some(&'[');
            let open = if bang { at + 1 } else { at };
            if chars[open] == '[' {
                if let Some((text, dest, end)) = markdown_link_at(&chars, open) {
                    if !bang {
                        let unwrapped = if dest.chars().count() >= 2 && dest.starts_with('<') && dest.ends_with('>') { &dest[1..dest.len() - 1] } else { dest.as_str() };
                        let target = js_trim(unwrapped).to_string();
                        if !target.is_empty() {
                            found.push((at, DocsLink { target, text: clip(&text), kind: "markdown" }));
                        }
                    }
                    at = end;
                    continue;
                }
            }
            at += 1;
        }
        let mut at = 0;
        while at < chars.len() {
            let bang = chars[at] == '!' && chars.get(at + 1) == Some(&'[');
            let open = if bang { at + 1 } else { at };
            if chars[open] == '[' {
                if let Some((inner, end)) = wikilink_at(&chars, open) {
                    if !bang {
                        let name = inner.split(['#', '|']).next().unwrap_or("");
                        if !js_trim(name).is_empty() {
                            let alias = inner.find('|').map(|bar| js_trim(&inner[bar + 1..])).unwrap_or("");
                            let text = if alias.is_empty() { clip(name) } else { clip(alias) };
                            found.push((at, DocsLink { target: js_trim(&inner).to_string(), text, kind: "wikilink" }));
                        }
                    }
                    at = end;
                    continue;
                }
            }
            at += 1;
        }
        found.sort_by_key(|(at, _)| *at);
        out.extend(found.into_iter().map(|(_, link)| link));
        if out.len() >= super::rules::DOCS_MAX_LINKS_PER_PAGE {
            out.truncate(super::rules::DOCS_MAX_LINKS_PER_PAGE);
            return out;
        }
    }
    out
}
