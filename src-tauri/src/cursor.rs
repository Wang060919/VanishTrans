/// Mouse cursor position and monitor-aware edge detection for floating window placement.
use tauri::Manager;

/// Cursor position in physical screen coordinates (DPI-aware on Windows).
pub struct CursorPosition {
    pub x: i32,
    pub y: i32,
}

/// Bounds of a single monitor in physical coordinates.
pub struct MonitorBounds {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub scale_factor: f64,
}

/// Get the current mouse cursor position using the Windows API.
#[cfg(target_os = "windows")]
pub fn get_cursor_position() -> Option<CursorPosition> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt).is_ok() {
            Some(CursorPosition { x: pt.x, y: pt.y })
        } else {
            None
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_cursor_position() -> Option<CursorPosition> {
    None
}

/// Find the monitor containing the cursor and return its bounds.
/// Falls back to the primary monitor if cursor position cannot be determined.
fn get_cursor_monitor_bounds(app: &tauri::AppHandle) -> Option<MonitorBounds> {
    let cursor = get_cursor_position()?;
    let anchor_window = app
        .get_webview_window("ball")
        .or_else(|| app.get_webview_window("quick"))?;
    let monitors = anchor_window.available_monitors().ok()?;
    // Find the monitor whose area contains the cursor
    for m in &monitors {
        let mx = m.position().x;
        let my = m.position().y;
        let mw = m.size().width as i32;
        let mh = m.size().height as i32;
        if cursor.x >= mx && cursor.x < mx + mw && cursor.y >= my && cursor.y < my + mh {
            return Some(MonitorBounds {
                left: mx,
                top: my,
                width: mw,
                height: mh,
                scale_factor: m.scale_factor(),
            });
        }
    }
    // Fallback: use primary monitor (first in list)
    monitors.first().map(|m| MonitorBounds {
        left: m.position().x,
        top: m.position().y,
        width: m.size().width as i32,
        height: m.size().height as i32,
        scale_factor: m.scale_factor(),
    })
}

/// Default gap between cursor and window edge (pixels).
const CURSOR_GAP: i32 = 12;

/// Compute the optimal window position relative to the cursor,
/// flipping axes when the window would overflow the monitor.
///
/// - `window_w`, `window_h`: the main window's dimensions in logical pixels.
/// - Returns the top-left coordinate for the window, clamped to the monitor.
pub fn compute_cursor_follow_position(
    app: &tauri::AppHandle,
    window_w: f64,
    window_h: f64,
) -> (i32, i32) {
    let cursor = match get_cursor_position() {
        Some(c) => c,
        None => return (100, 100),
    };
    let monitor = match get_cursor_monitor_bounds(app) {
        Some(m) => m,
        None => return (cursor.x + CURSOR_GAP, cursor.y + CURSOR_GAP),
    };

    let ww = (window_w * monitor.scale_factor).round() as i32;
    let wh = (window_h * monitor.scale_factor).round() as i32;

    // Default: right-below cursor
    let mut x = cursor.x + CURSOR_GAP;
    let mut y = cursor.y + CURSOR_GAP;

    // Flip horizontally if overflowing right edge of monitor
    if x + ww > monitor.left + monitor.width {
        x = cursor.x - CURSOR_GAP - ww;
    }
    // Flip vertically if overflowing bottom edge of monitor
    if y + wh > monitor.top + monitor.height {
        y = cursor.y - CURSOR_GAP - wh;
    }

    // Clamp to monitor bounds as a safety net
    let max_x = (monitor.left + monitor.width - ww).max(monitor.left);
    let max_y = (monitor.top + monitor.height - wh).max(monitor.top);
    x = x.clamp(monitor.left, max_x);
    y = y.clamp(monitor.top, max_y);

    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_position_is_copyable() {
        let c = CursorPosition { x: 100, y: 200 };
        assert_eq!(c.x, 100);
        assert_eq!(c.y, 200);
    }
}
