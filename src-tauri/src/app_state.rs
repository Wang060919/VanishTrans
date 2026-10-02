use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Condvar, Mutex};

pub struct AppState {
    pub pinned: AtomicBool,
    pub shortcuts_enabled: AtomicBool,
    /// Reference count of transient hotkey suspensions (hotkey recorder).
    /// Independent of `shortcuts_enabled` so a recorder resume can never
    /// re-enable shortcuts the user paused from the tray.
    pub shortcut_suspend_count: AtomicUsize,
    pub clipboard_watch_enabled: AtomicBool,
    pub clipboard_watch_signal: (Mutex<bool>, Condvar),
    pub alt_r_lock: Mutex<()>,
    /// Shared tokio runtime for background translation (Alt+R).
    /// Avoids creating a new runtime per request.
    pub runtime: tokio::runtime::Runtime,
}

pub struct ShortcutsMenuItem(pub tauri::menu::MenuItem<tauri::Wry>);
pub struct PinMenuItem(pub tauri::menu::MenuItem<tauri::Wry>);
pub struct WatchMenuItem(pub tauri::menu::MenuItem<tauri::Wry>);
pub struct StartupWarnings(pub Mutex<Vec<String>>);
