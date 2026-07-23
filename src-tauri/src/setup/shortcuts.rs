use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::clipboard::ClipboardGuard;
use crate::commands::FRONTEND_READY;
use crate::keyboard;
use crate::translate::{self, ApiConfig};
use crate::AppState;

/// Currently registered shortcuts, protected by Mutex for dynamic updates.
/// Each entry is (Shortcut, action_name).
static REGISTERED_SHORTCUTS: std::sync::OnceLock<Mutex<Vec<(Shortcut, String)>>> =
    std::sync::OnceLock::new();

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
                            let _ = w.hide();
                            let _ = w.emit("screenshot-escape", ());
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
                    registered
                        .iter()
                        .find(|(s, _)| *s == *sc)
                        .map(|(_, a)| a.clone())
                };

                match action.as_deref() {
                    Some("translate") => handle_alt_q(app),
                    Some("replace") => handle_alt_r(app.clone()),
                    Some("screenshot") => start_screenshot(app.clone()),
                    _ => {}
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

/// Alt+Q: Copy selected text, show popup, translate.
fn handle_alt_q(app: &tauri::AppHandle) {
    keyboard::simulate_copy();
    thread::sleep(Duration::from_millis(80));
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        // Wait for frontend to signal readiness (max 500ms)
        let mut waited = 0u32;
        while !FRONTEND_READY.load(Ordering::SeqCst) && waited < 500 {
            thread::sleep(Duration::from_millis(10));
            waited += 10;
        }
        let _ = w.emit("shortcut-translate", ());
    }
}

/// Alt+R: Copy → translate → paste replacement.
fn handle_alt_r(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let app_state = app.state::<AppState>();
        let _lock = match app_state.alt_r_lock.try_lock() {
            Ok(g) => g,
            Err(_) => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                return;
            }
        };
        keyboard::simulate_copy();
        thread::sleep(Duration::from_millis(80));
        let guard = app.state::<ClipboardGuard>();
        let text = match app.clipboard().read_text() {
            Ok(t) if !t.trim().is_empty() => t,
            _ => return,
        };
        if guard.is_own_content(&text) {
            guard.clear_dirty();
            return;
        }
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
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.emit("ocr-translate", format!("❌ Alt+R 失败: {}", e));
                    }
                    return;
                }
            };
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
    std::thread::spawn(move || {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.emit("screenshot-start", ());
        }
        let (data_uri, raw_image) = match crate::ocr::capture_screenshot_as_data_uri() {
            Some(d) => d,
            None => {
                log::error!("[screenshot] Capture failed");
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit("screenshot-error", "截图失败，请检查屏幕录制权限");
                }
                return;
            }
        };
        {
            let sb = app.state::<crate::ocr::ScreenshotBuffer>();
            *sb.data_uri.lock().unwrap() = Some(data_uri.clone());
            *sb.image.lock().unwrap() = Some(raw_image);
        }
        if let Some(w) = app.get_webview_window("screenshot") {
            let _ = w.emit("screenshot-ready", data_uri);
            let _ = w.show();
            let _ = w.set_focus();
        } else {
            let _ = tauri::WebviewWindowBuilder::new(
                &app,
                "screenshot",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("VanishTrans Screenshot")
            .inner_size(1.0, 1.0)
            .fullscreen(true)
            .always_on_top(true)
            .decorations(false)
            .resizable(false)
            .visible(true)
            .skip_taskbar(true)
            .build();
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
