//! MikeDown Desktop: Tauri 2 shell around `@mikedown/core`.
//!
//! Plugin registration, one window, the launch-file queue and the commands
//! under `src/commands/` (file I/O, native window state). Menus, search and
//! the watcher arrive with later milestones.

use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

mod commands;

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
            commands::launch::queue_open(app, paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::launch::LaunchQueue::default())
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
            commands::window::set_document_edited,
            commands::window::set_represented_file,
            commands::launch::frontend_ready,
        ])
        .build(tauri::generate_context!())
        .expect("error while building MikeDown");

    app.run(|app_handle, event| {
        // macOS: a double-clicked file or a Dock drop while the app runs (or
        // at launch, before the webview exists; the queue holds it).
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths: Vec<PathBuf> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            commands::launch::queue_open(app_handle, paths);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}
