use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::clipboard::ClipboardGuard;
use crate::keyboard;
use crate::translate::{self, ApiConfig};
use crate::AppState;

/// Currently registered shortcuts, protected by Mutex for dynamic updates.
/// Each entry is (Shortcut, action_name).
static REGISTERED_SHORTCUTS: std::sync::OnceLock<Mutex<Vec<(Shortcut, String)>>> =
    std::sync::OnceLock::new();
static ALT_Q_ACTIVE: AtomicBool = AtomicBool::new(false);

struct AltQActiveGuard;

impl Drop for AltQActiveGuard {
    fn drop(&mut self) {
        ALT_Q_ACTIVE.store(false, Ordering::Release);
    }
}

fn get_shortcuts() -> &'static Mutex<Vec<(Shortcut, String)>> {
    REGISTERED_SHORTCUTS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Parse a shortcut string like "Alt+Q" into a Shortcut object.
fn parse_shortcut(s: &str) -> Result<Shortcut, String> {
    let mut modifiers = Modifiers::empty();
    let mut key_code: Option<Code> = None;

    for part in s.split('+') {
        let part = part.trim();
        match part {
            "Alt" => modifiers |= Modifiers::ALT,
            "Ctrl" | "Control" => modifiers |= Modifiers::CONTROL,
            "Shift" => modifiers |= Modifiers::SHIFT,
            "Meta" | "Super" | "Win" => modifiers |= Modifiers::SUPER,
            _ => {
                // Map readable key names to Code
                key_code = Some(match part {
                    "Q" | "q" => Code::KeyQ,
                    "W" | "w" => Code::KeyW,
                    "E" | "e" => Code::KeyE,
                    "R" | "r" => Code::KeyR,
                    "T" | "t" => Code::KeyT,
                    "Y" | "y" => Code::KeyY,
                    "U" | "u" => Code::KeyU,
                    "I" | "i" => Code::KeyI,
                    "O" | "o" => Code::KeyO,
                    "P" | "p" => Code::KeyP,
                    "A" | "a" => Code::KeyA,
                    "S" | "s" => Code::KeyS,
                    "D" | "d" => Code::KeyD,
                    "F" | "f" => Code::KeyF,
                    "G" | "g" => Code::KeyG,
                    "H" | "h" => Code::KeyH,
                    "J" | "j" => Code::KeyJ,
                    "K" | "k" => Code::KeyK,
                    "L" | "l" => Code::KeyL,
                    "Z" | "z" => Code::KeyZ,
                    "X" | "x" => Code::KeyX,
                    "C" | "c" => Code::KeyC,
                    "V" | "v" => Code::KeyV,
                    "B" | "b" => Code::KeyB,
                    "N" | "n" => Code::KeyN,
                    "M" | "m" => Code::KeyM,
                    "Esc" | "Escape" => Code::Escape,
                    "Space" => Code::Space,
                    "1" => Code::Digit1,
                    "2" => Code::Digit2,
                    "3" => Code::Digit3,
                    "4" => Code::Digit4,
                    "5" => Code::Digit5,
                    "6" => Code::Digit6,
                    "7" => Code::Digit7,
                    "8" => Code::Digit8,
                    "9" => Code::Digit9,
                    "0" => Code::Digit0,
                    _ => return Err(format!("未知按键: {}", part)),
                });
            }
        }
    }

    let key = key_code.ok_or_else(|| format!("缺少按键: {}", s))?;
    if modifiers.is_empty() {
        return Err(format!("快捷键必须包含修饰键: {}", s));
    }
    Ok(Shortcut::new(Some(modifiers), key))
}

fn validate_shortcuts(hotkeys: &[(String, String)]) -> Result<Vec<(Shortcut, String)>, String> {
    let mut validated = Vec::with_capacity(hotkeys.len());
    for (action, combo) in hotkeys {
        if !matches!(action.as_str(), "translate" | "replace" | "screenshot") {
            return Err(format!("未知快捷键操作: {}", action));
        }
        if validated
            .iter()
            .any(|(_, existing_action)| existing_action == action)
        {
            return Err(format!("快捷键操作重复: {}", action));
        }

        let shortcut = parse_shortcut(combo)?;
        if validated.iter().any(|(existing, _)| *existing == shortcut) {
            return Err(format!("快捷键重复: {}", combo));
        }
        validated.push((shortcut, action.clone()));
    }
    Ok(validated)
}

/// Synchronize registered shortcuts with the current config.
/// Called on init and whenever hotkeys are updated.
pub fn sync_shortcuts(app: &tauri::AppHandle) -> Result<(), String> {
    let api_config = app.state::<ApiConfig>();
    let hotkeys = api_config.hotkeys.lock().unwrap().clone();
    let shortcut_plugin = app.global_shortcut();
    let validated = validate_shortcuts(&hotkeys)?;
    log::info!(
        "[sync_shortcuts] input hotkeys: {:?}, validated: {:?}",
        hotkeys,
        validated
            .iter()
            .map(|(s, a)| format!("{:?}→{}", s, a))
            .collect::<Vec<_>>()
    );

    // Validate the complete replacement set before touching active bindings.
    let previous = {
        let mut registered = get_shortcuts().lock().unwrap();
        std::mem::take(&mut *registered)
    };
    for (shortcut, _) in &previous {
        let _ = shortcut_plugin.unregister(*shortcut);
    }

    let mut replacement = Vec::with_capacity(validated.len());
    for (shortcut, action) in validated {
        if let Err(error) = shortcut_plugin.register(shortcut) {
            for (registered, _) in replacement.drain(..) {
                let _ = shortcut_plugin.unregister(registered);
            }

            let mut restored = Vec::with_capacity(previous.len());
            for (old_shortcut, old_action) in previous {
                match shortcut_plugin.register(old_shortcut) {
                    Ok(()) => restored.push((old_shortcut, old_action)),
                    Err(restore_error) => log::error!(
                        "[shortcut] Failed to restore {:?}: {}",
                        old_shortcut,
                        restore_error
                    ),
                }
            }
            *get_shortcuts().lock().unwrap() = restored;
            return Err(format!("注册快捷键 {} 失败: {}", action, error));
        }
        replacement.push((shortcut, action));
    }

    *get_shortcuts().lock().unwrap() = replacement;
    Ok(())
}

pub fn setup_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Register the global shortcut plugin FIRST — sync_shortcuts and
    // Alt+Escape registration both need the plugin to exist.
    let ah = app.handle().clone();
    ah.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, sc, ev| {
                if ev.state() != ShortcutState::Pressed {
                    return;
                }

                // Alt+Esc — dismiss screenshot overlay (always active)
                let esc = Shortcut::new(Some(Modifiers::ALT), Code::Escape);
                if *sc == esc {
                    if let Some(w) = app.get_webview_window("screenshot") {
                        if w.is_visible().unwrap_or(false) {
                            crate::commands::dismiss_screenshot(app);
                        }
                    }
                    return;
                }

                if !app
                    .state::<AppState>()
                    .shortcuts_enabled
                    .load(Ordering::SeqCst)
                {
                    return;
                }

                // Look up the action for this shortcut
                let action = {
                    let registered = get_shortcuts().lock().unwrap();
                    log::info!(
                        "[shortcut] fired: {:?}, registered: {:?}",
                        sc,
                        registered
                            .iter()
                            .map(|(s, a)| format!("{:?}→{}", s, a))
                            .collect::<Vec<_>>()
                    );
                    registered
                        .iter()
                        .find(|(s, _)| *s == *sc)
                        .map(|(_, a)| a.clone())
                };

                match action.as_deref() {
                    Some("translate") => {
                        log::info!("[shortcut] → handle_alt_q");
                        handle_alt_q(app);
                    }
                    Some("replace") => {
                        log::info!("[shortcut] → handle_alt_r");
                        handle_alt_r(app.clone());
                    }
                    Some("screenshot") => {
                        log::info!("[shortcut] → start_screenshot");
                        start_screenshot(app.clone());
                    }
                    other => {
                        log::warn!("[shortcut] no match for {:?}, action={:?}", sc, other);
                    }
                }
            })
            .build(),
    )?;

    // NOW the plugin exists — register shortcuts from config
    sync_shortcuts(app.handle())?;

    // Register Alt+Escape for screenshot dismiss (always present)
    let esc = Shortcut::new(Some(Modifiers::ALT), Code::Escape);
    if let Err(e) = app.global_shortcut().register(esc) {
        log::warn!("[shortcut] Failed to register Alt+Escape: {}", e);
    }

    Ok(())
}

/// Alt+Q: Copy selected text and translate it in the compact result window.
/// Uses WM_COPY (hook-safe) with SendInput(Ctrl+C) fallback.
/// Clipboard is backed up before and restored after the copy.
fn handle_alt_q(app: &tauri::AppHandle) {
    if ALT_Q_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        log::info!("[alt-q] Ignoring duplicate trigger while selection capture is active");
        return;
    }

    let app = app.clone();
    let spawn_result = thread::Builder::new()
        .name("alt-q-selection".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(move || run_alt_q(app));

    if let Err(error) = spawn_result {
        ALT_Q_ACTIVE.store(false, Ordering::Release);
        log::error!("[alt-q] Failed to start selection worker: {}", error);
    }
}

fn run_alt_q(app: tauri::AppHandle) {
    let _active_guard = AltQActiveGuard;
    log::info!("[alt-q] === start ===");

    // Copy selected text (WM_COPY first, SendInput fallback)
    //    Internally handles clipboard backup/restore.
    let text = keyboard::copy_selection(&app);
    log::info!(
        "[alt-q] captured {} chars",
        text.as_ref().map_or(0, String::len)
    );

    let result = if let Some(cleaned) = text {
        log::info!(
            "[alt-q] opening quick translation with {} chars",
            cleaned.len()
        );
        crate::commands::show_quick_translation(&app, cleaned)
    } else {
        log::info!("[alt-q] no text captured");
        crate::commands::show_quick_error(&app, "未读取到选中文字")
    };
    if let Err(error) = result {
        log::error!("[alt-q] Failed to show quick window: {}", error);
    }
    log::info!("[alt-q] === end ===");
}

/// Alt+R: Copy → translate → paste replacement.
/// Uses WM_COPY (hook-safe) for the copy step.
fn handle_alt_r(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let app_state = app.state::<AppState>();
        let _lock = match app_state.alt_r_lock.try_lock() {
            Ok(g) => g,
            Err(_) => {
                if let Some(w) = app.get_webview_window("ball") {
                    let _ = w.show();
                    let _ = w.set_focus();
                    let _ = w.emit("expand-main-window", ());
                }
                return;
            }
        };

        // 1. Copy selected text (WM_COPY first, SendInput fallback)
        let text = match keyboard::copy_selection(&app) {
            Some(t) => t,
            None => return,
        };

        let cleaned = text
            .replace("\r\n", "\n")
            .replace("-\n", "")
            .trim()
            .to_string();
        if cleaned.is_empty() {
            return;
        }
        let target = translate::resolve_target_lang(&cleaned, "auto");
        let api_config = app.state::<ApiConfig>();
        let seq = api_config.next_request_seq();
        let translated =
            match app
                .state::<AppState>()
                .runtime
                .block_on(translate::do_translate_async(
                    &api_config,
                    &cleaned,
                    "auto",
                    target,
                )) {
                Ok(t) => {
                    if !api_config.is_current_request(seq) {
                        return;
                    }
                    t
                }
                Err(e) => {
                    if let Some(w) = app.get_webview_window("ball") {
                        let _ = w.show();
                        let _ = w.emit("expand-main-window", ());
                        let _ = w.emit("ocr-translate", format!("❌ Alt+R 失败: {}", e));
                    }
                    return;
                }
            };

        // 2. Write translation to clipboard (guarded so clipboard watch ignores it)
        {
            let g = app.state::<ClipboardGuard>();
            g.mark_written(&translated);
            let _ = app.clipboard().write_text(&translated);
        }
        thread::sleep(Duration::from_millis(50));
        keyboard::simulate_paste();
    });
}

/// Alt+W: Screenshot OCR.
pub(crate) fn start_screenshot(app: tauri::AppHandle) {
    log::info!("[start_screenshot] === called ===");
    std::thread::spawn(move || {
        if let Some(w) = app.get_webview_window("ball") {
            let _ = w.emit("screenshot-start", ());
        }
        let Some(session_id) = crate::commands::prepare_screenshot(&app) else {
            log::info!("[screenshot] A capture session is already active");
            return;
        };
        let (payload, raw_image) = match crate::ocr::capture_screenshot() {
            Some(d) => d,
            None => {
                log::error!("[screenshot] Capture failed");
                crate::commands::dismiss_screenshot(&app);
                if let Some(w) = app.get_webview_window("ball") {
                    let _ = w.emit("screenshot-error", "截图失败，请检查屏幕录制权限");
                }
                return;
            }
        };
        {
            let sb = app.state::<crate::ocr::ScreenshotBuffer>();
            if !sb.store(session_id, payload.clone(), raw_image) {
                log::info!("[screenshot] Capture was cancelled before it became ready");
                return;
            }
        }
        if let Some(w) = app.get_webview_window("screenshot") {
            let _ = w.set_fullscreen(false);
            let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: payload.monitor_x,
                y: payload.monitor_y,
            }));
            let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: payload.monitor_width,
                height: payload.monitor_height,
            }));
            let _ = w.emit("screenshot-ready", payload);
            if let Err(error) = w.show().and_then(|_| w.set_focus()) {
                log::error!("[screenshot] Failed to show overlay: {}", error);
                crate::commands::dismiss_screenshot(&app);
            }
        } else {
            let window = tauri::WebviewWindowBuilder::new(
                &app,
                "screenshot",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("VanishTrans Screenshot")
            .inner_size(1.0, 1.0)
            .always_on_top(true)
            .decorations(false)
            .resizable(false)
            .visible(false)
            .skip_taskbar(true)
            .build();

            match window {
                Ok(w) => {
                    let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: payload.monitor_x,
                        y: payload.monitor_y,
                    }));
                    let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: payload.monitor_width,
                        height: payload.monitor_height,
                    }));
                    let _ = w.emit("screenshot-ready", payload);
                    if let Err(error) = w.show().and_then(|_| w.set_focus()) {
                        log::error!("[screenshot] Failed to show overlay: {}", error);
                        crate::commands::dismiss_screenshot(&app);
                        if let Some(ball) = app.get_webview_window("ball") {
                            let _ = ball.emit("screenshot-error", "无法打开截图窗口");
                        }
                    }
                }
                Err(error) => {
                    log::error!("[screenshot] Failed to create overlay: {}", error);
                    crate::commands::dismiss_screenshot(&app);
                    if let Some(ball) = app.get_webview_window("ball") {
                        let _ = ball.emit("screenshot-error", "无法打开截图窗口");
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_shortcuts() {
        assert!(parse_shortcut("Alt+Q").is_ok());
        assert!(parse_shortcut("Ctrl+Shift+Space").is_ok());
        assert!(parse_shortcut("Meta+1").is_ok());
    }

    #[test]
    fn rejects_shortcuts_without_modifier_or_unsupported_keys() {
        assert!(parse_shortcut("Q").is_err());
        assert!(parse_shortcut("Alt+↑").is_err());
        assert!(parse_shortcut("Alt+F1").is_err());
    }

    #[test]
    fn rejects_duplicate_actions_and_shortcuts() {
        assert!(validate_shortcuts(&[
            ("translate".into(), "Alt+Q".into()),
            ("translate".into(), "Alt+W".into()),
        ])
        .is_err());
        assert!(validate_shortcuts(&[
            ("translate".into(), "Alt+Q".into()),
            ("replace".into(), "Alt+Q".into()),
        ])
        .is_err());
    }
}
