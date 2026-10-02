#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
pub(crate) mod vk {
    pub use windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY;
    pub const PASTE: VIRTUAL_KEY = VIRTUAL_KEY(0x56);
}

#[cfg(target_os = "windows")]
pub(crate) fn send_key_combo(key: vk::VIRTUAL_KEY, include_shift: bool) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VK_CONTROL, VK_SHIFT,
    };
    unsafe {
        let mk = |vk: vk::VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let mut inputs = Vec::with_capacity(if include_shift { 6 } else { 4 });
        inputs.push(mk(VK_CONTROL, KEYBD_EVENT_FLAGS::default()));
        if include_shift {
            inputs.push(mk(VK_SHIFT, KEYBD_EVENT_FLAGS::default()));
        }
        inputs.push(mk(key, KEYBD_EVENT_FLAGS::default()));
        inputs.push(mk(key, KEYEVENTF_KEYUP));
        if include_shift {
            inputs.push(mk(VK_SHIFT, KEYEVENTF_KEYUP));
        }
        inputs.push(mk(VK_CONTROL, KEYEVENTF_KEYUP));
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) == inputs.len() as u32
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn wait_for_modifiers_release(timeout: Duration) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    let modifiers = [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN];
    let deadline = Instant::now() + timeout;
    loop {
        let released = modifiers
            .iter()
            .all(|key| unsafe { GetAsyncKeyState(key.0 as i32) & i16::MIN == 0 });
        if released {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(8));
    }
}

/// Paste clipboard content via simulated Ctrl+V.
///
/// Waits for physically held modifiers first: Alt+R may still be held when a
/// fast translation returns, and an injected Ctrl+V would then reach the
/// target as Ctrl+Alt+V — "Paste Special" in Office, ignored by many other
/// apps — instead of a plain paste.
#[cfg(target_os = "windows")]
pub fn simulate_paste() -> bool {
    if !wait_for_modifiers_release(Duration::from_millis(450)) {
        log::warn!("[keyboard] Paste skipped because a modifier is still held");
        return false;
    }
    send_key_combo(vk::PASTE, false)
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_paste() -> bool {
    log::warn!("simulate_paste only available on Windows");
    false
}
