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
pub(crate) fn focused_control() -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    if let Some(info) = gui_thread_info() {
        return Some(info.hwndFocus);
    }
    let foreground = unsafe { GetForegroundWindow() };
    (!foreground.0.is_null()).then_some(foreground)
}

/// Focused control handle and caret rectangle as read-only identity bits.
#[cfg(target_os = "windows")]
pub(crate) fn focused_control_identity() -> (Option<isize>, Option<[i32; 4]>) {
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
pub(crate) fn focused_control_identity() -> (Option<isize>, Option<[i32; 4]>) {
    (None, None)
}

#[cfg(target_os = "windows")]
pub(crate) fn window_class(window: windows::Win32::Foundation::HWND) -> Option<String> {
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

/// Whether the foreground window is a terminal, by window class or process.
/// Shared by the copy path (Ctrl+Shift+C) and the replace path (terminals can
/// never own a replaceable selection).
#[cfg(target_os = "windows")]
pub fn foreground_is_terminal() -> bool {
    foreground_window_class()
        .as_deref()
        .map(is_terminal_window_class)
        .unwrap_or(false)
        || foreground_process_name()
            .as_deref()
            .map(is_terminal_process_name)
            .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
pub fn foreground_is_terminal() -> bool {
    false
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

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
}
