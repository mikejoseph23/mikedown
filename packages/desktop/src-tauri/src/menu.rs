//! The native menu bar (M8, edge case 23).
//!
//! The menu is data owned by the webview: `src/menu/shortcuts.ts` is the one
//! table of commands, labels, `CmdOrCtrl` accelerators and `when` clauses,
//! and `src/menu/menuSpec.ts` arranges it into menus per platform. Each
//! window sends that spec with `menu_set` when it boots (an identical spec is
//! not rebuilt), the focused window keeps the enabled state current with
//! `menu_update`, and `menu_set_recents` refills File > Open Recent.
//!
//! Until the first spec arrives (the page is still loading) a small
//! bootstrap menu stands in: Settings, Quit, New/Close Window and the native
//! Edit items, so the clipboard and Cmd+Q work from the first frame.
//!
//! Tauri's default menu binds Cmd+W to Close Window and its Quit item
//! terminates without asking (`terminate:` bypasses `ExitRequested`), so
//! neither is used: Quit goes through the quit handshake here, every other
//! item id is an app command name sent to the focused window as a
//! `mikedown:menu` event. Ids kept from M4/M7/M9: `quit`, `newWindow`,
//! `closeTab`, `closeWindow`, `searchFolder`, `exportHtml`, `exportPdf`,
//! `print`, `openSettings`, `splitRight`, `splitDown`, `nextTab`, `prevTab`.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::commands::multiwindow;

pub const MENU_EVENT: &str = "mikedown:menu";
pub const OPEN_RECENT_ID: &str = "openRecent";

/// One node of the spec `menuSpec.ts` builds (`kind` tags the variant).
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MenuNode {
    Item {
        id: String,
        label: String,
        #[serde(default)]
        accelerator: Option<String>,
        #[serde(default)]
        enabled: Option<bool>,
    },
    Separator,
    Predefined {
        role: String,
    },
    Submenu {
        #[serde(default)]
        id: Option<String>,
        label: String,
        items: Vec<MenuNode>,
        #[serde(default)]
        role: Option<String>,
    },
}

/// The last spec applied, so windows booting with the same spec skip the rebuild.
#[derive(Default)]
pub struct MenuState {
    applied: Mutex<Option<String>>,
}

pub const PREDEFINED_ROLES: &[&str] = &[
    "about", "services", "hide", "hideOthers", "showAll", "cut", "copy", "paste", "selectAll",
    "minimize", "maximize", "fullscreen", "bringAllToFront",
];

/// Every item and submenu id, depth first.
pub fn ids(nodes: &[MenuNode]) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(nodes: &[MenuNode], out: &mut Vec<String>) {
        for n in nodes {
            match n {
                MenuNode::Item { id, .. } => out.push(id.clone()),
                MenuNode::Submenu { id, items, .. } => {
                    if let Some(id) = id {
                        out.push(id.clone());
                    }
                    walk(items, out);
                }
                _ => {}
            }
        }
    }
    walk(nodes, &mut out);
    out
}

/// The accelerator grammar muda accepts, for the keys the table uses:
/// modifiers joined by `+`, then one key. Used to reject a bad spec early
/// (tests) and to drop a bad accelerator instead of the whole item.
pub fn valid_accelerator(acc: &str) -> bool {
    let parts: Vec<&str> = acc.split('+').collect();
    let Some((key, mods)) = parts.split_last() else { return false };
    let mods_ok = mods.iter().all(|m| {
        matches!(
            m.to_ascii_lowercase().as_str(),
            "cmdorctrl" | "commandorcontrol" | "cmd" | "command" | "super" | "ctrl" | "control" | "shift" | "alt" | "option"
        )
    });
    let key_ok = match *key {
        k if k.len() == 1 => k.chars().all(|c| c.is_ascii_alphanumeric() || ",./\\;=-'`[]".contains(c)),
        k => {
            let k = k.to_ascii_lowercase();
            matches!(k.as_str(), "tab" | "pageup" | "pagedown" | "enter" | "space" | "escape" | "backspace" | "delete" | "home" | "end")
                || (k.starts_with('f') && k[1..].parse::<u8>().map(|n| (1..=24).contains(&n)).unwrap_or(false))
        }
    };
    !mods.is_empty() && mods_ok && key_ok || (mods.is_empty() && key.len() > 1 && key_ok)
}

/// Problems with a spec: duplicate ids, unknown predefined roles, bad accelerators.
pub fn validate(nodes: &[MenuNode]) -> Vec<String> {
    let mut problems = Vec::new();
    let mut seen = HashSet::new();
    for id in ids(nodes) {
        if !seen.insert(id.clone()) {
            problems.push(format!("duplicate id {id}"));
        }
    }
    fn walk(nodes: &[MenuNode], problems: &mut Vec<String>, accels: &mut HashMap<String, String>) {
        for n in nodes {
            match n {
                MenuNode::Item { id, accelerator: Some(acc), .. } => {
                    if !valid_accelerator(acc) {
                        problems.push(format!("{id}: bad accelerator {acc}"));
                    }
                    if let Some(other) = accels.insert(acc.to_ascii_lowercase(), id.clone()) {
                        problems.push(format!("{id} and {other} share {acc}"));
                    }
                }
                MenuNode::Predefined { role } if !PREDEFINED_ROLES.contains(&role.as_str()) => {
                    problems.push(format!("unknown predefined role {role}"));
                }
                MenuNode::Submenu { items, .. } => walk(items, problems, accels),
                _ => {}
            }
        }
    }
    walk(nodes, &mut problems, &mut HashMap::new());
    problems
}

fn predefined<R: Runtime>(app: &AppHandle<R>, role: &str) -> tauri::Result<Option<PredefinedMenuItem<R>>> {
    Ok(Some(match role {
        "about" => PredefinedMenuItem::about(app, None, None)?,
        "services" => PredefinedMenuItem::services(app, None)?,
        "hide" => PredefinedMenuItem::hide(app, None)?,
        "hideOthers" => PredefinedMenuItem::hide_others(app, None)?,
        "showAll" => PredefinedMenuItem::show_all(app, None)?,
        "cut" => PredefinedMenuItem::cut(app, None)?,
        "copy" => PredefinedMenuItem::copy(app, None)?,
        "paste" => PredefinedMenuItem::paste(app, None)?,
        "selectAll" => PredefinedMenuItem::select_all(app, None)?,
        "minimize" => PredefinedMenuItem::minimize(app, None)?,
        "maximize" => PredefinedMenuItem::maximize(app, None)?,
        "fullscreen" => PredefinedMenuItem::fullscreen(app, None)?,
        "bringAllToFront" => PredefinedMenuItem::bring_all_to_front(app, None)?,
        _ => return Ok(None),
    }))
}

fn menu_item<R: Runtime>(app: &AppHandle<R>, id: &str, label: &str, accelerator: Option<&str>, enabled: bool) -> tauri::Result<MenuItem<R>> {
    let accel = accelerator.filter(|a| valid_accelerator(a));
    match MenuItem::with_id(app, id, label, enabled, accel) {
        Ok(item) => Ok(item),
        // An accelerator the platform rejects loses the chord, not the item.
        Err(_) if accel.is_some() => MenuItem::with_id(app, id, label, enabled, None::<&str>),
        Err(e) => Err(e),
    }
}

fn append_node<R: Runtime>(app: &AppHandle<R>, parent: &Submenu<R>, node: &MenuNode) -> tauri::Result<()> {
    match node {
        MenuNode::Item { id, label, accelerator, enabled } => {
            parent.append(&menu_item(app, id, label, accelerator.as_deref(), enabled.unwrap_or(true))?)
        }
        MenuNode::Separator => parent.append(&PredefinedMenuItem::separator(app)?),
        MenuNode::Predefined { role } => match predefined(app, role)? {
            Some(item) => parent.append(&item),
            None => Ok(()),
        },
        MenuNode::Submenu { id, label, items, role } => parent.append(&build_submenu(app, id.as_deref(), label, items, role.as_deref())?),
    }
}

fn build_submenu<R: Runtime>(app: &AppHandle<R>, id: Option<&str>, label: &str, items: &[MenuNode], role: Option<&str>) -> tauri::Result<Submenu<R>> {
    let sub = match id {
        Some(id) => Submenu::with_id(app, id, label, true)?,
        None => Submenu::new(app, label, true)?,
    };
    for child in items {
        append_node(app, &sub, child)?;
    }
    #[cfg(target_os = "macos")]
    match role {
        Some("window") => sub.set_as_windows_menu_for_nsapp()?,
        Some("help") => sub.set_as_help_menu_for_nsapp()?,
        _ => {}
    }
    #[cfg(not(target_os = "macos"))]
    let _ = role;
    Ok(sub)
}

/// A Tauri menu from a spec. Top-level nodes are the menus of the bar.
pub fn build_from_spec<R: Runtime>(app: &AppHandle<R>, nodes: &[MenuNode]) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    for node in nodes {
        if let MenuNode::Submenu { id, label, items, role } = node {
            menu.append(&build_submenu(app, id.as_deref(), label, items, role.as_deref())?)?;
        }
    }
    Ok(menu)
}

/// The bootstrap spec: enough menu for the moments before the page sends its own.
pub fn bootstrap_spec(mac: bool, app_name: &str) -> Vec<MenuNode> {
    let item = |id: &str, label: &str, acc: Option<&str>| MenuNode::Item {
        id: id.to_string(),
        label: label.to_string(),
        accelerator: acc.map(str::to_string),
        enabled: None,
    };
    let pre = |role: &str| MenuNode::Predefined { role: role.to_string() };
    let sub = |label: &str, items: Vec<MenuNode>| MenuNode::Submenu { id: None, label: label.to_string(), items, role: None };
    let mut file = vec![item("newWindow", "New Window", Some("CmdOrCtrl+Shift+N")), item("closeWindow", "Close Window", Some("CmdOrCtrl+Shift+W"))];
    if !mac {
        file.push(MenuNode::Separator);
        file.push(item("openSettings", "Settings…", Some("CmdOrCtrl+,")));
        file.push(item("quit", "Exit", Some("Alt+F4")));
    }
    let edit = vec![pre("cut"), pre("copy"), pre("paste"), pre("selectAll")];
    let mut out = Vec::new();
    if mac {
        out.push(sub(
            app_name,
            vec![
                pre("about"),
                MenuNode::Separator,
                item("openSettings", "Settings…", Some("CmdOrCtrl+,")),
                MenuNode::Separator,
                pre("hide"),
                pre("hideOthers"),
                pre("showAll"),
                MenuNode::Separator,
                item("quit", &format!("Quit {app_name}"), Some("CmdOrCtrl+Q")),
            ],
        ));
    }
    out.push(sub("File", file));
    out.push(sub("Edit", edit));
    out.push(MenuNode::Submenu {
        id: None,
        label: "Window".to_string(),
        items: vec![pre("minimize"), pre("maximize")],
        role: Some("window".to_string()),
    });
    out
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = app.package_info().name.clone();
    build_from_spec(app, &bootstrap_spec(cfg!(target_os = "macos"), &name))
}

fn walk_items<R: Runtime>(items: Vec<MenuItemKind<R>>, f: &mut dyn FnMut(&MenuItemKind<R>)) {
    for it in items {
        f(&it);
        if let MenuItemKind::Submenu(s) = &it {
            if let Ok(children) = s.items() {
                walk_items(children, f);
            }
        }
    }
}

/// Replace the app menu with the page's spec (skipped when unchanged).
#[tauri::command]
pub fn menu_set<R: Runtime>(app: AppHandle<R>, spec: Vec<MenuNode>) -> Result<bool, String> {
    let json = serde_json::to_string(&spec).map_err(|e| e.to_string())?;
    let state = app.state::<MenuState>();
    let mut applied = state.applied.lock().unwrap();
    if applied.as_deref() == Some(json.as_str()) {
        return Ok(false);
    }
    let problems = validate(&spec);
    if !problems.is_empty() {
        // Still applied: a bad accelerator loses its chord, not the menu.
        eprintln!("[mikedown] menu spec problems: {problems:?}");
    }
    let menu = build_from_spec(&app, &spec).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    *applied = Some(json);
    Ok(true)
}

/// Enable or disable items by id (the focused window's `when` clauses).
#[tauri::command]
pub fn menu_update<R: Runtime>(app: AppHandle<R>, enabled: HashMap<String, bool>) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    let items = menu.items().map_err(|e| e.to_string())?;
    walk_items(items, &mut |it| {
        if let MenuItemKind::MenuItem(m) = it {
            if let Some(on) = enabled.get(m.id().as_ref()) {
                if m.is_enabled().ok() != Some(*on) {
                    let _ = m.set_enabled(*on);
                }
            }
        }
    });
    Ok(())
}

/// Refill File > Open Recent with the given items.
#[tauri::command]
pub fn menu_set_recents<R: Runtime>(app: AppHandle<R>, items: Vec<MenuNode>) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    let mut target: Option<Submenu<R>> = None;
    walk_items(menu.items().map_err(|e| e.to_string())?, &mut |it| {
        if let MenuItemKind::Submenu(s) = it {
            if s.id().as_ref() == OPEN_RECENT_ID {
                target = Some(s.clone());
            }
        }
    });
    let Some(sub) = target else { return Ok(()) };
    for old in sub.items().map_err(|e| e.to_string())? {
        let item: &dyn IsMenuItem<R> = match &old {
            MenuItemKind::MenuItem(m) => m,
            MenuItemKind::Predefined(p) => p,
            MenuItemKind::Submenu(s) => s,
            MenuItemKind::Check(c) => c,
            MenuItemKind::Icon(i) => i,
        };
        let _ = sub.remove(item);
    }
    for node in &items {
        append_node(&app, &sub, node).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Route a menu click: quit runs the handshake here, everything else is an
/// app command name (the ids of `src/menu/shortcuts.ts`, or a recent entry)
/// sent to the focused window as a `mikedown:menu` event.
pub fn handle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "quit" => multiwindow::request_quit(app),
        "newWindow" => {
            let _ = multiwindow::create_window(app, None, Vec::new());
        }
        other => {
            let target = multiwindow::focused_label(app)
                .filter(|l| !l.starts_with("print-"))
                .or_else(|| app.webview_windows().keys().find(|l| !l.starts_with("print-")).cloned());
            if let Some(label) = target {
                let _ = app.emit_to(label.as_str(), MENU_EVENT, other.to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<MenuNode> {
        let path = format!("{}/../test/fixtures/menu/{name}", env!("CARGO_MANIFEST_DIR"));
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"))
    }

    /// Ids other milestones rely on (M4 windows and tabs, M7 search, M9 export).
    const KEPT_IDS: &[&str] = &[
        "quit", "newWindow", "newDocument", "open", "openFolder", "save", "saveAs", "saveAll", "closeTab",
        "closeWindow", "searchFolder", "exportHtml", "exportPdf", "print", "openSettings", "toggleSource",
        "toggleSidebar", "splitRight", "splitDown", "nextTab", "prevTab", OPEN_RECENT_ID,
    ];

    #[test]
    fn page_specs_parse_validate_and_keep_every_id() {
        for name in ["menu-mac.json", "menu-windows.json"] {
            let spec = fixture(name);
            assert_eq!(validate(&spec), Vec::<String>::new(), "{name}");
            let all = ids(&spec);
            for id in KEPT_IDS {
                assert!(all.iter().any(|i| i == id), "{name} lacks {id}");
            }
        }
    }

    #[test]
    fn platform_conventions() {
        let mac = fixture("menu-mac.json");
        let win = fixture("menu-windows.json");
        let labels = |spec: &[MenuNode]| -> Vec<String> {
            spec.iter().filter_map(|n| if let MenuNode::Submenu { label, .. } = n { Some(label.clone()) } else { None }).collect()
        };
        assert_eq!(labels(&mac), ["MikeDown", "File", "Edit", "Format", "View", "Window", "Help"]);
        assert_eq!(labels(&win), ["File", "Edit", "Format", "View", "Window", "Help"]);
        let find = |spec: &[MenuNode], id: &str| -> Option<MenuNode> {
            fn walk(nodes: &[MenuNode], id: &str) -> Option<MenuNode> {
                for n in nodes {
                    match n {
                        MenuNode::Item { id: i, .. } if i == id => return Some(n.clone()),
                        MenuNode::Submenu { items, .. } => {
                            if let Some(f) = walk(items, id) {
                                return Some(f);
                            }
                        }
                        _ => {}
                    }
                }
                None
            }
            walk(spec, id)
        };
        let acc = |n: Option<MenuNode>| if let Some(MenuNode::Item { accelerator, .. }) = n { accelerator } else { None };
        assert_eq!(acc(find(&mac, "openSettings")).as_deref(), Some("CmdOrCtrl+,"));
        assert_eq!(acc(find(&win, "openSettings")).as_deref(), Some("CmdOrCtrl+,"));
        assert_eq!(acc(find(&mac, "quit")).as_deref(), Some("CmdOrCtrl+Q"));
        assert_eq!(acc(find(&win, "quit")).as_deref(), Some("Alt+F4"));
        assert!(find(&win, "about").is_some(), "Windows keeps About under Help");
    }

    #[test]
    fn bootstrap_specs_are_valid() {
        for mac in [true, false] {
            let spec = bootstrap_spec(mac, "MikeDown");
            assert_eq!(validate(&spec), Vec::<String>::new());
            assert!(ids(&spec).contains(&"quit".to_string()));
        }
    }

    #[test]
    fn accelerator_grammar() {
        for ok in ["CmdOrCtrl+S", "CmdOrCtrl+Shift+\\", "Ctrl+Tab", "Ctrl+PageDown", "CmdOrCtrl+,", "CmdOrCtrl+=", "CmdOrCtrl+-", "Alt+F4", "CmdOrCtrl+Alt+0", "CmdOrCtrl+;", "CmdOrCtrl+Shift+."] {
            assert!(valid_accelerator(ok), "{ok}");
        }
        for bad in ["", "S", "Hyper+S", "CmdOrCtrl+", "CmdOrCtrl+Shift+Banana"] {
            assert!(!valid_accelerator(bad), "{bad}");
        }
    }

    #[test]
    fn validate_reports_duplicates_and_unknown_roles() {
        let spec: Vec<MenuNode> = serde_json::from_str(
            r#"[{"kind":"submenu","label":"File","items":[
                {"kind":"item","id":"a","label":"A","accelerator":"CmdOrCtrl+S"},
                {"kind":"item","id":"a","label":"A2"},
                {"kind":"item","id":"b","label":"B","accelerator":"cmdorctrl+s"},
                {"kind":"predefined","role":"teleport"},
                {"kind":"separator"}
            ]}]"#,
        )
        .unwrap();
        let problems = validate(&spec);
        assert!(problems.iter().any(|p| p.contains("duplicate id a")));
        assert!(problems.iter().any(|p| p.contains("share")));
        assert!(problems.iter().any(|p| p.contains("teleport")));
    }
}
