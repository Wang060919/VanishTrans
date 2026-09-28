use super::*;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, SendMessageW, WM_NCACTIVATE, WS_CLIPCHILDREN,
    WS_OVERLAPPEDWINDOW,
};

struct TestWindow(HWND);
impl Drop for TestWindow {
    fn drop(&mut self) {
        unsafe { DestroyWindow(self.0) }.expect("destroy test window");
    }
}

#[test]
fn region_and_activation_changes_keep_the_native_canvas_frameless() {
    // Use a real hidden HWND, never taking focus or showing test UI.
    let window = TestWindow(unsafe {
        CreateWindowExW(
            WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE,
            windows::core::w!("STATIC"),
            windows::core::w!("island frame regression"),
            WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
            100,
            100,
            720,
            380,
            HWND::default(),
            None,
            None,
            None,
        )
        .expect("create test window")
    });
    let hwnd = window.0;
    let mut original = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut original) }.unwrap();
    ensure_frameless(hwnd).unwrap();
    ensure_frameless(hwnd).unwrap(); // Repeated transitions must be idempotent.
    unsafe {
        let region = CreateRectRgn(302, 0, 418, 42);
        assert!(!region.0.is_null());
        if SetWindowRgn(hwnd, region, true) == 0 {
            let _ = DeleteObject(region);
            panic!("set test region");
        }
        for active in [1, 0, 1, 0] {
            SendMessageW(hwnd, WM_NCACTIVATE, WPARAM(active), LPARAM(0));
        }
        assert_ne!(SetWindowRgn(hwnd, None, true), 0);
        let mut outer = RECT::default();
        let mut client = RECT::default();
        GetWindowRect(hwnd, &mut outer).unwrap();
        GetClientRect(hwnd, &mut client).unwrap();
        assert_eq!(
            (outer.left, outer.top, outer.right, outer.bottom),
            (original.left, original.top, original.right, original.bottom)
        );
        assert_eq!(
            (client.right, client.bottom),
            (outer.right - outer.left, outer.bottom - outer.top)
        );
        assert_ne!(
            GetWindowLongW(hwnd, GWL_STYLE) as u32 & WS_CLIPCHILDREN.0,
            0
        );
    }
}
