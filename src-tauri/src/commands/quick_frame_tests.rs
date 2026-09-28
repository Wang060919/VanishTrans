use super::*;
use windows::Win32::Graphics::Gdi::{CreateRectRgn, GetRgnBox, GetWindowRgn, PtInRegion, ERROR};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, SendMessageW, SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOZORDER, WINDOW_EX_STYLE, WM_NCACTIVATE, WS_POPUP,
};

#[test]
fn quick_surface_keeps_corners_transparent() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    let quick = config["app"]["windows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|window| window["label"] == "quick")
        .unwrap();
    assert_eq!(quick["transparent"], true);
    assert_eq!(quick["decorations"], false);
    assert_eq!(quick["shadow"], false);
    assert!(quick.get("windowEffects").is_none());

    // Native backdrops fill the transparent area outside the CSS surface.
    let setup = include_str!("../lib.rs");
    assert!(!setup.contains("window_vibrancy::apply_"));
    let css = include_str!("../../../src/styles/quick-window.css");
    assert!(css.contains(&format!("border-radius: {CORNER_RADIUS}px;")));
}

struct TestWindow(HWND);
impl Drop for TestWindow {
    fn drop(&mut self) {
        unsafe { DestroyWindow(self.0) }.expect("destroy test window");
    }
}

fn assert_rounded_region(hwnd: HWND, width: i32, height: i32) {
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        assert!(!region.0.is_null());
        assert_ne!(GetWindowRgn(hwnd, region).0, ERROR);
        let mut bounds = RECT::default();
        assert_ne!(GetRgnBox(region, &mut bounds).0, ERROR);
        assert_eq!((bounds.left, bounds.top), (0, 0));
        // GDI's rounded-region rasterization may exclude the last edge pixel.
        assert!((width - 1..=width).contains(&bounds.right));
        assert!((height - 1..=height).contains(&bounds.bottom));
        for (x, y) in [
            (0, 0),
            (width - 1, 0),
            (0, height - 1),
            (width - 1, height - 1),
        ] {
            assert!(!PtInRegion(region, x, y).as_bool(), "corner {x},{y}");
        }
        assert!(PtInRegion(region, width / 2, height / 2).as_bool());
        assert!(PtInRegion(region, width / 2, height - 2).as_bool());
        assert!(!PtInRegion(region, width / 2, height + 1).as_bool());
        assert!(DeleteObject(region).as_bool());
    }
}

#[test]
fn clips_corners_on_install_resize_and_activation() {
    let window = TestWindow(unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            windows::core::w!("STATIC"),
            windows::core::w!("quick rounded region regression"),
            WS_POPUP,
            0,
            0,
            392,
            132,
            HWND::default(),
            None,
            None,
            None,
        )
        .unwrap()
    });
    super::super::island_frame::install(window.0).unwrap();
    install(window.0).unwrap();
    install(window.0).unwrap();
    assert_rounded_region(window.0, 392, 132);
    for (width, height) in [(392, 330), (588, 198), (392, 132)] {
        unsafe {
            SetWindowPos(
                window.0,
                None,
                0,
                0,
                width,
                height,
                SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER,
            )
            .unwrap();
            SendMessageW(window.0, WM_NCACTIVATE, WPARAM(1), LPARAM(0));
            SendMessageW(window.0, WM_NCACTIVATE, WPARAM(0), LPARAM(0));
        }
        assert_rounded_region(window.0, width, height);
    }
}
