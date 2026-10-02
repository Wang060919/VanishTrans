#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

use crate::selection::CapturedSelection;

#[cfg(target_os = "windows")]
use super::input::{send_key_combo, vk, wait_for_modifiers_release};
#[cfg(target_os = "windows")]
use super::platform::{
    clipboard_sequence_number, focused_control, foreground_is_terminal, foreground_window_token,
    hold_com_apartment,
};
#[cfg(target_os = "windows")]
use super::target::{capture_edit_target, target_from_uia};

#[cfg(target_os = "windows")]
fn normalize_selection(text: String) -> Option<String> {
    crate::selection::normalize_source_text(&text)
}

#[cfg(target_os = "windows")]
pub(crate) struct UiaCapture {
    pub(crate) text: String,
    pub(crate) control_id: Vec<i32>,
    pub(crate) ranges: Vec<windows::Win32::UI::Accessibility::IUIAutomationTextRange>,
}

#[cfg(target_os = "windows")]
unsafe fn read_i32_array(array: *mut windows::Win32::System::Com::SAFEARRAY) -> Vec<i32> {
    use windows::Win32::System::Ole::{
        SafeArrayDestroy, SafeArrayGetDim, SafeArrayGetElement, SafeArrayGetLBound,
        SafeArrayGetUBound,
    };

    let mut values = Vec::new();
    if !array.is_null() && SafeArrayGetDim(array) == 1 {
        if let (Ok(low), Ok(high)) = (SafeArrayGetLBound(array, 1), SafeArrayGetUBound(array, 1)) {
            for index in low..=high {
                let mut value = 0i32;
                if SafeArrayGetElement(array, &index, (&mut value as *mut i32).cast()).is_ok() {
                    values.push(value);
                }
            }
        }
    }
    let _ = SafeArrayDestroy(array);
    values
}

/// One UI Automation read: the selected text plus the identity needed to
/// recognize its control and position again later.
#[cfg(target_os = "windows")]
pub(crate) fn try_uia_capture() -> Option<UiaCapture> {
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId,
    };

    unsafe {
        let init_result = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninitialize = init_result.is_ok();
        if init_result.is_err() && init_result != RPC_E_CHANGED_MODE {
            log::debug!(
                "[keyboard] UI Automation COM init failed: {:?}",
                init_result
            );
            return None;
        }

        let result = (|| -> windows::core::Result<Option<UiaCapture>> {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let element = automation.GetFocusedElement()?;
            let control_id = element
                .GetRuntimeId()
                .map(|array| read_i32_array(array))
                .unwrap_or_default();
            let pattern: IUIAutomationTextPattern =
                element.GetCurrentPatternAs(UIA_TextPatternId)?;
            let ranges = pattern.GetSelection()?;
            let length = ranges.Length()?;
            let mut selected = Vec::new();
            let mut identity_ranges = Vec::new();

            for index in 0..length {
                let Ok(range) = ranges.GetElement(index) else {
                    continue;
                };
                let Ok(value) = range.GetText(-1) else {
                    continue;
                };
                if let Some(text) = normalize_selection(value.to_string()) {
                    selected.push(text);
                    identity_ranges.push(range);
                }
            }

            Ok((!selected.is_empty()).then(|| UiaCapture {
                text: selected.join("\n"),
                control_id,
                ranges: identity_ranges,
            }))
        })();

        if should_uninitialize {
            CoUninitialize();
        }

        match result {
            Ok(capture) => capture,
            Err(error) => {
                log::debug!("[keyboard] UI Automation selection unavailable: {}", error);
                None
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn wait_for_clipboard_text(
    app: &tauri::AppHandle,
    sequence_before: u32,
    timeout: Duration,
) -> Option<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let deadline = Instant::now() + timeout;
    let settle_time = Duration::from_millis(20);
    let mut observed_sequence = sequence_before;
    let mut last_change = None;
    let mut candidate = None;
    loop {
        let now = Instant::now();
        let sequence = clipboard_sequence_number();
        if sequence != observed_sequence {
            observed_sequence = sequence;
            last_change = Some(now);
            candidate = None;
        }
        if observed_sequence != sequence_before && candidate.is_none() {
            if let Ok(text) = app.clipboard().read_text() {
                candidate = normalize_selection(text);
            }
        }
        if candidate.is_some()
            && last_change
                .map(|changed_at| now.duration_since(changed_at) >= settle_time)
                .unwrap_or(false)
        {
            return candidate;
        }
        if now >= deadline {
            return candidate;
        }
        thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(target_os = "windows")]
fn try_wm_copy(app: &tauri::AppHandle) -> Option<String> {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_COPY};

    let hwnd = focused_control()?;
    let sequence_before = clipboard_sequence_number();
    unsafe {
        let _ = SendMessageTimeoutW(
            hwnd,
            WM_COPY,
            WPARAM(0),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            100,
            None,
        );
    }
    wait_for_clipboard_text(app, sequence_before, Duration::from_millis(400))
}

#[cfg(target_os = "windows")]
fn try_send_input_copy(app: &tauri::AppHandle) -> (&'static str, Option<String>) {
    if !wait_for_modifiers_release(Duration::from_millis(450)) {
        log::warn!("[keyboard] Copy fallback skipped because a modifier is still held");
        return ("SendInput", None);
    }

    let terminal_copy = foreground_is_terminal();
    let method = if terminal_copy {
        "SendInput Ctrl+Shift+C"
    } else {
        "SendInput Ctrl+C"
    };
    let sequence_before = clipboard_sequence_number();
    if !send_key_combo(vk::VIRTUAL_KEY(0x43), terminal_copy) {
        return (method, None);
    }
    (
        method,
        wait_for_clipboard_text(app, sequence_before, Duration::from_millis(550)),
    )
}

/// Copy the selected text from the foreground application and return it with
/// its replace-target identity, when that identity could be read at all.
///
/// UI Automation leaves the clipboard untouched and yields text and identity
/// from one read, so they cannot drift apart. Clipboard-based fallbacks back
/// up and restore the user's content around the copy — but only while no newer
/// user copy has landed — and pair the text with an edit-control selection
/// that stayed put across the copy.
#[cfg(target_os = "windows")]
pub fn copy_selection(app: &tauri::AppHandle) -> Option<CapturedSelection> {
    use crate::clipboard::{backup_clipboard, restore_clipboard, should_restore_clipboard};

    let apartment = hold_com_apartment();

    for attempt in 0..2 {
        if let Some(capture) = try_uia_capture() {
            log::info!(
                "[keyboard] UI Automation captured {} chars",
                capture.text.len()
            );
            let target =
                foreground_window_token().and_then(|window| target_from_uia(window, &capture));
            return Some(CapturedSelection {
                text: capture.text,
                target,
                _apartment: apartment,
            });
        }
        if attempt == 0 {
            thread::sleep(Duration::from_millis(24));
        }
    }

    let window = foreground_window_token();
    let before = window.and_then(capture_edit_target);
    let backup = backup_clipboard(app);
    let (method, text) = if let Some(text) = try_wm_copy(app) {
        ("WM_COPY", Some(text))
    } else {
        try_send_input_copy(app)
    };
    let seq_at_write = clipboard_sequence_number();
    let after = window.and_then(capture_edit_target);
    let target = match (before, after) {
        (Some(before), Some(after))
            if crate::selection::target_still_valid(&before, &after)
                && text.as_deref() == Some(after.source_text()) =>
        {
            Some(after)
        }
        _ => None,
    };

    if should_restore_clipboard(seq_at_write, clipboard_sequence_number()) {
        let _ = restore_clipboard(app, backup);
    } else {
        log::warn!(
            "[keyboard] Clipboard changed after the selection copy; keeping the user's content"
        );
    }

    if let Some(text) = text.as_ref() {
        log::info!("[keyboard] {} captured {} chars", method, text.len());
    }
    Some(CapturedSelection {
        text: text?,
        target,
        _apartment: apartment,
    })
}

#[cfg(not(target_os = "windows"))]
pub fn copy_selection(_app: &tauri::AppHandle) -> Option<CapturedSelection> {
    log::warn!("copy_selection only available on Windows");
    None
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn normalizes_selection_line_endings() {
        assert_eq!(
            normalize_selection("a\r\nb\rc\u{2029}d".into()).as_deref(),
            Some("a\nb\nc\nd")
        );
    }
}
