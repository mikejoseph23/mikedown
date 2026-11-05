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

#[test]
fn frontmatter_titles_match_the_fixture() {
    let cases = fixture("titles.json");
    let cases = cases["cases"].as_array().unwrap();
    assert!(cases.len() > 10);
    for case in cases {
        let want = case["title"].as_str().map(str::to_string);
        assert_eq!(frontmatter_title(case["markdown"].as_str().unwrap()), want, "{}", case["name"]);
    }
}

#[test]
fn links_match_the_fixture() {
    let cases = fixture("links.json");
    let cases = cases["cases"].as_array().unwrap();
    assert!(cases.len() > 10);
    for case in cases {
        let got: Vec<(String, String, String)> = extract_links(case["markdown"].as_str().unwrap()).into_iter().map(|l| (l.target, l.text, l.kind.to_string())).collect();
        let want: Vec<(String, String, String)> = case["links"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| (l["target"].as_str().unwrap().to_string(), l["text"].as_str().unwrap().to_string(), l["kind"].as_str().unwrap().to_string()))
            .collect();
        assert_eq!(got, want, "{}", case["name"]);
    }
}

/// Keyword search through a whole host, on files: the same ids and scores in the
/// same order as `keyword-files.json`, which the VS Code host also runs.
#[test]
fn keyword_search_over_files_matches_the_fixture() {
    let f = fixture("keyword-files.json");
    let parent = temp_dir("kwfiles");
    let root = parent.join(f["rootName"].as_str().unwrap());
    for (rel, text) in f["files"].as_object().unwrap() {
        let path = root.join(rel);
        stdfs::create_dir_all(path.parent().unwrap()).unwrap();
        stdfs::write(path, text.as_str().unwrap().as_bytes()).unwrap();
    }
    let index = build_base_index(&base("kw", &[root.as_path()]));
    for q in f["queries"].as_array().unwrap() {
        let query = q["query"].as_str().unwrap();
        let got: Vec<(String, u64)> = keyword_search(&index, query).iter().map(|r| (r.id.clone(), r.score as u64)).collect();
        let want: Vec<(String, u64)> = q["expected"].as_array().unwrap().iter().map(|e| (e["id"].as_str().unwrap().to_string(), e["score"].as_u64().unwrap())).collect();
        assert_eq!(got, want, "query {query:?}");
    }
    let _ = stdfs::remove_dir_all(&parent);
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
            // In document order; the external link is kept (core marks it), the image is not.
            ("guide/setup.md#install".to_string(), "setup".to_string(), "markdown"),
            ("https://x.dev".to_string(), "web".to_string(), "markdown"),
            ("#top".to_string(), "here".to_string(), "markdown"),
            ("Key rotation".to_string(), "Key rotation".to_string(), "wikilink"),
            ("Security#Keys|the keys".to_string(), "the keys".to_string(), "wikilink"),
            ("a b.md".to_string(), "<angle>".to_string(), "markdown"),
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
        // A link that stays inside the root is refused too: the read must be the file that was listed.
        std::os::unix::fs::symlink(root.join("ok.md"), root.join("inside.md")).unwrap();
        assert!(read_checked(&root, &root.join("inside.md")).is_err(), "an in-root symlink");
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

// ── M7: the refusals through `read_sections` and `keyword_search` ───────────

/// Index a folder and return the index with the id of a page.
fn indexed(tag: &str, files: &[(&str, &str)]) -> (PathBuf, BaseIndex, String) {
    let root = temp_dir(tag);
    for (rel, text) in files {
        write(&root, rel, text);
    }
    let index = build_base_index(&base(tag, &[root.as_path()]));
    let label = index.out.roots[0].label.clone();
    (root, index, label)
}

#[test]
fn read_sections_refuses_the_five_cases_after_indexing() {
    let (root, index, label) = indexed("five", &[("page.md", "# Page\ntext\n"), ("grows.md", "# Grows\nsmall\n"), ("swap.md", "# Swap\nx\n")]);
    let outside = temp_dir("five-outside");
    write(&outside, "secret.md", "# Secret\nhunter2\n");
    let ids = |names: &[&str]| names.iter().map(|n| format!("{label}/{n}")).collect::<Vec<_>>();
    assert_eq!(read_sections(&index, &ids(&["page.md"])).len(), 1);
    // An id that is not in the index: a ../ path, an absolute path, a .txt that was never listed, nonsense.
    let hostile = vec![
        format!("{label}/../outside/secret.md"),
        "../../etc/passwd".to_string(),
        format!("{}/secret.md", outside.display()),
        format!("{label}/notes.txt"),
        format!("{label}/nope.md"),
        format!("{label}/page.md#nothing-here"),
        String::new(),
    ];
    assert!(read_sections(&index, &hostile).is_empty());
    // A file that grew to 2 MiB since it was indexed.
    write(&root, "grows.md", &"x".repeat(2 * 1024 * 1024));
    assert!(read_sections(&index, &ids(&["grows.md"])).is_empty(), "2 MiB");
    // A file swapped for a link that leaves the root.
    #[cfg(unix)]
    {
        stdfs::remove_file(root.join("swap.md")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.md"), root.join("swap.md")).unwrap();
        assert!(read_sections(&index, &ids(&["swap.md"])).is_empty(), "a symlink escaping the root");
    }
    assert_eq!(read_sections(&index, &ids(&["page.md"])).len(), 1, "the untouched page still reads");
    let _ = stdfs::remove_dir_all(&root);
    let _ = stdfs::remove_dir_all(&outside);
}

#[test]
fn a_sibling_folder_sharing_the_roots_prefix_is_not_inside_it() {
    let parent = temp_dir("evil");
    let root = parent.join("docs");
    let evil = parent.join("docs-evil");
    write(&root, "page.md", "# Page\nok\n");
    write(&evil, "x.md", "# Evil\nhunter2\n");
    let index = build_base_index(&base("evil", &[root.as_path()]));
    let id = format!("{}/page.md", index.out.roots[0].label);
    assert_eq!(read_sections(&index, &[id.clone()]).len(), 1);
    assert!(read_checked(&root, &evil.join("x.md")).is_err(), "docs-evil is not under docs");
    #[cfg(unix)]
    {
        stdfs::remove_file(root.join("page.md")).unwrap();
        std::os::unix::fs::symlink(evil.join("x.md"), root.join("page.md")).unwrap();
        assert!(read_sections(&index, &[id]).is_empty());
    }
    let _ = stdfs::remove_dir_all(&parent);
}

/// Review fix 1: the read must be the very file the walker listed.
#[cfg(unix)]
#[test]
fn a_file_swapped_for_an_in_root_link_is_refused() {
    let (root, index, label) = indexed("inlink", &[("page.md", "# Page\ntext\n"), ("other.md", "# Other\nother text\n")]);
    let id = format!("{label}/page.md");
    assert_eq!(read_sections(&index, &[id.clone()]).len(), 1);
    stdfs::remove_file(root.join("page.md")).unwrap();
    std::os::unix::fs::symlink(root.join("other.md"), root.join("page.md")).unwrap();
    assert!(read_sections(&index, &[id.clone()]).is_empty(), "the link points inside the root, and is still refused");
    assert!(keyword_search(&index, "other").iter().all(|r| r.page_id != id), "search refuses it too");
    // The real file is still readable under its own name.
    assert_eq!(read_sections(&index, &[format!("{label}/other.md")]).len(), 1);
    let _ = stdfs::remove_dir_all(&root);
}

/// Review fix 1: a parent folder swapped for a link, to another folder inside the root.
#[cfg(unix)]
#[test]
fn a_parent_folder_swapped_for_a_link_is_refused() {
    let (root, index, label) = indexed("parentlink", &[("sub/page.md", "# Page\nreal\n"), ("sub2/page.md", "# Page\nimpostor\n")]);
    let id = format!("{label}/sub/page.md");
    assert_eq!(read_sections(&index, &[id.clone()])[0].text, "# Page\nreal\n");
    stdfs::remove_dir_all(root.join("sub")).unwrap();
    std::os::unix::fs::symlink(root.join("sub2"), root.join("sub")).unwrap();
    assert!(read_sections(&index, &[id]).is_empty());
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn a_file_deleted_since_indexing_is_left_out_without_a_crash() {
    let (root, index, label) = indexed("deleted", &[("gone.md", "# Gone\nneedle\n"), ("kept.md", "# Kept\nneedle\n")]);
    stdfs::remove_file(root.join("gone.md")).unwrap();
    let got = read_sections(&index, &[format!("{label}/gone.md"), format!("{label}/kept.md")]);
    assert_eq!(got.iter().map(|s| s.page_id.as_str()).collect::<Vec<_>>(), vec![format!("{label}/kept.md")]);
    assert_eq!(keyword_search(&index, "needle").iter().map(|r| r.page_id.clone()).collect::<Vec<_>>(), vec![format!("{label}/kept.md")]);
    // The whole folder gone: nothing is read and nothing panics.
    let _ = stdfs::remove_dir_all(&root);
    assert!(read_sections(&index, &[format!("{label}/kept.md")]).is_empty());
    assert!(keyword_search(&index, "needle").is_empty());
}

#[test]
fn a_file_that_is_not_utf8_does_not_take_the_request_down() {
    let (root, _first, label) = indexed("badutf", &[("good.md", "# Good\nneedle\n")]);
    let mut bytes = b"# Bad\nneedle \xff\xfe broken\n".to_vec();
    bytes.extend_from_slice(&[0xc3]); // a cut multi-byte sequence at the end
    stdfs::write(root.join("bad.md"), &bytes).unwrap();
    // Indexed after the file exists, so it is a page like any other.
    let index2 = build_base_index(&base("badutf", &[root.as_path()]));
    let ids = vec![format!("{label}/bad.md"), format!("{label}/good.md")];
    let got = read_sections(&index2, &ids);
    assert_eq!(got.len(), 2, "{got:?}");
    assert!(got[0].text.contains('\u{fffd}') && got[0].text.contains("needle"));
    assert_eq!(keyword_search(&index2, "needle").len(), 2);
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn a_markdown_extension_in_any_case_is_read_and_a_double_extension_is_not_listed() {
    let (root, index, label) = indexed("ext", &[("Upper.MD", "# Upper\nx\n"), ("Mixed.Markdown", "# Mixed\ny\n"), ("a.md.txt", "# no\n"), ("b.mdx", "# no\n"), ("c.txt", "no")]);
    let ids: Vec<&str> = index.out.pages.iter().map(|p| p.rel_path.as_str()).collect();
    assert_eq!(ids, vec!["Mixed.Markdown", "Upper.MD"]);
    assert_eq!(read_sections(&index, &[format!("{label}/Upper.MD"), format!("{label}/Mixed.Markdown")]).len(), 2);
    assert!(read_checked(&root, &root.join("a.md.txt")).is_err());
    assert!(read_checked(&root, &root.join("b.mdx")).is_err());
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn an_unknown_or_disabled_base_is_refused_before_any_root_is_touched() {
    let a = base("a", &[Path::new("/a")]);
    let off = DocBase { enabled: false, name: "Off".into(), ..base("off", &[Path::new("/off")]) };
    let bases = vec![a.clone(), off];
    assert_eq!(pick_base(bases.clone(), "a").unwrap().id, "a");
    assert!(pick_base(bases.clone(), "nope").unwrap_err().contains("not in your settings"));
    assert!(pick_base(bases.clone(), "").is_err());
    assert!(pick_base(bases.clone(), "/a").is_err(), "a folder is not a base id");
    assert!(pick_base(bases, "off").unwrap_err().contains("turned off"));
}

/// A missing first root must not shift the labels, and so the ids, of the others.
#[test]
fn a_missing_first_root_does_not_shift_the_other_roots_ids() {
    let parent = temp_dir("missing-first");
    let first = parent.join("a").join("docs");
    let second = parent.join("b").join("docs");
    write(&second, "two.md", "# Two\n");
    let with_first_missing = build_base_index(&base("m", &[first.as_path(), second.as_path()]));
    assert_eq!(with_first_missing.out.pages.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["docs-2/two.md"]);
    write(&first, "one.md", "# One\n");
    let with_both = build_base_index(&base("m", &[first.as_path(), second.as_path()]));
    assert_eq!(with_both.out.pages.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["docs/one.md", "docs-2/two.md"]);
    let _ = stdfs::remove_dir_all(&parent);
}

// ── Refresh and the per-turn walk (decisions 12 and 14, A4) ─────────────────

fn list(state: &DocsState, app_data: &Path, refresh: bool) -> Vec<BaseStatusOut> {
    let bases = bases_from_app_data(app_data).unwrap();
    tauri::async_runtime::block_on(list_bases_with(state, bases, refresh)).unwrap()
}

fn walks(state: &DocsState) -> u64 {
    state.walks.load(Ordering::SeqCst)
}

fn write_bases(app_data: &Path, root: &Path, allow_cloud: bool, enabled: bool, name: &str) {
    let settings = json!({ "ai.docBases": [{ "id": "kb", "name": name, "roots": [root.to_string_lossy()], "allowCloud": allow_cloud, "enabled": enabled }] });
    stdfs::write(app_data.join("settings.json"), settings.to_string()).unwrap();
}

#[test]
fn a_plain_list_after_an_index_exists_walks_nothing_and_refresh_walks_again() {
    let root = temp_dir("plain-root");
    write(&root, "a.md", "# A\n");
    let app_data = temp_dir("plain-data");
    write_bases(&app_data, &root, false, true, "Docs");
    let state = DocsState::default();

    let first = list(&state, &app_data, false);
    assert_eq!(walks(&state), 1, "no index yet: the first call walks");
    assert_eq!(first[0].file_count, 1);
    for _ in 0..3 {
        assert_eq!(list(&state, &app_data, false)[0].file_count, 1);
    }
    assert_eq!(walks(&state), 1, "plain calls on a usable index walk nothing");

    write(&root, "b.md", "# B\n");
    assert_eq!(list(&state, &app_data, false)[0].file_count, 1, "a plain call serves the last known health");
    assert_eq!(walks(&state), 1);
    assert_eq!(list(&state, &app_data, true)[0].file_count, 2, "refresh picks up the file added since");
    assert_eq!(walks(&state), 2);

    // A watcher invalidation makes the next plain call walk.
    write(&root, "c.md", "# C\n");
    state.invalidate("kb");
    assert_eq!(list(&state, &app_data, false)[0].file_count, 3);
    assert_eq!(walks(&state), 3);

    let _ = stdfs::remove_dir_all(&root);
    let _ = stdfs::remove_dir_all(&app_data);
}

#[test]
fn flipping_allow_cloud_or_enabled_shows_on_the_next_plain_list_without_a_walk() {
    let root = temp_dir("a4-root");
    write(&root, "a.md", "# A\n");
    let app_data = temp_dir("a4-data");
    write_bases(&app_data, &root, false, true, "Docs");
    let state = DocsState::default();
    assert!(!list(&state, &app_data, false)[0].base.allow_cloud);
    assert_eq!(walks(&state), 1);

    write_bases(&app_data, &root, true, true, "Docs");
    assert!(list(&state, &app_data, false)[0].base.allow_cloud, "allowCloud is read afresh");
    write_bases(&app_data, &root, true, true, "Renamed");
    assert_eq!(list(&state, &app_data, false)[0].base.name, "Renamed");

    write_bases(&app_data, &root, true, false, "Renamed");
    let off = list(&state, &app_data, false);
    assert!(!off[0].base.enabled && !off[0].active, "enabled is read afresh");
    write_bases(&app_data, &root, true, true, "Renamed");
    let on = list(&state, &app_data, false);
    assert!(on[0].base.enabled && on[0].active);
    assert_eq!(on[0].file_count, 1);
    assert_eq!(walks(&state), 1, "none of the flips walked");

    let _ = stdfs::remove_dir_all(&root);
    let _ = stdfs::remove_dir_all(&app_data);
}

#[test]
fn a_plain_list_notices_a_root_that_vanishes_or_a_base_with_new_roots() {
    let root = temp_dir("gone-root");
    write(&root, "a.md", "# A\n");
    let app_data = temp_dir("gone-data");
    write_bases(&app_data, &root, false, true, "Docs");
    let state = DocsState::default();
    assert!(list(&state, &app_data, false)[0].active);
    stdfs::remove_dir_all(&root).unwrap();
    let after = list(&state, &app_data, false);
    assert!(!after[0].active && after[0].roots_missing == 1, "a vanished root is judged afresh");
    assert_eq!(walks(&state), 2);
    let _ = stdfs::remove_dir_all(&app_data);
}

// ── Hostile input and host hardening (S9, F2, F3, F7, F8, F9) ───────────────

/// Growth, not a wall clock (`helpers/growth.ts` on the TypeScript side): the
/// input grows 4x per step (1/64, 1/16, 1/4, 1 of about 1 MiB); linear work grows
/// about 4x per step and a quadratic scan about 16x. A step over 150 ms must not
/// be 10x its predecessor (best of two looks, the predecessor floored at 5 ms).
/// Climbing from the small end fails a regression in seconds, not minutes.
fn assert_near_linear<T>(name: &str, make: impl Fn(f64) -> T, run: impl Fn(&T)) {
    let time = |input: &T| {
        let t0 = std::time::Instant::now();
        run(input);
        t0.elapsed().as_secs_f64() * 1000.0
    };
    let mut prev: Option<(T, f64)> = None;
    for u in [1.0 / 64.0, 1.0 / 16.0, 1.0 / 4.0, 1.0] {
        let input = make(u);
        let mut ms = time(&input);
        if let Some((prev_input, prev_ms)) = prev.as_mut() {
            if ms >= 150.0 && ms / prev_ms.max(5.0) >= 10.0 {
                ms = ms.min(time(&input));
                *prev_ms = prev_ms.min(time(prev_input));
                assert!(ms / prev_ms.max(5.0) < 10.0, "{name}: {ms:.0} ms at {u} of a MiB, {prev_ms:.0} ms at a quarter of that");
            }
        }
        prev = Some((input, ms));
    }
}

const MIB: usize = 1024 * 1024;

fn rep(s: &str, chars: usize, u: f64) -> String {
    s.repeat((((chars as f64) * u / (s.chars().count() as f64)).round() as usize).max(1))
}

#[test]
fn links_stay_near_linear_on_a_mebibyte_of_one_line() {
    let inputs: Vec<(&str, Box<dyn Fn(f64) -> String>)> = vec![
        ("an opening link then blanks", Box::new(|u| format!("[a]({}x", " ".repeat((MIB as f64 * u) as usize)))),
        ("blank runs after many openings", Box::new(|u| rep(&format!("[a]({}x ", " ".repeat(40)), MIB, u))),
        ("brackets", Box::new(|u| rep("[", MIB, u))),
        ("link openings", Box::new(|u| rep("[a](", MIB, u))),
        ("unclosed angle destinations", Box::new(|u| rep("[a](<", MIB, u))),
        ("unclosed titles", Box::new(|u| rep("[a](x \"", MIB, u))),
        ("images", Box::new(|u| rep("![a](<", MIB, u))),
        ("wikilink openings", Box::new(|u| rep("[[a", MIB, u))),
        ("a long destination", Box::new(|u| format!("[a]({})", "d".repeat((MIB as f64 * u) as usize)))),
        ("backticks", Box::new(|u| rep("`[a](b)", MIB, u))),
    ];
    for (name, make) in inputs {
        assert_near_linear(name, |u| make(u), |md| {
            extract_links(md);
        });
    }
}

#[test]
fn headings_and_sections_stay_near_linear_on_a_mebibyte() {
    let inputs: Vec<(&str, Box<dyn Fn(f64) -> String>)> = vec![
        ("blanks inside a heading", Box::new(|u| format!("# a{}b", " ".repeat((MIB as f64 * u) as usize)))),
        ("closing hashes", Box::new(|u| format!("# a {}", "#".repeat((MIB as f64 * u) as usize)))),
        ("262,144 equal headings", Box::new(|u| rep("# a\n", MIB, u))),
        ("headings with the same slug family", Box::new(|u| rep("# a-1\n# a\n", MIB, u))),
    ];
    for (name, make) in inputs {
        assert_near_linear(name, |u| make(u), |md| {
            split_sections(md);
            headings_with_offsets(md);
        });
    }
}

#[test]
fn slugs_stay_near_linear_for_equal_headings_and_keep_their_old_values() {
    assert_near_linear("docs_slugs", |u| vec!["Setup"; (262_144.0 * u) as usize], |texts| {
        docs_slugs(texts);
    });
    assert_eq!(docs_slugs(&["Setup", "Setup", "Setup", "Setup 1"]), vec!["setup", "setup-1", "setup-2", "setup-1-1"]);
}

#[test]
fn sections_keep_1000_headings_and_clip_their_text_like_the_fixture() {
    let f = fixture("limits.json");
    let many = &f["manyHeadings"];
    let line = many["line"].as_str().unwrap();
    let md: String = (0..many["count"].as_u64().unwrap()).map(|n| line.replace("{n}", &n.to_string())).collect();
    let sections = split_sections(&md);
    assert_eq!(sections.len() as u64, many["sections"].as_u64().unwrap());
    let last = sections.last().unwrap();
    let (_, text, slug) = last.heading.clone().unwrap();
    assert_eq!(slug, many["lastSlug"].as_str().unwrap());
    assert_eq!(text, many["lastHeading"].as_str().unwrap());
    assert!(last.text.ends_with(many["lastTextTail"].as_str().unwrap()));

    let long = &f["longHeading"];
    let md = format!("# {}\nbody\n", long["char"].as_str().unwrap().repeat(long["length"].as_u64().unwrap() as usize));
    let (_, text, slug) = split_sections(&md)[0].heading.clone().unwrap();
    assert_eq!(text.chars().count() as u64, long["textLength"].as_u64().unwrap());
    assert_eq!(slug.chars().count() as u64, long["slugLength"].as_u64().unwrap());

    let wide = &f["longHeadingWide"];
    let md = format!("# {}\n", wide["char"].as_str().unwrap().repeat(wide["length"].as_u64().unwrap() as usize));
    assert_eq!(split_sections(&md)[0].heading.clone().unwrap().1.chars().count() as u64, wide["textCodePoints"].as_u64().unwrap());
}

#[test]
fn bytes_that_are_not_utf8_text_match_the_fixture() {
    let cases = fixture("not-text.json");
    let cases = cases["cases"].as_array().unwrap();
    assert!(cases.len() > 8);
    for case in cases {
        let hex = case["hex"].as_str().unwrap();
        let bytes: Vec<u8> = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect();
        assert_eq!(is_utf8_text(&bytes), case["text"].as_bool().unwrap(), "{}", case["name"]);
    }
}

fn write_bytes(root: &Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    stdfs::create_dir_all(path.parent().unwrap()).unwrap();
    stdfs::write(path, bytes).unwrap();
}

#[test]
fn a_file_that_is_not_utf8_text_is_refused_skipped_and_counted() {
    let root = temp_dir("nottext");
    write(&root, "ok.md", "# Ok\n");
    let mut bom = vec![0xef, 0xbb, 0xbf];
    bom.extend_from_slice(b"# With a UTF-8 mark\n");
    write_bytes(&root, "bom.md", &bom);
    let utf16: Vec<u8> = [0xff, 0xfe].into_iter().chain("# Keys\nAKIAIOSFODNN7EXAMPLE\n".chars().flat_map(|c| [c as u8, 0])).collect();
    write_bytes(&root, "u16.md", &utf16);
    write_bytes(&root, "u32.md", &[0, 0, 0xfe, 0xff, 0, 0, 0, 0x23]);
    write_bytes(&root, "nul.md", b"# a\0b\n");

    assert_eq!(read_checked(&root, &root.join("u16.md")).unwrap_err(), NOT_TEXT_REASON);
    assert_eq!(read_checked(&root, &root.join("nul.md")).unwrap_err(), NOT_TEXT_REASON);
    assert_eq!(read_checked(&root, &root.join("bom.md")).unwrap(), "# With a UTF-8 mark\n");

    let cfg = base("nt", &[root.as_path()]);
    let index = build_base_index(&cfg);
    let ids: Vec<&str> = index.out.pages.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids.len(), 2, "{ids:?}");
    assert_eq!(index.roots[0].not_text_skipped, 3);
    let status = base_status(&cfg, Some(&index));
    assert_eq!(status.not_text_skipped, Some(3));
    assert_eq!(status.roots[0].not_text_skipped, Some(3));
    assert_eq!(status.file_count, 2);
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn the_index_cuts_heading_text_and_link_targets() {
    let root = temp_dir("clip");
    write(&root, "a.md", &format!("# {}\n[a]({}) [[{}]]\n", "h".repeat(900), "t".repeat(900), "w".repeat(250)));
    let index = build_base_index(&base("clip", &[root.as_path()]));
    let page = &index.out.pages[0];
    assert_eq!(page.headings[0].text.chars().count(), 200);
    assert_eq!(page.headings[0].slug, "h".repeat(200));
    assert_eq!(page.links.iter().map(|l| l.target.chars().count()).collect::<Vec<_>>(), vec![500, 250]);
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn the_walk_stops_at_the_folder_cap_and_says_so() {
    let root = temp_dir("dircap");
    for i in 0..30 {
        write(&root, &format!("d{i}/page.md"), "# P\n");
    }
    let cfg = base("dircap", &[root.as_path()]);
    let index = build_base_index_with(&cfg, Duration::from_secs(60), 10);
    assert!(index.roots[0].dir_cap_reached);
    assert!(index.out.pages.len() < 30);
    let status = base_status(&cfg, Some(&index));
    assert_eq!(status.dir_cap_reached, Some(true));
    assert_eq!(status.roots[0].dir_cap_reached, Some(true));
    let full = build_base_index_with(&cfg, Duration::from_secs(60), 1000);
    assert!(!full.roots[0].dir_cap_reached);
    assert_eq!(full.out.pages.len(), 30);
    assert_eq!(base_status(&cfg, Some(&full)).dir_cap_reached, None);
    let _ = stdfs::remove_dir_all(&root);
}

#[test]
fn a_build_past_its_time_budget_ends_and_says_so() {
    let root = temp_dir("budget");
    for i in 0..50 {
        write(&root, &format!("f{i}.md"), "# P\n");
    }
    let cfg = base("budget", &[root.as_path()]);
    let index = build_base_index_with(&cfg, Duration::ZERO, DOCS_MAX_DIRS);
    assert!(index.timed_out);
    assert!(index.out.pages.is_empty());
    assert!(index.active(), "the root was found, only the reading ran out of time");
    let status = base_status(&cfg, Some(&index));
    assert_eq!(status.timed_out, Some(true));
    let ok = build_base_index_with(&cfg, Duration::from_secs(60), DOCS_MAX_DIRS);
    assert!(!ok.timed_out);
    assert_eq!(base_status(&cfg, Some(&ok)).timed_out, None);
    let _ = stdfs::remove_dir_all(&root);
}

// F8: the fs scope

fn trusted(keys: &[&str]) -> Mutex<HashSet<String>> {
    Mutex::new(keys.iter().map(|k| doc_root_key(k)).collect())
}

#[test]
fn a_root_inside_home_needs_nothing_and_one_outside_needs_a_native_yes() {
    let home = temp_dir("f8-home");
    let inside = home.join("notes");
    stdfs::create_dir_all(&inside).unwrap();
    let outside = temp_dir("f8-outside");
    let inside_s = inside.to_string_lossy().into_owned();
    let outside_s = outside.to_string_lossy().into_owned();

    let empty = HashSet::new();
    assert_eq!(classify_root(&inside_s, Some(&home), &empty), RootDecision::UnderHome);
    assert_eq!(classify_root(&outside_s, Some(&home), &empty), RootDecision::NeedsConfirm);
    assert_eq!(classify_root(&outside_s, None, &empty), RootDecision::NeedsConfirm, "no home known: ask");
    let mut known = HashSet::new();
    known.insert(doc_root_key(&outside_s));
    assert_eq!(classify_root(&outside_s, Some(&home), &known), RootDecision::Trusted);
    let _ = (stdfs::remove_dir_all(&home), stdfs::remove_dir_all(&outside));
}

#[test]
fn a_root_set_by_the_webview_joins_the_scope_only_if_trusted_or_confirmed() {
    let home = temp_dir("f8b-home");
    let outside_start = temp_dir("f8b-start");
    let outside_picked = temp_dir("f8b-picked");
    let outside_new = temp_dir("f8b-new");
    let cfg = |roots: &[&Path]| vec![base("b", roots)];
    let s = |p: &Path| p.to_string_lossy().into_owned();

    // The startup set and a pick are allowed without a question.
    let trust = trusted(&[&s(&outside_start), &s(&outside_picked)]);
    let asked = std::cell::RefCell::new(Vec::new());
    let ask = |root: &str| {
        asked.borrow_mut().push(root.to_string());
        false
    };
    let got = roots_to_allow(&cfg(&[&outside_start, &outside_picked]), Some(&home), &trust, ask);
    assert_eq!(got.len(), 2);
    assert!(asked.borrow().is_empty());

    // A root the webview just made up: asked, and refused means not added and not trusted.
    let got = roots_to_allow(&cfg(&[&outside_new]), Some(&home), &trust, |root| {
        asked.borrow_mut().push(root.to_string());
        false
    });
    assert!(got.is_empty());
    assert_eq!(asked.borrow().len(), 1);
    assert!(!trust.lock().unwrap().contains(&doc_root_key(&s(&outside_new))));

    // Confirmed: added, and trusted from then on, so the next sync does not ask again.
    let got = roots_to_allow(&cfg(&[&outside_new]), Some(&home), &trust, |_| true);
    assert_eq!(got, vec![s(&outside_new)]);
    let got = roots_to_allow(&cfg(&[&outside_new]), Some(&home), &trust, |_| panic!("asked twice"));
    assert_eq!(got, vec![s(&outside_new)]);

    // A root that does not exist is never asked about or added.
    let missing = home.join("gone");
    assert!(roots_to_allow(&cfg(&[&missing]), Some(&home), &trust, |_| panic!("asked about a missing folder")).is_empty());
    for d in [&home, &outside_start, &outside_picked, &outside_new] {
        let _ = stdfs::remove_dir_all(d);
    }
}

#[cfg(unix)]
#[test]
fn a_link_inside_home_that_points_outside_it_is_outside() {
    let home = temp_dir("f8c-home");
    let elsewhere = temp_dir("f8c-else");
    std::os::unix::fs::symlink(&elsewhere, home.join("shortcut")).unwrap();
    let link = home.join("shortcut").to_string_lossy().into_owned();
    assert_eq!(classify_root(&link, Some(&home), &HashSet::new()), RootDecision::NeedsConfirm);
    let _ = (stdfs::remove_dir_all(&home), stdfs::remove_dir_all(&elsewhere));
}
