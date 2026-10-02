mod app_state;
mod ball_emit;
mod ball_position;
mod clipboard;
mod commands;
mod config;
mod cursor;
mod error;
mod history;
mod keyboard;
mod lock;
mod logging;
mod ocr;
mod persistence;
#[cfg(test)]
mod persistence_test_support;
mod selection;
#[cfg(test)]
mod selection_tests;
mod setup;
mod tm;
mod translate;
mod tray_actions;
mod window_regions;

// Keep the historical crate-root paths (`crate::AppState`,
// `crate::toggle_shortcuts`, …) working for commands/ and setup/.
pub use app_state::{AppState, PinMenuItem, ShortcutsMenuItem, StartupWarnings, WatchMenuItem};
pub(crate) use ball_emit::emit_to_ball_when_ready;
pub(crate) use ball_position::{
    clamp_ball_position_to_monitor, default_ball_position_on_monitor, BALL_IDLE_HEIGHT,
    BALL_IDLE_WIDTH,
};
pub use tray_actions::{toggle_clipboard_watch, toggle_shortcuts};
// Kept on the crate root for parity with the pre-split paths; currently only
// exercised by ball_position_tests inside ball_position.rs.
#[allow(unused_imports)]
pub(crate) use ball_position::ball_position_is_visible;
pub(crate) use tray_actions::{toggle_main, toggle_top};

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Condvar, Mutex};

use tauri::Manager;

use crate::clipboard::ClipboardGuard;
use crate::history::HistoryStore;
use crate::lock::LockRecover;
use crate::ocr::ScreenshotBuffer;
use crate::translate::ApiConfig;

// -----------------------------------------------------------
// App entry
// -----------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();
    tauri::Builder::default()
        // Must be the first plugin: a second process exits here and forwards
        // its launch to the running instance, which expands the main window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("ball") {
                let _ = window.show();
                emit_to_ball_when_ready(app, "expand-main-window", ());
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            pinned: AtomicBool::new(false),
            shortcuts_enabled: AtomicBool::new(true),
            shortcut_suspend_count: AtomicUsize::new(0),
            clipboard_watch_enabled: AtomicBool::new(false),
            clipboard_watch_signal: (Mutex::new(false), Condvar::new()),
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
            if let Err(error) = logging::configure(&config_dir) {
                log::error!("[logging] Failed to configure file logging: {error}");
            }
            // OCR crops go through %TEMP% as plaintext PNGs; a crash skips the
            // drop-guard cleanup, so sweep leftovers before anything runs.
            ocr::sweep_stale_ocr_temp_files();
            let api_config = ApiConfig::load_or_default(config_dir.clone());
            let history_limit = api_config
                .max_records
                .load(std::sync::atomic::Ordering::Relaxed);
            // Resolve before `manage` takes ownership: a configured override
            // wins over the default app-data dir.
            let tm_dir = api_config.tm_db_dir(&config_dir);
            let mut startup_warnings = Vec::new();
            startup_warnings.extend(api_config.startup_warning().map(str::to_owned));
            app.manage(api_config);
            let history = HistoryStore::load_or_default_with_max(config_dir.clone(), history_limit);
            startup_warnings.extend(history.startup_warning().map(str::to_owned));
            app.manage(history);

            // Quick renders its own opaque surface with transparent corners.
            // Native Mica/Acrylic would fill those corners with a gray backdrop;
            // quick_frame owns the rounded outline without a second DWM surface.

            // Keep translation usable if persistent TM storage is unavailable.
            let translation_memory = match tm::TranslationMemory::open(&tm_dir) {
                Ok(memory) => memory,
                Err(error) => {
                    log::error!(
                        "[tm] Failed to initialize persistent storage at {}: {error}",
                        tm_dir.display()
                    );
                    startup_warnings.push(
                        "翻译记忆数据库不可用，本次运行将使用临时内存，退出后不会保留。".to_string(),
                    );
                    tm::TranslationMemory::open_in_memory().map_err(|fallback_error| {
                        std::io::Error::other(format!(
                            "翻译记忆初始化失败: {error}; 临时模式也失败: {fallback_error}"
                        ))
                    })?
                }
            };
            app.manage(translation_memory);
            app.manage(StartupWarnings(Mutex::new(startup_warnings)));

            // Periodic history flush — every 5 seconds, write dirty records to disk
            let flush_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                if let Err(error) = flush_handle.state::<HistoryStore>().flush() {
                    log::error!("[history] periodic flush failed: {error}");
                }
            });

            // Install before shortcuts can reveal either transparent window.
            #[cfg(target_os = "windows")]
            for label in ["ball", "quick"] {
                if let Some(window) = app.get_webview_window(label) {
                    let hwnd = windows::Win32::Foundation::HWND(window.hwnd()?.0);
                    commands::island_frame::install(hwnd)?;
                    if label == "quick" {
                        commands::quick_frame::install(hwnd)?;
                    }
                }
            }

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

                #[cfg(target_os = "windows")]
                commands::ball_region::clip_initial(windows::Win32::Foundation::HWND(
                    ball_w.hwnd()?.0,
                ))?;

                if let Err(error) = ball_w.show() {
                    log::error!("[ball] failed to show window on startup: {error}");
                }
            }

            // Pre-warm HTTP connection pool for faster first translation
            let warm_handle = app.handle().clone();
            app.state::<AppState>().runtime.spawn(async move {
                let cfg = warm_handle.state::<ApiConfig>();
                let base_url = cfg.base_url.lock_recover().clone();
                let client = cfg.client.lock_recover().clone();
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
            match e {
                // An OS-level close/hide of the screenshot overlay (Alt+F4,
                // a stray frontend hide) must release the capture session or
                // Alt+W stays wedged on "session already active" forever.
                // `dismiss_screenshot` reaches the same handler on its own
                // close(), where it is a no-op — the session already ended.
                tauri::WindowEvent::CloseRequested { .. }
                | tauri::WindowEvent::Destroyed
                    if w.label() == "screenshot" =>
                {
                    crate::setup::screenshot_window_closed(w);
                }
                tauri::WindowEvent::Focused(false) if w.label() == "quick" => {
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
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::frontend_ready,
            commands::get_startup_warnings,
            commands::quick_frontend_ready,
            commands::reserve_quick_request,
            commands::reveal_quick_result,
            commands::log_frontend_message,
            commands::set_logging_enabled,
            commands::get_logging_enabled,
            commands::read_clipboard_safe,
            commands::write_clipboard_safe,
            commands::hide_window,
            commands::toggle_pin,
            commands::get_pin_state,
            commands::set_ball_window_bounds,
            commands::start_window_drag,
            commands::get_api_config,
            commands::set_api_config,
            commands::set_hotkeys,
            commands::set_shortcuts_suspended,
            commands::set_glossary,
            commands::set_max_records,
            commands::set_free_translation,
            commands::list_service_profiles,
            commands::save_service_profile,
            commands::delete_service_profile,
            commands::apply_service_profile,
            commands::test_connection,
            commands::translate_with_direction,
            commands::translate_stream,
            commands::cancel_translation,
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
            commands::get_tm_dir,
            commands::set_tm_dir,
            commands::show_main_window,
            commands::hide_quick_window,
            commands::show_main_with_text,
            commands::translate_clipboard_from_ball,
            commands::start_screenshot_from_ball,
            commands::toggle_ball_show_main,
            commands::toggle_ball,
            commands::save_ball_position,
            commands::get_ball_position,
            commands::get_foreground_window_info,
        ])
        .build(tauri::generate_context!())
        .expect("启动 VanishTrans 失败")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Flush pending history once more on shutdown so a kill via the
                // OS or a crash path does not silently drop the last few seconds
                // of records (the tray "quit" path already flushes explicitly).
                if let Some(store) = app.try_state::<HistoryStore>() {
                    if let Err(error) = store.flush() {
                        log::error!("[history] exit flush failed: {error}");
                    }
                }
            }
        });
}
