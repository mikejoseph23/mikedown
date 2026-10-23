//! Native window state the JS window API does not cover: the macOS dirty dot
//! in the close button (`NSWindow.documentEdited`) and the title-bar proxy
//! icon (`representedFilename`). Both are no-ops on other platforms; the
//! title itself goes through `getCurrentWindow().setTitle` from JS.

use tauri::{Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
fn with_ns_window<R: Runtime>(
    window: &WebviewWindow<R>,
    f: impl FnOnce(&objc2_app_kit::NSWindow) + Send + 'static,
) -> Result<(), String> {
    let ptr = window.ns_window().map_err(|e| e.to_string())? as usize;
    window
        .run_on_main_thread(move || {
            // SAFETY: `ns_window` returns the live NSWindow for this Tauri
            // window; AppKit requires its methods on the main thread, which
            // `run_on_main_thread` guarantees, and the window outlives the
            // closure because Tauri keeps it alive until the window closes.
            let ns: &objc2_app_kit::NSWindow = unsafe { &*(ptr as *const objc2_app_kit::NSWindow) };
            f(ns);
        })
        .map_err(|e| e.to_string())
}

/// Dirty dot in the macOS close button. No-op elsewhere.
#[tauri::command]
pub fn set_document_edited<R: Runtime>(window: WebviewWindow<R>, edited: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        with_ns_window(&window, move |ns| ns.setDocumentEdited(edited))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, edited);
        Ok(())
    }
}

/// macOS title-bar proxy icon (Cmd-click the title for the path, drag it).
/// An empty path clears it. No-op elsewhere.
#[tauri::command]
pub fn set_represented_file<R: Runtime>(window: WebviewWindow<R>, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        with_ns_window(&window, move |ns| {
            let s = objc2_foundation::NSString::from_str(&path);
            ns.setRepresentedFilename(&s);
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, path);
        Ok(())
    }
}
