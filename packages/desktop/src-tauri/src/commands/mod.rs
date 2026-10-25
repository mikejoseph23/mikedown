//! Tauri commands. These are the only path from the webview to the disk, the
//! OS dialogs and the native window: the TypeScript side calls them through
//! the typed wrapper in `src/documents/fsApi.ts` and nowhere else.

pub mod ai;
pub mod appdata;
pub mod fs;
pub mod launch;
pub mod multiwindow;
pub mod print;
pub mod settings;
pub mod search;
pub mod watcher;
pub mod window;
pub mod versions;
pub mod recents;
pub mod updater;
pub mod updater_verify;
