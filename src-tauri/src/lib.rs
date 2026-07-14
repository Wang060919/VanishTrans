mod clipboard;
mod commands;
mod history;
mod keyboard;
mod ocr;
mod setup;
mod translate;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::Manager;

use crate::clipboard::ClipboardGuard;
use crate::history::HistoryStore;
use crate::ocr::ScreenshotBuffer;
use crate::translate::ApiConfig;

// -----------------------------------------------------------
// Global state
// -----------------------------------------------------------

pub struct AppState {
    pub pinned: AtomicBool,
    pub shortcuts_enabled: AtomicBool,
    pub clipboard_watch_enabled: AtomicBool,
    pub alt_r_lock: Mutex<()>,
    /// Shared tokio runtime for background translation (Alt+R).
    /// Avoids creating a new runtime per request.
    pub runtime: tokio::runtime::Runtime,
}

pub struct ShortcutsMenuItem(pub tauri::menu::MenuItem<tauri::Wry>);
pub struct WatchMenuItem(pub tauri::menu::MenuItem<tauri::Wry>);

// -----------------------------------------------------------
// App entry
// -----------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            pinned: AtomicBool::new(false),
            shortcuts_enabled: AtomicBool::new(true),
            clipboard_watch_enabled: AtomicBool::new(false),
            alt_r_lock: Mutex::new(()),
            runtime: tokio::runtime::Runtime::new().expect("Failed to create tokio runtime"),
        })
        .manage(ClipboardGuard::new())
        .manage(ScreenshotBuffer {
            image: std::sync::Mutex::new(None),
            data_uri: std::sync::Mutex::new(None),
        })
        .setup(|app| {
            let config_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let api_config = ApiConfig::load_or_default(config_dir.clone());
            app.manage(api_config);
            app.manage(HistoryStore::load_or_default(config_dir));

            // Periodic history flush — every 5 seconds, write dirty records to disk
            let flush_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    flush_handle.state::<HistoryStore>().flush();
                }
            });

            setup::setup_tray(app)?;
            setup::setup_shortcuts(app)?;
            setup::setup_clipboard_watch(app);

            // Pre-warm HTTP connection pool for faster first translation
            let warm_handle = app.handle().clone();
            app.state::<AppState>().runtime.spawn(async move {
                let cfg = warm_handle.state::<ApiConfig>();
                let base_url = cfg.base_url.lock().unwrap().clone();
                let client = cfg.client.lock().unwrap().clone();
                let url = if base_url.ends_with("/v1") || base_url.ends_with("/v1/") {
                    format!("{}/models", base_url.trim_end_matches('/'))
                } else {
                    format!("{}/v1/models", base_url)
                };
                let _ = client.head(&url).timeout(std::time::Duration::from_secs(5)).send().await;
            });

            Ok(())
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Focused(false) = e {
                let label = w.label();
                if label == "main" && !w.state::<AppState>().pinned.load(Ordering::SeqCst) {
                    // Delay auto-hide by 150ms so the user can click elsewhere
                    // to select text without the window disappearing instantly.
                    let wh = w.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(150));
                        // Only hide if the window is still unfocused
                        if wh.is_focused().unwrap_or(false) {
                            return;
                        }
                        let _ = wh.hide();
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::frontend_ready,
            commands::read_clipboard_safe,
            commands::write_clipboard_safe,
            commands::hide_window,
            commands::toggle_pin,
            commands::get_api_config,
            commands::set_api_config,
            commands::set_hotkeys,
            commands::set_glossary,
            commands::translate,
            commands::translate_with_direction,
            commands::translate_stream,
            commands::translate_batch,
            commands::cleanup_clipboard_text,
            commands::get_screenshot_data_uri,
            commands::clear_screenshot_buffer,
            commands::run_ocr_on_crop,
            commands::finish_ocr,
            commands::get_history,
            commands::delete_history_record,
            commands::clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("启动 VanishTrans 失败");
}

// -----------------------------------------------------------
// Tray menu helpers (called from setup::tray)
// -----------------------------------------------------------

fn toggle_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

fn toggle_top(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let t = w.is_always_on_top().unwrap_or(false);
        let _ = w.set_always_on_top(!t);
        app.state::<AppState>().pinned.store(!t, Ordering::SeqCst);
    }
}

pub fn toggle_shortcuts(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let enabled = !state.shortcuts_enabled.load(Ordering::SeqCst);
    state.shortcuts_enabled.store(enabled, Ordering::SeqCst);
    let label = if enabled {
        "⏸ 暂停热键监听"
    } else {
        "▶ 恢复热键监听"
    };
    let _ = app.state::<ShortcutsMenuItem>().0.set_text(label);
}

pub fn toggle_clipboard_watch(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let enabled = !state.clipboard_watch_enabled.load(Ordering::SeqCst);
    state
        .clipboard_watch_enabled
        .store(enabled, Ordering::SeqCst);
    let label = if enabled {
        "📋 关闭剪贴板监听"
    } else {
        "📋 开启剪贴板监听"
    };
    let _ = app.state::<WatchMenuItem>().0.set_text(label);
}
