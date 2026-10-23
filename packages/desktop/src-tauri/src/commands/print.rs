//! Print and PDF (M9). The webview hands over a finished standalone HTML
//! document; a `print-N` window loads `print.html`, writes the document into
//! itself and calls `window.print()` (the OS print dialog, which on both
//! macOS and Windows offers Save as PDF). The window is hidden first; if it
//! never reports `printing`, the app reopens it visible as a print preview.
//!
//! The HTML waits here in `PrintJobs` keyed by window label instead of
//! travelling in a URL or an init script: it can be several MB with inlined
//! images.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Window labels of print windows. Quit handshakes and "last window" checks skip them.
pub const PREFIX: &str = "print-";
pub const RESULT_EVENT: &str = "mikedown:print-result";

pub fn is_print_label(label: &str) -> bool {
    label.starts_with(PREFIX)
}

struct Job {
    html: String,
    preview: bool,
}

#[derive(Default)]
pub struct PrintJobs {
    jobs: Mutex<HashMap<String, Job>>,
    next: AtomicUsize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrintPayload {
    pub html: String,
    pub preview: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PrintResult {
    label: String,
    /// `printing` (print() was called), `failed`, or `closed`.
    state: String,
    error: Option<String>,
}

/// Open a print window for `html`. `preview` shows it (the fallback); otherwise it stays hidden.
#[tauri::command]
pub fn print_open<R: Runtime>(
    app: AppHandle<R>,
    jobs: tauri::State<'_, PrintJobs>,
    html: String,
    title: String,
    preview: bool,
) -> Result<String, String> {
    let n = jobs.next.fetch_add(1, Ordering::SeqCst) + 1;
    let label = format!("{PREFIX}{n}");
    jobs.jobs.lock().unwrap().insert(label.clone(), Job { html, preview });
    let built = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("print.html".into()))
        .title(if preview { format!("Print Preview: {title}") } else { title })
        .inner_size(900.0, 1000.0)
        .visible(preview)
        .focused(preview)
        .build();
    if let Err(e) = built {
        jobs.jobs.lock().unwrap().remove(&label);
        return Err(e.to_string());
    }
    Ok(label)
}

/// The print page asks for its document (once).
#[tauri::command]
pub fn print_take<R: Runtime>(window: tauri::WebviewWindow<R>, jobs: tauri::State<'_, PrintJobs>) -> Option<PrintPayload> {
    jobs.jobs
        .lock()
        .unwrap()
        .remove(window.label())
        .map(|j| PrintPayload { html: j.html, preview: j.preview })
}

/// The print page reports progress to every window (the opener listens).
#[tauri::command]
pub fn print_report<R: Runtime>(app: AppHandle<R>, window: tauri::WebviewWindow<R>, state: String, error: Option<String>) {
    let _ = app.emit(RESULT_EVENT, PrintResult { label: window.label().to_string(), state, error });
}

/// Close a print window (the page calls it after `afterprint` or from the preview's Close button).
#[tauri::command]
pub fn print_close<R: Runtime>(app: AppHandle<R>, jobs: tauri::State<'_, PrintJobs>, label: String) {
    if !is_print_label(&label) {
        return;
    }
    jobs.jobs.lock().unwrap().remove(&label);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.destroy();
    }
}

/// A hidden print window must not keep the app alive: when the last
/// non-print window is gone, destroy the print windows.
pub fn close_stragglers<R: Runtime>(app: &AppHandle<R>) {
    let windows = app.webview_windows();
    if windows.keys().any(|l| !is_print_label(l)) {
        return;
    }
    for (label, w) in windows {
        if is_print_label(&label) {
            let _ = w.destroy();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_print_labels() {
        assert!(is_print_label("print-3"));
        assert!(!is_print_label("main"));
        assert!(!is_print_label("w-1"));
    }
}
