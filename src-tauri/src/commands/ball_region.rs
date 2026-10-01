use crate::error::CommandError;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    ClientToScreen, CreateRoundRectRgn, DeleteObject, SetWindowRgn,
};
use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect};

/// Grow the clip capsule outward by this many physical pixels. A GDI window
/// region is a binary mask with no antialiasing, and its rasterized arc never
/// lands on the same curve WebView2 draws for the CSS border-radius. Clipping
/// exactly at the painted bounds therefore cuts through the ~1px alpha-fade
/// band and leaves jagged edge burrs. The bleed keeps the painted capsule —
/// including its antialiased edge — fully inside the region; the extra ring is
/// transparent anyway, so only hit testing grows imperceptibly.
pub(crate) const EDGE_BLEED: i32 = 2;

/// Compact island modes are capsules: CSS radius is half their physical height.
/// Exclude corners natively, even before WebView2 presents transparent pixels.
pub(super) fn clip_capsule(hwnd: HWND, bounds: RECT) -> Result<(), CommandError> {
    let width = bounds
        .right
        .checked_sub(bounds.left)
        .filter(|value| *value > 0);
    let height = bounds
        .bottom
        .checked_sub(bounds.top)
        .filter(|value| *value > 0);
    let right = bounds.right.checked_add(1);
    let bottom = bounds.bottom.checked_add(1);
    let (Some(width), Some(height), Some(right), Some(bottom)) = (width, height, right, bottom)
    else {
        return Err(CommandError::validation("灵动岛圆角区域超出范围"));
    };
    let diameter = width.min(height);
    // GDI excludes the last rounded-region edge pixel; +1 preserves the requested
    // bounds. Coordinates are already physical pixels, including fractional DPI.
    // The capsule is then dilated by EDGE_BLEED (rect grows, radius grows) so the
    // clip never intersects the painted edge. Saturating ops: bounds already
    // passed overflow checks, and a clamped far edge clips nothing extra.
    let region_diameter = diameter.saturating_add(EDGE_BLEED * 2);
    // SAFETY: caller supplies a live HWND and validated window-relative bounds.
    unsafe {
        let region = CreateRoundRectRgn(
            bounds.left.saturating_sub(EDGE_BLEED),
            bounds.top.saturating_sub(EDGE_BLEED),
            right.saturating_add(EDGE_BLEED),
            bottom.saturating_add(EDGE_BLEED),
            region_diameter,
            region_diameter,
        );
        if region.0.is_null() {
            return Err(CommandError::internal("无法创建灵动岛圆角区域"));
        }
        // Windows owns the region only after a successful SetWindowRgn.
        if SetWindowRgn(hwnd, region, true) == 0 {
            let _ = DeleteObject(region);
            return Err(CommandError::internal("无法设置灵动岛圆角区域"));
        }
    }
    Ok(())
}

/// Called after restoring the initial size/position, but before the first show.
pub(crate) fn clip_initial(hwnd: HWND) -> Result<(), CommandError> {
    let mut client = RECT::default();
    let mut outer = RECT::default();
    let mut origin = POINT::default();
    // SAFETY: the startup window is live and all output pointers are valid.
    unsafe {
        GetClientRect(hwnd, &mut client)
            .and_then(|()| GetWindowRect(hwnd, &mut outer))
            .and_then(|()| ClientToScreen(hwnd, &mut origin).ok())
            .map_err(|e| CommandError::internal(e.to_string()))?;
    }
    let left = origin.x - outer.left;
    let top = origin.y - outer.top;
    clip_capsule(
        hwnd,
        RECT {
            left,
            top,
            right: left + client.right - client.left,
            bottom: top + client.bottom - client.top,
        },
    )
}

#[cfg(test)]
#[path = "ball_region_tests.rs"]
mod tests;
