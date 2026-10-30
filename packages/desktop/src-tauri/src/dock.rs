//! New Window from outside the app's own windows: the Dock icon's menu on
//! macOS and the taskbar jump list on Windows.
//!
//! Tauri wraps neither. On macOS the Dock asks the app delegate for
//! `applicationDockMenu:`; tao's delegate does not implement it, so the
//! method (and the item's action) are added to its class at startup. On
//! Windows the jump list gets a user task that relaunches the exe with
//! `--new-window`; the single-instance plugin hands that to the running app
//! (`lib.rs`), and a cold launch ignores the flag (session restore opens the
//! windows).

pub const NEW_WINDOW_ARG: &str = "--new-window";

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_char;
    use std::sync::atomic::{AtomicPtr, Ordering};
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::{sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
    use objc2_foundation::NSString;
    use tauri::AppHandle;

    use crate::commands::multiwindow;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static MENU: AtomicPtr<NSMenu> = AtomicPtr::new(std::ptr::null_mut());

    extern "C-unwind" fn dock_menu(_this: &AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> *mut NSMenu {
        MENU.load(Ordering::SeqCst)
    }

    extern "C-unwind" fn new_window(_this: &AnyObject, _cmd: Sel, _sender: *mut AnyObject) {
        if let Some(app) = APP.get() {
            if let Err(e) = multiwindow::create_window(app, None, Vec::new()) {
                eprintln!("MikeDown: could not open a window: {e}");
            }
        }
    }

    /// Must run on the main thread after tao has set its app delegate
    /// (Tauri's `setup` does both).
    pub fn install(app: &AppHandle) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let _ = APP.set(app.clone());
        let ns_app = NSApplication::sharedApplication(mtm);
        let Some(delegate) = ns_app.delegate() else { return };
        let delegate_obj: &AnyObject = delegate.as_ref();
        let cls = delegate_obj.class() as *const _ as *mut _;
        let action = sel!(mikedownNewWindow:);
        // SAFETY: the imps match the type encodings (`id (id, SEL, id)` and
        // `void (id, SEL, id)`); class_addMethod leaves an existing method
        // alone, so a second call is harmless.
        unsafe {
            let dock: unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *mut NSMenu = dock_menu;
            let item: unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) = new_window;
            objc2::ffi::class_addMethod(
                cls,
                sel!(applicationDockMenu:),
                std::mem::transmute::<_, Imp>(dock),
                c"@@:@".as_ptr() as *const c_char,
            );
            objc2::ffi::class_addMethod(
                cls,
                action,
                std::mem::transmute::<_, Imp>(item),
                c"v@:@".as_ptr() as *const c_char,
            );
        }

        let menu = NSMenu::new(mtm);
        // SAFETY: `action` is a valid selector the delegate now implements.
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &NSString::from_str("New Window"),
                Some(action),
                &NSString::from_str(""),
            )
        };
        // SAFETY: the delegate lives as long as the app.
        unsafe { item.setTarget(Some(delegate_obj)) };
        menu.addItem(&item);
        // Kept for the life of the app; the Dock asks for it on every open.
        MENU.store(Retained::into_raw(menu), Ordering::SeqCst);
        // AppKit caches which optional delegate methods exist when the
        // delegate is set; setting it again picks up `applicationDockMenu:`.
        ns_app.setDelegate(Some(&delegate));
    }
}

#[cfg(windows)]
mod win {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Foundation::E_FAIL;
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW,
        SetCurrentProcessExplicitAppUserModelID, ShellLink,
    };

    /// The installer gives the Start menu shortcut this id (the bundle
    /// identifier); the process must use the same one or the pinned icon and
    /// the running windows are two taskbar buttons and the jump list lands on
    /// the wrong one. Call before the first window.
    pub fn set_app_id(id: &str) {
        // SAFETY: plain Win32 call with a valid wide string.
        if let Err(e) = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(id)) } {
            eprintln!("MikeDown: could not set the AppUserModelID: {e}");
        }
    }

    /// Off the main thread: COM setup and the shell write take a moment.
    pub fn install(id: String) {
        std::thread::spawn(move || {
            if let Err(e) = write_jump_list(&id) {
                eprintln!("MikeDown: could not set the jump list: {e}");
            }
        });
    }

    fn write_jump_list(id: &str) -> windows::core::Result<()> {
        let exe = std::env::current_exe().map_err(|e| windows::core::Error::new(E_FAIL, e.to_string()))?;
        let exe = HSTRING::from(exe.as_os_str());
        // SAFETY: COM calls on a thread this function initialized; every
        // string outlives the call that takes it.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let list: ICustomDestinationList = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
            list.SetAppID(&HSTRING::from(id))?;
            let mut min_slots = 0u32;
            let _removed: IObjectArray = list.BeginList(&mut min_slots)?;

            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&exe)?;
            link.SetArguments(&HSTRING::from(super::NEW_WINDOW_ARG))?;
            link.SetIconLocation(&exe, 0)?;
            link.SetDescription(&HSTRING::from("Open a new MikeDown window"))?;
            let store: IPropertyStore = link.cast()?;
            store.SetValue(&PKEY_Title, &PROPVARIANT::from("New Window"))?;
            store.Commit()?;

            let tasks: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            tasks.AddObject(&link)?;
            list.AddUserTasks(&tasks.cast::<IObjectArray>()?)?;
            list.CommitList()?;
        }
        Ok(())
    }
}

/// Before the app is built: the process AppUserModelID (Windows only).
pub fn before_build(identifier: &str) {
    #[cfg(windows)]
    win::set_app_id(identifier);
    #[cfg(not(windows))]
    let _ = identifier;
}

/// From Tauri's `setup`: the Dock menu (macOS) or the jump list (Windows).
pub fn install(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    mac::install(app);
    #[cfg(windows)]
    win::install(app.config().identifier.clone());
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = app;
}

/// A second launch's arguments ask for a new window (the jump list task).
pub fn wants_new_window(argv: &[String]) -> bool {
    argv.iter().skip(1).any(|a| a == NEW_WINDOW_ARG)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_window_flag_after_the_exe() {
        let argv = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(wants_new_window(&argv(&["MikeDown.exe", "--new-window"])));
        assert!(!wants_new_window(&argv(&["MikeDown.exe", "notes.md"])));
        assert!(!wants_new_window(&argv(&["--new-window"])));
    }
}
