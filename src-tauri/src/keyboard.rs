/// Keyboard simulation for copy/paste and selection capture.
///
/// Selection capture uses three progressively more invasive strategies:
/// UI Automation, `WM_COPY` on the focused control, then `SendInput(Ctrl+C)`.
use std::thread;
use std::time::{Duration, Instant};

use crate::selection::{CapturedSelection, SelectionFingerprint, SelectionTarget};

/// Opaque identifier for the top-level window that owned focus when a
/// selection-replacement workflow started.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ForegroundWindowToken(isize);

impl ForegroundWindowToken {
    #[cfg(test)]
    pub(crate) fn from_raw(value: isize) -> Self {
        Self(value)
    }
}

/// Keeps the thread's COM apartment alive while live UIA ranges are held.
/// COM objects are apartment-affine: ranges captured on this thread are only
/// valid here and only while the apartment stays initialized.
#[cfg(target_os = "windows")]
#[derive(Debug)]
pub struct ComApartment {
    release: bool,
}

#[cfg(target_os = "windows")]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.release {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(not(target_os = "windows"))]
#[derive(Debug)]
pub struct ComApartment;

/// Hold the current thread's COM apartment. Leases stack; the apartment is
/// released when the last one drops.
pub fn hold_com_apartment() -> Option<ComApartment> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};

        let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if init.is_ok() {
            return Some(ComApartment { release: true });
        }
        // The thread already uses another apartment mode (e.g. MTA); that
        // apartment outlives this workflow and nothing has to be released.
        (init == RPC_E_CHANGED_MODE).then_some(ComApartment { release: false })
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// Live UIA text ranges kept as the logical position identity of one
/// capture. `same_as` compares them with `IUIAutomationTextRange::Compare`,
/// which — per the API documentation — checks endpoint equality: identical
/// text selected at another place is a different range.
#[cfg(target_os = "windows")]
#[derive(Clone, Debug)]
pub struct TextRangeIdentity(TextRangeSet);

#[cfg(target_os = "windows")]
#[derive(Clone, Debug)]
enum TextRangeSet {
    Native(Vec<windows::Win32::UI::Accessibility::IUIAutomationTextRange>),
    #[cfg(test)]
    Fake(u64),
}

#[cfg(target_os = "windows")]
impl TextRangeIdentity {
    pub fn from_ranges(
        ranges: Vec<windows::Win32::UI::Accessibility::IUIAutomationTextRange>,
    ) -> Self {
        Self(TextRangeSet::Native(ranges))
    }

    pub fn same_as(&self, other: &Self) -> bool {
        match (&self.0, &other.0) {
            (TextRangeSet::Native(mine), TextRangeSet::Native(theirs)) => {
                mine.len() == theirs.len()
                    && mine.iter().zip(theirs.iter()).all(|(a, b)| {
                        unsafe { a.Compare(b) }
                            .map(|same| same.as_bool())
                            .unwrap_or(false)
                    })
            }
            #[cfg(test)]
            (TextRangeSet::Fake(mine), TextRangeSet::Fake(theirs)) => mine == theirs,
            #[cfg(test)]
            _ => false,
        }
    }

    #[cfg(test)]
    pub fn fake(id: u64) -> Self {
        Self(TextRangeSet::Fake(id))
    }
}

#[cfg(not(target_os = "windows"))]
#[derive(Clone, Debug)]
pub struct TextRangeIdentity(());

#[cfg(not(target_os = "windows"))]
impl TextRangeIdentity {
    pub fn same_as(&self, _other: &Self) -> bool {
        false
    }
}

#[cfg(target_os = "windows")]
pub fn foreground_window_token() -> Option<ForegroundWindowToken> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let window = unsafe { GetForegroundWindow() };
    (!window.0.is_null()).then_some(ForegroundWindowToken(window.0 as isize))
}

#[cfg(not(target_os = "windows"))]
pub fn foreground_window_token() -> Option<ForegroundWindowToken> {
    None
}

pub fn foreground_window_is_current(expected: ForegroundWindowToken) -> bool {
    foreground_window_token() == Some(expected)
}

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
    crate::selection::normalize_source_text(&text)
}

#[cfg(target_os = "windows")]
struct UiaCapture {
    text: String,
    control_id: Vec<i32>,
    ranges: Vec<windows::Win32::UI::Accessibility::IUIAutomationTextRange>,
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
fn try_uia_capture() -> Option<UiaCapture> {
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

/// Clipboard sequence number used to notice foreign writes before restoring.
#[cfg(target_os = "windows")]
pub fn clipboard_sequence_number() -> u32 {
    use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
    unsafe { GetClipboardSequenceNumber() }
}

#[cfg(not(target_os = "windows"))]
pub fn clipboard_sequence_number() -> u32 {
    0
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
fn gui_thread_info() -> Option<windows::Win32::UI::WindowsAndMessaging::GUITHREADINFO> {
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
            return None;
        }

        let mut info = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        (GetGUIThreadInfo(thread_id, &mut info).is_ok() && !info.hwndFocus.0.is_null())
            .then_some(info)
    }
}

#[cfg(target_os = "windows")]
fn focused_control() -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    if let Some(info) = gui_thread_info() {
        return Some(info.hwndFocus);
    }
    let foreground = unsafe { GetForegroundWindow() };
    (!foreground.0.is_null()).then_some(foreground)
}

/// Focused control handle and caret rectangle as read-only identity bits.
#[cfg(target_os = "windows")]
fn focused_control_identity() -> (Option<isize>, Option<[i32; 4]>) {
    match gui_thread_info() {
        Some(info) => {
            let caret = (!info.hwndCaret.0.is_null()).then_some([
                info.rcCaret.left,
                info.rcCaret.top,
                info.rcCaret.right,
                info.rcCaret.bottom,
            ]);
            (Some(info.hwndFocus.0 as isize), caret)
        }
        None => (None, None),
    }
}

#[cfg(not(target_os = "windows"))]
fn focused_control_identity() -> (Option<isize>, Option<[i32; 4]>) {
    (None, None)
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
fn window_class(window: windows::Win32::Foundation::HWND) -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;

    unsafe {
        let mut class_name = [0u16; 256];
        let length = GetClassNameW(window, &mut class_name);
        (length > 0).then(|| String::from_utf16_lossy(&class_name[..length as usize]))
    }
}

#[cfg(target_os = "windows")]
fn foreground_window_class() -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let window = unsafe { GetForegroundWindow() };
    (!window.0.is_null())
        .then_some(window)
        .and_then(window_class)
}

/// Best-effort executable name of the foreground window's process.
#[cfg(target_os = "windows")]
fn foreground_process_name() -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null() {
            return None;
        }
        let mut process_id = 0u32;
        let _ = GetWindowThreadProcessId(window, Some(&mut process_id));
        if process_id == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
        let mut buffer = [0u16; 512];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);
        result.ok()?;
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        std::path::Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
    }
}

fn is_terminal_window_class(class_name: &str) -> bool {
    matches!(
        class_name.to_ascii_lowercase().as_str(),
        "cascadia_hosting_window_class" // Windows Terminal
            | "consolewindowclass" // conhost (cmd / PowerShell)
            | "mintty" // Git Bash
            | "virtualconsoleclass" // ConEmu / Cmder
            | "alacritty" // Alacritty
            | "org.wezfurlong.wezterm" // WezTerm
            | "hyper" // Hyper
    )
}

fn is_terminal_process_name(process_name: &str) -> bool {
    matches!(
        process_name.to_ascii_lowercase().as_str(),
        "windowsterminal.exe" // Windows Terminal
            | "mintty.exe" // Git Bash
            | "conemu64.exe" // ConEmu / Cmder
            | "alacritty.exe" // Alacritty
            | "wezterm-gui.exe" // WezTerm
            | "hyper.exe" // Hyper
    )
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
        .unwrap_or(false)
        || foreground_process_name()
            .as_deref()
            .map(is_terminal_process_name)
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

/// Classic Win32 edit controls answer `EM_GETSEL`; anything else is treated
/// as unverifiable and never auto-replaced.
fn is_edit_control_class(class: &str) -> bool {
    let class = class.to_ascii_lowercase();
    class == "edit" || class.starts_with("richedit")
}

/// `EM_GETSEL` packs both offsets into the return value's two 16-bit halves,
/// which is what makes the read work across processes. Empty or unreadable
/// selections come back as None.
#[cfg(target_os = "windows")]
fn edit_selection_offsets(hwnd: isize) -> Option<(u32, u32)> {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::SendMessageW;

    const EM_GETSEL: u32 = 0x00B0;
    let result = unsafe { SendMessageW(HWND(hwnd as _), EM_GETSEL, WPARAM(0), LPARAM(0)) };
    let packed = result.0 as u32;
    let (start, end) = (packed & 0xFFFF, (packed >> 16) & 0xFFFF);
    (end > start).then_some((start, end))
}

/// Read the whole control text (UTF-16) so the selected span can be compared
/// for content changes. Oversized or unreadable controls stay unverifiable.
#[cfg(target_os = "windows")]
fn read_control_text(hwnd: isize) -> Option<Vec<u16>> {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, SMTO_ABORTIFHUNG};

    const WM_GETTEXT: u32 = 0x000D;
    const WM_GETTEXTLENGTH: u32 = 0x000E;
    const MAX_CONTROL_TEXT: usize = 1 << 20;

    let window = HWND(hwnd as _);
    let mut length: usize = 0;
    let length_result = unsafe {
        SendMessageTimeoutW(
            window,
            WM_GETTEXTLENGTH,
            WPARAM(0),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            100,
            Some(&mut length),
        )
    };
    if length_result.0 == 0 || length > MAX_CONTROL_TEXT {
        return None;
    }
    let mut buffer = vec![0u16; length + 1];
    let mut copied: usize = 0;
    let text_result = unsafe {
        SendMessageTimeoutW(
            window,
            WM_GETTEXT,
            WPARAM(buffer.len()),
            LPARAM(buffer.as_mut_ptr() as isize),
            SMTO_ABORTIFHUNG,
            200,
            Some(&mut copied),
        )
    };
    if text_result.0 == 0 {
        return None;
    }
    buffer.truncate(copied.min(length));
    Some(buffer)
}

#[cfg(target_os = "windows")]
fn edit_target_for(
    window: ForegroundWindowToken,
    focus_hwnd: isize,
    caret: Option<[i32; 4]>,
) -> Option<SelectionTarget> {
    let class = window_class(windows::Win32::Foundation::HWND(focus_hwnd as _))?;
    if !is_edit_control_class(&class) {
        return None;
    }
    let (start, end) = edit_selection_offsets(focus_hwnd)?;
    let control_text = read_control_text(focus_hwnd)?;
    let fingerprint = crate::selection::edit_fingerprint(&control_text, start, end, caret)?;
    Some(SelectionTarget {
        window,
        focus_hwnd: Some(focus_hwnd),
        fingerprint,
    })
}

#[cfg(target_os = "windows")]
fn capture_edit_target(window: ForegroundWindowToken) -> Option<SelectionTarget> {
    let (focus_hwnd, caret) = focused_control_identity();
    edit_target_for(window, focus_hwnd?, caret)
}

/// Build the replace target from one UI Automation read. Without live ranges
/// and a control id, an equal text at another place cannot be told apart, so
/// the target stays unverifiable instead of guessing.
#[cfg(target_os = "windows")]
fn target_from_uia(window: ForegroundWindowToken, capture: &UiaCapture) -> Option<SelectionTarget> {
    if capture.control_id.is_empty() || capture.ranges.is_empty() {
        return None;
    }
    let (focus_hwnd, _) = focused_control_identity();
    Some(SelectionTarget {
        window,
        focus_hwnd,
        fingerprint: SelectionFingerprint::Uia {
            control_id: capture.control_id.clone(),
            text: capture.text.clone(),
            range: TextRangeIdentity::from_ranges(capture.ranges.clone()),
        },
    })
}

#[cfg(target_os = "windows")]
fn capture_uia_target(window: ForegroundWindowToken) -> Option<SelectionTarget> {
    let capture = try_uia_capture()?;
    target_from_uia(window, &capture)
}

/// Read the replace target as it is right now. `None` means the application
/// does not expose a verifiable control/selection identity.
#[cfg(target_os = "windows")]
pub fn capture_selection_target() -> Option<SelectionTarget> {
    let window = foreground_window_token()?;
    capture_uia_target(window).or_else(|| capture_edit_target(window))
}

#[cfg(not(target_os = "windows"))]
pub fn capture_selection_target() -> Option<SelectionTarget> {
    None
}

/// True while the captured selection is provably the one under the caret now.
pub fn target_is_unchanged(captured: &SelectionTarget) -> bool {
    let _apartment = hold_com_apartment();
    foreground_window_is_current(captured.window)
        && capture_selection_target()
            .is_some_and(|now| crate::selection::target_still_valid(captured, &now))
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

/// Paste clipboard content via simulated Ctrl+V.
#[cfg(target_os = "windows")]
pub fn simulate_paste() -> bool {
    send_key_combo(vk::PASTE, false)
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_paste() -> bool {
    log::warn!("simulate_paste only available on Windows");
    false
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
        assert!(is_terminal_window_class("mintty"));
        assert!(is_terminal_window_class("VirtualConsoleClass"));
        assert!(is_terminal_window_class("Alacritty"));
        assert!(is_terminal_window_class("org.wezfurlong.wezterm"));
        assert!(!is_terminal_window_class("Chrome_WidgetWin_1"));
    }

    #[test]
    fn recognizes_common_terminal_process_names() {
        assert!(is_terminal_process_name("mintty.exe"));
        assert!(is_terminal_process_name("ConEmu64.exe"));
        assert!(is_terminal_process_name("alacritty.exe"));
        assert!(is_terminal_process_name("wezterm-gui.exe"));
        assert!(is_terminal_process_name("WindowsTerminal.exe"));
        assert!(!is_terminal_process_name("chrome.exe"));
        assert!(!is_terminal_process_name("explorer.exe"));
    }

    #[test]
    fn recognizes_classic_edit_control_classes() {
        assert!(is_edit_control_class("Edit"));
        assert!(is_edit_control_class("RICHEDIT50W"));
        assert!(!is_edit_control_class("Chrome_WidgetWin_1"));
    }

    #[test]
    fn edit_control_identity_detects_replaced_content_at_the_same_selection() {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, SendMessageW, SetWindowTextW, WINDOW_EX_STYLE,
            WS_OVERLAPPEDWINDOW,
        };

        const EM_SETSEL: u32 = 0x00B1;
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                windows::core::w!("Edit"),
                windows::core::w!("vanish-trans edit identity test"),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                320,
                120,
                HWND::default(),
                None,
                None,
                None,
            )
        }
        .expect("test edit window");
        let select = |start: usize, end: isize| unsafe {
            SendMessageW(hwnd, EM_SETSEL, WPARAM(start), LPARAM(end));
        };

        unsafe { SetWindowTextW(hwnd, windows::core::w!("hello world")) }.expect("set test text");
        select(0, 5);
        let captured = edit_target_for(ForegroundWindowToken::from_raw(1), hwnd.0 as isize, None)
            .expect("edit identity must be readable");

        // Same offsets and caret, but the content inside them was replaced.
        unsafe { SetWindowTextW(hwnd, windows::core::w!("howdy world")) }
            .expect("replace test text");
        select(0, 5);
        let now = edit_target_for(ForegroundWindowToken::from_raw(1), hwnd.0 as isize, None)
            .expect("edit identity must be readable");
        let _ = unsafe { DestroyWindow(hwnd) };

        assert_eq!(captured.source_text(), "hello");
        assert_eq!(now.source_text(), "howdy");
        assert!(!crate::selection::target_still_valid(&captured, &now));
    }
}
