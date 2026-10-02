use std::sync::atomic::AtomicBool;

use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::commands::app::{FRONTEND_READY, QUICK_FRONTEND_READY};
use crate::commands::clipboard::cleanup_clipboard_text;
use crate::error::CommandError;

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
) -> Result<bool, CommandError> {
    // fetch_not is the atomic read-modify-write; a plain load+store can lose a
    // toggle raced against the tray pin item (lib.rs::toggle_top must use the
    // same primitive).
    let pinned = !state.pinned.fetch_not(std::sync::atomic::Ordering::SeqCst);
    // The tray label mirrors the pin state even when the ball window lookup
    // fails, so it is updated outside the window check.
    let label = if pinned {
        "取消保持主界面展开"
    } else {
        "保持主界面展开"
    };
    if let Some(item) = app.try_state::<crate::PinMenuItem>() {
        let _ = item.0.set_text(label);
    }
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
    retain_surface: Option<bool>,
    clip: Option<super::window_bounds::BallClipSpec>,
) -> Result<bool, CommandError> {
    if window.label() != "ball" {
        return Err(CommandError::validation("窗口边界只能应用到灵动岛"));
    }
    if width == 0 || height == 0 {
        return Err(CommandError::validation("灵动岛窗口尺寸必须大于零"));
    }
    if !screen_coordinate_is_sane(x) || !screen_coordinate_is_sane(y) {
        return Err(CommandError::validation("灵动岛窗口坐标超出范围"));
    }

    #[cfg(target_os = "windows")]
    {
        if retain_surface.unwrap_or(false) {
            return super::window_bounds::retain_surface(&window, x, y, width, height, clip);
        }
        super::window_bounds::set_bounds(&window, x, y, width, height)?;
        Ok(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (retain_surface, clip);
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
            .map_err(|error| CommandError::internal(error.to_string()))?;
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
            .map_err(|error| CommandError::internal(error.to_string()))?;
        Ok(false)
    }
}

// -----------------------------------------------------------
// Quick window helpers (shared with screenshot flow)
// -----------------------------------------------------------

#[cfg(target_os = "windows")]
pub(crate) fn show_without_activation<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
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
pub(crate) fn show_without_activation<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.show();
}

const FRONTEND_READY_WAIT: std::time::Duration = std::time::Duration::from_millis(5000);

/// Virtual screen coordinates can be negative (monitors left of the primary)
/// but anything beyond this magnitude is junk the frontend must not write.
fn screen_coordinate_is_sane(value: i32) -> bool {
    i64::from(value).abs() <= 32767
}

/// Async readiness wait for Tauri commands. Non-async commands run on the
/// webview IPC thread, where a sleeping loop would freeze every queued
/// command — including the frontend_ready dispatch this wait depends on.
pub(crate) async fn wait_for_frontend(ready: &AtomicBool) -> Result<(), CommandError> {
    wait_for_frontend_until(ready, FRONTEND_READY_WAIT).await
}

async fn wait_for_frontend_until(
    ready: &AtomicBool,
    timeout: std::time::Duration,
) -> Result<(), CommandError> {
    let deadline = std::time::Instant::now() + timeout;
    while !ready.load(std::sync::atomic::Ordering::SeqCst) {
        if std::time::Instant::now() >= deadline {
            return Err(CommandError::internal("前端监听器尚未就绪"));
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    Ok(())
}

/// Blocking readiness wait for plain worker threads (shortcut/screenshot
/// workers). Never call this on the IPC thread or inside an async command.
pub(crate) fn wait_for_frontend_sync(ready: &AtomicBool) -> Result<(), CommandError> {
    let mut waited = 0u32;
    let limit = FRONTEND_READY_WAIT.as_millis() as u32;
    while !ready.load(std::sync::atomic::Ordering::SeqCst) && waited < limit {
        std::thread::sleep(std::time::Duration::from_millis(10));
        waited += 10;
    }
    if ready.load(std::sync::atomic::Ordering::SeqCst) {
        Ok(())
    } else {
        Err(CommandError::internal("前端监听器尚未就绪"))
    }
}

pub(super) fn position_quick_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let (x, y) = crate::cursor::compute_cursor_follow_position(app, 392.0, 330.0);
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
}

fn deliver_quick_translation(app: &tauri::AppHandle, text: String) -> Result<(), CommandError> {
    let window = app
        .get_webview_window("quick")
        .ok_or_else(|| CommandError::not_found("找不到迷你翻译窗口"))?;
    position_quick_window(app, &window);
    window
        .show()
        .map_err(|error| CommandError::internal(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| CommandError::internal(error.to_string()))?;
    window
        .emit("quick-translate", text)
        .map_err(|error| CommandError::internal(error.to_string()))
}

/// Sync variant for plain worker threads (shortcut handlers). Async commands
/// must use `show_quick_translation_async`.
pub(crate) fn show_quick_translation(
    app: &tauri::AppHandle,
    text: String,
) -> Result<(), CommandError> {
    let seq = super::quick_result::claim_quick_request();
    show_quick_translation_if_current(app, text, seq)
}

/// Async variant for commands: the readiness poll yields instead of freezing
/// the IPC thread while the frontend listener registers.
pub(crate) async fn show_quick_translation_async(
    app: &tauri::AppHandle,
    text: String,
) -> Result<(), CommandError> {
    let seq = super::quick_result::claim_quick_request();
    // Same contract as the sync variant: poll before taking QUICK_SEQUENCE.
    wait_for_frontend(&QUICK_FRONTEND_READY).await?;
    super::quick_result::with_current_quick_request(seq, || deliver_quick_translation(app, text))
        .unwrap_or(Ok(()))
}

/// Alt+R's source fallback keeps the sequence claimed at shortcut start.
pub(crate) fn show_quick_translation_if_current(
    app: &tauri::AppHandle,
    text: String,
    seq: u64,
) -> Result<(), CommandError> {
    // Wait BEFORE taking QUICK_SEQUENCE: the up-to-5s wait inside the
    // mutex would block claim/reserve/reveal on every other quick request
    // (show_quick_result already follows this order).
    wait_for_frontend_sync(&QUICK_FRONTEND_READY)?;
    super::quick_result::with_current_quick_request(seq, || deliver_quick_translation(app, text))
        .unwrap_or(Ok(()))
}

/// Deliver an already-computed translation to the quick window. Pure display:
/// nothing is re-translated and no TM/history is written — the window shows
/// the result through its session without issuing a new request.
pub(crate) fn show_quick_result(
    app: &tauri::AppHandle,
    source: String,
    text: String,
    request_seq: u64,
) -> Result<(), CommandError> {
    #[derive(Clone, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct QuickResultPayload {
        source: String,
        text: String,
        request_seq: u64,
    }

    // Hidden webviews register listeners at startup. Never show or focus
    // before the frontend session accepts this request's result.
    wait_for_frontend_sync(&QUICK_FRONTEND_READY)?;
    super::quick_result::with_current_quick_request(request_seq, || {
        let window = app
            .get_webview_window("quick")
            .ok_or_else(|| CommandError::not_found("找不到迷你翻译窗口"))?;
        window
            .emit(
                "quick-translate-result",
                QuickResultPayload {
                    source,
                    text,
                    request_seq,
                },
            )
            .map_err(|error| CommandError::internal(error.to_string()))
    })
    .unwrap_or(Ok(()))
}

pub(crate) fn show_quick_error(app: &tauri::AppHandle, message: &str) -> Result<(), CommandError> {
    // Same ordering as show_quick_result: claim the sequence and wait for the
    // frontend BEFORE showing, so a stale error cannot steal focus over a
    // newer in-flight request or leave a visible window with no content.
    let seq = super::quick_result::claim_quick_request();
    wait_for_frontend_sync(&QUICK_FRONTEND_READY)?;
    super::quick_result::with_current_quick_request(seq, || {
        let window = app
            .get_webview_window("quick")
            .ok_or_else(|| CommandError::not_found("找不到迷你翻译窗口"))?;
        position_quick_window(app, &window);
        window
            .show()
            .map_err(|error| CommandError::internal(error.to_string()))?;
        window
            .set_focus()
            .map_err(|error| CommandError::internal(error.to_string()))?;
        window
            .emit("quick-translate-error", message)
            .map_err(|error| CommandError::internal(error.to_string()))
    })
    .unwrap_or(Ok(()))
}

// -----------------------------------------------------------
// Ball window commands
// -----------------------------------------------------------

#[tauri::command]
pub async fn show_main_window(app: tauri::AppHandle) -> Result<(), CommandError> {
    let window = app
        .get_webview_window("ball")
        .ok_or_else(|| CommandError::not_found("找不到灵动岛窗口"))?;
    window
        .show()
        .map_err(|e| CommandError::internal(e.to_string()))?;
    wait_for_frontend(&FRONTEND_READY).await?;
    window
        .emit("expand-main-window", ())
        .map_err(|e| CommandError::internal(e.to_string()))?;
    window
        .set_focus()
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub fn hide_quick_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub async fn show_main_with_text(app: tauri::AppHandle, text: String) -> Result<(), CommandError> {
    if let Some(quick) = app.get_webview_window("quick") {
        let _ = quick.hide();
    }
    let window = app
        .get_webview_window("ball")
        .ok_or_else(|| CommandError::not_found("找不到灵动岛窗口"))?;
    window
        .show()
        .map_err(|error| CommandError::internal(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| CommandError::internal(error.to_string()))?;
    wait_for_frontend(&FRONTEND_READY).await?;
    window
        .emit("expand-main-window", ())
        .map_err(|error| CommandError::internal(error.to_string()))?;
    window
        .emit("shortcut-translate", text)
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub async fn translate_clipboard_from_ball(app: tauri::AppHandle) -> Result<(), CommandError> {
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| CommandError::io(format!("读取剪贴板失败: {}", e)))?;
    if text.trim().is_empty() {
        return Err(CommandError::validation("剪贴板里没有可翻译的文本"));
    }
    let cleaned = cleanup_clipboard_text(text)?;
    show_quick_translation_async(&app, cleaned).await
}

#[tauri::command]
pub fn start_screenshot_from_ball(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    if window.label() != "ball" {
        return Err(CommandError::validation("该命令只能由灵动岛窗口调用"));
    }
    crate::setup::start_screenshot(app);
    Ok(())
}

#[tauri::command]
pub async fn toggle_ball_show_main(app: tauri::AppHandle) -> Result<(), CommandError> {
    let window = app
        .get_webview_window("ball")
        .ok_or_else(|| CommandError::not_found("找不到灵动岛窗口"))?;
    window
        .show()
        .map_err(|error| CommandError::internal(error.to_string()))?;
    wait_for_frontend(&FRONTEND_READY).await?;
    window
        .emit("toggle-main-window", ())
        .map_err(|error| CommandError::internal(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub fn toggle_ball(app: tauri::AppHandle) -> Result<(), CommandError> {
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
) -> Result<(i32, i32), CommandError> {
    let (x, y) = if let Some(w) = app.get_webview_window("ball") {
        // Validate against each monitor's work area — the same rect fallback
        // placement uses — so a saved position cannot survive on taskbar pixels.
        let mut cx = x;
        let mut cy = y;
        match w.available_monitors() {
            Ok(monitors) => {
                let mut adjusted_position = None;
                for m in &monitors {
                    let area = m.work_area();
                    let mx = area.position.x;
                    let my = area.position.y;
                    let mw = area.size.width as i32;
                    let mh = area.size.height as i32;
                    if let Some(position) = crate::clamp_ball_position_to_monitor(
                        cx,
                        cy,
                        mx,
                        my,
                        mw,
                        mh,
                        m.scale_factor(),
                    ) {
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
            Err(_) => {
                // Monitor enumeration failed: never persist raw frontend
                // coordinates; accept only plausible positions, else reset.
                if !screen_coordinate_is_sane(x) || !screen_coordinate_is_sane(y) {
                    (cx, cy) = (100, 0);
                }
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
        // No window to validate against: same sanity gate as above.
        if screen_coordinate_is_sane(x) && screen_coordinate_is_sane(y) {
            (x, y)
        } else {
            (100, 0)
        }
    };
    // Use the same recovery and write protection as every other config update.
    app.state::<crate::translate::ApiConfig>()
        .save_ball_position_fields(x, y)
        .map_err(CommandError::io)?;
    Ok((x, y))
}

/// Diagnostic: identify which window holds the foreground. Called from the
/// island's blur handler to reveal what steals focus after an expansion.
#[tauri::command]
pub fn get_foreground_window_info() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::PWSTR;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
        };

        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd == HWND::default() {
                return None;
            }
            let mut title = [0u16; 256];
            let title_len = GetWindowTextW(hwnd, &mut title);
            let mut class = [0u16; 128];
            let class_len = GetClassNameW(hwnd, &mut class);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let mut process = String::new();
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut size = 260u32;
                let mut buffer = vec![0u16; size as usize];
                if QueryFullProcessImageNameW(
                    handle,
                    windows::Win32::System::Threading::PROCESS_NAME_WIN32,
                    PWSTR(buffer.as_mut_ptr()),
                    &mut size,
                )
                .is_ok()
                {
                    process = String::from_utf16_lossy(&buffer[..size as usize]);
                }
                let _ = windows::Win32::Foundation::CloseHandle(handle);
            }
            Some(format!(
                "pid={pid} process={} class={} title={}",
                std::path::Path::new(&process)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or(process),
                String::from_utf16_lossy(&class[..class_len as usize]),
                String::from_utf16_lossy(&title[..title_len as usize]),
            ))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[tauri::command]
pub fn get_ball_position(app: tauri::AppHandle) -> Result<(i32, i32), CommandError> {
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
    fn screen_coordinate_bounds_accept_virtual_desktops_and_reject_garbage() {
        assert!(screen_coordinate_is_sane(0));
        assert!(screen_coordinate_is_sane(-2560));
        assert!(screen_coordinate_is_sane(32767));
        assert!(!screen_coordinate_is_sane(32768));
        assert!(!screen_coordinate_is_sane(-32768));
        assert!(!screen_coordinate_is_sane(i32::MIN));
        assert!(!screen_coordinate_is_sane(i32::MAX));
    }

    #[tokio::test]
    async fn wait_for_frontend_times_out_then_returns_when_ready() {
        let ready = AtomicBool::new(false);
        let error = wait_for_frontend_until(&ready, std::time::Duration::ZERO)
            .await
            .unwrap_err();
        assert_eq!(error.code, crate::error::code::INTERNAL);
        assert_eq!(error.message, "前端监听器尚未就绪");
        ready.store(true, std::sync::atomic::Ordering::SeqCst);
        wait_for_frontend(&ready).await.unwrap();
    }

    /// Regression: the wait must yield so the readiness flag can be set by a
    /// concurrently running task — a synchronous sleep loop on the IPC thread
    /// made this impossible and always timed out.
    #[tokio::test]
    async fn async_wait_observes_ready_set_by_another_task() {
        static READY: AtomicBool = AtomicBool::new(false);
        READY.store(false, std::sync::atomic::Ordering::SeqCst);
        let toggle = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            READY.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        wait_for_frontend_until(&READY, std::time::Duration::from_secs(2))
            .await
            .unwrap();
        toggle.await.unwrap();
        READY.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}
