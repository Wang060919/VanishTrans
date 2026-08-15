use std::sync::atomic::AtomicBool;

use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::commands::app::{FRONTEND_READY, QUICK_FRONTEND_READY};
use crate::commands::clipboard::cleanup_clipboard_text;
use crate::error::CommandError;
use crate::lock::LockRecover;

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
) -> Result<(), CommandError> {
    if window.label() != "ball" {
        return Err(CommandError::validation("窗口边界只能应用到灵动岛"));
    }
    if width == 0 || height == 0 {
        return Err(CommandError::validation("灵动岛窗口尺寸必须大于零"));
    }

    // Use Tauri's built-in methods - they handle Windows decorations correctly
    // Reference: RustyIsland (same Tauri v2 stack) uses only Tauri APIs
    // https://github.com/hasnain7abbas/RustyIsland
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|error| CommandError::internal(error.to_string()))?;
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|error| CommandError::internal(error.to_string()))
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

pub(crate) fn wait_for_frontend(ready: &AtomicBool) {
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

pub(crate) fn show_quick_translation(
    app: &tauri::AppHandle,
    text: String,
) -> Result<(), CommandError> {
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
    wait_for_frontend(&QUICK_FRONTEND_READY);
    window
        .emit("quick-translate", text)
        .map_err(|error| CommandError::internal(error.to_string()))
}

pub(crate) fn show_quick_error(app: &tauri::AppHandle, message: &str) -> Result<(), CommandError> {
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
    wait_for_frontend(&QUICK_FRONTEND_READY);
    window
        .emit("quick-translate-error", message)
        .map_err(|error| CommandError::internal(error.to_string()))
}

// -----------------------------------------------------------
// Ball window commands
// -----------------------------------------------------------

#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), CommandError> {
    let window = app
        .get_webview_window("ball")
        .ok_or_else(|| CommandError::not_found("找不到灵动岛窗口"))?;
    window
        .show()
        .map_err(|e| CommandError::internal(e.to_string()))?;
    wait_for_frontend(&FRONTEND_READY);
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
pub fn show_main_with_text(app: tauri::AppHandle, text: String) -> Result<(), CommandError> {
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
    wait_for_frontend(&FRONTEND_READY);
    window
        .emit("expand-main-window", ())
        .map_err(|error| CommandError::internal(error.to_string()))?;
    window
        .emit("shortcut-translate", text)
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub fn translate_clipboard_from_ball(app: tauri::AppHandle) -> Result<(), CommandError> {
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| CommandError::io(format!("读取剪贴板失败: {}", e)))?;
    if text.trim().is_empty() {
        return Err(CommandError::validation("剪贴板里没有可翻译的文本"));
    }
    let cleaned = cleanup_clipboard_text(text)?;
    show_quick_translation(&app, cleaned)
}

#[tauri::command]
pub fn start_screenshot_from_ball(app: tauri::AppHandle) {
    crate::setup::start_screenshot(app);
}

#[tauri::command]
pub fn toggle_ball_show_main(app: tauri::AppHandle) -> Result<(), CommandError> {
    let window = app
        .get_webview_window("ball")
        .ok_or_else(|| CommandError::not_found("找不到灵动岛窗口"))?;
    window
        .show()
        .map_err(|error| CommandError::internal(error.to_string()))?;
    wait_for_frontend(&FRONTEND_READY);
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
    // Persist to config (with lock to avoid concurrent write conflicts).
    // Written via tmp+rename so a crash mid-write cannot truncate config.json.
    let _lock = crate::translate::CONFIG_FILE_LOCK.lock_recover();
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
        std::fs::create_dir_all(p)
            .map_err(|e| CommandError::io(format!("创建配置目录失败: {}", e)))?;
    }
    let json = serde_json::to_string_pretty(&cfg)
        .map_err(|e| CommandError::io(format!("序列化配置失败: {}", e)))?;
    let tmp_path = config_path.with_extension("json.tmp");
    std::fs::write(&tmp_path, json)
        .map_err(|e| CommandError::io(format!("写入临时配置失败: {}", e)))?;
    if let Err(e) = std::fs::rename(&tmp_path, &config_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(CommandError::io(format!("替换配置文件失败: {}", e)));
    }
    Ok((x, y))
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
