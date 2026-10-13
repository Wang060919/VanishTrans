use super::*;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateRectRgn, DeleteObject, GetRgnBox, GetWindowRgn, PtInRegion, ERROR,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, IsWindowVisible, SendMessageW, SetWindowPos, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOZORDER, WINDOW_EX_STYLE, WM_DPICHANGED, WS_POPUP,
};

fn geometry(width: i32, height: i32, dpi: u32) -> ClientGeometry {
    ClientGeometry {
        width,
        height,
        origin: POINT::default(),
        dpi,
    }
}

fn capsule(left: i32, top: i32, width: i32, height: i32) -> RECT {
    RECT {
        left,
        top,
        right: left + width,
        bottom: top + height,
    }
}

fn coordinates(bounds: RECT) -> (i32, i32, i32, i32) {
    (bounds.left, bounds.top, bounds.right, bounds.bottom)
}

struct TestWindow(HWND);
impl Drop for TestWindow {
    fn drop(&mut self) {
        unsafe { DestroyWindow(self.0) }.expect("destroy hidden test window");
    }
}

fn window(width: i32, height: i32) -> TestWindow {
    let window = TestWindow(unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            windows::core::w!("STATIC"),
            windows::core::w!("island DPI regression"),
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
    });
    super::super::island_frame::install(window.0).unwrap();
    assert!(!unsafe { IsWindowVisible(window.0) }.as_bool());
    window
}

fn resize(hwnd: HWND, width: i32, height: i32) {
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            width,
            height,
            SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .unwrap();
    }
}

fn assert_region(hwnd: HWND, expected: RECT, pad: i32) {
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        assert!(!region.0.is_null());
        assert_ne!(GetWindowRgn(hwnd, region).0, ERROR);
        let mut actual = RECT::default();
        assert_ne!(GetRgnBox(region, &mut actual).0, ERROR);
        assert_eq!(
            coordinates(actual),
            (
                expected.left - pad,
                expected.top - pad,
                expected.right + pad,
                expected.bottom + pad,
            )
        );
        let cy = (expected.top + expected.bottom) / 2;
        for x in [
            expected.left,
            (expected.left + expected.right) / 2,
            expected.right - 1,
        ] {
            assert!(
                PtInRegion(region, x, cy).as_bool(),
                "content at {x},{cy} was cropped"
            );
        }
        assert!(!PtInRegion(region, actual.left - 1, cy).as_bool());
        assert!(!PtInRegion(region, actual.right, cy).as_bool());
        assert!(DeleteObject(region).as_bool());
    }
}

#[test]
fn rdp_125_to_100_percent_resolves_from_original_layout_without_round_trip_drift() {
    let layout = ClipLayout::new(
        &geometry(706, 678, 120),
        capsule(261, 0, 185, 53),
        26,
        10,
        &[],
    );
    // Physical values reproduce the recorded retained canvas and capsule.
    for _ in 0..8 {
        for (dpi, width, height, left, cw, ch, radius, pad) in [
            (96, 564, 542, 208, 148, 42, 21, 8),
            (120, 706, 678, 261, 185, 53, 26, 10),
            (144, 846, 813, 313, 222, 64, 31, 12),
            (192, 1128, 1084, 417, 296, 85, 42, 16),
        ] {
            let (bounds, resolved_radius, resolved_pad) =
                layout.resolve(&geometry(width, height, dpi));
            assert_eq!(coordinates(bounds), coordinates(capsule(left, 0, cw, ch)));
            assert_eq!((resolved_radius, resolved_pad), (radius, pad));
        }
    }
}

#[test]
fn keeps_alignment_client_origin_vertical_offset_and_docked_edges() {
    let mut old = geometry(706, 678, 120);
    old.origin = POINT { x: 12, y: 16 };
    let mut new = geometry(564, 542, 96);
    new.origin = POINT { x: 7, y: 9 };
    for (left, expected) in [(0, 7), (261, 215), (521, 423)] {
        let edges = vec!["top".to_owned(), "left".to_owned()];
        let layout = ClipLayout::new(&old, capsule(12 + left, 36, 185, 53), 26, 10, &edges);
        assert_eq!(layout.square_edges, edges);
        assert_eq!(
            coordinates(layout.resolve(&new).0),
            coordinates(capsule(expected, 25, 148, 42))
        );
        let tiny = ClientGeometry {
            width: 100,
            height: 20,
            origin: new.origin,
            dpi: 96,
        };
        assert_eq!(
            coordinates(layout.resolve(&tiny).0),
            coordinates(capsule(7, 9, 100, 20))
        );
    }
}

#[test]
fn resize_rebuilds_region_and_expansion_or_destruction_discards_it() {
    let window = window(600, 400);
    let hwnd = window.0;
    set_clip(hwnd, capsule(200, 0, 200, 42), 21, 2, &[]).unwrap();
    resize(hwnd, 400, 300);
    // SetWindowPos synchronously delivers WM_SIZE through the real subclass.
    assert_region(hwnd, capsule(100, 0, 200, 42), 2);
    assert!(!UPDATING.with(Cell::get));
    guarded(|| {
        resize(hwnd, 600, 400);
        refresh(hwnd)?;
        assert_region(hwnd, capsule(100, 0, 200, 42), 2);
        guarded(|| {
            assert!(UPDATING.with(Cell::get));
            Ok(())
        })?;
        assert!(UPDATING.with(Cell::get));
        Ok(())
    })
    .unwrap();
    assert!(!UPDATING.with(Cell::get));
    refresh(hwnd).unwrap();
    assert_region(hwnd, capsule(200, 0, 200, 42), 2);
    clear(hwnd).unwrap();
    resize(hwnd, 720, 440);
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        assert_eq!(
            GetWindowRgn(hwnd, region).0,
            ERROR,
            "expanded window must stay unclipped"
        );
        assert!(DeleteObject(region).as_bool());
    }
    set_clip(hwnd, capsule(260, 0, 200, 42), 21, 2, &[]).unwrap();
    drop(window);
    assert!(CLIPS.with(|clips| !clips.borrow().contains_key(&(hwnd.0 as isize))));
}

#[test]
fn simulated_dpi_notification_rebuilds_cached_125_percent_clip_at_current_window_dpi() {
    let window = window(706, 678);
    let hwnd = window.0;
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let scale = f64::from(dpi) / 96.0;
    let width = (564.0 * scale).round() as i32;
    let height = (542.0 * scale).round() as i32;
    let layout = ClipLayout::new(
        &geometry(706, 678, 120),
        capsule(261, 0, 185, 53),
        26,
        10,
        &[],
    );
    let (expected, _, pad) = layout.resolve(&geometry(width, height, dpi));
    CLIPS.with(|clips| clips.borrow_mut().insert(hwnd.0 as isize, layout));
    resize(hwnd, width, height);
    assert_region(hwnd, expected, pad);
    // Restore stale pixels to distinguish WM_DPICHANGED handling from WM_SIZE.
    guarded(|| {
        super::super::ball_region::apply_rounded(hwnd, capsule(261, 0, 185, 53), 26, 10, &[])
    })
    .unwrap();
    let suggested = capsule(100, 100, width, height);
    unsafe {
        // This is a synthetic notification; it does not change the system DPI.
        SendMessageW(
            hwnd,
            WM_DPICHANGED,
            WPARAM((dpi | (dpi << 16)) as usize),
            LPARAM((&suggested as *const RECT) as isize),
        );
    }
    assert_region(hwnd, expected, pad);
    assert!(!UPDATING.with(Cell::get));
    assert!(!unsafe { IsWindowVisible(hwnd) }.as_bool());
}

#[test]
fn delayed_old_dpi_clip_ignores_stale_screen_coordinates_and_keeps_native_canvas() {
    let window = window(564, 542);
    let hwnd = window.0;
    let client = client_geometry(hwnd).unwrap();
    let clip: BallClipSpec = serde_json::from_value(serde_json::json!({
        "scaleFactor": 1.25, "alignment": "center", "cornerRadius": 26,
        "pad": 10,
    }))
    .unwrap();
    let layout = ClipLayout::from_request(185, 53, &clip).unwrap();
    let (expected, _, pad) = layout.resolve(&client);
    // The old monitor coordinates no longer overlap the live canvas after
    // RDP reconnect. Metadata resolves the CSS layout instead of clipping there.
    assert!(
        super::super::window_bounds::retain_surface_at(hwnd, 5000, 5000, 185, 53, Some(clip),)
            .unwrap()
    );
    assert_region(hwnd, expected, pad);
    let after = client_geometry(hwnd).unwrap();
    assert_eq!((after.width, after.height), (client.width, client.height));
    refresh(hwnd).unwrap();
    assert_region(hwnd, expected, pad);

    let docked: BallClipSpec = serde_json::from_value(serde_json::json!({
        "scaleFactor": 1.25, "alignment": "center", "cornerRadius": 26,
        "pad": 10, "squareEdges": ["top"],
    }))
    .unwrap();
    set_scaled_clip(hwnd, 185, 53, &docked).unwrap();
    refresh(hwnd).unwrap();
    // Squared edges use union strips, so their region bounding box differs
    // from a capsule. Verify the docked corners themselves remain visible.
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        assert_ne!(GetWindowRgn(hwnd, region).0, ERROR);
        assert!(PtInRegion(region, expected.left, expected.top).as_bool());
        assert!(PtInRegion(region, expected.right - 1, expected.top).as_bool());
        assert!(DeleteObject(region).as_bool());
    }
}
