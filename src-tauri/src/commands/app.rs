use std::sync::atomic::AtomicBool;

use crate::lock::LockRecover;

// -----------------------------------------------------------
// Frontend readiness signal
// -----------------------------------------------------------

/// Set to true once the frontend has mounted its event listeners.
/// The Alt+Q handler checks this before emitting events.
pub static FRONTEND_READY: AtomicBool = AtomicBool::new(false);
pub static QUICK_FRONTEND_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn frontend_ready() {
    FRONTEND_READY.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub fn get_startup_warnings(warnings: tauri::State<'_, crate::StartupWarnings>) -> Vec<String> {
    warnings.0.lock_recover().clone()
}

#[tauri::command]
pub fn quick_frontend_ready() {
    QUICK_FRONTEND_READY.store(true, std::sync::atomic::Ordering::SeqCst);
}

// -----------------------------------------------------------
// Frontend logging
// -----------------------------------------------------------

/// Forward a frontend operational error into the Rust log so production
/// issues are not only visible in the browser console.
#[tauri::command]
pub fn log_frontend_message(level: String, message: String) {
    let message = message.chars().take(4096).collect::<String>();
    match level.as_str() {
        "error" => log::error!("[frontend] {}", message),
        "warn" => log::warn!("[frontend] {}", message),
        _ => log::info!("[frontend] {}", message),
    }
}

// -----------------------------------------------------------
// Privacy controls
// -----------------------------------------------------------

#[tauri::command]
pub fn set_logging_enabled(enabled: bool) {
    crate::logging::set_logging_enabled(enabled);
    log::info!(
        "[privacy] file logging {}",
        if enabled { "enabled" } else { "disabled" }
    );
}

#[tauri::command]
pub fn get_logging_enabled() -> bool {
    crate::logging::logging_enabled()
}
