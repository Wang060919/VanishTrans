use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::clipboard::{
    backup_clipboard, restore_clipboard, should_restore_clipboard, ClipboardGuard,
};
use crate::history::HistoryStore;
use crate::keyboard;
use crate::lock::LockRecover;
use crate::translate::{self, ApiConfig};
use crate::AppState;

use super::replace_flow::{
    deliver_to_quick_window, delivery_for_failure, replace_clipboard_and_paste, replacement_target,
};
use super::CLIPBOARD_OP_LOCK;

static ALT_Q_ACTIVE: AtomicBool = AtomicBool::new(false);

struct AltQActiveGuard;

impl Drop for AltQActiveGuard {
    fn drop(&mut self) {
        ALT_Q_ACTIVE.store(false, Ordering::Release);
    }
}

/// Alt+Q: Copy selected text and translate it in the compact result window.
/// Uses WM_COPY (hook-safe) with SendInput(Ctrl+C) fallback.
/// Clipboard is backed up before and restored after the copy.
pub(super) fn handle_alt_q(app: &tauri::AppHandle) {
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
    //    Serialized with Alt+R's paste section so a restore cannot overwrite a
    //    clipboard the other flow just wrote for an in-flight paste.
    let text = {
        let _clipboard_op = CLIPBOARD_OP_LOCK.lock_recover();
        keyboard::copy_selection(&app)
    }
    .map(|capture| capture.text);
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

/// Alt+R: Copy → translate → verify the target → paste the replacement.
/// Falls back to the quick result window instead of pasting when the target
/// cannot be proven to still be the captured selection.
/// Uses WM_COPY (hook-safe) for the copy step.
pub(super) fn handle_alt_r(app: tauri::AppHandle) {
    // Selection capture, COM work and a blocking HTTP round-trip all run on
    // this worker; give it the same generous stack as the Alt+Q worker.
    let spawn_result = thread::Builder::new()
        .name("alt-r-replace".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(move || run_alt_r(app));
    if let Err(error) = spawn_result {
        log::error!("[alt-r] Failed to start replacement worker: {error}");
    }
}

/// `try_lock` with poison recovery: a panicked Alt+R worker must not wedge the
/// lock forever, but a live holder still blocks the next run (`WouldBlock`).
pub(super) fn try_alt_r_lock(lock: &Mutex<()>) -> Option<std::sync::MutexGuard<'_, ()>> {
    match lock.try_lock() {
        Ok(guard) => Some(guard),
        Err(std::sync::TryLockError::WouldBlock) => None,
        Err(std::sync::TryLockError::Poisoned(poison)) => Some(poison.into_inner()),
    }
}

fn run_alt_r(app: tauri::AppHandle) {
    let app_state = app.state::<AppState>();
    let _lock = match try_alt_r_lock(&app_state.alt_r_lock) {
        Some(g) => g,
        None => {
            // Surface a notice without stealing focus: set_focus here would
            // break the in-flight run's own target verification.
            if let Some(w) = app.get_webview_window("ball") {
                let _ = w.show();
                let _ = w.emit("screenshot-error", "上一个原地替换仍在进行中");
            }
            return;
        }
    };

    let api_config = app.state::<ApiConfig>();
    // Alt+R shares the normal request-scope domain under a dedicated label.
    let scope = "replace";
    let seq = api_config.next_request_seq(scope);

    let Some(original_window) = keyboard::foreground_window_token() else {
        log::warn!("[alt-r] No foreground window; replacement cancelled");
        return;
    };

    // 1. Copy the selected text together with a read-only identity of the
    //    control and selection it came from (WM_COPY first, SendInput fallback).
    //    Serialized with Alt+Q's capture and Alt+R's own paste section via the
    //    shared clipboard lock.
    let Some(captured) = ({
        let _clipboard_op = CLIPBOARD_OP_LOCK.lock_recover();
        keyboard::copy_selection(&app)
    }) else {
        let _ = crate::commands::show_quick_error(&app, "未读取到选中文字");
        return;
    };

    let cleaned = captured
        .text
        .replace("\r\n", "\n")
        .replace("-\n", "")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        let _ = crate::commands::show_quick_error(&app, "未读取到选中文字");
        return;
    }

    // Terminal selections are scrollback text, not editable input: pasting
    // would type the translation into the shell prompt instead of replacing
    // anything, so they go to the quick result window like any other
    // unverifiable target.
    if keyboard::foreground_is_terminal() {
        deliver_to_quick_window(
            &app,
            delivery_for_failure(None, &cleaned),
            "Terminal selections cannot be replaced",
        );
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
        );
        return;
    };

    let target = translate::resolve_target_lang(&cleaned, "auto");
    let snapshot = api_config.translation_snapshot();
    let context_hash = snapshot.context_hash();
    let tm_state = app.state::<crate::tm::TranslationMemory>();
    let history_state = app.state::<HistoryStore>();

    // Same cache and commit behavior as the quick/main translation path.
    let translated =
        if let Some(cached) = tm_state.lookup_in_context(&cleaned, "auto", target, &context_hash) {
            history_state.add(&cleaned, &cached, "auto");
            cached
        } else {
            match app_state
                .runtime
                .block_on(translate::do_translate_unified_scoped(
                    &api_config,
                    &snapshot,
                    &cleaned,
                    "auto",
                    target,
                    scope,
                    seq,
                )) {
                Ok(t) => {
                    if api_config
                        .with_current_request(scope, seq, || {
                            crate::commands::persist_translation(
                                &tm_state,
                                &history_state,
                                &cleaned,
                                &t,
                                "auto",
                                target,
                                &context_hash,
                            );
                        })
                        .is_none()
                    {
                        return;
                    }
                    t
                }
                Err(e) => {
                    if e != "CANCELLED" {
                        if let Some(w) = app.get_webview_window("ball") {
                            let _ = w.show();
                            crate::emit_to_ball_when_ready(&app, "expand-main-window", ());
                            let _ = w.emit("screenshot-error", format!("❌ Alt+R 失败: {}", e));
                        }
                    }
                    return;
                }
            }
        };

    // 2. Only replace in the window that owned focus when the workflow began.
    // Back up the now-restored user clipboard, then restore it after paste.
    //    The whole write→paste→confirm→restore sequence stays inside the
    //    shared clipboard lock so an Alt+Q restore cannot land between our
    //    write and the injected Ctrl+V (which would paste stale content
    //    while `after_paste` still reports success).
    let _clipboard_op = CLIPBOARD_OP_LOCK.lock_recover();
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
        || {
            // Keep the translated text on the clipboard until the target's
            // content provably changed: a busy target may not read the
            // clipboard until long after SendInput returns, and restoring
            // early would make it paste the old clipboard content instead.
            let deadline = Instant::now() + Duration::from_millis(1500);
            loop {
                if !keyboard::target_is_unchanged(&replace_target) {
                    return true;
                }
                if Instant::now() >= deadline {
                    return false;
                }
                thread::sleep(Duration::from_millis(30));
            }
        },
        || {
            // `write_seq` is only set after our own write succeeded. On a
            // failed write the clipboard may still have been disturbed (for
            // example emptied before a failing SetData), so the backup is
            // restored unconditionally then.
            let seq = write_seq.get();
            if seq != 0 && !should_restore_clipboard(seq, keyboard::clipboard_sequence_number()) {
                log::warn!("[alt-r] Clipboard changed while pasting; keeping the user's content");
                return;
            }
            if !restore_clipboard(&restore_app, clipboard_backup) {
                log::warn!("[alt-r] Failed to restore the user's clipboard after paste");
            }
        },
    );
    // Clipboard is stable again; release before the quick-window fallback
    // so a queued Alt+Q capture is not held up by window plumbing.
    drop(_clipboard_op);

    match replacement {
        Ok(()) => {}
        Err(error) => {
            // Nothing was provably replaced: hand the finished translation
            // to the quick result window instead of dropping it.
            deliver_to_quick_window(
                &app,
                delivery_for_failure(Some(&translated), &cleaned),
                &format!("Replacement did not land: {error}"),
            );
        }
    }
}
