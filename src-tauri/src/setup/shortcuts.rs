use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::clipboard::{
    backup_clipboard, restore_clipboard, should_restore_clipboard, ClipboardGuard,
};
use crate::keyboard;
use crate::lock::LockRecover;
use crate::translate::{self, ApiConfig};
use crate::AppState;

/// Currently registered shortcuts, protected by Mutex for dynamic updates.
/// Each entry is (Shortcut, action_name).
static REGISTERED_SHORTCUTS: std::sync::OnceLock<Mutex<Vec<(Shortcut, String)>>> =
    std::sync::OnceLock::new();
/// Serializes the unregister → register → track sequence in `sync_shortcuts`:
/// `set_hotkeys` and the tray pause toggle reach it from different threads
/// holding different locks, and interleaving could orphan a live hotkey grab.
static SYNC_SHORTCUTS_LOCK: Mutex<()> = Mutex::new(());
static ALT_Q_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutRegistrationConflict {
    action: String,
    shortcut: String,
    error: String,
}

struct AltQActiveGuard;

impl Drop for AltQActiveGuard {
    fn drop(&mut self) {
        ALT_Q_ACTIVE.store(false, Ordering::Release);
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ReplaceSelectionError {
    FocusChanged,
    ClipboardWrite(String),
    PasteInputRejected,
}

impl std::fmt::Display for ReplaceSelectionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FocusChanged => write!(formatter, "前台窗口已切换，已取消原地替换"),
            Self::ClipboardWrite(error) => write!(formatter, "写入剪贴板失败: {error}"),
            Self::PasteInputRejected => write!(formatter, "系统未接受粘贴按键"),
        }
    }
}

fn replace_clipboard_and_paste<CheckFocus, WriteClipboard, Paste, AfterPaste, Restore>(
    mut original_window_is_current: CheckFocus,
    write_clipboard: WriteClipboard,
    paste: Paste,
    after_paste: AfterPaste,
    restore_clipboard: Restore,
) -> Result<(), ReplaceSelectionError>
where
    CheckFocus: FnMut() -> bool,
    WriteClipboard: FnOnce() -> Result<(), String>,
    Paste: FnOnce() -> bool,
    AfterPaste: FnOnce(),
    Restore: FnOnce(),
{
    if !original_window_is_current() {
        return Err(ReplaceSelectionError::FocusChanged);
    }

    let mut restore_clipboard = Some(restore_clipboard);
    let restore = |restore_clipboard: &mut Option<Restore>| {
        if let Some(restore_clipboard) = restore_clipboard.take() {
            restore_clipboard();
        }
    };

    if let Err(error) = write_clipboard() {
        restore(&mut restore_clipboard);
        return Err(ReplaceSelectionError::ClipboardWrite(error));
    }

    if !original_window_is_current() {
        restore(&mut restore_clipboard);
        return Err(ReplaceSelectionError::FocusChanged);
    }

    if !paste() {
        restore(&mut restore_clipboard);
        return Err(ReplaceSelectionError::PasteInputRejected);
    }

    after_paste();
    restore(&mut restore_clipboard);
    Ok(())
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
fn unregister_all<E: std::fmt::Display>(
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

fn validate_shortcuts(
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

fn register_available_shortcuts(
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

    let (replacement, conflicts) = register_available_shortcuts(validated, |shortcut| {
        shortcut_plugin
            .register(shortcut)
            .map_err(|error| error.to_string())
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
    let text = keyboard::copy_selection(&app).map(|capture| capture.text);
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

/// Where a failed replace attempt hands its content.
#[derive(Debug, PartialEq, Eq)]
enum ReplacementDelivery<'a> {
    /// Nothing was translated yet: the quick window translates the source once.
    TranslateSource(&'a str),
    /// A translation already exists: deliver it as-is. Handing it to the
    /// translation channel would burn a second API call re-translating it.
    ShowResult { source: &'a str, text: &'a str },
}

fn delivery_for_failure<'a>(
    translated: Option<&'a str>,
    source: &'a str,
) -> ReplacementDelivery<'a> {
    match translated {
        Some(text) => ReplacementDelivery::ShowResult { source, text },
        None => ReplacementDelivery::TranslateSource(source),
    }
}

/// The captured selection is the only thing Alt+R may replace. `None` means
/// the identity is missing or belongs to another window: never paste.
fn replacement_target(
    captured: &crate::selection::CapturedSelection,
    original_window: keyboard::ForegroundWindowToken,
) -> Option<crate::selection::SelectionTarget> {
    captured
        .target
        .clone()
        .filter(|candidate| candidate.window == original_window)
}

/// Conservative Alt+R outcome: never paste, hand the content to the quick
/// result window instead.
fn deliver_to_quick_window(
    app: &tauri::AppHandle,
    delivery: ReplacementDelivery<'_>,
    reason: &str,
    quick_seq: u64,
) {
    log::info!("[alt-r] {reason}; showing the quick result window instead of pasting");
    let result = match delivery {
        ReplacementDelivery::TranslateSource(source) => {
            crate::commands::show_quick_translation_if_current(app, source.to_string(), quick_seq)
        }
        ReplacementDelivery::ShowResult { source, text } => {
            crate::commands::show_quick_result(app, source.to_string(), text.to_string(), quick_seq)
        }
    };
    if let Err(error) = result {
        log::warn!("[alt-r] Failed to show quick window: {error}");
    }
}

/// Alt+R: Copy → translate → verify the target → paste the replacement.
/// Falls back to the quick result window instead of pasting when the target
/// cannot be proven to still be the captured selection.
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

        // The shortcut claims its generation before selection capture and API work.
        // Frontend quick requests use the same monotonic sequence domain.
        let quick_seq = crate::commands::claim_quick_request();
        let api_config = app.state::<ApiConfig>();
        let seq = api_config.next_replace_request_seq();

        let Some(original_window) = keyboard::foreground_window_token() else {
            log::warn!("[alt-r] No foreground window; replacement cancelled");
            return;
        };

        // 1. Copy the selected text together with a read-only identity of the
        //    control and selection it came from (WM_COPY first, SendInput fallback).
        let Some(captured) = keyboard::copy_selection(&app) else {
            return;
        };

        let cleaned = captured
            .text
            .replace("\r\n", "\n")
            .replace("-\n", "")
            .trim()
            .to_string();
        if cleaned.is_empty() {
            return;
        }

        // Auto-replacement needs a provable target. Without one (for example in
        // applications that expose no control/selection identity) or when the
        // captured selection already moved during the copy, hand the text to
        // the quick result window instead of pasting blindly.
        let Some(replace_target) = replacement_target(&captured, original_window) else {
            deliver_to_quick_window(
                &app,
                delivery_for_failure(None, &cleaned),
                "Replace target is not verifiable",
                quick_seq,
            );
            return;
        };
        let target = translate::resolve_target_lang(&cleaned, "auto");
        let translated =
            match app
                .state::<AppState>()
                .runtime
                .block_on(translate::do_translate_unified(
                    &api_config,
                    &cleaned,
                    "auto",
                    target,
                )) {
                Ok(t) => {
                    if !api_config.is_current_replace_request(seq) {
                        return;
                    }
                    t
                }
                Err(e) => {
                    if let Some(w) = app.get_webview_window("ball") {
                        let _ = w.show();
                        let _ = w.emit("expand-main-window", ());
                        let _ = w.emit("screenshot-error", format!("❌ Alt+R 失败: {}", e));
                    }
                    return;
                }
            };

        // 2. Only replace in the window that owned focus when the workflow began.
        // Back up the now-restored user clipboard, then restore it after paste.
        let clipboard_backup = backup_clipboard(&app);
        let write_app = app.clone();
        let restore_app = app.clone();
        let write_seq = std::cell::Cell::new(0u32);
        let replacement = replace_clipboard_and_paste(
            || keyboard::target_is_unchanged(&replace_target),
            || {
                write_app
                    .clipboard()
                    .write_text(translated.clone())
                    .map_err(|error| error.to_string())?;
                write_app
                    .state::<ClipboardGuard>()
                    .mark_written(&translated);
                write_seq.set(keyboard::clipboard_sequence_number());
                Ok(())
            },
            keyboard::simulate_paste,
            || thread::sleep(Duration::from_millis(150)),
            || {
                if !should_restore_clipboard(write_seq.get(), keyboard::clipboard_sequence_number())
                {
                    log::warn!(
                        "[alt-r] Clipboard changed while pasting; keeping the user's content"
                    );
                    return;
                }
                if !restore_clipboard(&restore_app, clipboard_backup) {
                    log::warn!("[alt-r] Failed to restore the user's clipboard after paste");
                }
            },
        );

        match replacement {
            Err(ReplaceSelectionError::FocusChanged) => {
                deliver_to_quick_window(
                    &app,
                    delivery_for_failure(Some(&translated), &cleaned),
                    "Replace target changed during translation",
                    quick_seq,
                );
            }
            Err(error) => {
                log::warn!("[alt-r] Replacement cancelled: {error}");
                if let Some(window) = app.get_webview_window("ball") {
                    let _ = window.emit("screenshot-error", format!("Alt+R 失败: {error}"));
                }
            }
            Ok(()) => {}
        }
    });
}

/// Alt+W: Screenshot OCR.
pub(crate) fn start_screenshot(app: tauri::AppHandle) {
    log::info!("[start_screenshot] === called ===");
    std::thread::spawn(move || {
        if let Some(w) = app.get_webview_window("ball") {
            let _ = w.emit("screenshot-start", ());
        }
        let session_id = match crate::commands::prepare_screenshot(&app) {
            Ok(Some(session_id)) => session_id,
            Ok(None) => {
                log::info!("[screenshot] A capture session is already active");
                return;
            }
            Err(error) => {
                log::error!("[screenshot] Failed to hide capture windows: {error}");
                if let Some(w) = app.get_webview_window("ball") {
                    let _ = w.emit("screenshot-error", "无法隐藏灵动岛，截图已取消");
                }
                return;
            }
        };
        let (mut payload, raw_image) = match crate::ocr::capture_screenshot() {
            Some(d) => d,
            None => {
                log::error!("[screenshot] Capture failed");
                crate::commands::dismiss_screenshot(&app, session_id);
                if let Some(w) = app.get_webview_window("ball") {
                    let _ = w.emit("screenshot-error", "截图失败，请检查屏幕录制权限");
                }
                return;
            }
        };
        payload.session_id = session_id;
        {
            let sb = app.state::<crate::ocr::ScreenshotBuffer>();
            if !sb.store(session_id, payload.clone(), raw_image) {
                log::info!("[screenshot] Capture was cancelled before it became ready");
                return;
            }
        }
        if let Some(w) = app.get_webview_window("screenshot") {
            let _ = w.set_fullscreen(false);
            let _ = w.set_shadow(false);
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
                crate::commands::dismiss_screenshot(&app, session_id);
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
            // Undecorated windows with shadows gain hidden frame insets on
            // Windows (tao computes an offset for the shadow border), which
            // shifts the overlay content right/down by a few pixels. The
            // screenshot overlay must cover the monitor pixel-exactly.
            .shadow(false)
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
                        crate::commands::dismiss_screenshot(&app, session_id);
                        if let Some(ball) = app.get_webview_window("ball") {
                            let _ = ball.emit("screenshot-error", "无法打开截图窗口");
                        }
                    }
                }
                Err(error) => {
                    log::error!("[screenshot] Failed to create overlay: {}", error);
                    crate::commands::dismiss_screenshot(&app, session_id);
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
    fn rejects_shortcuts_with_multiple_key_parts() {
        // A second non-modifier part must be an error, not silently win.
        assert!(parse_shortcut("Ctrl+Q+W").is_err());
        assert!(parse_shortcut("Alt+1+2").is_err());
        assert!(parse_shortcut("Alt+Q+Q").is_err());
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

    #[test]
    fn registration_keeps_available_shortcuts_when_one_conflicts() {
        let validated = validate_shortcuts(&[
            ("translate".into(), "Alt+Q".into()),
            ("replace".into(), "Alt+R".into()),
            ("screenshot".into(), "Alt+W".into()),
        ])
        .unwrap();
        let conflicting = parse_shortcut("Alt+R").unwrap();

        let (registered, conflicts) = register_available_shortcuts(validated, |shortcut| {
            if shortcut == conflicting {
                Err("already registered".into())
            } else {
                Ok(())
            }
        });

        assert_eq!(registered.len(), 2);
        assert!(registered.iter().any(|(_, action)| action == "translate"));
        assert!(registered.iter().any(|(_, action)| action == "screenshot"));
        assert_eq!(
            conflicts,
            vec![ShortcutRegistrationConflict {
                action: "replace".into(),
                shortcut: "Alt+R".into(),
                error: "already registered".into(),
            }]
        );
    }

    #[test]
    fn unregister_all_keeps_entries_the_os_refused_to_release() {
        let stuck = parse_shortcut("Alt+R").unwrap();
        let released = parse_shortcut("Alt+Q").unwrap();
        let retained = unregister_all(
            vec![
                (released, "translate".to_string()),
                (stuck, "replace".to_string()),
            ],
            |shortcut| -> Result<(), String> {
                if shortcut == stuck {
                    Err("still held".into())
                } else {
                    Ok(())
                }
            },
        );
        assert_eq!(retained, vec![(stuck, "replace".to_string())]);
    }

    #[test]
    fn replacement_never_writes_after_focus_changed() {
        use std::cell::Cell;

        let wrote = Cell::new(false);
        let pasted = Cell::new(false);
        let restored = Cell::new(false);
        let result = replace_clipboard_and_paste(
            || false,
            || {
                wrote.set(true);
                Ok(())
            },
            || {
                pasted.set(true);
                true
            },
            || {},
            || restored.set(true),
        );

        assert_eq!(result, Err(ReplaceSelectionError::FocusChanged));
        assert!(!wrote.get());
        assert!(!pasted.get());
        assert!(!restored.get());
    }

    #[test]
    fn replacement_restores_clipboard_when_focus_changes_before_paste() {
        use std::cell::Cell;

        let focus_checks = Cell::new(0);
        let pasted = Cell::new(false);
        let restored = Cell::new(false);
        let result = replace_clipboard_and_paste(
            || {
                let check = focus_checks.get();
                focus_checks.set(check + 1);
                check == 0
            },
            || Ok(()),
            || {
                pasted.set(true);
                true
            },
            || {},
            || restored.set(true),
        );

        assert_eq!(result, Err(ReplaceSelectionError::FocusChanged));
        assert!(!pasted.get());
        assert!(restored.get());
    }

    #[test]
    fn replacement_restores_clipboard_on_write_and_paste_failures() {
        use std::cell::Cell;

        let write_restore_count = Cell::new(0);
        let write_result = replace_clipboard_and_paste(
            || true,
            || Err("locked".into()),
            || true,
            || {},
            || write_restore_count.set(write_restore_count.get() + 1),
        );
        assert_eq!(
            write_result,
            Err(ReplaceSelectionError::ClipboardWrite("locked".into()))
        );
        assert_eq!(write_restore_count.get(), 1);

        let paste_restore_count = Cell::new(0);
        let paste_result = replace_clipboard_and_paste(
            || true,
            || Ok(()),
            || false,
            || {},
            || paste_restore_count.set(paste_restore_count.get() + 1),
        );
        assert_eq!(paste_result, Err(ReplaceSelectionError::PasteInputRejected));
        assert_eq!(paste_restore_count.get(), 1);
    }

    #[test]
    fn successful_replacement_restores_clipboard_after_paste() {
        use std::cell::Cell;

        let pasted = Cell::new(false);
        let restored_after_paste = Cell::new(false);
        let result = replace_clipboard_and_paste(
            || true,
            || Ok(()),
            || {
                pasted.set(true);
                true
            },
            || assert!(pasted.get()),
            || restored_after_paste.set(pasted.get()),
        );

        assert_eq!(result, Ok(()));
        assert!(restored_after_paste.get());
    }

    #[test]
    fn post_translation_fallback_delivers_the_existing_result() {
        assert_eq!(
            delivery_for_failure(Some("译文"), "hello"),
            ReplacementDelivery::ShowResult {
                source: "hello",
                text: "译文"
            }
        );
        assert_eq!(
            delivery_for_failure(None, "hello"),
            ReplacementDelivery::TranslateSource("hello")
        );
    }

    #[test]
    fn unverifiable_identity_never_reaches_the_paste_flow() {
        use std::cell::Cell;

        let original = keyboard::ForegroundWindowToken::from_raw(1);
        let captured = crate::selection::CapturedSelection {
            text: "hello".into(),
            target: None,
            _apartment: None,
        };
        let pasted = Cell::new(false);
        let mut delivered: Option<ReplacementDelivery<'_>> = None;
        // The same routing handle_alt_r performs: without a target the paste
        // flow is never entered and the source goes to the quick window.
        if let Some(target) = replacement_target(&captured, original) {
            let _ = replace_clipboard_and_paste(
                || keyboard::target_is_unchanged(&target),
                || Ok(()),
                || {
                    pasted.set(true);
                    true
                },
                || {},
                || {},
            );
        } else {
            delivered = Some(delivery_for_failure(None, &captured.text));
        }
        assert!(!pasted.get());
        assert!(matches!(
            delivered,
            Some(ReplacementDelivery::TranslateSource("hello"))
        ));

        // A captured identity from another window is equally unusable.
        let foreign = crate::selection::CapturedSelection {
            text: "hello".into(),
            target: Some(crate::selection::SelectionTarget {
                window: keyboard::ForegroundWindowToken::from_raw(2),
                focus_hwnd: None,
                fingerprint: crate::selection::SelectionFingerprint::Edit {
                    start: 0,
                    end: 5,
                    caret: None,
                    text: "hello".into(),
                },
            }),
            _apartment: None,
        };
        assert!(replacement_target(&foreign, original).is_none());
    }
}
