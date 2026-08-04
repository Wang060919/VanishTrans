mod clipboard;
mod commands;
mod cursor;
mod history;
mod keyboard;
mod ocr;
mod setup;
mod tm;
mod translate;
mod window_regions;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::clipboard::ClipboardGuard;
use crate::history::HistoryStore;
use crate::ocr::ScreenshotBuffer;
use crate::translate::ApiConfig;

pub(crate) const BALL_IDLE_WIDTH: f64 = 116.0;
pub(crate) const BALL_IDLE_HEIGHT: f64 = 42.0;
const BALL_POSITION_TOLERANCE: f64 = 8.0;
const BALL_TOP_GUTTER: f64 = 0.0;

fn default_ball_position_on_monitor(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    scale_factor: f64,
) -> (i32, i32) {
    let width = (BALL_IDLE_WIDTH * scale_factor).round() as i32;
    let gutter = (BALL_TOP_GUTTER * scale_factor).round() as i32;
    (
        monitor_x + (monitor_width - width).max(0) / 2,
        monitor_y + gutter,
    )
}

fn ball_position_bounds(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    scale_factor: f64,
) -> (i32, i32, i32, i32) {
    let tolerance = (BALL_POSITION_TOLERANCE * scale_factor).round() as i32;
    let width = (BALL_IDLE_WIDTH * scale_factor).round() as i32;
    let height = (BALL_IDLE_HEIGHT * scale_factor).round() as i32;
    let min_x = monitor_x - tolerance;
    let min_y = monitor_y - tolerance;
    let max_x_exclusive = (monitor_x + monitor_width - (width - tolerance)).max(min_x + 1);
    let max_y_exclusive = (monitor_y + monitor_height - (height - tolerance)).max(min_y + 1);

    (min_x, max_x_exclusive, min_y, max_y_exclusive)
}

pub(crate) fn ball_position_is_visible(
    x: i32,
    y: i32,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    scale_factor: f64,
) -> bool {
    let (min_x, max_x_exclusive, min_y, max_y_exclusive) = ball_position_bounds(
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
        scale_factor,
    );

    x >= min_x && x < max_x_exclusive && y >= min_y && y < max_y_exclusive
}

pub(crate) fn clamp_ball_position_to_monitor(
    x: i32,
    y: i32,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    scale_factor: f64,
) -> Option<(i32, i32)> {
    let tolerance = (BALL_POSITION_TOLERANCE * scale_factor).round() as i32;
    if ball_position_is_visible(
        x,
        y,
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
        scale_factor,
    ) {
        let snapped_y = if y <= monitor_y + tolerance {
            monitor_y
        } else {
            y
        };
        return Some((x, snapped_y));
    }

    let monitor_right = monitor_x + monitor_width;
    let monitor_bottom = monitor_y + monitor_height;
    if x < monitor_x - tolerance
        || x >= monitor_right
        || y < monitor_y - tolerance
        || y >= monitor_bottom
    {
        return None;
    }

    let (min_x, max_x_exclusive, min_y, max_y_exclusive) = ball_position_bounds(
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
        scale_factor,
    );
    Some((
        x.clamp(min_x, max_x_exclusive - 1),
        y.clamp(min_y, max_y_exclusive - 1),
    ))
}

#[cfg(test)]
mod ball_position_tests {
    use super::{
        ball_position_is_visible, clamp_ball_position_to_monitor, default_ball_position_on_monitor,
    };

    #[test]
    fn defaults_to_the_top_center_of_the_monitor() {
        assert_eq!(default_ball_position_on_monitor(0, 0, 1920, 1.0), (902, 0));
        assert_eq!(
            default_ball_position_on_monitor(-2560, -200, 2560, 1.5),
            (-1367, -200)
        );
    }

    #[test]
    fn migrates_the_previous_top_gutter_to_the_monitor_edge() {
        assert_eq!(
            clamp_ball_position_to_monitor(902, 8, 0, 0, 1920, 1080, 1.0),
            Some((902, 0))
        );
        assert_eq!(
            clamp_ball_position_to_monitor(-1367, -188, -2560, -200, 2560, 1440, 1.5),
            Some((-1367, -200))
        );
    }

    #[test]
    fn keeps_an_already_visible_position() {
        assert_eq!(
            clamp_ball_position_to_monitor(100, 100, 0, 0, 1920, 1080, 1.0),
            Some((100, 100))
        );
    }

    #[test]
    fn migrates_a_legacy_right_edge_position() {
        let legacy_x = 1920 - 58;
        assert!(!ball_position_is_visible(
            legacy_x, 100, 0, 0, 1920, 1080, 1.0
        ));
        assert_eq!(
            clamp_ball_position_to_monitor(legacy_x, 100, 0, 0, 1920, 1080, 1.0),
            Some((1811, 100))
        );
    }

    #[test]
    fn migrates_a_scaled_legacy_right_edge_position() {
        let legacy_x = 2560 - (58.0_f64 * 1.5).round() as i32;
        assert_eq!(
            clamp_ball_position_to_monitor(legacy_x, 150, 0, 0, 2560, 1440, 1.5),
            Some((2397, 150))
        );
    }

    #[test]
    fn rejects_a_position_outside_the_monitor() {
        assert_eq!(
            clamp_ball_position_to_monitor(3000, 100, 0, 0, 1920, 1080, 1.0),
            None
        );
    }
}

// -----------------------------------------------------------
// Global state
// -----------------------------------------------------------

pub struct AppState {
    pub pinned: AtomicBool,
    pub shortcuts_enabled: AtomicBool,
    pub clipboard_watch_enabled: AtomicBool,
    pub alt_r_lock: Mutex<()>,
    /// Shared tokio runtime for background translation (Alt+R).
    /// Avoids creating a new runtime per request.
    pub runtime: tokio::runtime::Runtime,
}

pub struct ShortcutsMenuItem(pub tauri::menu::MenuItem<tauri::Wry>);
pub struct WatchMenuItem(pub tauri::menu::MenuItem<tauri::Wry>);

// -----------------------------------------------------------
// App entry
// -----------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            pinned: AtomicBool::new(false),
            shortcuts_enabled: AtomicBool::new(true),
            clipboard_watch_enabled: AtomicBool::new(false),
            alt_r_lock: Mutex::new(()),
            runtime: tokio::runtime::Runtime::new().expect("Failed to create tokio runtime"),
        })
        .manage(ClipboardGuard::new())
        .manage(ScreenshotBuffer::new())
        .setup(|app| {
            let config_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let api_config = ApiConfig::load_or_default(config_dir.clone());
            app.manage(api_config);
            app.manage(HistoryStore::load_or_default(config_dir.clone()));

            // Use the compositor-backed Windows 11 acrylic material. Setting Mica
            // first enables the immersive dark DWM palette; Acrylic then replaces
            // the backdrop type while retaining that dark palette. Unlike the old
            // blur-behind API, this remains stable while dragging and resizing.
            #[cfg(target_os = "windows")]
            {
                for label in ["quick"] {
                    let Some(glass_window) = app.get_webview_window(label) else {
                        continue;
                    };
                    let _ = window_vibrancy::apply_mica(&glass_window, Some(true));
                    let _ = window_vibrancy::apply_acrylic(&glass_window, None);

                    // Windows 11 draws a one-pixel DWM outline around Acrylic
                    // windows even when Tauri decorations are disabled. Hide only
                    // that outline while keeping the native window shadow.
                    if let Ok(tauri_hwnd) = glass_window.hwnd() {
                        use windows::Win32::Foundation::HWND;
                        use windows::Win32::Graphics::Dwm::{
                            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
                            DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
                        };

                        let hwnd = HWND(tauri_hwnd.0 as _);
                        let border_color = DWMWA_COLOR_NONE;
                        unsafe {
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_BORDER_COLOR,
                                &border_color as *const u32 as *const std::ffi::c_void,
                                std::mem::size_of::<u32>() as u32,
                            );

                            let corner_preference = DWMWCP_ROUND;
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_WINDOW_CORNER_PREFERENCE,
                                &corner_preference as *const _ as *const std::ffi::c_void,
                                std::mem::size_of_val(&corner_preference) as u32,
                            );
                        }
                    }
                }
            }

            // Initialize Translation Memory (SQLite)
            match tm::TranslationMemory::open(&config_dir) {
                Ok(tmem) => {
                    app.manage(tmem);
                }
                Err(e) => {
                    log::error!("[tm] Failed to init: {}", e);
                }
            }

            // Periodic history flush — every 5 seconds, write dirty records to disk
            let flush_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                flush_handle.state::<HistoryStore>().flush();
            });

            setup::setup_tray(app)?;
            setup::setup_shortcuts(app)?;
            setup::setup_clipboard_watch(app);

            // Restore ball window position from config, clamped to visible monitor bounds
            if let Some(ball_w) = app.get_webview_window("ball") {
                let scale = ball_w.scale_factor().unwrap_or(1.0);
                let idle_width = (BALL_IDLE_WIDTH * scale).round() as u32;
                let idle_height = (BALL_IDLE_HEIGHT * scale).round() as u32;

                let _ = ball_w.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: idle_width,
                    height: idle_height,
                }));
                let config_dir = app
                    .path()
                    .app_data_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
                let config_path = config_dir.join("config.json");
                let saved_position = std::fs::read_to_string(&config_path)
                    .ok()
                    .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
                    .and_then(|config| {
                        Some((
                            config.get("ball_x")?.as_i64()? as i32,
                            config.get("ball_y")?.as_i64()? as i32,
                        ))
                    });
                let monitors = ball_w.available_monitors().unwrap_or_default();
                let default_position = ball_w
                    .primary_monitor()
                    .ok()
                    .flatten()
                    .or_else(|| ball_w.current_monitor().ok().flatten())
                    .map(|monitor| {
                        default_ball_position_on_monitor(
                            monitor.work_area().position.x,
                            monitor.work_area().position.y,
                            monitor.work_area().size.width as i32,
                            monitor.scale_factor(),
                        )
                    })
                    .or_else(|| {
                        monitors.first().map(|monitor| {
                            default_ball_position_on_monitor(
                                monitor.work_area().position.x,
                                monitor.work_area().position.y,
                                monitor.work_area().size.width as i32,
                                monitor.scale_factor(),
                            )
                        })
                    })
                    .unwrap_or((100, 0));

                let restored_position = saved_position.and_then(|(x, y)| {
                    log::info!("[ball] restoring saved position: ({}, {})", x, y);
                    if monitors.is_empty() {
                        return Some((x, y));
                    }
                    monitors.iter().find_map(|monitor| {
                        clamp_ball_position_to_monitor(
                            x,
                            y,
                            monitor.position().x,
                            monitor.position().y,
                            monitor.size().width as i32,
                            monitor.size().height as i32,
                            monitor.scale_factor(),
                        )
                    })
                });
                let (x, y) = restored_position.unwrap_or_else(|| {
                    if let Some((saved_x, saved_y)) = saved_position {
                        log::warn!(
                            "[ball] saved position ({}, {}) is outside all monitors, using top center",
                            saved_x,
                            saved_y
                        );
                    }
                    default_position
                });

                let _ = ball_w.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition { x, y },
                ));

                if let Err(error) = ball_w.show() {
                    log::error!("[ball] failed to show window on startup: {error}");
                }
            }

            // Pre-warm HTTP connection pool for faster first translation
            let warm_handle = app.handle().clone();
            app.state::<AppState>().runtime.spawn(async move {
                let cfg = warm_handle.state::<ApiConfig>();
                let base_url = cfg.base_url.lock().unwrap().clone();
                let client = cfg.client.lock().unwrap().clone();
                let url = if base_url.ends_with("/v1") || base_url.ends_with("/v1/") {
                    format!("{}/models", base_url.trim_end_matches('/'))
                } else {
                    format!("{}/v1/models", base_url)
                };
                let _ = client
                    .head(&url)
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await;
            });

            Ok(())
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Focused(false) = e {
                let label = w.label();
                if label == "quick" {
                    let app = w.app_handle().clone();
                    let state_app = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(120));
                        let _ = app.run_on_main_thread(move || {
                            if let Some(quick) = state_app.get_webview_window("quick") {
                                if !quick.is_focused().unwrap_or(true) {
                                    let _ = quick.hide();
                                }
                            }
                        });
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::frontend_ready,
            commands::quick_frontend_ready,
            commands::log_frontend_message,
            commands::read_clipboard_safe,
            commands::write_clipboard_safe,
            commands::hide_window,
            commands::toggle_pin,
            commands::get_pin_state,
            commands::set_ball_window_bounds,
            commands::get_api_config,
            commands::set_api_config,
            commands::set_hotkeys,
            commands::set_glossary,
            commands::set_max_records,
            commands::translate,
            commands::translate_with_direction,
            commands::translate_stream,
            commands::translate_batch,
            commands::cleanup_clipboard_text,
            commands::get_screenshot_payload,
            commands::cancel_screenshot,
            commands::run_ocr_on_crop,
            commands::finish_ocr,
            commands::get_history,
            commands::delete_history_record,
            commands::clear_history,
            commands::tm_search,
            commands::tm_delete,
            commands::tm_clear,
            commands::tm_stats,
            commands::tm_export,
            commands::tm_import,
            commands::tm_import_content,
            commands::show_main_window,
            commands::hide_quick_window,
            commands::show_main_with_text,
            commands::translate_clipboard_from_ball,
            commands::start_screenshot_from_ball,
            commands::toggle_ball_show_main,
            commands::toggle_ball,
            commands::save_ball_position,
            commands::get_ball_position,
        ])
        .run(tauri::generate_context!())
        .expect("启动 VanishTrans 失败");
}

// -----------------------------------------------------------
// Tray menu helpers (called from setup::tray)
// -----------------------------------------------------------

fn toggle_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("ball") {
        let _ = w.show();
        let _ = w.emit("toggle-main-window", ());
        let _ = w.set_focus();
    }
}

fn toggle_top(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let pinned = !state.pinned.load(Ordering::SeqCst);
    state.pinned.store(pinned, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("ball") {
        let _ = window.emit("pin-state-changed", pinned);
    }
}

pub fn toggle_shortcuts(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let enabled = !state.shortcuts_enabled.load(Ordering::SeqCst);
    state.shortcuts_enabled.store(enabled, Ordering::SeqCst);
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
}
