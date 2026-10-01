use crate::error::CommandError;
use windows::Win32::Foundation::{GetLastError, SetLastError, HWND, RECT, WIN32_ERROR};
use windows::Win32::Graphics::Gdi::SetWindowRgn;
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetWindowLongW, GetWindowRect, SetWindowLongW, SetWindowPos, GWL_EXSTYLE,
    GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOCOPYBITS, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, WS_CAPTION, WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE,
    WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
};

// Tao retains caption styles on undecorated top-level windows and hides them via
// WM_NCCALCSIZE. SetWindowRgn can expose that non-client frame during repaint or
// activation. Remove it before changing regions; leave WebView size and focus alone.
pub(super) fn ensure_frameless(hwnd: HWND) -> Result<(), CommandError> {
    // SAFETY: caller supplies the live island HWND; style updates preserve all
    // unrelated bits, including visibility, activation policy and child clipping.
    unsafe {
        let mut changed = false;
        for (index, mask) in [
            (
                GWL_STYLE,
                (WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX).0,
            ),
            (
                GWL_EXSTYLE,
                (WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME | WS_EX_STATICEDGE).0,
            ),
        ] {
            let current = GetWindowLongW(hwnd, index) as u32;
            let next = current & !mask;
            if current != next {
                SetLastError(WIN32_ERROR(0));
                if SetWindowLongW(hwnd, index, next as i32) == 0 && GetLastError().0 != 0 {
                    return Err(CommandError::internal(
                        windows::core::Error::from_win32().to_string(),
                    ));
                }
                changed = true;
            }
        }
        if changed {
            SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
            )
            .map_err(|e| CommandError::internal(e.to_string()))?;
        }
    }
    Ok(())
}

fn outer_extent(client: u32, outer: i32, inner: i32) -> Result<i32, CommandError> {
    let extent = i64::from(client) + i64::from(outer) - i64::from(inner);
    i32::try_from(extent)
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| CommandError::validation("灵动岛窗口尺寸超出范围"))
}

/// One native update prevents an intermediate new-size/old-position frame.
/// Keep the existing IPC contract: physical client size and outer position.
pub(super) fn set_bounds(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), CommandError> {
    let handle = window
        .hwnd()
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let hwnd = HWND(handle.0);
    ensure_frameless(hwnd)?;
    let mut outer = RECT::default();
    let mut inner = RECT::default();
    // SAFETY: hwnd belongs to the live Tauri window; both RECT pointers are valid.
    unsafe {
        GetWindowRect(hwnd, &mut outer)
            .and_then(|()| GetClientRect(hwnd, &mut inner))
            .map_err(|error| CommandError::internal(error.to_string()))?;
    }
    let width = outer_extent(width, outer.right - outer.left, inner.right - inner.left)?;
    let height = outer_extent(height, outer.bottom - outer.top, inner.bottom - inner.top)?;
    // Remove the idle hit-test region before revealing an expanded island.
    // Avoid resizing an already large viewport: that can expose stale WebView pixels.
    unsafe {
        if SetWindowRgn(hwnd, None, true) == 0 {
            return Err(CommandError::internal("无法恢复灵动岛窗口区域"));
        }
    }
    if outer.left == x
        && outer.top == y
        && outer.right - outer.left == width
        && outer.bottom - outer.top == height
    {
        return Ok(());
    }
    // SAFETY: retain activation and z-order, and let normal resize messages update
    // WebView2. Do not copy a cropped fragment of the previous client pixels.
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOCOPYBITS,
        )
        .map_err(|error| CommandError::internal(error.to_string()))
    }
}

/// Painted-shape description for a retained clip: a missing radius yields a
/// capsule (half the short side), a missing pad falls back to EDGE_BLEED.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BallClipSpec {
    corner_radius: Option<f64>,
    pad: Option<i32>,
}

/// Clip the collapsed island without moving or resizing its WebView viewport.
/// Pixels and hit testing outside the capsule belong to the desktop again.
pub(super) fn retain_surface(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    clip: Option<BallClipSpec>,
) -> Result<bool, CommandError> {
    let handle = window
        .hwnd()
        .map_err(|e| CommandError::internal(e.to_string()))?;
    let hwnd = HWND(handle.0);
    retain_surface_at(hwnd, x, y, width, height, clip)
}

pub(super) fn retain_surface_at(
    hwnd: HWND,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    clip: Option<BallClipSpec>,
) -> Result<bool, CommandError> {
    ensure_frameless(hwnd)?;
    let mut outer = RECT::default();
    // SAFETY: live window handle and a valid writable RECT.
    unsafe { GetWindowRect(hwnd, &mut outer) }
        .map_err(|e| CommandError::internal(e.to_string()))?;
    let window_width = i64::from(outer.right) - i64::from(outer.left);
    let window_height = i64::from(outer.bottom) - i64::from(outer.top);
    // Sub-pixel/DPI rounding can push the clip a few pixels past the canvas
    // edge; clamp those into the window instead of failing the transition.
    let left = (i64::from(x) - i64::from(outer.left)).clamp(0, window_width);
    let top = (i64::from(y) - i64::from(outer.top)).clamp(0, window_height);
    let right = (left + i64::from(width)).clamp(left, window_width);
    let bottom = (top + i64::from(height)).clamp(top, window_height);
    if right <= left || bottom <= top {
        return Err(CommandError::validation("灵动岛区域超出窗口边界"));
    }
    let half_min_side = ((right - left).min(bottom - top) / 2) as i32;
    let radius = clip
        .and_then(|spec| spec.corner_radius)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| value.round() as i32)
        .unwrap_or(half_min_side)
        .clamp(0, half_min_side);
    let pad = clip
        .and_then(|spec| spec.pad)
        .unwrap_or(super::ball_region::EDGE_BLEED)
        .max(0);
    super::ball_region::clip_rounded(
        hwnd,
        RECT {
            left: left as i32,
            top: top as i32,
            right: right as i32,
            bottom: bottom as i32,
        },
        radius,
        pad,
    )?;
    Ok(true)
}

#[cfg(test)]
#[path = "window_bounds_tests.rs"]
mod native_tests;

#[cfg(test)]
mod tests {
    use super::outer_extent;

    #[test]
    fn preserves_client_size_with_and_without_native_insets() {
        assert_eq!(outer_extent(116, 720, 720).unwrap(), 116);
        assert_eq!(outer_extent(116, 736, 720).unwrap(), 132);
        assert_eq!(outer_extent(42, 396, 380).unwrap(), 58);
    }

    #[test]
    fn rejects_dimensions_that_cannot_be_passed_to_win32() {
        assert!(outer_extent(u32::MAX, 720, 720).is_err());
        assert!(outer_extent(0, 720, 720).is_err());
    }
}
