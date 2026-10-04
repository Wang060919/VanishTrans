use std::sync::atomic::AtomicBool;

use tauri::Manager;

use crate::commands::window::{show_quick_translation_async_edit, show_without_activation};
use crate::error::CommandError;
use crate::lock::LockRecover;
use crate::ocr::{OcrOutput, ScreenshotBuffer, ScreenshotPayload, ScreenshotWindowState};

// -----------------------------------------------------------
// Screenshot + OCR commands
// -----------------------------------------------------------

/// Whether the quick window was visible before capture hid it. Kept outside
/// ScreenshotWindowState (owned by ocr.rs) but with the same lifecycle: set
/// only after a session begins, consumed by restore_windows.
static QUICK_WAS_VISIBLE: AtomicBool = AtomicBool::new(false);

/// Idle delay before the hidden overlay is actually destroyed.
const OVERLAY_IDLE_CLOSE_SECS: u64 = 60;

/// Hide the overlay now but close it after a quiet period: an immediate close
/// frees the ~80–100MB WebView2 renderer at the cost of a cold webview boot on
/// the next capture, while a hidden window kept forever wastes that memory.
/// The timer closes only when NO session is active (covers the begun-but-
/// unbound window) AND the managed window is still the one we hid (HWND token
/// on Windows). Both guards are post-sleep reads, so a session that started
/// or a window that got replaced while we slept is never closed underneath.
fn hide_overlay(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("screenshot") else {
        return;
    };
    let _ = window.hide();
    #[cfg(target_os = "windows")]
    let token = window.hwnd().map(|hwnd| hwnd.0 as u64).unwrap_or(0);
    #[cfg(not(target_os = "windows"))]
    let token = 0u64;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(OVERLAY_IDLE_CLOSE_SECS));
        if app
            .state::<ScreenshotBuffer>()
            .active_session_id()
            .is_some()
        {
            return;
        }
        let Some(window) = app.get_webview_window("screenshot") else {
            return;
        };
        #[cfg(target_os = "windows")]
        let same_window = window.hwnd().map(|hwnd| hwnd.0 as u64).unwrap_or(0) == token;
        #[cfg(not(target_os = "windows"))]
        let same_window = true;
        if same_window {
            let _ = window.close();
        }
    });
}

/// Poll plain-Escape while a capture session runs. The overlay's webview
/// keydown only fires when Windows grants the window focus — which
/// SetForegroundWindow is routinely denied — and the global-shortcut plugin's
/// register/unregister block on the main thread, deadlocking when Esc is
/// handled from the event loop itself. A raw GetAsyncKeyState poll avoids
/// both: it needs no focus, no focus window, and no main-thread round-trip.
#[cfg(target_os = "windows")]
fn spawn_escape_watcher(app: &tauri::AppHandle, session_id: u64) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
    let app = app.clone();
    std::thread::spawn(move || {
        // Edge-triggered: Esc held across the hotkey press must not cancel
        // the newborn session instantly.
        let mut was_down = false;
        loop {
            let active = app.state::<ScreenshotBuffer>().is_active(session_id);
            if !active {
                return;
            }
            let down = unsafe { GetAsyncKeyState(i32::from(VK_ESCAPE.0)) } < 0;
            if down && !was_down {
                log::info!("[screenshot] Escape pressed; cancelling session {session_id}");
                dismiss_screenshot(&app, session_id);
                return;
            }
            was_down = down;
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}
#[cfg(not(target_os = "windows"))]
fn spawn_escape_watcher(_app: &tauri::AppHandle, _session_id: u64) {}

#[tauri::command]
pub fn get_screenshot_payload(
    state: tauri::State<'_, ScreenshotBuffer>,
) -> Result<ScreenshotPayload, CommandError> {
    let guard = state.payload.lock_recover();
    match guard.as_ref() {
        Some(payload) => Ok(payload.clone()),
        None => Err(CommandError::not_found("没有截图数据，请先截屏 (Alt+W)")),
    }
}

pub(crate) fn prepare_screenshot(app: &tauri::AppHandle) -> Result<Option<u64>, CommandError> {
    use super::screenshot_visibility::{hide_for_capture, wait_for_window_compositor};

    let ball = app.get_webview_window("ball");
    // The quick window is always-on-top: it would land in the capture and
    // float above the overlay, so it must be hidden like ball.
    let quick = app.get_webview_window("quick");
    let quick_was_visible = quick
        .as_ref()
        .map(|window| window.is_visible())
        .transpose()
        .map_err(|e| CommandError::internal(e.to_string()))?
        .unwrap_or(false);
    let windows = ScreenshotWindowState {
        ball_was_visible: ball
            .as_ref()
            .map(|window| window.is_visible())
            .transpose()
            .map_err(|e| CommandError::internal(e.to_string()))?
            .unwrap_or(false),
    };
    let Some(session_id) = app.state::<ScreenshotBuffer>().begin(windows) else {
        return Ok(None);
    };
    QUICK_WAS_VISIBLE.store(quick_was_visible, std::sync::atomic::Ordering::SeqCst);
    spawn_escape_watcher(app, session_id);
    let prepared = (|| {
        for window in [app.get_webview_window("screenshot"), ball, quick]
            .into_iter()
            .flatten()
        {
            hide_for_capture(&window)?;
        }
        wait_for_window_compositor()
    })();
    if let Err(error) = prepared {
        dismiss_screenshot(app, session_id);
        return Err(error);
    }
    Ok(Some(session_id))
}

fn restore_windows(app: &tauri::AppHandle, windows: ScreenshotWindowState) {
    if windows.ball_was_visible {
        if let Some(window) = app.get_webview_window("ball") {
            show_without_activation(&window);
        }
    }
    if QUICK_WAS_VISIBLE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        if let Some(window) = app.get_webview_window("quick") {
            show_without_activation(&window);
        }
    }
}

#[tauri::command]
pub async fn run_ocr_on_crop(
    app: tauri::AppHandle,
    session_id: u64,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Result<OcrOutput, CommandError> {
    // Sync commands run on the webview's IPC (main) thread, and crop +
    // enhancement + two WinRT OCR passes take seconds, blocking UI and the
    // Esc-cancel command. Move the work to the blocking pool.
    tauri::async_runtime::spawn_blocking(move || {
        run_ocr_on_crop_blocking(&app, session_id, x, y, w, h)
    })
    .await
    .map_err(|error| CommandError::internal(format!("OCR 任务中止: {error}")))?
}

fn run_ocr_on_crop_blocking(
    app: &tauri::AppHandle,
    session_id: u64,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Result<OcrOutput, CommandError> {
    let state = app.state::<ScreenshotBuffer>();
    // Validate the session and clone its image under one session guard.
    let img = state.image_for_session(session_id).ok_or_else(|| {
        if state.is_active(session_id) {
            CommandError::not_found("没有截图数据，请先截屏 (Alt+W)")
        } else {
            CommandError::not_found("截图会话已过期，请重新截屏")
        }
    })?;
    let (img_w, img_h) = (img.width(), img.height());
    log::info!(
        "[ocr] image: {}x{}, crop request: ({},{}) {}x{}",
        img_w,
        img_h,
        x,
        y,
        w,
        h
    );
    if img_w == 0 || img_h == 0 {
        return Err(CommandError::validation("截图尺寸无效"));
    }

    // Clamp crop coordinates
    let x = x.min(img_w.saturating_sub(1));
    let y = y.min(img_h.saturating_sub(1));
    let w = w.min(img_w.saturating_sub(x)).max(1);
    let h = h.min(img_h.saturating_sub(y)).max(1);
    log::info!("[ocr] clamped: ({},{}) {}x{}", x, y, w, h);

    let crop = img.crop_imm(x, y, w, h);
    let max_dimension = crate::ocr::ocr_max_image_dimension();
    let enhanced = crate::ocr::prepare_enhanced_ocr_image(&crop, max_dimension);
    log::info!(
        "[ocr] enhanced to {}x{} (system max {})",
        enhanced.width(),
        enhanced.height(),
        max_dimension
    );
    let enhanced_png = crate::ocr::encode_ocr_png(&enhanced)?;
    let enhanced_output = crate::ocr::native_ocr_on_png(&enhanced_png)?;
    if !enhanced_output.text.trim().is_empty() {
        if !state.is_active(session_id) {
            return Err(CommandError::cancelled());
        }
        return Ok(enhanced_output);
    }

    log::info!("[ocr] enhanced pass was empty, retrying with original colors");
    let original = crate::ocr::prepare_original_ocr_image(&crop, max_dimension);
    let original_png = crate::ocr::encode_ocr_png(&original).map_err(CommandError::io)?;
    let output = crate::ocr::native_ocr_on_png(&original_png).map_err(CommandError::io)?;
    if !state.is_active(session_id) {
        return Err(CommandError::cancelled());
    }
    Ok(output)
}

pub(crate) fn dismiss_screenshot(app: &tauri::AppHandle, session_id: u64) {
    // A stale or unknown id ends nothing — a newer session's overlay and
    // restored windows stay untouched.
    let Some(windows) = app.state::<ScreenshotBuffer>().cancel(session_id) else {
        log::debug!("[screenshot] cancel for stale/unknown session {session_id}; no-op");
        return;
    };
    hide_overlay(app);
    restore_windows(app, windows);
}

/// Idempotent: the frontend may call this for a session that was never
/// claimed (already cancelled/expired/stale), which is a graceful no-op.
/// `session_id == 0` is the overlay's "I never learned the id" cancel —
/// resolve it to the session bound to the calling overlay window (or the
/// active one when the binding hasn't landed yet) instead of no-oping.
#[tauri::command]
pub fn cancel_screenshot(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: u64,
) -> Result<(), CommandError> {
    if window.label() != "screenshot" {
        return Err(CommandError::validation("该命令只能由截图窗口调用"));
    }
    let state = app.state::<ScreenshotBuffer>();
    let resolved = if session_id == 0 {
        #[cfg(target_os = "windows")]
        let from_window = window
            .hwnd()
            .ok()
            .and_then(|hwnd| state.session_id_for_window(hwnd.0 as u64));
        #[cfg(not(target_os = "windows"))]
        let from_window = state.session_id_for_window(0);
        from_window.or_else(|| state.active_session_id())
    } else {
        Some(session_id)
    };
    if let Some(id) = resolved {
        dismiss_screenshot(&app, id);
    } else {
        log::debug!("[screenshot] cancel with no active session; no-op");
    }
    Ok(())
}

#[tauri::command]
pub async fn finish_ocr(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: u64,
    text: String,
) -> Result<(), CommandError> {
    if window.label() != "screenshot" {
        return Err(CommandError::validation("该命令只能由截图窗口调用"));
    }
    let Some(windows) = app.state::<ScreenshotBuffer>().complete(session_id) else {
        return Err(CommandError::cancelled());
    };
    hide_overlay(&app);
    restore_windows(&app, windows);
    // OCR output needs confirmation: the quick window opens in edit mode so
    // the user can fix recognition mistakes before translating.
    show_quick_translation_async_edit(&app, text, true).await
}
