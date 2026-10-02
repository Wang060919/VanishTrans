// Tray menu callbacks, invoked from setup::tray.

use std::sync::atomic::Ordering;

use tauri::{Emitter, Manager};

use crate::emit_to_ball_when_ready;
use crate::{AppState, PinMenuItem, ShortcutsMenuItem, WatchMenuItem};

pub(crate) fn toggle_main(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("ball") else {
        return;
    };
    // Decide the target while the island still owns its current mode; emitting
    // first prevents the tray focus-loss handler from inverting the request.
    emit_to_ball_when_ready(app, "toggle-main-window", ());
    let _ = w.show();
    let _ = w.set_focus();
}

pub(crate) fn toggle_top(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    // Atomic read-modify-write: matches commands::window::toggle_pin and keeps
    // simultaneous toggles from losing one side's flip.
    let pinned = !state.pinned.fetch_not(Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("ball") {
        if pinned {
            let _ = window.show();
            emit_to_ball_when_ready(app, "expand-main-window", ());
        }
        let _ = window.emit("pin-state-changed", pinned);
    }
    let label = if pinned {
        "取消保持主界面展开"
    } else {
        "保持主界面展开"
    };
    let _ = app.state::<PinMenuItem>().0.set_text(label);
}

pub fn toggle_shortcuts(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let enabled = !state.shortcuts_enabled.load(Ordering::SeqCst);
    state.shortcuts_enabled.store(enabled, Ordering::SeqCst);
    if let Err(error) = crate::setup::sync_shortcuts(app) {
        log::error!("[shortcut] failed to update paused state: {error}");
        state.shortcuts_enabled.store(!enabled, Ordering::SeqCst);
        return;
    }
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
    if enabled {
        let (lock, signal) = &state.clipboard_watch_signal;
        if let Ok(mut notified) = lock.lock() {
            *notified = true;
            signal.notify_one();
        }
    }
}
