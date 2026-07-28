/// Keyboard simulation for copy/paste and selection capture.
///
/// Selection capture uses three progressively more invasive strategies:
/// UI Automation, `WM_COPY` on the focused control, then `SendInput(Ctrl+C)`.
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
mod vk {
    pub use windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY;
    pub const PASTE: VIRTUAL_KEY = VIRTUAL_KEY(0x56);
}

#[cfg(target_os = "windows")]
fn send_key_combo(key: vk::VIRTUAL_KEY, include_shift: bool) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VK_CONTROL, VK_SHIFT,
    };
    unsafe {
        let mk = |vk: vk::VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let mut inputs = Vec::with_capacity(if include_shift { 6 } else { 4 });
        inputs.push(mk(VK_CONTROL, KEYBD_EVENT_FLAGS::default()));
        if include_shift {
            inputs.push(mk(VK_SHIFT, KEYBD_EVENT_FLAGS::default()));
        }
        inputs.push(mk(key, KEYBD_EVENT_FLAGS::default()));
        inputs.push(mk(key, KEYEVENTF_KEYUP));
        if include_shift {
            inputs.push(mk(VK_SHIFT, KEYEVENTF_KEYUP));
        }
        inputs.push(mk(VK_CONTROL, KEYEVENTF_KEYUP));
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) == inputs.len() as u32
    }
}

#[cfg(target_os = "windows")]
fn normalize_selection(text: String) -> Option<String> {
    let normalized = text.replace("\r\n", "\n").replace(['\r', '\u{2029}'], "\n");
    (!normalized.trim().is_empty()).then_some(normalized)
}

#[cfg(target_os = "windows")]
fn try_uia_selection() -> Option<String> {
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

        let result = (|| -> windows::core::Result<Option<String>> {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let element = automation.GetFocusedElement()?;
            let pattern: IUIAutomationTextPattern =
                element.GetCurrentPatternAs(UIA_TextPatternId)?;
            let ranges = pattern.GetSelection()?;
            let length = ranges.Length()?;
            let mut selected = Vec::new();

            for index in 0..length {
                let Ok(range) = ranges.GetElement(index) else {
                    continue;
                };
                let Ok(value) = range.GetText(-1) else {
                    continue;
                };
                if let Some(text) = normalize_selection(value.to_string()) {
                    selected.push(text);
                }
            }

            Ok((!selected.is_empty()).then(|| selected.join("\n")))
        })();

        if should_uninitialize {
            CoUninitialize();
        }

        match result {
            Ok(text) => text,
            Err(error) => {
                log::debug!("[keyboard] UI Automation selection unavailable: {}", error);
                None
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn clipboard_sequence_number() -> u32 {
    use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
    unsafe { GetClipboardSequenceNumber() }
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
fn focused_control() -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO,
    };

    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() {
            return None;
        }

        let thread_id = GetWindowThreadProcessId(foreground, None);
        if thread_id == 0 {
            return Some(foreground);
        }

        let mut info = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        if GetGUIThreadInfo(thread_id, &mut info).is_ok() && !info.hwndFocus.0.is_null() {
            Some(info.hwndFocus)
        } else {
            Some(foreground)
        }
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
fn foreground_window_class() -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};

    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null() {
            return None;
        }
        let mut class_name = [0u16; 256];
        let length = GetClassNameW(window, &mut class_name);
        (length > 0).then(|| String::from_utf16_lossy(&class_name[..length as usize]))
    }
}

fn is_terminal_window_class(class_name: &str) -> bool {
    class_name.eq_ignore_ascii_case("CASCADIA_HOSTING_WINDOW_CLASS")
        || class_name.eq_ignore_ascii_case("ConsoleWindowClass")
}

#[cfg(target_os = "windows")]
fn wait_for_modifiers_release(timeout: Duration) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    let modifiers = [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN];
    let deadline = Instant::now() + timeout;
    loop {
        let released = modifiers
            .iter()
            .all(|key| unsafe { GetAsyncKeyState(key.0 as i32) & i16::MIN == 0 });
        if released {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(8));
    }
}

#[cfg(target_os = "windows")]
fn try_send_input_copy(app: &tauri::AppHandle) -> (&'static str, Option<String>) {
    if !wait_for_modifiers_release(Duration::from_millis(450)) {
        log::warn!("[keyboard] Copy fallback skipped because a modifier is still held");
        return ("SendInput", None);
    }

    let terminal_copy = foreground_window_class()
        .as_deref()
        .map(is_terminal_window_class)
        .unwrap_or(false);
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

/// Copy the selected text from the foreground application and return it.
///
/// UI Automation leaves the clipboard untouched. Clipboard-based fallbacks
/// back up and restore the user's text immediately after capture.
pub fn copy_selection(app: &tauri::AppHandle) -> Option<String> {
    use crate::clipboard::{backup_clipboard, restore_clipboard};

    for attempt in 0..2 {
        if let Some(text) = try_uia_selection() {
            log::info!("[keyboard] UI Automation captured {} chars", text.len());
            return Some(text);
        }
        if attempt == 0 {
            thread::sleep(Duration::from_millis(24));
        }
    }

    let backup = backup_clipboard(app);
    let (method, text) = if let Some(text) = try_wm_copy(app) {
        ("WM_COPY", Some(text))
    } else {
        try_send_input_copy(app)
    };
    restore_clipboard(app, backup);

    if let Some(text) = text.as_ref() {
        log::info!("[keyboard] {} captured {} chars", method, text.len());
    }
    text
}

#[cfg(not(target_os = "windows"))]
pub fn copy_selection(_app: &tauri::AppHandle) -> Option<String> {
    log::warn!("copy_selection only available on Windows");
    None
}

/// Paste clipboard content via simulated Ctrl+V.
#[cfg(target_os = "windows")]
pub fn simulate_paste() {
    send_key_combo(vk::PASTE, false);
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_paste() {
    log::warn!("simulate_paste only available on Windows");
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

    #[test]
    fn recognizes_native_windows_terminal_classes() {
        assert!(is_terminal_window_class("CASCADIA_HOSTING_WINDOW_CLASS"));
        assert!(is_terminal_window_class("ConsoleWindowClass"));
        assert!(!is_terminal_window_class("Chrome_WidgetWin_1"));
    }
}
