use std::cell::Cell;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    ClientToScreen, CreateRoundRectRgn, DeleteObject, SetWindowRgn,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetWindowRect, WM_DPICHANGED, WM_NCDESTROY, WM_SIZE,
};

const SUBCLASS_ID: usize = 2;
// Keep in sync with .quick-translate-shell in quick-window.css (logical pixels).
const CORNER_RADIUS: u32 = 28;
thread_local! { static UPDATING_REGION: Cell<bool> = const { Cell::new(false) }; }

pub(crate) fn install(hwnd: HWND) -> Result<(), std::io::Error> {
    // SAFETY: setup calls this on the live window's owning UI thread.
    if !unsafe { SetWindowSubclass(hwnd, Some(frame_proc), SUBCLASS_ID, 0) }.as_bool() {
        return Err(std::io::Error::other("无法安装迷你窗口圆角处理"));
    }
    update_region(hwnd).map_err(std::io::Error::other)
}

fn update_region(hwnd: HWND) -> windows::core::Result<()> {
    // SetWindowRgn sends window-position messages synchronously. Those may lead
    // back to WM_SIZE; never recursively update the same window's region.
    UPDATING_REGION.with(|updating| {
        if updating.replace(true) {
            return Ok(());
        }
        let result = apply_region(hwnd);
        updating.set(false);
        result
    })
}

fn apply_region(hwnd: HWND) -> windows::core::Result<()> {
    let mut client = RECT::default();
    let mut outer = RECT::default();
    let mut origin = POINT::default();
    // SAFETY: all pointers are valid, and hwnd belongs to this UI thread.
    unsafe {
        GetClientRect(hwnd, &mut client)?;
        GetWindowRect(hwnd, &mut outer)?;
        ClientToScreen(hwnd, &mut origin).ok()?;
        let width = client.right - client.left;
        let height = client.bottom - client.top;
        if width <= 0 || height <= 0 {
            return Ok(());
        }
        let dpi = GetDpiForWindow(hwnd);
        if dpi == 0 {
            return Err(windows::core::Error::from_win32());
        }
        let diameter = ((2 * CORNER_RADIUS * dpi + 48) / 96) as i32;
        let left = origin.x - outer.left;
        let top = origin.y - outer.top;
        let region = CreateRoundRectRgn(left, top, left + width, top + height, diameter, diameter);
        if region.0.is_null() {
            return Err(windows::core::Error::from_win32());
        }
        // Windows owns the region after success, including its destruction.
        if SetWindowRgn(hwnd, region, true) == 0 {
            let error = windows::core::Error::from_win32();
            let _ = DeleteObject(region);
            return Err(error);
        }
    }
    Ok(())
}

unsafe extern "system" fn frame_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _data: usize,
) -> LRESULT {
    if message == WM_NCDESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(frame_proc), id);
        return DefSubclassProc(hwnd, message, wparam, lparam);
    }
    // Let Tao/WebView2 apply resize and DPI changes before measuring the client.
    let result = DefSubclassProc(hwnd, message, wparam, lparam);
    if matches!(message, WM_SIZE | WM_DPICHANGED) {
        if let Err(error) = update_region(hwnd) {
            log::error!("[quick] failed to update rounded window region: {error}");
        }
    }
    result
}

#[cfg(test)]
#[path = "quick_frame_tests.rs"]
mod tests;
