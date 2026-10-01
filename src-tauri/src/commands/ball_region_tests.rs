use super::*;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, GetRgnBox, GetWindowRgn, PtInRegion, ERROR};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, IsWindowVisible, SendMessageW, WINDOW_EX_STYLE, WM_NCACTIVATE,
    WS_POPUP,
};

struct TestWindow(HWND);
impl Drop for TestWindow {
    fn drop(&mut self) {
        unsafe { DestroyWindow(self.0) }.expect("destroy test window");
    }
}

fn test_window(width: i32, height: i32) -> TestWindow {
    TestWindow(unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            windows::core::w!("STATIC"),
            windows::core::w!("island capsule regression"),
            WS_POPUP,
            100,
            100,
            width,
            height,
            HWND::default(),
            None,
            None,
            None,
        )
        .unwrap()
    })
}

fn assert_capsule(hwnd: HWND, expected: RECT) {
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        assert!(!region.0.is_null());
        assert_ne!(GetWindowRgn(hwnd, region).0, ERROR);
        let mut bounds = RECT::default();
        assert_ne!(GetRgnBox(region, &mut bounds).0, ERROR);
        // The clip capsule is dilated by EDGE_BLEED so its binary edge never
        // intersects the painted antialiased capsule outline.
        assert_eq!(
            (bounds.left, bounds.top, bounds.right, bounds.bottom),
            (
                expected.left - EDGE_BLEED,
                expected.top - EDGE_BLEED,
                expected.right + EDGE_BLEED,
                expected.bottom + EDGE_BLEED
            )
        );
        for (x, y) in [
            (bounds.left, bounds.top),
            (bounds.right - 1, bounds.top),
            (bounds.left, bounds.bottom - 1),
            (bounds.right - 1, bounds.bottom - 1),
        ] {
            assert!(
                !PtInRegion(region, x, y).as_bool(),
                "corner {x},{y} must belong to desktop"
            );
        }
        let cx = (bounds.left + bounds.right) / 2;
        let cy = (bounds.top + bounds.bottom) / 2;
        for (x, y) in [
            (cx, cy),
            (cx, bounds.top),
            (cx, bounds.bottom - 1),
            (bounds.left, cy),
            (bounds.right - 1, cy),
        ] {
            assert!(
                PtInRegion(region, x, y).as_bool(),
                "edge {x},{y} must remain visible"
            );
        }
        assert!(!PtInRegion(region, bounds.right, cy).as_bool());
        assert!(!PtInRegion(region, cx, bounds.bottom).as_bool());
        assert!(DeleteObject(region).as_bool());
    }
}

#[test]
fn startup_capsule_excludes_corners_before_first_show() {
    let window = test_window(116, 42);
    super::super::island_frame::install(window.0).unwrap();
    let bounds = RECT {
        left: 0,
        top: 0,
        right: 116,
        bottom: 42,
    };
    clip_initial(window.0).unwrap();
    assert_capsule(window.0, bounds);
    assert!(!unsafe { IsWindowVisible(window.0) }.as_bool());
}

#[test]
fn retained_capsules_match_every_compact_mode_scale_and_dock_without_resizing() {
    let window = test_window(1440, 760);
    super::super::island_frame::install(window.0).unwrap();
    let mut original = RECT::default();
    unsafe { GetWindowRect(window.0, &mut original) }.unwrap();
    // 100%, 125%, 150%, 200% DPI, including odd physical capsule heights.
    for scale in [1.0_f64, 1.25, 1.5, 2.0] {
        for (width, height) in [(116, 42), (296, 60), (264, 52)] {
            let width = (f64::from(width) * scale).round() as i32;
            let height = (f64::from(height) * scale).round() as i32;
            for left in [0, (1440 - width) / 2, 1440 - width] {
                let bounds = RECT {
                    left,
                    top: 0,
                    right: left + width,
                    bottom: height,
                };
                // Expansion removes clipping; the production collapse path must restore it.
                assert_ne!(unsafe { SetWindowRgn(window.0, None, true) }, 0);
                for _ in 0..2 {
                    assert!(super::super::window_bounds::retain_surface_at(
                        window.0,
                        original.left + left,
                        original.top,
                        width as u32,
                        height as u32,
                        None,
                    )
                    .unwrap());
                }
                for active in [1, 0] {
                    unsafe {
                        SendMessageW(window.0, WM_NCACTIVATE, WPARAM(active), LPARAM(0));
                    }
                }
                assert_capsule(window.0, bounds);
            }
        }
    }
    let mut outer = RECT::default();
    let mut client = RECT::default();
    unsafe {
        GetWindowRect(window.0, &mut outer).unwrap();
        GetClientRect(window.0, &mut client).unwrap();
        assert_ne!(SetWindowRgn(window.0, None, true), 0);
        let region = CreateRectRgn(0, 0, 0, 0);
        assert_eq!(GetWindowRgn(window.0, region).0, ERROR);
        assert!(DeleteObject(region).as_bool());
    }
    assert_eq!(
        (outer.left, outer.top, outer.right, outer.bottom),
        (original.left, original.top, original.right, original.bottom)
    );
    assert_eq!((client.right, client.bottom), (1440, 760));
}

#[test]
fn rejects_empty_or_overflowing_regions() {
    for bounds in [
        RECT::default(),
        RECT {
            left: 0,
            top: 0,
            right: i32::MAX,
            bottom: 42,
        },
    ] {
        assert!(clip_capsule(HWND::default(), bounds).is_err());
    }
}
