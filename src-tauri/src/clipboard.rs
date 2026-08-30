use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::lock::LockRecover;

#[cfg(target_os = "windows")]
struct ClipboardFormatSnapshot {
    format: u32,
    bytes: Vec<u8>,
}

/// Snapshot of the clipboard before a simulated Ctrl+C.
/// Preserves the user's original clipboard content across our copy+translate cycle.
pub struct ClipboardBackup {
    text: Option<String>,
    was_empty: bool,
    #[cfg(target_os = "windows")]
    formats: Vec<ClipboardFormatSnapshot>,
}

/// Back up the current clipboard text before overwriting it with a simulated Ctrl+C.
pub fn backup_clipboard(app: &tauri::AppHandle) -> ClipboardBackup {
    let text = app.clipboard().read_text().ok();
    #[cfg(target_os = "windows")]
    let formats = backup_native_clipboard();
    ClipboardBackup {
        was_empty: text.is_none() && clipboard_is_empty(),
        text,
        #[cfg(target_os = "windows")]
        formats,
    }
}

#[cfg(target_os = "windows")]
fn open_clipboard_with_retry(owner: windows::Win32::Foundation::HWND) -> bool {
    use windows::Win32::System::DataExchange::OpenClipboard;

    for attempt in 0..8 {
        if unsafe { OpenClipboard(owner).is_ok() } {
            return true;
        }
        if attempt < 7 {
            thread::sleep(Duration::from_millis(8));
        }
    }
    false
}

#[cfg(target_os = "windows")]
fn is_copyable_global_format(format: u32) -> bool {
    const HANDLE_FORMATS: [u32; 8] = [2, 3, 9, 14, 128, 130, 131, 142];
    !HANDLE_FORMATS.contains(&format) && !(0x0200..=0x03ff).contains(&format)
}

#[cfg(target_os = "windows")]
fn backup_native_clipboard() -> Vec<ClipboardFormatSnapshot> {
    use windows::Win32::Foundation::{HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EnumClipboardFormats, GetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    const MAX_FORMAT_BYTES: usize = 64 * 1024 * 1024;
    const MAX_TOTAL_BYTES: usize = 128 * 1024 * 1024;

    if !open_clipboard_with_retry(HWND::default()) {
        return Vec::new();
    }

    let mut snapshots = Vec::new();
    let mut total_bytes = 0usize;
    let mut format = 0u32;
    unsafe {
        loop {
            format = EnumClipboardFormats(format);
            if format == 0 {
                break;
            }
            if !is_copyable_global_format(format) {
                continue;
            }

            let Ok(handle) = GetClipboardData(format) else {
                continue;
            };
            let global = HGLOBAL(handle.0);
            let size = GlobalSize(global);
            if size == 0
                || size > MAX_FORMAT_BYTES
                || total_bytes.saturating_add(size) > MAX_TOTAL_BYTES
            {
                continue;
            }

            let pointer = GlobalLock(global);
            if pointer.is_null() {
                continue;
            }
            let bytes = std::slice::from_raw_parts(pointer.cast::<u8>(), size).to_vec();
            let _ = GlobalUnlock(global);
            total_bytes += bytes.len();
            snapshots.push(ClipboardFormatSnapshot { format, bytes });
        }
        let _ = CloseClipboard();
    }
    snapshots
}

#[cfg(target_os = "windows")]
fn clipboard_is_empty() -> bool {
    use windows::Win32::System::DataExchange::CountClipboardFormats;
    unsafe { CountClipboardFormats() == 0 }
}

#[cfg(not(target_os = "windows"))]
fn clipboard_is_empty() -> bool {
    true
}

/// Restore a previously backed-up clipboard content.
/// An originally empty clipboard is restored to empty instead of leaving the
/// temporary selection text behind.
pub fn restore_clipboard(app: &tauri::AppHandle, mut backup: ClipboardBackup) -> bool {
    let restored_text = backup.text.clone();

    #[cfg(target_os = "windows")]
    if restore_native_clipboard(app, std::mem::take(&mut backup.formats)) {
        mark_restored_clipboard(app, restored_text.as_deref());
        return true;
    }

    if backup.text.is_none() && !backup.was_empty {
        // If native rich formats could not be restored, never leave the temporary
        // selection text on the user's clipboard. Clearing is the least surprising
        // fallback available when no text backup exists.
        for attempt in 0..5 {
            if app.clipboard().clear().is_ok() {
                mark_restored_clipboard(app, None);
                log::warn!("[clipboard] Native clipboard restore unavailable; clipboard cleared");
                return true;
            }
            if attempt < 4 {
                thread::sleep(Duration::from_millis(10));
            }
        }
        return false;
    }
    for attempt in 0..5 {
        let result = match backup.text.as_ref() {
            Some(text) => app.clipboard().write_text(text.clone()),
            None => app.clipboard().clear(),
        };
        if result.is_ok() {
            mark_restored_clipboard(app, restored_text.as_deref());
            return true;
        }
        if attempt < 4 {
            thread::sleep(Duration::from_millis(10));
        }
    }
    log::warn!("[clipboard] Failed to restore clipboard after selection capture");
    false
}

fn mark_restored_clipboard(app: &tauri::AppHandle, restored_text: Option<&str>) {
    let Some(guard) = app.try_state::<ClipboardGuard>() else {
        return;
    };
    if let Some(text) = restored_text {
        guard.mark_written(text);
    } else {
        guard.clear_dirty();
    }
}

#[cfg(target_os = "windows")]
fn restore_native_clipboard(
    app: &tauri::AppHandle,
    snapshots: Vec<ClipboardFormatSnapshot>,
) -> bool {
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HWND};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };

    let owner = ["quick", "ball"].iter().find_map(|label| {
        app.get_webview_window(label)
            .and_then(|window| window.hwnd().ok())
            .map(|handle| HWND(handle.0 as _))
    });
    let Some(owner) = owner else {
        return false;
    };
    if snapshots.is_empty() || !open_clipboard_with_retry(owner) {
        return false;
    }

    let mut restored_count = 0usize;
    unsafe {
        if EmptyClipboard().is_ok() {
            for snapshot in snapshots {
                let Ok(global) = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, snapshot.bytes.len())
                else {
                    continue;
                };
                let pointer = GlobalLock(global);
                if pointer.is_null() {
                    let _ = GlobalFree(global);
                    continue;
                }
                std::ptr::copy_nonoverlapping(
                    snapshot.bytes.as_ptr(),
                    pointer.cast::<u8>(),
                    snapshot.bytes.len(),
                );
                let _ = GlobalUnlock(global);

                if SetClipboardData(snapshot.format, HANDLE(global.0)).is_ok() {
                    restored_count += 1;
                } else {
                    let _ = GlobalFree(global);
                }
            }
        }
        let _ = CloseClipboard();
    }
    restored_count > 0
}

pub struct ClipboardGuard {
    pub dirty: AtomicBool,
    pub last_written_hash: Mutex<u64>,
    watch_last_hash: Mutex<u64>,
}

impl ClipboardGuard {
    pub fn new() -> Self {
        Self {
            dirty: AtomicBool::new(false),
            last_written_hash: Mutex::new(0),
            watch_last_hash: Mutex::new(0),
        }
    }

    pub fn mark_written(&self, text: &str) {
        let mut h = DefaultHasher::new();
        text.hash(&mut h);
        *self.last_written_hash.lock_recover() = h.finish();
        self.dirty.store(true, Ordering::SeqCst);
    }

    pub fn is_own_content(&self, text: &str) -> bool {
        if !self.dirty.load(Ordering::SeqCst) {
            return false;
        }
        let mut h = DefaultHasher::new();
        text.hash(&mut h);
        h.finish() == *self.last_written_hash.lock_recover()
    }

    pub fn clear_dirty(&self) {
        self.dirty.store(false, Ordering::SeqCst);
    }

    /// Decides whether clipboard-watch mode should translate `text`: skips our
    /// own writes (and clears the dirty flag so the next external copy isn't
    /// mistaken for one of ours) and skips re-triggering on unchanged content
    /// (e.g. the same text copied twice, or a poll re-reading what's already there).
    pub fn should_translate_for_watch(&self, text: &str) -> bool {
        if self.is_own_content(text) {
            self.clear_dirty();
            return false;
        }
        let mut h = DefaultHasher::new();
        text.hash(&mut h);
        let hash = h.finish();
        let mut last = self.watch_last_hash.lock_recover();
        if *last == hash {
            return false;
        }
        *last = hash;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_guard_does_not_flag_anything_as_own_content() {
        let guard = ClipboardGuard::new();
        assert!(!guard.is_own_content("hello"));
    }

    #[test]
    fn recognizes_text_it_just_wrote() {
        let guard = ClipboardGuard::new();
        guard.mark_written("translated text");
        assert!(guard.is_own_content("translated text"));
    }

    #[test]
    fn does_not_flag_different_text_as_own_content() {
        let guard = ClipboardGuard::new();
        guard.mark_written("translated text");
        assert!(!guard.is_own_content("something else the user copied"));
    }

    #[test]
    fn clear_dirty_stops_matching_even_for_same_text() {
        let guard = ClipboardGuard::new();
        guard.mark_written("translated text");
        guard.clear_dirty();
        assert!(!guard.is_own_content("translated text"));
    }

    #[test]
    fn mark_written_updates_the_tracked_hash() {
        let guard = ClipboardGuard::new();
        guard.mark_written("first");
        guard.mark_written("second");
        assert!(!guard.is_own_content("first"));
        assert!(guard.is_own_content("second"));
    }

    #[test]
    fn watch_mode_translates_new_external_content() {
        let guard = ClipboardGuard::new();
        assert!(guard.should_translate_for_watch("hello"));
    }

    #[test]
    fn watch_mode_skips_own_written_content() {
        let guard = ClipboardGuard::new();
        guard.mark_written("translated text");
        assert!(!guard.should_translate_for_watch("translated text"));
        // Clears dirty as a side effect, so a later external copy of the same
        // text is treated as new user content, not mistaken for our own write.
        assert!(!guard.dirty.load(Ordering::SeqCst));
    }

    #[test]
    fn watch_mode_skips_unchanged_content_on_repeat_polls() {
        let guard = ClipboardGuard::new();
        assert!(guard.should_translate_for_watch("hello"));
        assert!(!guard.should_translate_for_watch("hello"));
    }

    #[test]
    fn watch_mode_triggers_again_once_content_changes() {
        let guard = ClipboardGuard::new();
        assert!(guard.should_translate_for_watch("hello"));
        assert!(!guard.should_translate_for_watch("hello"));
        assert!(guard.should_translate_for_watch("world"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rich_clipboard_snapshot_skips_non_global_handle_formats() {
        assert!(!is_copyable_global_format(2));
        assert!(!is_copyable_global_format(14));
        assert!(!is_copyable_global_format(0x0200));
        assert!(!is_copyable_global_format(0x0300));
        assert!(is_copyable_global_format(13));
        assert!(is_copyable_global_format(15));
        assert!(is_copyable_global_format(0xc001));
    }
}
