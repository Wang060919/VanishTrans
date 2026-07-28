use crate::ocr::SmartSelectionRegion;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bounds {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

fn clip_to_monitor(window: Bounds, monitor: Bounds) -> Option<SmartSelectionRegion> {
    let left = window.left.max(monitor.left);
    let top = window.top.max(monitor.top);
    let right = window.right.min(monitor.right);
    let bottom = window.bottom.min(monitor.bottom);
    let width = right.saturating_sub(left);
    let height = bottom.saturating_sub(top);
    if width < 48 || height < 32 {
        return None;
    }

    Some(SmartSelectionRegion {
        x: left.saturating_sub(monitor.left) as u32,
        y: top.saturating_sub(monitor.top) as u32,
        width: width as u32,
        height: height as u32,
    })
}

#[cfg(target_os = "windows")]
pub fn visible_window_regions(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
) -> Vec<SmartSelectionRegion> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
        GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    struct EnumContext {
        monitor: Bounds,
        process_id: u32,
        regions: Vec<SmartSelectionRegion>,
    }

    unsafe extern "system" fn visit_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam.0 as *mut EnumContext);
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == context.process_id {
            return BOOL(1);
        }

        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let ignored_styles = WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_TRANSPARENT.0;
        if ex_style & ignored_styles != 0 {
            return BOOL(1);
        }

        let mut cloaked = 0u32;
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        )
        .is_ok()
            && cloaked != 0
        {
            return BOOL(1);
        }

        let mut rect = RECT::default();
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut std::ffi::c_void,
            std::mem::size_of::<RECT>() as u32,
        )
        .is_err()
            && GetWindowRect(hwnd, &mut rect).is_err()
        {
            return BOOL(1);
        }

        let window = Bounds {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        };
        if let Some(region) = clip_to_monitor(window, context.monitor) {
            if !context.regions.contains(&region) {
                context.regions.push(region);
            }
        }
        BOOL(1)
    }

    let monitor = Bounds {
        left: monitor_x,
        top: monitor_y,
        right: monitor_x.saturating_add(monitor_width as i32),
        bottom: monitor_y.saturating_add(monitor_height as i32),
    };
    let mut context = EnumContext {
        monitor,
        process_id: std::process::id(),
        regions: Vec::new(),
    };
    unsafe {
        let _ = EnumWindows(
            Some(visit_window),
            LPARAM(&mut context as *mut EnumContext as isize),
        );
    }
    context.regions.truncate(96);
    context.regions
}

#[cfg(not(target_os = "windows"))]
pub fn visible_window_regions(
    _monitor_x: i32,
    _monitor_y: i32,
    _monitor_width: u32,
    _monitor_height: u32,
) -> Vec<SmartSelectionRegion> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clips_window_bounds_to_the_captured_monitor() {
        let monitor = Bounds {
            left: -1920,
            top: 0,
            right: 0,
            bottom: 1080,
        };
        let window = Bounds {
            left: -2000,
            top: 100,
            right: -800,
            bottom: 900,
        };

        assert_eq!(
            clip_to_monitor(window, monitor),
            Some(SmartSelectionRegion {
                x: 0,
                y: 100,
                width: 1120,
                height: 800,
            })
        );
    }

    #[test]
    fn rejects_tiny_or_non_intersecting_regions() {
        let monitor = Bounds {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        assert_eq!(
            clip_to_monitor(
                Bounds {
                    left: 10,
                    top: 10,
                    right: 40,
                    bottom: 30,
                },
                monitor,
            ),
            None
        );
        assert_eq!(
            clip_to_monitor(
                Bounds {
                    left: 2000,
                    top: 20,
                    right: 2200,
                    bottom: 200,
                },
                monitor,
            ),
            None
        );
    }
}
