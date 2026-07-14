use std::sync::atomic::AtomicBool;
use tauri::{Emitter, Manager};

use crate::clipboard::ClipboardGuard;
use crate::history::HistoryStore;
use crate::ocr::{OcrOutput, ScreenshotBuffer};
use crate::translate::{do_translate_async, ApiConfig};
use tauri_plugin_clipboard_manager::ClipboardExt;

// -----------------------------------------------------------
// Frontend readiness signal
// -----------------------------------------------------------

/// Set to true once the frontend has mounted its event listeners.
/// The Alt+Q handler checks this before emitting events.
pub static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn frontend_ready() {
    FRONTEND_READY.store(true, std::sync::atomic::Ordering::SeqCst);
}

// -----------------------------------------------------------
// Clipboard commands
// -----------------------------------------------------------

#[tauri::command]
pub fn read_clipboard_safe(
    app: tauri::AppHandle,
    guard: tauri::State<'_, ClipboardGuard>,
) -> Result<String, String> {
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| format!("读取剪贴板失败: {}", e))?;
    if text.trim().is_empty() {
        return Err("剪贴板为空".into());
    }
    if guard.is_own_content(&text) {
        guard.clear_dirty();
        return Err("SKIP_OWN_CONTENT".into());
    }
    Ok(text)
}

#[tauri::command]
pub fn write_clipboard_safe(
    app: tauri::AppHandle,
    guard: tauri::State<'_, ClipboardGuard>,
    text: String,
) -> Result<(), String> {
    guard.mark_written(&text);
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("写入剪贴板失败: {}", e))
}

// -----------------------------------------------------------
// Window commands
// -----------------------------------------------------------

#[tauri::command]
pub fn hide_window(window: tauri::Window) {
    if let Some(w) = window.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
pub fn toggle_pin(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    if let Some(w) = window.get_webview_window("main") {
        let is = w.is_always_on_top().map_err(|e| e.to_string())?;
        let new = !is;
        w.set_always_on_top(new).map_err(|e| e.to_string())?;
        state.pinned.store(new, std::sync::atomic::Ordering::SeqCst);
        Ok(new)
    } else {
        Err("找不到主窗口".into())
    }
}

// -----------------------------------------------------------
// API config commands
// -----------------------------------------------------------

#[tauri::command]
pub fn get_api_config(state: tauri::State<'_, ApiConfig>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "baseUrl": *state.base_url.lock().unwrap(),
        "hasApiKey": !state.api_key.lock().unwrap().is_empty(),
        "model": *state.model.lock().unwrap(),
        "hotkeys": *state.hotkeys.lock().unwrap(),
        "glossary": *state.glossary.lock().unwrap(),
    }))
}

#[tauri::command]
pub fn set_api_config(
    state: tauri::State<'_, ApiConfig>,
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<(), String> {
    if !base_url.is_empty() {
        *state.base_url.lock().unwrap() = base_url.trim_end_matches('/').to_string();
    }
    if let Some(api_key) = api_key {
        *state.api_key.lock().unwrap() = api_key;
        state.save_api_key()?;
    }
    if !model.is_empty() {
        *state.model.lock().unwrap() = model;
    }
    state.save_to_disk();
    Ok(())
}

#[tauri::command]
pub fn set_hotkeys(
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiConfig>,
    hotkeys: Vec<(String, String)>,
) -> Result<(), String> {
    *state.hotkeys.lock().unwrap() = hotkeys;
    state.save_to_disk();
    // Re-register global shortcuts with the new bindings
    crate::setup::sync_shortcuts(&app).map_err(|e| format!("快捷键更新失败: {}", e))
}

#[tauri::command]
pub fn set_glossary(
    state: tauri::State<'_, ApiConfig>,
    glossary: Vec<(String, String)>,
) -> Result<(), String> {
    *state.glossary.lock().unwrap() = glossary;
    state.save_to_disk();
    Ok(())
}

// -----------------------------------------------------------
// Translation commands
// -----------------------------------------------------------

#[tauri::command]
pub async fn translate(
    state: tauri::State<'_, ApiConfig>,
    text: String,
    source_lang: String,
    target_lang: String,
) -> Result<String, String> {
    let seq = state.next_request_seq();
    let result = do_translate_async(&state, &text, &source_lang, &target_lang).await?;
    if !state.is_current_request(seq) {
        // A newer request superseded this one — silently drop the result
        return Err("CANCELLED".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn translate_with_direction(
    state: tauri::State<'_, ApiConfig>,
    history: tauri::State<'_, HistoryStore>,
    text: String,
    direction: String,
) -> Result<String, String> {
    let seq = state.next_request_seq();
    let target = crate::translate::resolve_target_lang(&text, &direction);
    let result = do_translate_async(&state, &text, "auto", target).await?;
    if !state.is_current_request(seq) {
        return Err("CANCELLED".into());
    }
    // Record successful translation in history
    history.add(&text, &result, &direction);
    Ok(result)
}

#[tauri::command]
pub async fn translate_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiConfig>,
    history: tauri::State<'_, HistoryStore>,
    text: String,
    direction: String,
) -> Result<String, String> {
    let seq = state.next_request_seq();
    let target = crate::translate::resolve_target_lang(&text, &direction);
    let app_clone = app.clone();
    let seq_for_closure = seq;
    let state_for_closure = state.inner();
    let result = crate::translate::do_translate_stream_async(
        state_for_closure,
        &text,
        "auto",
        target,
        |chunk| {
            // Check cancellation before emitting each chunk
            if !state_for_closure.is_current_request(seq_for_closure) {
                return;
            }
            let _ = app_clone.emit("translate-stream-chunk", chunk);
        },
    )
    .await?;

    if !state.is_current_request(seq) {
        return Err("CANCELLED".into());
    }

    let _ = app.emit("translate-stream-done", &result);
    // Record successful translation in history
    history.add(&text, &result, &direction);
    Ok(result)
}

/// Batch translate multiple text segments in a single API call.
/// Used for file translation (.srt subtitles, .json values).
/// Each segment is separated by a unique marker so they can be split back.
#[tauri::command]
pub async fn translate_batch(
    state: tauri::State<'_, ApiConfig>,
    segments: Vec<String>,
    direction: String,
) -> Result<Vec<String>, String> {
    if segments.is_empty() {
        return Ok(Vec::new());
    }

    let seq = state.next_request_seq();

    // Join segments with a unique marker
    const MARKER: &str = "\n\n===SEGMENT_BREAK===\n\n";
    let combined = segments.join(MARKER);
    let target = crate::translate::resolve_target_lang(&combined, &direction);
    let result = crate::translate::do_translate_async(&state, &combined, "auto", target).await?;

    if !state.is_current_request(seq) {
        return Err("CANCELLED".into());
    }

    // Split result back into segments
    let translated: Vec<String> = result
        .split("===SEGMENT_BREAK===")
        .map(|s| s.trim().to_string())
        .collect();

    // If split count doesn't match (model may have merged/split segments),
    // fall back: return the full result as the only segment
    if translated.len() != segments.len() {
        return Ok(vec![result]);
    }

    Ok(translated)
}

// -----------------------------------------------------------
// Text cleanup command
// -----------------------------------------------------------

#[tauri::command]
pub fn cleanup_clipboard_text(text: String) -> Result<String, String> {
    let cleaned = text.replace("\r\n", "\n").replace("-\n", "");
    Ok(cleaned.trim().to_string())
}

// -----------------------------------------------------------
// Screenshot + OCR commands
// -----------------------------------------------------------

#[tauri::command]
pub fn get_screenshot_data_uri(
    state: tauri::State<'_, ScreenshotBuffer>,
) -> Result<String, String> {
    let guard = state.data_uri.lock().unwrap();
    match guard.as_ref() {
        Some(uri) => Ok(uri.clone()),
        None => Err("没有截图数据，请先截屏 (Alt+W)".into()),
    }
}

#[tauri::command]
pub fn clear_screenshot_buffer(state: tauri::State<'_, ScreenshotBuffer>) {
    *state.data_uri.lock().unwrap() = None;
    *state.image.lock().unwrap() = None;
}

#[tauri::command]
pub fn run_ocr_on_crop(
    state: tauri::State<'_, ScreenshotBuffer>,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Result<OcrOutput, String> {
    // Use the stored DynamicImage directly — no JPEG decode needed
    let img = {
        let guard = state
            .image
            .lock()
            .map_err(|_| "截图缓冲区状态异常".to_string())?;
        guard.as_ref().ok_or("没有截图数据，请先截屏 (Alt+W)")?.clone()
    };

    let (img_w, img_h) = (img.width(), img.height());
    log::info!(
        "[ocr] image: {}x{}, crop request: ({},{}) {}x{}",
        img_w, img_h, x, y, w, h
    );
    if img_w == 0 || img_h == 0 {
        return Err("截图尺寸无效".into());
    }

    // Clamp crop coordinates
    let x = x.min(img_w.saturating_sub(1));
    let y = y.min(img_h.saturating_sub(1));
    let w = w.min(img_w.saturating_sub(x)).max(1);
    let h = h.min(img_h.saturating_sub(y)).max(1);
    log::info!("[ocr] clamped: ({},{}) {}x{}", x, y, w, h);

    let crop = img.crop_imm(x, y, w, h);

    // 放大 3 倍，显著提升 OCR 对小字号中文的识别准确率
    let scaled_w = crop.width().checked_mul(crate::ocr::OCR_SCALE_FACTOR).ok_or_else(|| "OCR 图像宽度过大".to_string())?;
    let scaled_h = crop.height().checked_mul(crate::ocr::OCR_SCALE_FACTOR).ok_or_else(|| "OCR 图像高度过大".to_string())?;
    let scaled = crop.resize_exact(scaled_w, scaled_h, image::imageops::FilterType::Lanczos3);
    log::info!("[ocr] scaled to {}x{}", scaled.width(), scaled.height());

    let rgb = scaled.to_rgb8();
    let mut png_buf = std::io::Cursor::new(Vec::new());
    rgb.write_to(&mut png_buf, image::ImageFormat::Png)
        .map_err(|e| format!("PNG 编码失败: {}", e))?;
    let png_bytes = png_buf.into_inner();
    log::info!("[ocr] -> {} bytes PNG", png_bytes.len());
    crate::ocr::native_ocr_on_png(&png_bytes)
}

// -----------------------------------------------------------
// History commands
// -----------------------------------------------------------

#[tauri::command]
pub fn get_history(
    history: tauri::State<'_, HistoryStore>,
    query: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let records = match query.as_deref() {
        Some(q) if !q.is_empty() => history.search(q),
        _ => history.get_all(),
    };
    Ok(records
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "original": r.original,
                "translated": r.translated,
                "direction": r.direction,
                "timestamp": r.timestamp,
            })
        })
        .collect())
}

#[tauri::command]
pub fn delete_history_record(
    history: tauri::State<'_, HistoryStore>,
    id: u64,
) -> Result<(), String> {
    history.delete(id);
    Ok(())
}

#[tauri::command]
pub fn clear_history(history: tauri::State<'_, HistoryStore>) -> Result<(), String> {
    history.clear();
    Ok(())
}

#[tauri::command]
pub fn finish_ocr(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("screenshot") {
        let _ = w.hide();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("ocr-translate", text);
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_replaces_crlf_with_lf() {
        assert_eq!(cleanup_clipboard_text("a\r\nb".into()).unwrap(), "a\nb");
    }

    #[test]
    fn cleanup_preserves_line_breaks() {
        assert_eq!(cleanup_clipboard_text("a\nb".into()).unwrap(), "a\nb");
    }

    #[test]
    fn cleanup_merges_hyphen_line_breaks() {
        assert_eq!(cleanup_clipboard_text("computa-\ntion".into()).unwrap(), "computation");
    }

    #[test]
    fn cleanup_trims_whitespace() {
        assert_eq!(cleanup_clipboard_text("  hello  ".into()).unwrap(), "hello");
    }

    #[test]
    fn cleanup_handles_empty_string() {
        assert_eq!(cleanup_clipboard_text("".into()).unwrap(), "");
    }

    #[test]
    fn cleanup_preserves_normal_text() {
        assert_eq!(cleanup_clipboard_text("hello world".into()).unwrap(), "hello world");
    }
}