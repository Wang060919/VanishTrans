use tauri::Manager;

use crate::commands::window::{show_quick_translation, show_without_activation};
use crate::error::CommandError;
use crate::lock::LockRecover;
use crate::ocr::{OcrOutput, ScreenshotBuffer, ScreenshotPayload, ScreenshotWindowState};

// -----------------------------------------------------------
// Screenshot + OCR commands
// -----------------------------------------------------------

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

pub(crate) fn prepare_screenshot(app: &tauri::AppHandle) -> Option<u64> {
    let ball = app.get_webview_window("ball");
    let windows = ScreenshotWindowState {
        ball_was_visible: ball
            .as_ref()
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false),
    };

    let session_id = app.state::<ScreenshotBuffer>().begin(windows)?;
    if let Some(window) = app.get_webview_window("screenshot") {
        let _ = window.hide();
    }
    if windows.ball_was_visible {
        if let Some(window) = ball {
            let _ = window.hide();
        }
    }
    wait_for_window_compositor();
    Some(session_id)
}

#[cfg(target_os = "windows")]
fn wait_for_window_compositor() {
    use windows::Win32::Graphics::Dwm::DwmFlush;
    unsafe {
        let _ = DwmFlush();
    }
}

#[cfg(not(target_os = "windows"))]
fn wait_for_window_compositor() {
    std::thread::sleep(std::time::Duration::from_millis(32));
}

fn restore_windows_after_cancel(app: &tauri::AppHandle, windows: ScreenshotWindowState) {
    if windows.ball_was_visible {
        if let Some(window) = app.get_webview_window("ball") {
            show_without_activation(&window);
        }
    }
}

fn restore_windows_after_ocr(app: &tauri::AppHandle, windows: ScreenshotWindowState) {
    if windows.ball_was_visible {
        if let Some(window) = app.get_webview_window("ball") {
            show_without_activation(&window);
        }
    }
}

#[tauri::command]
pub fn run_ocr_on_crop(
    state: tauri::State<'_, ScreenshotBuffer>,
    session_id: u64,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Result<OcrOutput, CommandError> {
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
    let Some(windows) = app.state::<ScreenshotBuffer>().cancel(session_id) else {
        return;
    };
    if let Some(w) = app.get_webview_window("screenshot") {
        let _ = w.hide();
    }
    restore_windows_after_cancel(app, windows);
}

#[tauri::command]
pub fn cancel_screenshot(app: tauri::AppHandle, session_id: u64) -> Result<(), CommandError> {
    dismiss_screenshot(&app, session_id);
    Ok(())
}

#[tauri::command]
pub fn finish_ocr(
    app: tauri::AppHandle,
    session_id: u64,
    text: String,
) -> Result<(), CommandError> {
    let Some(windows) = app.state::<ScreenshotBuffer>().complete(session_id) else {
        return Err(CommandError::cancelled());
    };
    if let Some(w) = app.get_webview_window("screenshot") {
        let _ = w.hide();
    }
    restore_windows_after_ocr(&app, windows);
    show_quick_translation(&app, text)
}
