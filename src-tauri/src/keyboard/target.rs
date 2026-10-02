#[cfg(target_os = "windows")]
use crate::selection::SelectionFingerprint;
use crate::selection::SelectionTarget;

#[cfg(target_os = "windows")]
use super::capture::{try_uia_capture, UiaCapture};
#[cfg(target_os = "windows")]
use super::platform::{
    focused_control_identity, foreground_is_terminal, foreground_window_token, window_class,
    ForegroundWindowToken, TextRangeIdentity,
};

/// Classic Win32 edit controls answer `EM_GETSEL`; anything else is treated
/// as unverifiable and never auto-replaced.
fn is_edit_control_class(class: &str) -> bool {
    let class = class.to_ascii_lowercase();
    class == "edit" || class.starts_with("richedit")
}

/// `EM_GETSEL` writes both offsets through out-pointers, which Windows
/// marshals across processes for this system message. Reading them from the
/// return value instead would pack the positions into two 16-bit halves and
/// truncate selections beyond 64K characters. A bare `SendMessageW` would
/// block this worker forever on a hung target; use the same timeout pattern
/// as `read_control_text`. Empty or unreadable selections return None.
#[cfg(target_os = "windows")]
fn edit_selection_offsets(hwnd: isize) -> Option<(u32, u32)> {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, SMTO_ABORTIFHUNG};

    const EM_GETSEL: u32 = 0x00B0;
    let mut start = 0u32;
    let mut end = 0u32;
    let mut result: usize = 0;
    let status = unsafe {
        SendMessageTimeoutW(
            HWND(hwnd as _),
            EM_GETSEL,
            WPARAM((&mut start as *mut u32) as usize),
            LPARAM((&mut end as *mut u32) as isize),
            SMTO_ABORTIFHUNG,
            100,
            Some(&mut result),
        )
    };
    if status.0 == 0 {
        return None;
    }
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
pub(crate) fn capture_edit_target(window: ForegroundWindowToken) -> Option<SelectionTarget> {
    let (focus_hwnd, caret) = focused_control_identity();
    edit_target_for(window, focus_hwnd?, caret)
}

/// Build the replace target from one UI Automation read. Without live ranges
/// and a control id, an equal text at another place cannot be told apart, so
/// the target stays unverifiable instead of guessing.
#[cfg(target_os = "windows")]
pub(crate) fn target_from_uia(
    window: ForegroundWindowToken,
    capture: &UiaCapture,
) -> Option<SelectionTarget> {
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
    // Terminal selections are scrollback text, not editable input: pasting
    // would type the translation into the shell prompt instead of replacing
    // anything, so a terminal is never a verifiable replace target.
    if foreground_is_terminal() {
        return None;
    }
    let window = foreground_window_token()?;
    capture_uia_target(window).or_else(|| capture_edit_target(window))
}

#[cfg(not(target_os = "windows"))]
pub fn capture_selection_target() -> Option<SelectionTarget> {
    None
}

/// True while the captured selection is provably the one under the caret now.
pub fn target_is_unchanged(captured: &SelectionTarget) -> bool {
    let _apartment = super::hold_com_apartment();
    super::foreground_window_is_current(captured.window)
        && super::capture_selection_target()
            .is_some_and(|now| crate::selection::target_still_valid(captured, &now))
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

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
