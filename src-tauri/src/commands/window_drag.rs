use crate::error::CommandError;

#[cfg(any(target_os = "windows", test))]
use std::time::Duration;

#[cfg(any(target_os = "windows", test))]
async fn wait_for_release(
    mut active: impl FnMut() -> Result<bool, CommandError>,
    timeout: Duration,
) -> Result<(), CommandError> {
    let deadline = tokio::time::Instant::now() + timeout;
    while active()? {
        if tokio::time::Instant::now() >= deadline {
            return Err(CommandError::internal("等待窗口拖动结束超时"));
        }
        tokio::time::sleep(Duration::from_millis(16)).await;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn left_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    // SAFETY: reads the current button state without changing input or capture.
    unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON.0)) < 0 }
}

#[cfg(target_os = "windows")]
fn drag_active(thread_id: u32) -> Result<bool, CommandError> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetGUIThreadInfo, GUITHREADINFO, GUI_INMOVESIZE,
    };
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: thread_id is the calling window's UI thread; info is writable.
    unsafe { GetGUIThreadInfo(thread_id, &mut info) }
        .map_err(|error| CommandError::internal(error.to_string()))?;
    Ok(left_button_down() || info.flags.0 & GUI_INMOVESIZE.0 != 0)
}

/// On Windows start_dragging only posts the native move message. Keep the
/// frontend drag guard active until both the button and native move loop finish.
#[tauri::command]
pub async fn start_window_drag(window: tauri::WebviewWindow) -> Result<bool, CommandError> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let origin = window
            .outer_position()
            .map_err(|error| CommandError::internal(error.to_string()))?;
        let handle = window
            .hwnd()
            .map_err(|error| CommandError::internal(error.to_string()))?;
        // SAFETY: this is the live HWND belonging to the invoking webview.
        let thread_id = unsafe { GetWindowThreadProcessId(HWND(handle.0), None) };
        if thread_id == 0 {
            return Err(CommandError::internal("无法获取窗口拖动线程"));
        }
        // A quick click may already have been released while IPC was queued.
        if !left_button_down() {
            return Ok(false);
        }
        window
            .start_dragging()
            .map_err(|error| CommandError::internal(error.to_string()))?;
        wait_for_release(|| drag_active(thread_id), Duration::from_secs(120)).await?;
        let destination = window
            .outer_position()
            .map_err(|error| CommandError::internal(error.to_string()))?;
        Ok(destination != origin)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Preserve the existing drag behavior on the other supported platforms.
        window
            .start_dragging()
            .map_err(|error| CommandError::internal(error.to_string()))?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    #[tokio::test]
    async fn does_not_finish_until_native_drag_is_released() {
        let active = Arc::new(AtomicBool::new(true));
        let probe = active.clone();
        let task = tokio::spawn(wait_for_release(
            move || Ok(probe.load(Ordering::SeqCst)),
            Duration::from_secs(1),
        ));
        tokio::time::sleep(Duration::from_millis(35)).await;
        assert!(!task.is_finished());
        active.store(false, Ordering::SeqCst);
        task.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn released_click_finishes_without_waiting() {
        wait_for_release(|| Ok(false), Duration::ZERO)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn timeout_and_probe_errors_do_not_report_success() {
        assert!(wait_for_release(|| Ok(true), Duration::ZERO).await.is_err());
        assert!(wait_for_release(
            || Err(CommandError::internal("probe failed")),
            Duration::from_secs(1),
        )
        .await
        .is_err());
    }
}
