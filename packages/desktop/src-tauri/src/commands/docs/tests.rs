//! Tests for the documentation bases: the shared fixtures
//! (`test/ai-fixtures/docs/`, the contract with core's `ai/docs/`), the
//! containment and cap rules on real temp folders, and the watcher over several
//! roots. M7 adds more refusal cases; these are the ones the port stands on.

use std::fs as stdfs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};

use super::markdown::{extract_links, frontmatter_end, frontmatter_title, headings_with_offsets, split_sections};
use super::rules::*;
use super::*;
use crate::commands::watcher::{start_with, Mode, Signal};

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../test/ai-fixtures/docs").join(name);
    serde_json::from_str(&stdfs::read_to_string(path).unwrap()).unwrap()
}

fn temp_dir(tag: &str) -> PathBuf {
    // Tests run in parallel and several share a tag: the counter keeps their folders apart.
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("mikedown-docs-{tag}-{}-{n}", std::process::id()));
    let _ = stdfs::remove_dir_all(&dir);
    stdfs::create_dir_all(&dir).unwrap();
    // Canonical: macOS /tmp and /var are links.
    dir.canonicalize().unwrap()
}

fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    stdfs::create_dir_all(path.parent().unwrap()).unwrap();
    stdfs::write(path, text).unwrap();
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect()
}

fn base(id: &str, roots: &[&Path]) -> DocBase {
    DocBase {
        id: id.to_string(),
        name: id.to_string(),
        roots: roots.iter().map(|r| r.to_string_lossy().into_owned()).collect(),
        home_file: None,
        allow_cloud: false,
        enabled: true,
    }
}

// ── Shared fixtures (A10) ───────────────────────────────────────────────────

#[test]
fn root_labels_match_the_fixture() {
    for case in fixture("labels.json")["cases"].as_array().unwrap() {
        assert_eq!(docs_root_labels(&strings(&case["roots"])), strings(&case["labels"]), "{}", case["roots"]);
    }
}

#[test]
fn slugs_match_the_fixture() {
    let f = fixture("slugs.json");
    for case in f["slug"].as_array().unwrap() {
        assert_eq!(docs_slug(case["text"].as_str().unwrap()), case["slug"].as_str().unwrap(), "slug of {}", case["text"]);
    }
    for case in f["pages"].as_array().unwrap() {
        assert_eq!(docs_slugs(&strings(&case["headings"])), strings(&case["slugs"]), "{}", case["headings"]);
    }
}

#[test]
fn ids_match_the_fixture() {
    let f = fixture("ids.json");
    for p in f["pages"].as_array().unwrap() {
        assert_eq!(docs_page_id(p["root"].as_str().unwrap(), p["relPath"].as_str().unwrap()), p["id"].as_str().unwrap());
    }
    for s in f["sections"].as_array().unwrap() {
        assert_eq!(docs_section_id(s["pageId"].as_str().unwrap(), s["slug"].as_str().unwrap()), s["id"].as_str().unwrap());
    }
    let known = strings(&f["known"]);
    for case in f["parse"].as_array().unwrap() {
        let got = parse_docs_id(case["id"].as_str().unwrap(), |p| known.iter().any(|k| k == p));
        let want = &case["expected"];
        match (got, want) {
            (None, Value::Null) => {}
            (Some((page, slug)), Value::Object(o)) => {
                assert_eq!(page, o["pageId"].as_str().unwrap(), "{}", case["id"]);
                assert_eq!(slug.as_deref(), o.get("slug").and_then(Value::as_str), "{}", case["id"]);
            }
            (got, want) => panic!("{}: got {got:?}, want {want}", case["id"]),
        }
    }
    for case in f["safeRelPaths"].as_array().unwrap() {
        assert_eq!(is_safe_rel_path(case["relPath"].as_str().unwrap()), case["safe"].as_bool().unwrap(), "{}", case["relPath"]);
    }
    for case in f["stems"].as_array().unwrap() {
        assert_eq!(docs_file_stem(case["relPath"].as_str().unwrap()), case["stem"].as_str().unwrap(), "{}", case["relPath"]);
    }
}

#[test]
fn sections_match_the_fixture() {
    for case in fixture("sections.json")["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let got = split_sections(case["markdown"].as_str().unwrap());
        let want = case["sections"].as_array().unwrap();
        assert_eq!(got.len(), want.len(), "{name}: section count");
        for (g, w) in got.iter().zip(want) {
            assert_eq!(g.text, w["text"].as_str().unwrap(), "{name}: text");
            match (&g.heading, &w["heading"]) {
                (None, Value::Null) => {}
                (Some((level, text, slug)), Value::Object(h)) => {
                    assert_eq!(*level as u64, h["level"].as_u64().unwrap(), "{name}: level");
                    assert_eq!(text, h["text"].as_str().unwrap(), "{name}: heading");
                    assert_eq!(slug, h["slug"].as_str().unwrap(), "{name}: slug");
                }
                (g, w) => panic!("{name}: heading {g:?} vs {w}"),
            }
        }
    }
}

#[test]
fn keyword_terms_and_ranking_match_the_fixture() {
    let f = fixture("keyword.json");
    for case in f["terms"].as_array().unwrap() {
        assert_eq!(keyword_terms(case["query"].as_str().unwrap()), strings(&case["terms"]), "terms of {}", case["query"]);
    }
    for case in f["rank"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let sections: Vec<KeywordSection> = case["sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| KeywordSection {
                id: s["id"].as_str().unwrap().to_string(),
                page_id: s["pageId"].as_str().unwrap().to_string(),
                title: s["title"].as_str().unwrap().to_string(),
                rel_path: s["relPath"].as_str().unwrap().to_string(),
                heading: s["heading"].as_str().map(str::to_string),
                text: s["text"].as_str().unwrap().to_string(),
            })
            .collect();
        let got = rank_keyword_sections(case["query"].as_str().unwrap(), &sections, case["limit"].as_u64().unwrap() as usize);
        let want = case["expected"].as_array().unwrap();
        let got_pairs: Vec<(String, u64)> = got.iter().map(|r| (r.id.clone(), r.score as u64)).collect();
        let want_pairs: Vec<(String, u64)> = want.iter().map(|w| (w["id"].as_str().unwrap().to_string(), w["score"].as_u64().unwrap())).collect();
        assert_eq!(got_pairs, want_pairs, "{name}");
    }
}

/// UTF-16 and code point order differ above U+FFFF; Rust's `str` order is the code point one.
#[test]
fn ties_break_by_code_point_not_utf16() {
    assert!("\u{ff5e}" < "\u{1f600}", "U+FF5E sorts before U+1F600 by code point (UTF-16 would put the emoji first)");
    let mk = |id: &str| KeywordSection { id: id.into(), page_id: id.into(), title: "T".into(), rel_path: "p.md".into(), heading: None, text: "word".into() };
    let got = rank_keyword_sections("word", &[mk("d/\u{1f600}"), mk("d/\u{ff5e}")], 20);
    assert_eq!(got.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["d/\u{ff5e}", "d/\u{1f600}"]);
}

#[test]
fn the_section_cap_cuts_on_a_char_boundary() {
    let (short, cut) = cap_section_text("abc", 10);
    assert_eq!((short.as_str(), cut), ("abc", false));
    // Each é is two bytes; 5 bytes holds two of them.
    let (capped, cut) = cap_section_text("ééé", 5);
    assert_eq!((capped.as_str(), cut), ("éé", true));
    let (capped, _) = cap_section_text(&"x".repeat(DOCS_MAX_SECTION_BYTES + 10), DOCS_MAX_SECTION_BYTES);
    assert_eq!(capped.len(), DOCS_MAX_SECTION_BYTES);
}

// ── Markdown quirks the regex port keeps ────────────────────────────────────

#[test]
fn frontmatter_and_headings_follow_the_typescript_rules() {
    assert_eq!(frontmatter_end("---\ntitle: X\n---\n# A\n"), "---\ntitle: X\n---\n".len());
    assert_eq!(frontmatter_end("---\r\ntitle: X\r\n...\r\n# A"), "---\r\ntitle: X\r\n...\r\n".len());
    assert_eq!(frontmatter_end("---\n---\n# A"), 0, "an empty block is not frontmatter");
    assert_eq!(frontmatter_end("---\n\n---\n# A"), "---\n\n---\n".len());
    assert_eq!(frontmatter_end("---\ntitle: X\n--- \n# A"), "---\ntitle: X\n--- \n".len());
    assert_eq!(frontmatter_end("---\ntitle: X\n---x\n"), 0);
    assert_eq!(frontmatter_end("no frontmatter"), 0);
    assert_eq!(frontmatter_title("---\ntitle: \"Key rotation\"\n---\n").as_deref(), Some("Key rotation"));
    assert_eq!(frontmatter_title("---\ntags: [a]\n---\n"), None);

    let md = "# One ##\n```\n# not a heading\n```\n   ## Two\n    ### code\n####### seven\n#\n# \n#Tag\n###### Six  \n";
    let got: Vec<(u8, String)> = headings_with_offsets(md).into_iter().map(|h| (h.level, h.text)).collect();
    assert_eq!(got, vec![(1, "One".to_string()), (2, "Two".to_string()), (6, "Six".to_string())]);
    // `.` stops at a line terminator, so this line is not a heading.
    assert!(headings_with_offsets("# a\u{2028}b\n").is_empty());
}

#[test]
fn links_are_extracted_as_written() {
    let md = "---\nlinks: [skip](ignored.md)\n---\nSee [setup](guide/setup.md#install \"Setup\") and ![logo](logo.png), [web](https://x.dev), [here](#top).\n\
              ```\n[code](code.md)\n```\nAlso [[Key rotation]], [[Security#Keys|the keys]] and [<angle>](<a b.md>).\n";
    let got: Vec<(String, String, &str)> = extract_links(md).into_iter().map(|l| (l.target, l.text, l.kind)).collect();
    assert_eq!(
        got,
        vec![
            ("guide/setup.md#install".to_string(), "setup".to_string(), "markdown"),
            ("#top".to_string(), "here".to_string(), "markdown"),
            ("a b.md".to_string(), "<angle>".to_string(), "markdown"),
            ("Key rotation".to_string(), "Key rotation".to_string(), "wikilink"),
            ("Security#Keys|the keys".to_string(), "the keys".to_string(), "wikilink"),
        ]
    );
}

// ── Settings (S4, A9) ───────────────────────────────────────────────────────

#[test]
fn check_doc_root_follows_the_core_rules() {
    assert_eq!(check_doc_root("/a/b/../c//d/").as_deref(), Some("/a/c/d"));
    assert_eq!(check_doc_root(" /notes ").as_deref(), Some("/notes"));
    assert_eq!(check_doc_root("c:/Users/me/Docs/").as_deref(), Some("C:\\Users\\me\\Docs"));
    assert_eq!(check_doc_root("\\\\srv\\share\\docs").as_deref(), Some("\\\\srv\\share\\docs"));
    assert_eq!(check_doc_root("\\\\srv\\share").as_deref(), Some("\\\\srv\\share"));
    for bad in ["", "relative/path", "/", "/..", "C:\\", "/a/${HOME}", "/a/notes.md", "/a/NOTES.MARKDOWN", "~/docs", "/a\u{1}b", "\\\\srv"] {
        assert_eq!(check_doc_root(bad), None, "{bad:?}");
    }
    assert_eq!(normalize_home_file(" docs\\HOME.md ").as_deref(), Some("docs/HOME.md"));
    for bad in ["", "/abs.md", "C:\\x.md", "../x.md", "a/../x.md", "x.txt", "${HOME}/x.md"] {
        assert_eq!(normalize_home_file(bad), None, "{bad:?}");
    }
}

#[test]
fn bases_parse_like_core_and_drop_what_core_drops() {
    let settings = json!({ "ai.docBases": [
        { "id": "b1", "name": "  Handbook ", "roots": ["/docs/a", "/docs/a/", "/docs/b"], "homeFile": "HOME.md", "allowCloud": true },
        { "id": "b2", "roots": ["/docs/a", "/docs/c"], "enabled": false, "allowCloud": "yes" },
        { "id": "b1", "roots": ["/docs/d"] },
        { "roots": ["/docs/e"] },
        { "id": "b3", "roots": ["not absolute"] },
        { "id": "b4", "roots": [], "name": "Empty" },
        "junk"
    ]});
    let bases = parse_doc_bases(&settings);
    assert_eq!(bases.len(), 2);
    assert_eq!(bases[0].name, "Handbook");
    assert_eq!(bases[0].roots, vec!["/docs/a", "/docs/b"], "a repeated root is dropped");
    assert_eq!(bases[0].home_file.as_deref(), Some("HOME.md"));
    assert!(bases[0].allow_cloud && bases[0].enabled);
    assert_eq!(bases[1].roots, vec!["/docs/c"], "a root another base lists is dropped, first wins");
    assert_eq!(bases[1].name, "c", "the name defaults to the first root's folder");
    assert!(!bases[1].allow_cloud, "allowCloud is true only when exactly true");
    assert!(!bases[1].enabled);
    // The nested form reads the same.
    let nested = json!({ "ai": { "docBases": [{ "id": "n", "roots": ["/n"] }] } });
    assert_eq!(parse_doc_bases(&nested).len(), 1);
}

/// S4: `docBases` come from the global file only. A folder's
/// `.mikedown/settings.json` may name one, and it is never read.
#[test]
fn a_folder_settings_file_cannot_supply_bases() {
    let app_data = temp_dir("settings-global");
    let folder = temp_dir("settings-folder");
    let global = settings_path(&app_data, "global", None).unwrap();
    stdfs::write(&global, r#"{ "ai.docBases": [{ "id": "mine", "roots": ["/my/docs"] }] }"#).unwrap();
    write(&folder, ".mikedown/settings.json", r#"{ "ai.docBases": [{ "id": "evil", "roots": ["/etc"] }], "ai": { "docBases": [{ "id": "evil2", "roots": ["/etc"] }] } }"#);
    let bases = bases_from_app_data(&app_data).unwrap();
    assert_eq!(bases.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(), vec!["mine"]);
    // With no global file there are no bases, whatever the folder says.
    stdfs::remove_file(&global).unwrap();
    assert!(bases_from_app_data(&app_data).unwrap().is_empty());
    // A damaged global file gives none rather than an error.
    stdfs::write(&global, "{ broken").unwrap();
    assert!(bases_from_app_data(&app_data).unwrap().is_empty());
}

#[test]
fn consent_names_come_from_the_settings_and_unknown_ids_are_dropped() {
    let bases = vec![base("a", &[Path::new("/a")]), DocBase { name: "Handbook".into(), ..base("b", &[Path::new("/b")]) }];
    let ids = vec!["b".to_string(), "nope".to_string(), "a".to_string(), "b".to_string()];
    assert_eq!(base_names_for_ids(&bases, &ids), vec!["Handbook", "a"]);
    assert!(base_names_for_ids(&bases, &["x".to_string()]).is_empty());
}

// ── Containment (S1, S2) ────────────────────────────────────────────────────

#[test]
fn containment_compares_whole_path_components() {
    assert!(is_within(Path::new("/docs"), Path::new("/docs/a/b.md")));
    assert!(is_within(Path::new("/docs"), Path::new("/docs")));
    assert!(!is_within(Path::new("/docs"), Path::new("/docs-evil/a.md")));
    assert!(!is_within(Path::new("/docs/a"), Path::new("/docs")));
}

#[test]
fn reads_refuse_what_the_five_checks_name() {
    let root = temp_dir("refusals");
    let outside = temp_dir("refusals-outside");
    write(&root, "ok.md", "# Ok\nbody\n");
    write(&root, "notes.txt", "text");
    write(&root, "big.md", &"x".repeat(2 * 1024 * 1024));
    write(&outside, "secret.md", "# Secret\n");
    assert_eq!(read_checked(&root, &root.join("ok.md")).unwrap(), "# Ok\nbody\n");
    assert!(read_checked(&root, &root.join("notes.txt")).is_err(), "a .txt");
    assert!(read_checked(&root, &root.join("big.md")).is_err(), "2 MiB");
    assert!(read_checked(&root, &root.join("sub/../../nope.md")).is_err(), "a ../ path that does not exist");
    assert!(read_checked(&root, &outside.join("secret.md")).is_err(), "a file outside the root");
    assert!(read_checked(&root, &root).is_err(), "a folder");
    // `..` that does exist still resolves out of the root and is refused.
    let climb = root.join("..").join(outside.file_name().unwrap()).join("secret.md");
    assert!(read_checked(&root, &climb).is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(outside.join("secret.md"), root.join("link.md")).unwrap();
        assert!(read_checked(&root, &root.join("link.md")).is_err(), "a symlink that escapes the root");
        std::os::unix::fs::symlink(&outside, root.join("linkdir")).unwrap();
        assert!(read_checked(&root, &root.join("linkdir/secret.md")).is_err(), "a symlinked folder that escapes the root");
        // An inside link is fine for a read; the walker still never lists it.
        std::os::unix::fs::symlink(root.join("ok.md"), root.join("inside.md")).unwrap();
        assert!(read_checked(&root, &root.join("inside.md")).is_ok());
    }
    let _ = stdfs::remove_dir_all(&root);
    let _ = stdfs::remove_dir_all(&outside);
}

#[test]
fn a_file_swapped_for_an_escaping_link_after_the_walk_is_refused() {
    let root = temp_dir("swap");
    let outside = temp_dir("swap-outside");
    write(&root, "page.md", "# Page\ntext\n");
    write(&outside, "secret.md", "# Secret\nhunter2\n");
    let index = build_base_index(&base("b", &[root.as_path()]));
    let label = index.out.roots[0].label.clone();
    let ids = vec![format!("{label}/page.md")];
    assert_eq!(read_sections(&index, &ids).len(), 1);
    #[cfg(unix)]
    {
        stdfs::remove_file(root.join("page.md")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.md"), root.join("page.md")).unwrap();
        assert!(read_sections(&index, &ids).is_empty(), "the id is known, the file now escapes");
    }
    let _ = stdfs::remove_dir_all(&root);
    let _ = stdfs::remove_dir_all(&outside);
}

// ── Index, reads, keyword search on a real folder ───────────────────────────

fn sample_base() -> (PathBuf, DocBase) {
    let root = temp_dir("sample");
    write(&root, "README.md", "---\ntitle: Handbook\n---\nWelcome. See [security](security.md#key-rotation) and [[Setup]].\n\n# Start here\nLinks [broken](nope.md).\n");
    write(&root, "security.md", "# Security\nIntro\n\n## Key rotation\nRotate every key each 90 days. Rotation is logged.\n\n## Setup\nsecond setup\n");
    write(&root, "guides/Setup.md", "Preamble text about setup.\n\n# Setup\nInstall it. Setup is easy.\n\n```\n# not a heading\n```\n");
    write(&root, "guides/notes.txt", "not markdown");
    write(&root, ".hidden/secret.md", "# Hidden\n");
    write(&root, "node_modules/pkg/readme.md", "# Dep\n");
    write(&root, "big.md", &"y".repeat(1024 * 1024 + 1));
    let b = base("sample", &[root.as_path()]);
    (root, b)
}

#[test]
fn the_index_has_titles_headings_links_and_no_bodies() {
    let (root, base) = sample_base();
    let index = build_base_index(&base);
    let label = root.file_name().unwrap().to_string_lossy().into_owned();
    assert_eq!(index.out.roots[0].label, label);
    let ids: Vec<&str> = index.out.pages.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, vec![format!("{label}/README.md"), format!("{label}/guides/Setup.md"), format!("{label}/security.md")]);
    assert_eq!(index.out.oversize_skipped, 1, "big.md is skipped and counted");
    assert!(!index.out.truncated);
    let readme = &index.out.pages[0];
    assert_eq!(readme.title, "Handbook", "frontmatter title");
    assert_eq!(readme.headings.iter().map(|h| h.slug.as_str()).collect::<Vec<_>>(), vec!["start-here"]);
    assert_eq!(readme.links.iter().map(|l| l.target.as_str()).collect::<Vec<_>>(), vec!["security.md#key-rotation", "Setup", "nope.md"]);
    assert_eq!(index.out.pages[1].title, "Setup", "first heading when there is no frontmatter title");
    assert_eq!(index.out.homes[0].kind, "readme");
    assert_eq!(index.out.homes[0].page_id.as_deref(), Some(format!("{label}/README.md").as_str()));
    let json = serde_json::to_string(&index.out).unwrap();
    assert!(!json.contains("Rotate every key"), "bodies never cross");
    assert!(json.contains("\"relPath\"") && json.contains("\"baseId\"") && json.contains("\"oversizeSkipped\""));
    // The status a manager page shows.
    let status = base_status(&base, Some(&index));
    assert!(status.active);
    assert_eq!((status.file_count, status.oversize_skipped, status.roots_missing, status.cap_reached), (3, 1, 0, false));
    assert_eq!(status.roots[0].home, Some("readme"));
    assert_eq!(status.roots[0].home_path.as_deref(), Some("README.md"));
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn sections_are_read_by_id_capped_and_unknown_ids_are_left_out() {
    let (root, base) = sample_base();
    let index = build_base_index(&base);
    let label = root.file_name().unwrap().to_string_lossy().into_owned();
    let ids = vec![
        format!("{label}/security.md#key-rotation"),
        format!("{label}/security.md#nothing"),
        "../../etc/passwd".to_string(),
        format!("{label}/guides/notes.txt"),
        format!("{label}/big.md"),
        format!("{label}/security.md#key-rotation"),
        format!("{label}/guides/Setup.md"),
    ];
    let got = read_sections(&index, &ids);
    assert_eq!(got.len(), 2, "unknown, txt, oversize and repeated ids are omitted: {got:?}");
    assert_eq!(got[0].id, format!("{label}/security.md#key-rotation"));
    assert_eq!(got[0].heading.as_deref(), Some("Key rotation"));
    assert_eq!(got[0].title, "Security");
    assert_eq!(got[0].rel_path, "security.md");
    assert_eq!(got[0].text, "## Key rotation\nRotate every key each 90 days. Rotation is logged.\n\n");
    assert!(!got[0].truncated);
    assert_eq!(got[1].heading, None, "a page id is the whole page");
    assert!(got[1].text.starts_with("Preamble text about setup."));
    // The 24 KB cap, set on a char boundary.
    write(&root, "long.md", &format!("# Long\n{}\n", "é".repeat(20_000)));
    let index = build_base_index(&base);
    let long = read_sections(&index, &[format!("{label}/long.md#long")]);
    assert_eq!(long.len(), 1);
    assert!(long[0].truncated);
    assert!(long[0].text.len() <= DOCS_MAX_SECTION_BYTES && long[0].text.len() >= DOCS_MAX_SECTION_BYTES - 1);
    assert!(long[0].text.ends_with('é'));
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn keyword_search_ranks_the_files_with_the_shared_rules() {
    let (root, base) = sample_base();
    let index = build_base_index(&base);
    let label = root.file_name().unwrap().to_string_lossy().into_owned();
    let got = keyword_search(&index, "How do I rotate the key rotation?");
    assert_eq!(got[0].id, format!("{label}/security.md#key-rotation"));
    assert_eq!(got[0].heading.as_deref(), Some("Key rotation"));
    assert!(keyword_search(&index, "").is_empty());
    assert!(keyword_search(&index, "zzzznotfound").is_empty());
    // Preamble text is ranked under the bare page id; a code fence is not a heading.
    let setup = keyword_search(&index, "preamble");
    assert_eq!(setup.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec![format!("{label}/guides/Setup.md")]);
    assert!(setup[0].heading.is_none());
    // The merge keeps the order the single-pass ranking would give.
    let all = keyword_search(&index, "setup");
    let scores: Vec<u32> = all.iter().map(|r| r.score).collect();
    assert!(scores.windows(2).all(|w| w[0] >= w[1]), "{scores:?}");
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn the_walk_stops_at_the_cap_and_says_so() {
    let root = temp_dir("cap");
    for i in 0..(DOCS_MAX_FILES + 10) {
        write(&root, &format!("d{}/f{i}.md", i % 7), "x");
    }
    let base = base("cap", &[root.as_path()]);
    let index = build_base_index(&base);
    assert_eq!(index.out.pages.len(), DOCS_MAX_FILES);
    assert!(index.out.truncated);
    assert!(index.roots[0].cap_reached);
    assert!(base_status(&base, Some(&index)).cap_reached);
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn the_walk_reuses_walk_markdown_and_skips_links_hidden_and_node_modules() {
    let (root, base) = sample_base();
    let outside = temp_dir("walk-outside");
    write(&outside, "elsewhere.md", "# Elsewhere\n");
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&outside, root.join("linked")).unwrap();
        std::os::unix::fs::symlink(outside.join("elsewhere.md"), root.join("file-link.md")).unwrap();
    }
    let index = build_base_index(&base);
    for p in &index.out.pages {
        assert!(!p.rel_path.contains(".hidden") && !p.rel_path.contains("node_modules") && !p.rel_path.contains("linked") && p.rel_path != "file-link.md", "{}", p.rel_path);
    }
    let _ = stdfs::remove_dir_all(&root);
    let _ = stdfs::remove_dir_all(&outside);
}

#[test]
fn several_roots_get_unique_labels_and_a_missing_root_is_reported_not_deleted() {
    let a = temp_dir("multi-a");
    let b = temp_dir("multi-b");
    write(&a, "docs/one.md", "# One\n");
    write(&b, "docs/two.md", "# Two\n");
    let missing = a.join("not-there");
    let cfg = base("multi", &[a.join("docs").as_path(), missing.as_path(), b.join("docs").as_path()]);
    let index = build_base_index(&cfg);
    let ids: Vec<&str> = index.out.pages.iter().map(|p| p.id.as_str()).collect();
    // The labels are decided over every configured root, so a missing one does not shift the others.
    assert_eq!(ids, vec!["docs/one.md", "docs-2/two.md"]);
    let status = base_status(&cfg, Some(&index));
    assert!(status.active);
    assert_eq!(status.roots_missing, 1);
    assert!(!status.roots[1].found);
    let _ = stdfs::remove_dir_all(&a);
    let _ = stdfs::remove_dir_all(&b);
}

#[test]
fn a_base_with_no_folder_found_is_not_active() {
    let gone = std::env::temp_dir().join("mikedown-docs-definitely-not-there");
    let cfg = base("gone", &[gone.as_path()]);
    let index = build_base_index(&cfg);
    assert!(!index.active());
    assert!(!base_status(&cfg, Some(&index)).active);
    let off = DocBase { enabled: false, ..cfg };
    assert!(!base_status(&off, None).active);
}

#[test]
fn a_changed_config_key_means_a_new_index() {
    let a = base("k", &[Path::new("/a")]);
    let b = base("k", &[Path::new("/a"), Path::new("/b")]);
    let c = DocBase { home_file: Some("HOME.md".into()), ..a.clone() };
    assert_ne!(config_key(&a), config_key(&b));
    assert_ne!(config_key(&a), config_key(&c));
    assert_eq!(config_key(&a), config_key(&a.clone()));
}

// ── Watching ────────────────────────────────────────────────────────────────

#[test]
fn only_indexable_changes_are_relevant() {
    let root = Path::new("/r");
    assert!(relevant(root, "create", "/r/new.md"));
    assert!(relevant(root, "modify", "/r/sub/a.MD"));
    assert!(!relevant(root, "modify", "/r/sub/a.png"), "a modified non-markdown file");
    assert!(relevant(root, "remove", "/r/sub"), "a removed folder");
    assert!(!relevant(root, "create", "/r/.git/x.md"), "hidden folder");
    assert!(!relevant(root, "create", "/r/node_modules/x/readme.md"));
    assert!(!relevant(root, "create", "/r/.doc.md.mikedown-1-2.tmp"), "the app's own temp file");
}

/// Two roots watched at once, each recursively and each with its own handle,
/// next to a third watcher on the same folder the way the tree's would be: a
/// change under one root reaches only that root's callback, and dropping one
/// handle leaves the others running.
#[test]
fn several_recursive_watchers_run_side_by_side() {
    let a = temp_dir("watch-a");
    let b = temp_dir("watch-b");
    stdfs::create_dir_all(a.join("deep/er")).unwrap();
    let make = |tag: &'static str| {
        let (tx, rx) = mpsc::channel::<(&'static str, String)>();
        let tx = std::sync::Mutex::new(tx);
        let tx = std::sync::Arc::new(tx);
        let cb = move |s: Signal| {
            if let Signal::Change(c) = s {
                let _ = tx.lock().unwrap().send((tag, c.path));
            }
        };
        (cb, rx)
    };
    let (cb_a, rx_a) = make("a");
    let (cb_b, rx_b) = make("b");
    let (cb_tree, rx_tree) = make("tree");
    let (handle_a, _) = start_with(&a, Mode::Native, RecursiveMode::Recursive, cb_a).unwrap();
    let (handle_b, _) = start_with(&b, Mode::Native, RecursiveMode::Recursive, cb_b).unwrap();
    let (handle_tree, _) = start_with(&a, Mode::Native, RecursiveMode::NonRecursive, cb_tree).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    write(&a, "deep/er/note.md", "# hi\n");
    let seen = |rx: &mpsc::Receiver<(&'static str, String)>, needle: &str| {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if let Ok((_, path)) = rx.recv_timeout(Duration::from_millis(100)) {
                if path.ends_with(needle) {
                    return true;
                }
            }
        }
        false
    };
    assert!(seen(&rx_a, "note.md"), "the recursive root watcher sees a file two folders down");
    let _ = rx_tree; // the tree's own non-recursive watcher: its events are its business
    drop(handle_tree);
    write(&b, "other.md", "# b\n");
    assert!(seen(&rx_b, "other.md"), "the second root is watched too, and stopping the tree's watcher did not stop it");
    assert!(rx_a.try_recv().map(|(_, p)| !p.ends_with("other.md")).unwrap_or(true), "root a never hears about root b");
    drop(handle_a);
    drop(handle_b);
    let _ = stdfs::remove_dir_all(&a);
    let _ = stdfs::remove_dir_all(&b);
}

#[test]
fn the_state_drops_an_index_when_told() {
    let state = DocsState::default();
    let cfg = base("s", &[Path::new("/definitely/not/there")]);
    let key = config_key(&cfg);
    let generation = state.generation.load(Ordering::SeqCst);
    state.store("s", Arc::new(build_base_index(&cfg)), generation);
    assert!(state.cached("s", &key).is_some());
    assert!(state.cached("s", "other key").is_none(), "a changed config is a miss");
    state.invalidate("s");
    assert!(state.cached("s", &key).is_none());
    // A build that started before the invalidation is not cached.
    state.store("s", Arc::new(build_base_index(&cfg)), generation);
    assert!(state.cached("s", &key).is_none());
}
