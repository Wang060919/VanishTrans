use tauri::{Emitter, Manager};

/// Stable identity for the screenshot overlay window. On Windows this is the
/// HWND; other platforms collapse to 0 — harmless because a destroyed-window
/// event can only ever belong to the overlay itself there.
#[cfg(target_os = "windows")]
fn native_window_token(window: &tauri::WebviewWindow) -> u64 {
    window.hwnd().map(|hwnd| hwnd.0 as u64).unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn native_window_token_for_window(window: &tauri::Window) -> u64 {
    window.hwnd().map(|hwnd| hwnd.0 as u64).unwrap_or(0)
}

/// Bind the shown overlay to its capture session so `Destroyed` events can be
/// correlated with it. False when the session already ended — the caller must
/// close the orphaned window.
#[cfg(target_os = "windows")]
fn bind_session_window(
    state: &crate::ocr::ScreenshotBuffer,
    session_id: u64,
    window: &tauri::WebviewWindow,
) -> bool {
    state.bind_window(session_id, native_window_token(window))
}

#[cfg(not(target_os = "windows"))]
fn bind_session_window(
    state: &crate::ocr::ScreenshotBuffer,
    session_id: u64,
    _window: &tauri::WebviewWindow,
) -> bool {
    state.bind_window(session_id, 0)
}

/// A session whose overlay window is gone (destroyed out-of-band) or hidden
/// without the session ending wedges `begin()` forever — Alt+W would keep
/// hitting "session already active". Cancel it here so a bound session with
/// no visible overlay self-heals before `prepare_screenshot` runs.
fn heal_wedged_screenshot_session(app: &tauri::AppHandle) {
    let state = app.state::<crate::ocr::ScreenshotBuffer>();
    let Some(session_id) = state.active_session_id() else {
        return;
    };
    if !state.session_has_window() {
        // Mid-capture before the overlay is shown; still healthy.
        return;
    }
    let wedged = match app.get_webview_window("screenshot") {
        Some(window) => !window.is_visible().unwrap_or(false),
        None => true,
    };
    if wedged {
        log::warn!("[screenshot] clearing wedged session {session_id} (overlay window is gone)");
        crate::commands::dismiss_screenshot(app, session_id);
    }
}

/// Called from `on_window_event` for `CloseRequested`/`Destroyed` on the
/// `screenshot` overlay (e.g. Alt+F4). `dismiss_screenshot`'s own `close()`
/// reaches here too, but the session is already ended so this is a no-op.
/// Out-of-band destruction still ends the session and restores the island.
pub(crate) fn screenshot_window_closed(window: &tauri::Window) {
    let app = window.app_handle();
    #[cfg(target_os = "windows")]
    let token = native_window_token_for_window(window);
    #[cfg(not(target_os = "windows"))]
    let token = 0u64;

    let state = app.state::<crate::ocr::ScreenshotBuffer>();
    let session_id = state.session_id_for_window(token).or_else(|| {
        // The native handle may be unreadable during teardown: if no
        // screenshot window remains managed, the dead overlay owned the
        // active session regardless of token. When a newer overlay already
        // exists, this event belongs to its dead predecessor — never touch
        // the live session.
        (token == 0 && app.get_webview_window("screenshot").is_none() && state.session_has_window())
            .then(|| state.active_session_id())
            .flatten()
    });
    if let Some(session_id) = session_id {
        log::info!("[screenshot] overlay window closed; ending session {session_id}");
        crate::commands::dismiss_screenshot(app, session_id);
    }
}

/// Alt+W: Screenshot OCR.
pub(crate) fn start_screenshot(app: tauri::AppHandle) {
    log::info!("[start_screenshot] === called ===");
    std::thread::spawn(move || {
        heal_wedged_screenshot_session(&app);
        let session_id = match crate::commands::prepare_screenshot(&app) {
            Ok(Some(session_id)) => session_id,
            Ok(None) => {
                log::info!("[screenshot] A capture session is already active");
                return;
            }
            Err(error) => {
                log::error!("[screenshot] Failed to hide capture windows: {error}");
                crate::emit_to_ball_when_ready(
                    &app,
                    "screenshot-error",
                    "无法隐藏灵动岛，截图已取消",
                );
                return;
            }
        };
        // The island resets its translation state on this event — only a
        // session that actually started may clear it, so emit after `begin`.
        crate::emit_to_ball_when_ready(&app, "screenshot-start", ());
        let (mut payload, raw_image) = match crate::ocr::capture_screenshot() {
            Some(d) => d,
            None => {
                log::error!("[screenshot] Capture failed");
                crate::commands::dismiss_screenshot(&app, session_id);
                crate::emit_to_ball_when_ready(
                    &app,
                    "screenshot-error",
                    "截图失败，请检查屏幕录制权限",
                );
                return;
            }
        };
        payload.session_id = session_id;
        {
            let sb = app.state::<crate::ocr::ScreenshotBuffer>();
            if !sb.store(session_id, payload.clone(), raw_image) {
                log::info!("[screenshot] Capture was cancelled before it became ready");
                return;
            }
        }
        // Window ops all dispatch to the event loop; keep them strictly after
        // capture. A warm overlay pre-created at startup (or left hidden by a
        // previous session) skips the build entirely.
        let overlay = match app.get_webview_window("screenshot") {
            Some(w) => {
                let _ = w.set_fullscreen(false);
                let _ = w.set_shadow(false);
                w
            }
            None => {
                let built = tauri::WebviewWindowBuilder::new(
                    &app,
                    "screenshot",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("VanishTrans Screenshot")
                .inner_size(1.0, 1.0)
                .always_on_top(true)
                .decorations(false)
                // Undecorated windows with shadows gain hidden frame insets on
                // Windows (tao computes an offset for the shadow border),
                // which shifts the overlay content right/down by a few
                // pixels. The overlay must cover the monitor pixel-exactly.
                .shadow(false)
                .resizable(false)
                .visible(false)
                .skip_taskbar(true)
                .build();
                match built {
                    Ok(w) => w,
                    Err(error) => {
                        log::error!("[screenshot] Failed to create overlay: {}", error);
                        crate::commands::dismiss_screenshot(&app, session_id);
                        crate::emit_to_ball_when_ready(
                            &app,
                            "screenshot-error",
                            "无法打开截图窗口",
                        );
                        return;
                    }
                }
            }
        };
        let _ = overlay.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: payload.monitor_x,
            y: payload.monitor_y,
        }));
        let _ = overlay.set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: payload.monitor_width,
            height: payload.monitor_height,
        }));
        // Notify without the payload: pushing a 300KB+ base64 string through
        // evaluate_script on the event loop adds visible latency. The overlay
        // treats an empty payload as "fetch via get_screenshot_payload".
        let _ = overlay.emit("screenshot-ready", ());
        let bound = bind_session_window(
            &app.state::<crate::ocr::ScreenshotBuffer>(),
            session_id,
            &overlay,
        );
        if !bound {
            // Session ended while we configured the window; do not leave an
            // orphaned overlay behind.
            let _ = overlay.close();
            return;
        }
        if let Err(error) = overlay.show().and_then(|_| overlay.set_focus()) {
            log::error!("[screenshot] Failed to show overlay: {}", error);
            crate::commands::dismiss_screenshot(&app, session_id);
            crate::emit_to_ball_when_ready(&app, "screenshot-error", "无法打开截图窗口");
        }
    });
}
