use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{ClientToScreen, SetWindowRgn};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect};

use super::ball_clip_layout::{ClientGeometry, ClipLayout};
use super::window_clip::BallClipSpec;
use crate::error::CommandError;

thread_local! {
    static CLIPS: RefCell<HashMap<isize, ClipLayout>> = RefCell::new(HashMap::new());
    static UPDATING: Cell<bool> = const { Cell::new(false) };
}

fn client_geometry(hwnd: HWND) -> Result<ClientGeometry, CommandError> {
    let mut client = RECT::default();
    let mut outer = RECT::default();
    let mut origin = POINT::default();
    // SAFETY: callers supply a live HWND and all output pointers are valid.
    unsafe {
        GetClientRect(hwnd, &mut client)
            .and_then(|()| GetWindowRect(hwnd, &mut outer))
            .and_then(|()| ClientToScreen(hwnd, &mut origin).ok())
            .map_err(|error| CommandError::internal(error.to_string()))?;
        let dpi = GetDpiForWindow(hwnd);
        if dpi == 0 {
            return Err(CommandError::internal("无法读取灵动岛窗口 DPI"));
        }
        Ok(ClientGeometry {
            width: client.right - client.left,
            height: client.bottom - client.top,
            origin: POINT {
                x: origin.x - outer.left,
                y: origin.y - outer.top,
            },
            dpi,
        })
    }
}

fn guarded<T>(apply: impl FnOnce() -> Result<T, CommandError>) -> Result<T, CommandError> {
    // SetWindowRgn synchronously sends window-position/size messages. Neither
    // the cache borrow nor an unguarded refresh may cross that native call.
    let previous = UPDATING.with(|updating| updating.replace(true));
    let result = apply();
    UPDATING.with(|updating| updating.set(previous));
    result
}

pub(super) fn set_clip(
    hwnd: HWND,
    bounds: RECT,
    radius: i32,
    pad: i32,
    edges: &[String],
) -> Result<(), CommandError> {
    let client = client_geometry(hwnd)?;
    guarded(|| {
        super::ball_region::apply_rounded(hwnd, bounds, radius, pad, edges)?;
        let layout = ClipLayout::new(&client, bounds, radius, pad, edges);
        CLIPS.with(|clips| clips.borrow_mut().insert(hwnd.0 as isize, layout));
        Ok(())
    })
}

pub(super) fn forget(hwnd: HWND) {
    CLIPS.with(|clips| clips.borrow_mut().remove(&(hwnd.0 as isize)));
}

pub(super) fn set_scaled_clip(
    hwnd: HWND,
    width: u32,
    height: u32,
    clip: &BallClipSpec,
) -> Result<(), CommandError> {
    // A settling animation can submit physical values measured at the old
    // scale. Resolve its logical shape against the live canvas before applying.
    let layout = ClipLayout::from_request(width, height, clip)?;
    let (bounds, radius, pad) = layout.resolve(&client_geometry(hwnd)?);
    guarded(|| {
        super::ball_region::apply_rounded(hwnd, bounds, radius, pad, &layout.square_edges)?;
        CLIPS.with(|clips| clips.borrow_mut().insert(hwnd.0 as isize, layout));
        Ok(())
    })
}

pub(super) fn clear(hwnd: HWND) -> Result<(), CommandError> {
    guarded(|| {
        // Expansion must discard the old shape before its resize messages run.
        forget(hwnd);
        if unsafe { SetWindowRgn(hwnd, None, true) } == 0 {
            return Err(CommandError::internal("无法恢复灵动岛窗口区域"));
        }
        Ok(())
    })
}

pub(super) fn refresh(hwnd: HWND) -> Result<(), CommandError> {
    if UPDATING.with(Cell::get) {
        return Ok(());
    }
    let Some(layout) = CLIPS.with(|clips| clips.borrow().get(&(hwnd.0 as isize)).cloned()) else {
        // The shared frame subclass also guards quick; only ball owns a clip.
        return Ok(());
    };
    let client = client_geometry(hwnd)?;
    if client.width <= 0 || client.height <= 0 {
        return Ok(());
    }
    let (bounds, radius, pad) = layout.resolve(&client);
    // Do not recapture rounded physical values: DPI round trips must always
    // resolve from the original logical layout, without cumulative drift.
    guarded(|| super::ball_region::apply_rounded(hwnd, bounds, radius, pad, &layout.square_edges))
}

#[cfg(test)]
#[path = "ball_region_state_tests.rs"]
mod tests;
