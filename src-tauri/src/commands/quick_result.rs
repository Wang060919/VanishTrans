//! Quick-window delivery order shared by native shortcuts and frontend actions.
use std::sync::Mutex;

use crate::error::CommandError;
use crate::lock::LockRecover;

static QUICK_SEQUENCE: Mutex<u64> = Mutex::new(0);

/// Claimed before an operation starts; never reset when a request ends.
pub(crate) fn claim_quick_request() -> u64 {
    let mut sequence = QUICK_SEQUENCE.lock_recover();
    *sequence += 1;
    *sequence
}

/// Hold the same lock across native delivery effects and new claims.
pub(crate) fn with_current_quick_request<T>(
    sequence: u64,
    deliver: impl FnOnce() -> T,
) -> Option<T> {
    let current = QUICK_SEQUENCE.lock_recover();
    if sequence != *current {
        return None;
    }
    Some(deliver())
}

#[tauri::command]
pub fn reserve_quick_request(window: tauri::WebviewWindow) -> Result<u64, CommandError> {
    if window.label() != "quick" {
        return Err(CommandError::validation("只能从迷你窗口登记请求"));
    }
    Ok(claim_quick_request())
}

/// The backend never reveals a result before frontend session acceptance.
#[tauri::command]
pub fn reveal_quick_result(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request_seq: u64,
) -> Result<bool, CommandError> {
    if window.label() != "quick" {
        return Err(CommandError::validation("只能显示迷你窗口的回退结果"));
    }
    with_current_quick_request(request_seq, || {
        super::window::position_quick_window(&app, &window);
        window
            .show()
            .map_err(|error| CommandError::internal(error.to_string()))?;
        window
            .set_focus()
            .map_err(|error| CommandError::internal(error.to_string()))
    })
    .transpose()
    .map(|delivered| delivered.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_delivery_never_runs_native_show_or_focus_path() {
        let old = claim_quick_request(); // Alt+R begins.
        let newer = claim_quick_request(); // Quick-window user begins B.
        let mut native_actions = 0;
        let delivered = with_current_quick_request(old, || {
            native_actions += 1; // position/show/focus/emit are behind this gate.
        });
        assert!(delivered.is_none());
        assert_eq!(native_actions, 0);
        assert!(with_current_quick_request(newer, || native_actions += 1).is_some());
        assert_eq!(native_actions, 1);
    }
}
