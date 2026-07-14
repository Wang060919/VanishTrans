use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

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
        *self.last_written_hash.lock().unwrap() = h.finish();
        self.dirty.store(true, Ordering::SeqCst);
    }

    pub fn is_own_content(&self, text: &str) -> bool {
        if !self.dirty.load(Ordering::SeqCst) {
            return false;
        }
        let mut h = DefaultHasher::new();
        text.hash(&mut h);
        h.finish() == *self.last_written_hash.lock().unwrap()
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
        let mut last = self.watch_last_hash.lock().unwrap();
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
}
