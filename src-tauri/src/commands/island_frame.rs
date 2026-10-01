use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    WM_NCACTIVATE, WM_NCDESTROY, WM_NCPAINT, WM_STYLECHANGED,
};

const SUBCLASS_ID: usize = 1;

// Installed during Tauri setup on the window's owning UI thread, before showing
// either transparent window. Styles alone cannot prevent Tao's handler from invoking
// DefWindowProc and drawing an inactive caption into the transparent canvas.
pub(crate) fn install(hwnd: HWND) -> Result<(), std::io::Error> {
    // SAFETY: setup supplies a live window HWND on its owning thread. The
    // callback stores no borrowed state and removes itself on window destruction.
    if unsafe { SetWindowSubclass(hwnd, Some(frame_proc), SUBCLASS_ID, 0) }.as_bool() {
        // Startup must use the same frameless styles as later bounds updates.
        // Otherwise the first surface keeps native edges until its first transition.
        // Install the paint guard first: SWP_FRAMECHANGED can repaint synchronously.
        super::window_bounds::ensure_frameless(hwnd).map_err(std::io::Error::other)
    } else {
        Err(std::io::Error::other("无法安装透明窗口无边框绘制处理"))
    }
}

unsafe extern "system" fn frame_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _data: usize,
) -> LRESULT {
    match message {
        // Both windows render their entire surface in WebView2, including corners.
        WM_NCPAINT => LRESULT(0),
        // Tao rewrites GWL_STYLE/GWL_EXSTYLE on every flag diff (show, hide,
        // resizable, …), restoring the caption styles ensure_frameless removed
        // at install. Re-strip them inside the same synchronous frame change;
        // the nested FRAMECHANGED re-entry sees clean styles and stops.
        WM_STYLECHANGED => {
            let _ = super::window_bounds::ensure_frameless(hwnd);
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
        // Forward activation to Tao so its focus bookkeeping/events still run.
        // The documented -1 flag tells DefWindowProc to skip non-client repaint.
        WM_NCACTIVATE => DefSubclassProc(hwnd, message, wparam, LPARAM(-1)),
        WM_NCDESTROY => {
            let _ = RemoveWindowSubclass(hwnd, Some(frame_proc), id);
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
        _ => DefSubclassProc(hwnd, message, wparam, lparam),
    }
}

#[cfg(test)]
#[path = "island_frame_tests.rs"]
mod tests;
