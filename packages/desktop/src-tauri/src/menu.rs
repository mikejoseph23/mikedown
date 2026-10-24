//! The native menu bar, as far as M4 needs it. Tauri's default menu binds
//! Cmd+W to Close Window and its Quit item terminates the process without
//! asking (`terminate:` bypasses `ExitRequested`), so both are replaced:
//! Close Tab (Cmd+W) and Quit go to the webview and the quit handshake.
//! The Edit items stay predefined so copy/paste reach the webview on macOS.
//! M8 grows this into the full File / Edit / View / Window / Help bar from
//! the shortcut table.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::commands::multiwindow;

pub const MENU_EVENT: &str = "mikedown:menu";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = app.package_info().name.clone();
    let quit_label = if cfg!(target_os = "macos") { format!("Quit {name}") } else { "Exit".to_string() };

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "newDocument", "New Document", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "newWindow", "New Window", true, Some("CmdOrCtrl+Shift+N"))?,
            &MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "openFolder", "Open Folder…", true, Some("CmdOrCtrl+Alt+O"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "saveAs", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(app, "saveAll", "Save All", true, Some("CmdOrCtrl+Alt+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &Submenu::with_items(
                app,
                "Export",
                true,
                &[
                    &MenuItem::with_id(app, "exportHtml", "HTML…", true, None::<&str>)?,
                    &MenuItem::with_id(app, "exportPdf", "PDF…", true, None::<&str>)?,
                ],
            )?,
            &MenuItem::with_id(app, "print", "Print…", true, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "closeTab", "Close Tab", true, Some("CmdOrCtrl+W"))?,
            &MenuItem::with_id(app, "closeWindow", "Close Window", true, Some("CmdOrCtrl+Shift+W"))?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::separator(app)?,
            #[cfg(not(target_os = "macos"))]
            &MenuItem::with_id(app, "quit", &quit_label, true, None::<&str>)?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "searchFolder", "Search in Folder…", true, Some("CmdOrCtrl+Shift+F"))?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "toggleSource", "Toggle Source Mode", true, Some("CmdOrCtrl+/"))?,
            &MenuItem::with_id(app, "toggleSidebar", "Toggle Folder Sidebar", true, None::<&str>)?,
            &MenuItem::with_id(app, "showVersions", "Show Versions", true, Some("CmdOrCtrl+Shift+H"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "splitRight", "Split Right", true, Some("CmdOrCtrl+\\"))?,
            &MenuItem::with_id(app, "splitDown", "Split Down", true, Some("CmdOrCtrl+Shift+\\"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "nextTab", "Next Tab", true, Some("Ctrl+Tab"))?,
            &MenuItem::with_id(app, "prevTab", "Previous Tab", true, Some("Ctrl+Shift+Tab"))?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "openSettings", "Settings…", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", &quit_label, true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])?;
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file, &edit, &view, &window])?;
    Ok(menu)
}

/// Route a menu click: quit runs the handshake here, everything else is an
/// app command name (the same ids as `src/menu/shortcuts.ts`) sent to the
/// focused window as a `mikedown:menu` event.
pub fn handle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "quit" => multiwindow::request_quit(app),
        "newWindow" => {
            let _ = multiwindow::create_window(app, None, Vec::new());
        }
        other => {
            let target = multiwindow::focused_label(app)
                .or_else(|| app.webview_windows().keys().next().cloned());
            if let Some(label) = target {
                let _ = app.emit_to(label.as_str(), MENU_EVENT, other.to_string());
            }
        }
    }
}
