use std::thread;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::clipboard::ClipboardGuard;
use crate::AppState;

pub fn setup_clipboard_watch(app: &tauri::App) {
    let watch_handle = app.handle().clone();
    std::thread::spawn(move || {
        let mut last_text = String::new();
        loop {
            if !watch_handle
                .state::<AppState>()
                .clipboard_watch_enabled
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                // Longer sleep when feature is disabled to reduce CPU usage
                thread::sleep(Duration::from_secs(2));
                continue;
            }
            thread::sleep(Duration::from_millis(500));
            let text = match watch_handle.clipboard().read_text() {
                Ok(t) if !t.trim().is_empty() => t,
                _ => continue,
            };
            if text == last_text {
                continue;
            }
            last_text = text.clone();
            let guard = watch_handle.state::<ClipboardGuard>();
            if !guard.should_translate_for_watch(&text) {
                continue;
            }
            let cleaned = text
                .replace("\r\n", "\n")
                .replace("-\n", "")
                .trim()
                .to_string();
            if let Some(w) = watch_handle.get_webview_window("main") {
                let _ = w.emit("clipboard-watch-translate", cleaned);
            }
        }
    });
}
