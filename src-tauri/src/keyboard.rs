/// Virtual key codes for Ctrl+C / Ctrl+V simulation.
/// See https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
#[cfg(target_os = "windows")]
mod vk {
    pub use windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY;

    /// Ctrl+C — copy
    pub const COPY: VIRTUAL_KEY = VIRTUAL_KEY(0x43);
    /// Ctrl+V — paste
    pub const PASTE: VIRTUAL_KEY = VIRTUAL_KEY(0x56);
}

#[cfg(target_os = "windows")]
fn send_key_combo(key: vk::VIRTUAL_KEY) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VK_CONTROL,
    };
    unsafe {
        let zero: INPUT = std::mem::zeroed();
        let mut inputs = [zero, zero, zero, zero];
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
        inputs[0] = mk(VK_CONTROL, KEYBD_EVENT_FLAGS::default());
        inputs[1] = mk(key, KEYBD_EVENT_FLAGS::default());
        inputs[2] = mk(key, KEYEVENTF_KEYUP);
        inputs[3] = mk(VK_CONTROL, KEYEVENTF_KEYUP);
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(target_os = "windows")]
pub fn simulate_copy() {
    send_key_combo(vk::COPY);
}

#[cfg(target_os = "windows")]
pub fn simulate_paste() {
    send_key_combo(vk::PASTE);
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_copy() {
    log::warn!("simulate_copy only on Windows");
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_paste() {
    log::warn!("simulate_paste only on Windows");
}
