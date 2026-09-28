use crate::error::CommandError;

/// Called on the capture worker before reading any screen pixels.
pub(super) fn hide_for_capture(window: &tauri::WebviewWindow) -> Result<(), CommandError> {
    // Update Tao's visibility flags as well as the native window.
    window
        .hide()
        .map_err(|e| CommandError::internal(e.to_string()))?;
    #[cfg(target_os = "windows")]
    {
        // hwnd() is a synchronous main-thread getter: the queued hide is applied
        // before it returns. A raw no-activate restore can leave Tao's cached
        // VISIBLE flag false, so a successful hide() alone is not sufficient.
        let handle = window
            .hwnd()
            .map_err(|e| CommandError::internal(e.to_string()))?;
        hide_native(windows::Win32::Foundation::HWND(handle.0))?;
    }
    // A synchronous getter also acts as the dispatch barrier on other platforms.
    if window
        .is_visible()
        .map_err(|e| CommandError::internal(e.to_string()))?
    {
        return Err(CommandError::internal("截图前无法隐藏窗口"));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn hide_native(hwnd: windows::Win32::Foundation::HWND) -> Result<(), CommandError> {
    use windows::Win32::UI::WindowsAndMessaging::{IsWindow, IsWindowVisible, ShowWindow, SW_HIDE};
    // SAFETY: validate the HWND before use; ShowWindow synchronously hides it.
    // Its return value is previous visibility, NOT a success/failure indicator.
    unsafe {
        if !IsWindow(hwnd).as_bool() {
            return Err(CommandError::internal("截图窗口句柄无效"));
        }
        let _ = ShowWindow(hwnd, SW_HIDE);
        if IsWindowVisible(hwnd).as_bool() {
            return Err(CommandError::internal("截图前无法隐藏窗口"));
        }
    }
    Ok(())
}

pub(super) fn wait_for_window_compositor() -> Result<(), CommandError> {
    #[cfg(target_os = "windows")]
    {
        // Flush only AFTER the hide has actually executed, not after enqueueing it.
        unsafe { windows::Win32::Graphics::Dwm::DwmFlush() }
            .map_err(|e| CommandError::internal(e.to_string()))?;
    }
    #[cfg(not(target_os = "windows"))]
    std::thread::sleep(std::time::Duration::from_millis(32));
    Ok(())
}

#[cfg(all(test, target_os = "windows"))]
#[path = "screenshot_visibility_tests.rs"]
mod tests;
