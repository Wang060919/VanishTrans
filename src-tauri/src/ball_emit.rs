use std::sync::atomic::Ordering;
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::lock::LockRecover;

/// Serializes queued island emits so deferred events keep call order: two
/// quick `toggle-main-window` requests must still toggle twice, not collapse
/// into whichever emit reaches the lock first.
static BALL_EMIT_LOCK: Mutex<()> = Mutex::new(());

/// Emit to the island only once its listeners are registered. Native callers
/// (tray, single-instance, hotkeys) fire before the ball frontend is ready;
/// an unconditional emit there is silently dropped, so retry briefly instead.
pub(crate) fn emit_to_ball_when_ready<S: serde::Serialize + Clone + Send + 'static>(
    app: &tauri::AppHandle,
    event: &'static str,
    payload: S,
) {
    let emit = |app: &tauri::AppHandle, payload: &S| {
        if let Some(window) = app.get_webview_window("ball") {
            let _ = window.emit(event, payload.clone());
        }
    };
    let guard = BALL_EMIT_LOCK.lock_recover();
    if crate::commands::FRONTEND_READY.load(Ordering::SeqCst) {
        emit(app, &payload);
        return;
    }
    let app = app.clone();
    drop(guard);
    let _ = std::thread::Builder::new()
        .name("ball-emit-when-ready".into())
        .spawn(move || {
            let _guard = BALL_EMIT_LOCK.lock_recover();
            // 5s max, same bound as `wait_for_frontend` in commands/window.rs.
            for _ in 0..200 {
                if crate::commands::FRONTEND_READY.load(Ordering::SeqCst) {
                    emit(&app, &payload);
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            log::warn!("[ball] dropped {event}: frontend never became ready");
        });
}
