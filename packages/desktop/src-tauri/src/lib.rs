//! MikeDown Desktop: Tauri 2 shell around `@mikedown/core`.
//!
//! Plugin registration, windows, the launch-file queue, the menu bar and the
//! commands under `src/commands/` (file I/O and the folder tree's operations,
//! the per-directory watcher, native window state, hot-exit backups and
//! sessions, multi-window routing and the quit handshake, folder search,
//! the self-updater, the AI engine commands).

use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

mod commands;
mod menu;

/// What the webview is running on, for `docs/webview-notes.md`.
#[derive(Serialize)]
struct HostInfo {
    os: String,
    arch: String,
    tauri_version: String,
    webview_version: Option<String>,
    debug: bool,
}

#[tauri::command]
fn host_info() -> HostInfo {
    HostInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        webview_version: tauri::webview_version().ok(),
        debug: cfg!(debug_assertions),
    }
}

/// The smoke harness (`src/smoke/harness.ts`) posts its JSON report here.
/// With `MIKEDOWN_SMOKE_DIR` set the report is written to `<dir>/<name>.json`;
/// it is always echoed to stdout so `tauri dev` shows it. Inert otherwise.
#[tauri::command]
fn smoke_report(name: String, report: String) -> Result<Option<String>, String> {
    println!("[mikedown-smoke:{name}]\n{report}\n[/mikedown-smoke:{name}]");
    let Some(dir) = std::env::var_os("MIKEDOWN_SMOKE_DIR") else {
        return Ok(None);
    };
    let safe: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path: PathBuf = PathBuf::from(dir).join(format!("{safe}.json"));
    std::fs::write(&path, report).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single instance must be the first plugin so a second launch hands its
    // arguments (the double-clicked file, edge case 6) to the running app.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = commands::launch::paths_from_args(
                argv.into_iter().skip(1),
                Some(std::path::Path::new(&cwd)),
            );
            if paths.is_empty() {
                let label = commands::multiwindow::focused_label(app).unwrap_or_else(|| "main".to_string());
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            } else {
                commands::launch::queue_open(app, paths);
            }
        }));
    }

    // Channel `store` (Mac App Store / Microsoft Store builds) leaves the
    // updater plugin uninitialized: the store updates the app, not us.
    if commands::updater::channel() == commands::updater::CHANNEL_DIRECT {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let app = builder
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        // Update-found notification when no MikeDown window is focused (U2).
        .plugin(tauri_plugin_notification::init())
        .manage(commands::launch::LaunchQueue::default())
        .manage(commands::watcher::Watchers::default())
        .manage(commands::appdata::AppData::default())
        .manage(commands::multiwindow::WindowRegistry::default())
        .manage(commands::multiwindow::QuitState::default())
        .manage(commands::print::PrintJobs::default())
        .manage(commands::updater::UpdaterState::default())
        .manage(commands::search::Searches::default())
        .manage(commands::ai::AiState::new())
        .manage(menu::MenuState::default())
        .menu(|handle| menu::build(handle))
        .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()))
        .setup(|app| {
            // Files named on the command line (Windows file associations,
            // `open -a MikeDown file.md`, `tauri dev -- file.md`).
            let cwd = std::env::current_dir().ok();
            let paths = commands::launch::paths_from_args(std::env::args().skip(1), cwd.as_deref());
            commands::launch::queue_open(app.handle(), paths);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_info,
            smoke_report,
            commands::fs::read_text,
            commands::fs::write_text,
            commands::fs::stat,
            commands::fs::exists,
            commands::fs::list_dir,
            commands::fs::mkdir,
            commands::fs::read_bytes,
            commands::fs::write_bytes,
            commands::fs::open_in_default_app,
            commands::fs::allow_asset,
            commands::fs::allow_folder,
            commands::fs::rename,
            commands::fs::create_file,
            commands::fs::create_dir,
            commands::fs::move_path,
            commands::fs::copy_path,
            commands::fs::trash,
            commands::fs::list_markdown,
            commands::fs::reveal_path,
            commands::fs::modifier_state,
            commands::watcher::watch,
            commands::watcher::unwatch,
            commands::watcher::unwatch_all,
            commands::window::set_document_edited,
            commands::window::set_represented_file,
            commands::launch::frontend_ready,
            commands::appdata::backup_write,
            commands::appdata::backup_remove,
            commands::appdata::backup_list,
            commands::appdata::session_write,
            commands::appdata::session_read,
            commands::appdata::session_remove,
            commands::appdata::session_list,
            commands::multiwindow::report_window_state,
            commands::multiwindow::new_window,
            commands::multiwindow::window_count,
            commands::multiwindow::quit_reply,
            commands::multiwindow::request_quit_cmd,
            commands::print::print_open,
            commands::print::print_take,
            commands::print::print_report,
            commands::print::print_close,
            commands::settings::settings_read,
            commands::settings::settings_write,
            commands::settings::open_default_apps_settings,
            commands::search::search_folder,
            commands::search::search_cancel,
            commands::versions::versions_list,
            commands::versions::versions_snapshot,
            commands::versions::versions_prune,
            commands::versions::versions_move,
            menu::menu_set,
            menu::menu_update,
            menu::menu_set_recents,
            commands::recents::recents_read,
            commands::recents::recents_write,
            commands::recents::recents_allow,
            commands::recents::welcome_file,
            commands::updater::updater_claim,
            commands::updater::updater_check,
            commands::updater::updater_pending,
            commands::updater::updater_install,
            commands::updater::updater_log,
            commands::updater::updater_download,
            commands::updater::updater_skip,
            commands::updater::updater_snooze,
            commands::updater::updater_status,
            commands::ai::ai_complete,
            commands::ai::ai_cancel,
            commands::ai::ai_list_engines,
            commands::ai::ai_test_engine,
            commands::ai::ai_discover_models,
            commands::ai::ai_set_secret,
            commands::ai::ai_request_cloud_consent,
        ])
        .build(tauri::generate_context!())
        .expect("error while building MikeDown");

    app.run(|app_handle, event| {
        match &event {
            // macOS: a double-clicked file or a Dock drop while the app runs
            // (or at launch, before the webview exists; the queue holds it).
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let paths: Vec<PathBuf> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
                commands::launch::queue_open(app_handle, paths);
            }
            // The last window closed, or a quit was requested by the OS.
            // Nothing is lost either way: a window only closes after its own
            // dirty-file dialog, and the quit handshake (`request_quit`) sets
            // `approved` before it calls `exit`. A programmatic exit that did
            // not come through the handshake is held while the handshake
            // asks every window.
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                let quit = app_handle.state::<commands::multiwindow::QuitState>();
                let approved = quit.approved.load(std::sync::atomic::Ordering::SeqCst);
                if !approved && code.is_some() && !app_handle.webview_windows().is_empty() {
                    api.prevent_exit();
                    commands::multiwindow::request_quit(app_handle);
                }
            }
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } => {
                app_handle.state::<commands::multiwindow::WindowRegistry>().remove(label);
                commands::launch::forget(app_handle, label);
                // A closed window's AI requests have nowhere to stream to.
                commands::ai::cancel_window(app_handle, label);
                commands::print::close_stragglers(app_handle);
            }
            _ => {}
        }
    });
}
