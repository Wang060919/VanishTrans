use super::*;
use std::cell::RefCell;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, SendMessageW, WINDOW_EX_STYLE, WM_KILLFOCUS, WM_SETFOCUS,
    WS_OVERLAPPEDWINDOW,
};

thread_local! {
    static MESSAGES: RefCell<Vec<(u32, usize, isize)>> = const { RefCell::new(Vec::new()) };
}

unsafe extern "system" fn observe(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if matches!(
        message,
        WM_NCACTIVATE | WM_NCPAINT | WM_SETFOCUS | WM_KILLFOCUS
    ) {
        MESSAGES.with(|messages| messages.borrow_mut().push((message, wparam.0, lparam.0)));
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}

struct TestWindow(HWND);
impl Drop for TestWindow {
    fn drop(&mut self) {
        unsafe { DestroyWindow(self.0) }.expect("destroy test window");
    }
}

#[test]
fn prevents_frame_paint_without_swallowing_focus_or_activation() {
    // A real hidden HWND exercises the subclass chain without stealing focus.
    let window = TestWindow(unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            windows::core::w!("STATIC"),
            windows::core::w!("island paint regression"),
            WS_OVERLAPPEDWINDOW,
            0,
            0,
            720,
            380,
            HWND::default(),
            None,
            None,
            None,
        )
        .unwrap()
    });
    let hwnd = window.0;
    assert!(unsafe { SetWindowSubclass(hwnd, Some(observe), 2, 0) }.as_bool());
    install(hwnd).unwrap();
    install(hwnd).unwrap();
    MESSAGES.with(|messages| messages.borrow_mut().clear());
    unsafe {
        SendMessageW(hwnd, WM_NCPAINT, WPARAM(1), LPARAM(0));
        SendMessageW(hwnd, WM_NCACTIVATE, WPARAM(1), LPARAM(0));
        SendMessageW(hwnd, WM_NCACTIVATE, WPARAM(0), LPARAM(0));
        SendMessageW(hwnd, WM_SETFOCUS, WPARAM(0), LPARAM(0));
        SendMessageW(hwnd, WM_KILLFOCUS, WPARAM(0), LPARAM(0));
    }
    MESSAGES.with(|messages| {
        let messages = messages.borrow();
        assert!(!messages
            .iter()
            .any(|(message, _, _)| *message == WM_NCPAINT));
        assert!(messages.contains(&(WM_NCACTIVATE, 1, -1)));
        assert!(messages.contains(&(WM_NCACTIVATE, 0, -1)));
        assert!(messages.contains(&(WM_SETFOCUS, 0, 0)));
        assert!(messages.contains(&(WM_KILLFOCUS, 0, 0)));
    });
}

#[test]
fn removes_native_edges_before_first_show_without_a_transition() {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowLongW, GetWindowRect, IsWindowVisible, GWL_EXSTYLE, GWL_STYLE,
        WS_CAPTION, WS_CLIPCHILDREN, WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE,
        WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    };
    let edges = WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME | WS_EX_STATICEDGE;
    let frame = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    let window = TestWindow(unsafe {
        CreateWindowExW(
            edges,
            windows::core::w!("STATIC"),
            windows::core::w!("island first-show regression"),
            WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
            100,
            100,
            116,
            42,
            HWND::default(),
            None,
            None,
            None,
        )
        .unwrap()
    });
    let hwnd = window.0;
    let mut original = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut original) }.unwrap();
    // Exercise the startup path, without set_bounds or an expand/collapse cycle.
    install(hwnd).unwrap();
    install(hwnd).unwrap();
    unsafe {
        assert_eq!(GetWindowLongW(hwnd, GWL_STYLE) as u32 & frame.0, 0);
        assert_eq!(GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & edges.0, 0);
        assert_ne!(
            GetWindowLongW(hwnd, GWL_STYLE) as u32 & WS_CLIPCHILDREN.0,
            0
        );
        assert!(!IsWindowVisible(hwnd).as_bool());
        let mut outer = RECT::default();
        let mut client = RECT::default();
        GetWindowRect(hwnd, &mut outer).unwrap();
        GetClientRect(hwnd, &mut client).unwrap();
        assert_eq!(
            (outer.left, outer.top, outer.right, outer.bottom),
            (original.left, original.top, original.right, original.bottom)
        );
        // Windows can clamp the initial captioned window to its minimum width.
        assert_eq!(
            (client.right, client.bottom),
            (
                original.right - original.left,
                original.bottom - original.top
            )
        );
    }
}
