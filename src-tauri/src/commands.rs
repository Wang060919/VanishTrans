use serde::Serialize;
use std::sync::atomic::AtomicBool;
use tauri::{Emitter, Manager};

use crate::clipboard::ClipboardGuard;
use crate::history::HistoryStore;
use crate::ocr::{OcrOutput, ScreenshotBuffer, ScreenshotPayload, ScreenshotWindowState};
use crate::translate::{do_translate_async, ApiConfig};
use tauri_plugin_clipboard_manager::ClipboardExt;

// -----------------------------------------------------------
// Frontend readiness signal
// -----------------------------------------------------------

/// Set to true once the frontend has mounted its event listeners.
/// The Alt+Q handler checks this before emitting events.
pub static FRONTEND_READY: AtomicBool = AtomicBool::new(false);
pub static QUICK_FRONTEND_READY: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamChunkEvent {
    request_id: u64,
    chunk: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamDoneEvent {
    request_id: u64,
    full_text: String,
}

#[tauri::command]
pub fn frontend_ready() {
    FRONTEND_READY.store(true, std::sync::atomic::Ordering::SeqCst);
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
pub fn hide_window(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
pub fn toggle_pin(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let pinned = !state.pinned.load(std::sync::atomic::Ordering::SeqCst);
    state
        .pinned
        .store(pinned, std::sync::atomic::Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("ball") {
        let _ = window.emit("pin-state-changed", pinned);
    }
    Ok(pinned)
}

#[tauri::command]
pub fn get_pin_state(state: tauri::State<'_, crate::AppState>) -> bool {
    state.pinned.load(std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
pub fn set_ball_window_bounds(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if window.label() != "ball" {
        return Err("窗口边界只能应用到灵动岛".into());
    }
    if width == 0 || height == 0 {
        return Err("灵动岛窗口尺寸必须大于零".into());
    }

    // Use Tauri's built-in methods - they handle Windows decorations correctly
    // Reference: RustyIsland (same Tauri v2 stack) uses only Tauri APIs
    // https://github.com/hasnain7abbas/RustyIsland
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|error| error.to_string())?;
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|error| error.to_string())
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
        "maxRecords": state.max_records.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

#[tauri::command]
pub fn set_api_config(
    state: tauri::State<'_, ApiConfig>,
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<(), String> {
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    let model = model.trim().to_string();
    if base_url.is_empty() {
        return Err("Base URL 不能为空".into());
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("Base URL 必须以 http:// 或 https:// 开头".into());
    }
    if model.is_empty() {
        return Err("模型名称不能为空".into());
    }

    if let Some(api_key) = api_key {
        let mut key_guard = state.api_key.lock().unwrap();
        let previous_key = key_guard.clone();
        *key_guard = api_key;
        drop(key_guard);
        if let Err(error) = state.save_api_key() {
            *state.api_key.lock().unwrap() = previous_key;
            return Err(error);
        }
    }
    *state.base_url.lock().unwrap() = base_url;
    *state.model.lock().unwrap() = model;
    state.save_to_disk()
}

#[tauri::command]
pub fn set_hotkeys(
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiConfig>,
    hotkeys: Vec<(String, String)>,
) -> Result<(), String> {
    let previous = state.hotkeys.lock().unwrap().clone();
    *state.hotkeys.lock().unwrap() = hotkeys;
    // Re-register global shortcuts with the new bindings
    if let Err(error) = crate::setup::sync_shortcuts(&app) {
        *state.hotkeys.lock().unwrap() = previous;
        return Err(format!("快捷键更新失败: {}", error));
    }
    state.save_to_disk()
}

#[tauri::command]
pub fn set_glossary(
    state: tauri::State<'_, ApiConfig>,
    glossary: Vec<(String, String)>,
) -> Result<(), String> {
    *state.glossary.lock().unwrap() = glossary;
    state.save_to_disk()
}

#[tauri::command]
pub fn set_max_records(
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiConfig>,
    max_records: usize,
) -> Result<(), String> {
    let max = max_records.clamp(50, 1000);
    state
        .max_records
        .store(max, std::sync::atomic::Ordering::Relaxed);
    state.save_to_disk()?;
    // Update HistoryStore limit
    app.state::<HistoryStore>().set_max_records(max);
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
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    text: String,
    direction: String,
) -> Result<String, String> {
    let target = crate::translate::resolve_target_lang(&text, &direction);
    let seq = state.next_request_seq();

    // Check Translation Memory first
    if let Some(cached) = tm.lookup(&text, "auto", target) {
        if !state.is_current_request(seq) {
            return Err("CANCELLED".into());
        }
        history.add(&text, &cached, &direction);
        return Ok(cached);
    }

    let result = do_translate_async(&state, &text, "auto", target).await?;
    if !state.is_current_request(seq) {
        return Err("CANCELLED".into());
    }
    // Store in TM and history
    tm.store(&text, &result, "auto", target);
    history.add(&text, &result, &direction);
    Ok(result)
}

#[tauri::command]
pub async fn translate_stream(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ApiConfig>,
    history: tauri::State<'_, HistoryStore>,
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    text: String,
    direction: String,
    request_id: u64,
) -> Result<String, String> {
    let target = crate::translate::resolve_target_lang(&text, &direction);
    let seq = state.next_request_seq();

    // Check Translation Memory first
    if let Some(cached) = tm.lookup(&text, "auto", target) {
        if !state.is_current_request(seq) {
            return Err("CANCELLED".into());
        }
        let _ = window.emit(
            "translate-stream-chunk",
            StreamChunkEvent {
                request_id,
                chunk: cached.clone(),
            },
        );
        let _ = window.emit(
            "translate-stream-done",
            StreamDoneEvent {
                request_id,
                full_text: cached.clone(),
            },
        );
        history.add(&text, &cached, &direction);
        return Ok(cached);
    }

    let window_clone = window.clone();
    let seq_for_closure = seq;
    let state_for_closure = state.inner();
    let result = crate::translate::do_translate_stream_async(
        state_for_closure,
        &text,
        "auto",
        target,
        seq,
        |chunk| {
            // Check cancellation before emitting each chunk
            if !state_for_closure.is_current_request(seq_for_closure) {
                return;
            }
            let _ = window_clone.emit(
                "translate-stream-chunk",
                StreamChunkEvent { request_id, chunk },
            );
        },
    )
    .await?;

    if !state.is_current_request(seq) {
        return Err("CANCELLED".into());
    }

    let _ = window.emit(
        "translate-stream-done",
        StreamDoneEvent {
            request_id,
            full_text: result.clone(),
        },
    );
    // Store in TM and history
    tm.store(&text, &result, "auto", target);
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
    // return an error so the frontend shows raw text instead of broken reassembly
    if translated.len() != segments.len() {
        return Err("SEGMENT_COUNT_MISMATCH".into());
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
pub fn get_screenshot_payload(
    state: tauri::State<'_, ScreenshotBuffer>,
) -> Result<ScreenshotPayload, String> {
    let guard = state.payload.lock().unwrap();
    match guard.as_ref() {
        Some(payload) => Ok(payload.clone()),
        None => Err("没有截图数据，请先截屏 (Alt+W)".into()),
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

#[cfg(target_os = "windows")]
fn show_without_activation<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};

    if let Ok(tauri_hwnd) = window.hwnd() {
        unsafe {
            let _ = ShowWindow(HWND(tauri_hwnd.0 as _), SW_SHOWNOACTIVATE);
        }
    } else {
        let _ = window.show();
    }
}

#[cfg(not(target_os = "windows"))]
fn show_without_activation<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.show();
}

fn wait_for_frontend(ready: &AtomicBool) {
    let mut waited = 0u32;
    while !ready.load(std::sync::atomic::Ordering::SeqCst) && waited < 500 {
        std::thread::sleep(std::time::Duration::from_millis(10));
        waited += 10;
    }
}

fn position_quick_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let (x, y) = crate::cursor::compute_cursor_follow_position(app, 392.0, 330.0);
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
}

pub(crate) fn show_quick_translation(app: &tauri::AppHandle, text: String) -> Result<(), String> {
    let window = app
        .get_webview_window("quick")
        .ok_or_else(|| "找不到迷你翻译窗口".to_string())?;
    position_quick_window(app, &window);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    wait_for_frontend(&QUICK_FRONTEND_READY);
    window
        .emit("quick-translate", text)
        .map_err(|error| error.to_string())
}

pub(crate) fn show_quick_error(app: &tauri::AppHandle, message: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("quick")
        .ok_or_else(|| "找不到迷你翻译窗口".to_string())?;
    position_quick_window(app, &window);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    wait_for_frontend(&QUICK_FRONTEND_READY);
    window
        .emit("quick-translate-error", message)
        .map_err(|error| error.to_string())
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
        guard
            .as_ref()
            .ok_or("没有截图数据，请先截屏 (Alt+W)")?
            .clone()
    };

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
        return Err("截图尺寸无效".into());
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
        return Ok(enhanced_output);
    }

    log::info!("[ocr] enhanced pass was empty, retrying with original colors");
    let original = crate::ocr::prepare_original_ocr_image(&crop, max_dimension);
    let original_png = crate::ocr::encode_ocr_png(&original)?;
    crate::ocr::native_ocr_on_png(&original_png)
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

pub(crate) fn dismiss_screenshot(app: &tauri::AppHandle) {
    let windows = app.state::<ScreenshotBuffer>().cancel();
    if let Some(w) = app.get_webview_window("screenshot") {
        let _ = w.hide();
    }
    if let Some(windows) = windows {
        restore_windows_after_cancel(app, windows);
    }
}

#[tauri::command]
pub fn cancel_screenshot(app: tauri::AppHandle) {
    dismiss_screenshot(&app);
}

#[tauri::command]
pub fn finish_ocr(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let Some(windows) = app.state::<ScreenshotBuffer>().complete() else {
        return Ok(());
    };
    if let Some(w) = app.get_webview_window("screenshot") {
        let _ = w.hide();
    }
    restore_windows_after_ocr(&app, windows);
    show_quick_translation(&app, text)
}

// -----------------------------------------------------------
// Translation Memory commands
// -----------------------------------------------------------

#[tauri::command]
pub fn tm_search(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    query: Option<String>,
) -> Result<Vec<crate::tm::TmEntry>, String> {
    Ok(tm.search(query.as_deref().unwrap_or("")))
}

#[tauri::command]
pub fn tm_delete(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    id: i64,
) -> Result<(), String> {
    tm.delete(id);
    Ok(())
}

#[tauri::command]
pub fn tm_clear(tm: tauri::State<'_, crate::tm::TranslationMemory>) -> Result<(), String> {
    tm.clear();
    Ok(())
}

#[tauri::command]
pub fn tm_stats(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
) -> Result<crate::tm::TmStats, String> {
    Ok(tm.stats())
}

#[tauri::command]
pub fn tm_export(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    path: String,
) -> Result<usize, String> {
    tm.export_csv(std::path::Path::new(&path))
}

#[tauri::command]
pub fn tm_import(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    path: String,
) -> Result<usize, String> {
    tm.import_csv(std::path::Path::new(&path))
}

#[tauri::command]
pub fn tm_import_content(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    content: String,
) -> Result<usize, String> {
    tm.import_csv_content(&content)
}

// -----------------------------------------------------------
// Ball window commands
// -----------------------------------------------------------

#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("ball")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    wait_for_frontend(&FRONTEND_READY);
    window
        .emit("expand-main-window", ())
        .map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_quick_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn show_main_with_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if let Some(quick) = app.get_webview_window("quick") {
        let _ = quick.hide();
    }
    let window = app
        .get_webview_window("ball")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    wait_for_frontend(&FRONTEND_READY);
    window
        .emit("expand-main-window", ())
        .map_err(|error| error.to_string())?;
    window
        .emit("shortcut-translate", text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn translate_clipboard_from_ball(app: tauri::AppHandle) -> Result<(), String> {
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| format!("读取剪贴板失败: {}", e))?;
    if text.trim().is_empty() {
        return Err("剪贴板里没有可翻译的文本".into());
    }
    let cleaned = cleanup_clipboard_text(text)?;
    show_quick_translation(&app, cleaned)
}

#[tauri::command]
pub fn start_screenshot_from_ball(app: tauri::AppHandle) {
    crate::setup::start_screenshot(app);
}

#[tauri::command]
pub fn toggle_ball_show_main(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("ball")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    wait_for_frontend(&FRONTEND_READY);
    window
        .emit("toggle-main-window", ())
        .map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn toggle_ball(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("ball") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_ball_position(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    reposition: Option<bool>,
) -> Result<(i32, i32), String> {
    let (x, y) = if let Some(w) = app.get_webview_window("ball") {
        // Validate position: must be within any connected monitor's bounds
        let mut cx = x;
        let mut cy = y;
        if let Ok(monitors) = w.available_monitors() {
            let mut adjusted_position = None;
            for m in &monitors {
                let mx = m.position().x;
                let my = m.position().y;
                let mw = m.size().width as i32;
                let mh = m.size().height as i32;
                if let Some(position) =
                    crate::clamp_ball_position_to_monitor(cx, cy, mx, my, mw, mh, m.scale_factor())
                {
                    adjusted_position = Some(position);
                    break;
                }
            }
            if let Some((adjusted_x, adjusted_y)) = adjusted_position {
                cx = adjusted_x;
                cy = adjusted_y;
            } else {
                let fallback_monitor = w
                    .primary_monitor()
                    .ok()
                    .flatten()
                    .or_else(|| w.current_monitor().ok().flatten())
                    .or_else(|| monitors.first().cloned());
                (cx, cy) = fallback_monitor
                    .map(|monitor| {
                        crate::default_ball_position_on_monitor(
                            monitor.work_area().position.x,
                            monitor.work_area().position.y,
                            monitor.work_area().size.width as i32,
                            monitor.scale_factor(),
                        )
                    })
                    .unwrap_or((100, 0));
            }
        }
        if reposition.unwrap_or(true) {
            let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: cx,
                y: cy,
            }));
        }
        (cx, cy)
    } else {
        (x, y)
    };
    // Persist to config (with lock to avoid concurrent write conflicts)
    let _lock = crate::translate::CONFIG_FILE_LOCK.lock().unwrap();
    let config_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let config_path = config_dir.join("config.json");
    let mut cfg: serde_json::Value = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or(serde_json::json!({}));
    cfg["ball_x"] = serde_json::json!(x);
    cfg["ball_y"] = serde_json::json!(y);
    if let Some(p) = config_path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let _ = std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&cfg).unwrap_or_default(),
    );
    Ok((x, y))
}

#[tauri::command]
pub fn get_ball_position(app: tauri::AppHandle) -> Result<(i32, i32), String> {
    let config_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let config_path = config_dir.join("config.json");
    let cfg: serde_json::Value = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or(serde_json::json!({}));
    if let (Some(x), Some(y)) = (cfg["ball_x"].as_i64(), cfg["ball_y"].as_i64()) {
        return Ok((x as i32, y as i32));
    }
    if let Some(window) = app.get_webview_window("ball") {
        if let Ok(position) = window.outer_position() {
            return Ok((position.x, position.y));
        }
    }
    Ok((100, 0))
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
        assert_eq!(
            cleanup_clipboard_text("computa-\ntion".into()).unwrap(),
            "computation"
        );
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
        assert_eq!(
            cleanup_clipboard_text("hello world".into()).unwrap(),
            "hello world"
        );
    }
}
