use super::*;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgn, PtInRegion, ERROR};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, GetWindowRect, IsWindowVisible, ShowWindow, SW_SHOWNOACTIVATE,
    WINDOW_EX_STYLE, WS_POPUP,
};

struct TestWindow(HWND);
impl Drop for TestWindow {
    fn drop(&mut self) {
        unsafe { DestroyWindow(self.0) }.expect("destroy screenshot test window");
    }
}

fn test_window() -> TestWindow {
    TestWindow(unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            windows::core::w!("STATIC"),
            windows::core::w!("screenshot visibility regression"),
            WS_POPUP,
            -32000,
            -32000,
            116,
            42,
            HWND::default(),
            None,
            None,
            None,
        )
        .unwrap()
    })
}

#[test]
fn hides_every_capture_after_native_no_activate_restoration() {
    let window = test_window();
    super::super::island_frame::install(window.0).unwrap();
    super::super::ball_region::clip_initial(window.0).unwrap();
    let mut before = RECT::default();
    unsafe { GetWindowRect(window.0, &mut before) }.unwrap();
    for _ in 0..4 {
        // Matches screenshot cancel/OCR restoration, which bypasses Tao's cache.
        unsafe {
            let _ = ShowWindow(window.0, SW_SHOWNOACTIVATE);
        }
        assert!(unsafe { IsWindowVisible(window.0) }.as_bool());
        hide_native(window.0).unwrap();
        wait_for_window_compositor().unwrap();
        // The capture caller may proceed only with the actual HWND hidden.
        assert!(!unsafe { IsWindowVisible(window.0) }.as_bool());
    }
    let mut after = RECT::default();
    unsafe {
        GetWindowRect(window.0, &mut after).unwrap();
        let region = CreateRectRgn(0, 0, 0, 0);
        assert!(!region.0.is_null());
        assert_ne!(GetWindowRgn(window.0, region).0, ERROR);
        assert!(!PtInRegion(region, 0, 0).as_bool());
        assert!(PtInRegion(region, 58, 21).as_bool());
        assert!(DeleteObject(region).as_bool());
    }
    assert_eq!(
        (before.left, before.top, before.right, before.bottom),
        (after.left, after.top, after.right, after.bottom)
    );
}

#[test]
fn hiding_an_already_hidden_window_is_successful() {
    let window = test_window();
    for _ in 0..2 {
        hide_native(window.0).unwrap();
        assert!(!unsafe { IsWindowVisible(window.0) }.as_bool());
    }
}

#[test]
fn invalid_window_aborts_capture_preparation() {
    assert!(hide_native(HWND::default()).is_err());
}
