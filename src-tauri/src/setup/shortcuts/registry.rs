use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::lock::LockRecover;
use crate::translate::ApiConfig;
use crate::AppState;

use super::alt_flows::{handle_alt_q, handle_alt_r};
use super::start_screenshot;

/// Currently registered shortcuts, protected by Mutex for dynamic updates.
/// Each entry is (Shortcut, action_name).
static REGISTERED_SHORTCUTS: std::sync::OnceLock<Mutex<Vec<(Shortcut, String)>>> =
    std::sync::OnceLock::new();
/// Serializes the unregister → register → track sequence in `sync_shortcuts`:
/// `set_hotkeys` and the tray pause toggle reach it from different threads
/// holding different locks, and interleaving could orphan a live hotkey grab.
static SYNC_SHORTCUTS_LOCK: Mutex<()> = Mutex::new(());

/// Registration retries: a hotkey the OS still reports as taken is usually a
/// previous instance mid-shutdown, which releases its grabs within a few
/// hundred milliseconds. Retry briefly before surfacing a conflict.
const REGISTER_ATTEMPTS: u32 = 3;
const REGISTER_RETRY_DELAY: Duration = Duration::from_millis(400);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ShortcutRegistrationConflict {
    pub(super) action: String,
    pub(super) shortcut: String,
    pub(super) error: String,
}

fn get_shortcuts() -> &'static Mutex<Vec<(Shortcut, String)>> {
    REGISTERED_SHORTCUTS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Hotkeys are live only while the listener is enabled and no transient
/// suspension (hotkey recorder) is in flight.
fn shortcuts_are_active(app: &tauri::AppHandle) -> bool {
    let state = app.state::<AppState>();
    state.shortcuts_enabled.load(Ordering::SeqCst)
        && state.shortcut_suspend_count.load(Ordering::SeqCst) == 0
}

/// Unregister tracked shortcuts, returning the entries the OS refused to
/// release. Keeping them tracked lets the next sync retry instead of
/// orphaning a live global hotkey that keeps swallowing keystrokes.
pub(super) fn unregister_all<E: std::fmt::Display>(
    entries: Vec<(Shortcut, String)>,
    mut unregister: impl FnMut(Shortcut) -> Result<(), E>,
) -> Vec<(Shortcut, String)> {
    let mut failed = Vec::new();
    for (shortcut, action) in entries {
        if let Err(error) = unregister(shortcut) {
            log::warn!("[shortcut] Failed to unregister {shortcut:?} ({action}): {error}");
            failed.push((shortcut, action));
        }
    }
    failed
}

fn unregister_shortcuts(app: &tauri::AppHandle) {
    let previous = {
        let mut registered = get_shortcuts().lock_recover();
        std::mem::take(&mut *registered)
    };
    let plugin = app.global_shortcut();
    *get_shortcuts().lock_recover() =
        unregister_all(previous, |shortcut| plugin.unregister(shortcut));
}

/// Parse a shortcut string like "Alt+Q" into a Shortcut object.
pub(super) fn parse_shortcut(s: &str) -> Result<Shortcut, String> {
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
                if key_code.is_some() {
                    return Err(format!("快捷键包含多个按键: {}", s));
                }
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

pub(super) fn validate_shortcuts(
    hotkeys: &[(String, String)],
) -> Result<Vec<(Shortcut, String, String)>, String> {
    let mut validated = Vec::with_capacity(hotkeys.len());
    for (action, combo) in hotkeys {
        if !matches!(action.as_str(), "translate" | "replace" | "screenshot") {
            return Err(format!("未知快捷键操作: {}", action));
        }
        if validated
            .iter()
            .any(|(_, existing_action, _)| existing_action == action)
        {
            return Err(format!("快捷键操作重复: {}", action));
        }

        let shortcut = parse_shortcut(combo)?;
        if validated
            .iter()
            .any(|(existing, _, _)| *existing == shortcut)
        {
            return Err(format!("快捷键重复: {}", combo));
        }
        validated.push((shortcut, action.clone(), combo.clone()));
    }
    Ok(validated)
}

pub(super) fn register_available_shortcuts(
    validated: Vec<(Shortcut, String, String)>,
    mut register: impl FnMut(Shortcut) -> Result<(), String>,
) -> (Vec<(Shortcut, String)>, Vec<ShortcutRegistrationConflict>) {
    let mut registered = Vec::with_capacity(validated.len());
    let mut conflicts = Vec::new();

    for (shortcut, action, combo) in validated {
        match register(shortcut) {
            Ok(()) => registered.push((shortcut, action)),
            Err(error) => conflicts.push(ShortcutRegistrationConflict {
                action,
                shortcut: combo,
                error,
            }),
        }
    }

    (registered, conflicts)
}

fn publish_shortcut_conflicts(
    app: &tauri::AppHandle,
    conflicts: Vec<ShortcutRegistrationConflict>,
) {
    for conflict in &conflicts {
        log::warn!(
            "[shortcut] Could not register {} ({}): {}",
            conflict.action,
            conflict.shortcut,
            conflict.error
        );
    }

    let _ = app.emit("shortcut-registration-conflicts", conflicts.clone());
    if conflicts.is_empty()
        || crate::commands::FRONTEND_READY.load(std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }

    let app = app.clone();
    let _ = thread::Builder::new()
        .name("shortcut-conflict-notice".into())
        .spawn(move || {
            for _ in 0..200 {
                if crate::commands::FRONTEND_READY.load(std::sync::atomic::Ordering::SeqCst) {
                    let _ = app.emit("shortcut-registration-conflicts", conflicts);
                    return;
                }
                thread::sleep(Duration::from_millis(25));
            }
            log::warn!("[shortcut] Frontend was not ready to receive shortcut conflicts");
        });
}

/// Synchronize registered shortcuts with the current config.
/// Called on init and whenever hotkeys are updated.
pub fn sync_shortcuts(app: &tauri::AppHandle) -> Result<(), String> {
    let _sync_guard = SYNC_SHORTCUTS_LOCK.lock_recover();
    let shortcut_plugin = app.global_shortcut();
    // Releasing bindings needs no valid configuration — check activity before
    // validating so a corrupt hotkey set cannot block pausing the listener.
    if !shortcuts_are_active(app) {
        unregister_shortcuts(app);
        return Ok(());
    }
    let api_config = app.state::<ApiConfig>();
    let hotkeys = api_config.hotkeys.lock_recover().clone();
    let validated = validate_shortcuts(&hotkeys)?;
    log::info!(
        "[sync_shortcuts] input hotkeys: {:?}, validated: {:?}",
        hotkeys,
        validated
            .iter()
            .map(|(s, a, _)| format!("{:?}→{}", s, a))
            .collect::<Vec<_>>()
    );

    // Validate the complete replacement set before touching active bindings.
    let previous = {
        let mut registered = get_shortcuts().lock_recover();
        std::mem::take(&mut *registered)
    };
    // Entries the OS refused to release stay tracked so a later sync retries
    // unregistering them (and their old binding keeps working in the meantime,
    // which beats a live grab that silently eats keys without an action).
    let mut tracked = unregister_all(previous, |shortcut| shortcut_plugin.unregister(shortcut));

    // Re-check under the sync lock: a suspend/resume toggle racing the
    // unregister→register window must not leave live hotkeys registered
    // while suspended (they would silently swallow keystrokes).
    if !shortcuts_are_active(app) {
        *get_shortcuts().lock_recover() = tracked;
        return Ok(());
    }

    let (replacement, conflicts) = register_available_shortcuts(validated, |shortcut| {
        let mut attempt = 0;
        loop {
            match shortcut_plugin.register(shortcut) {
                Ok(()) => return Ok(()),
                Err(error) => {
                    attempt += 1;
                    if attempt >= REGISTER_ATTEMPTS {
                        return Err(error.to_string());
                    }
                    thread::sleep(REGISTER_RETRY_DELAY);
                }
            }
        }
    });

    tracked.extend(replacement);
    *get_shortcuts().lock_recover() = tracked;
    publish_shortcut_conflicts(app, conflicts);
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
                            if let Some(session_id) = app
                                .state::<crate::ocr::ScreenshotBuffer>()
                                .active_session_id()
                            {
                                crate::commands::dismiss_screenshot(app, session_id);
                            }
                        }
                    }
                    return;
                }

                if !shortcuts_are_active(app) {
                    return;
                }

                // Look up the action for this shortcut
                let action = {
                    let registered = get_shortcuts().lock_recover();
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

    // Register Alt+Escape for screenshot dismiss (always present)
    let esc = Shortcut::new(Some(Modifiers::ALT), Code::Escape);
    if let Err(e) = app.global_shortcut().register(esc) {
        log::warn!("[shortcut] Failed to register Alt+Escape: {}", e);
    }

    // Registration conflicts are a degraded state, not a startup failure.
    // Alt+Escape is registered first so it remains reserved for screenshot cancel.
    if let Err(error) = sync_shortcuts(app.handle()) {
        log::error!("[shortcut] Invalid shortcut configuration: {error}");
        publish_shortcut_conflicts(
            app.handle(),
            vec![ShortcutRegistrationConflict {
                action: "configuration".into(),
                shortcut: String::new(),
                error,
            }],
        );
    }

    Ok(())
}
