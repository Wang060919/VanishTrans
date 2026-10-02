use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::lock::LockRecover;

/// OCR output returned to the screenshot overlay.
#[derive(serde::Serialize, Clone, Debug)]
pub struct OcrOutput {
    pub text: String,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SmartSelectionRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotPayload {
    pub data_uri: String,
    pub session_id: u64,
    pub image_width: u32,
    pub image_height: u32,
    pub monitor_x: i32,
    pub monitor_y: i32,
    pub monitor_width: u32,
    pub monitor_height: u32,
    pub scale_factor: f32,
    pub smart_regions: Vec<SmartSelectionRegion>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ScreenshotWindowState {
    pub ball_was_visible: bool,
}

struct ScreenshotSession {
    id: u64,
    windows: ScreenshotWindowState,
    /// Native handle of the overlay window once `start_screenshot` shows it.
    /// Correlate a window's `Destroyed`/`CloseRequested` with the live session:
    /// a stale event from a previous overlay must never clear a newer session.
    window: Option<u64>,
}

pub struct ScreenshotBuffer {
    /// Raw image for OCR crop — avoids re-decoding from JPEG on every crop.
    pub image: Mutex<Option<image::DynamicImage>>,
    /// Preview image and monitor metadata used by the screenshot overlay.
    pub payload: Mutex<Option<ScreenshotPayload>>,
    session: Mutex<Option<ScreenshotSession>>,
    next_session: AtomicU64,
}

impl ScreenshotBuffer {
    pub fn new() -> Self {
        Self {
            image: Mutex::new(None),
            payload: Mutex::new(None),
            session: Mutex::new(None),
            next_session: AtomicU64::new(1),
        }
    }

    pub fn begin(&self, windows: ScreenshotWindowState) -> Option<u64> {
        let mut session = self.session.lock_recover();
        if session.is_some() {
            return None;
        }
        let id = self.next_session.fetch_add(1, Ordering::Relaxed);
        *session = Some(ScreenshotSession {
            id,
            windows,
            window: None,
        });
        Some(id)
    }

    /// Bind the session's overlay window (native handle as an opaque token).
    /// Returns false when the session already ended — the caller must close
    /// the orphaned window.
    pub fn bind_window(&self, session_id: u64, window_token: u64) -> bool {
        let mut session = self.session.lock_recover();
        match session.as_mut() {
            Some(active) if active.id == session_id => {
                active.window = Some(window_token);
                true
            }
            _ => false,
        }
    }

    /// The active session id when `window_token` identifies its overlay.
    /// A destroyed window's event must only cancel its own session.
    pub fn session_id_for_window(&self, window_token: u64) -> Option<u64> {
        self.session
            .lock_recover()
            .as_ref()
            .and_then(|session| (session.window == Some(window_token)).then_some(session.id))
    }

    /// Whether the active session already owns an overlay window. A session
    /// without a bound window is still mid-capture and is never wedged.
    pub fn session_has_window(&self) -> bool {
        self.session
            .lock_recover()
            .as_ref()
            .is_some_and(|session| session.window.is_some())
    }

    pub fn store(
        &self,
        session_id: u64,
        payload: ScreenshotPayload,
        image: image::DynamicImage,
    ) -> bool {
        let session = self.session.lock_recover();
        if session.as_ref().map(|session| session.id) != Some(session_id) {
            return false;
        }
        *self.payload.lock_recover() = Some(payload);
        *self.image.lock_recover() = Some(image);
        true
    }

    pub fn active_session_id(&self) -> Option<u64> {
        self.session
            .lock_recover()
            .as_ref()
            .map(|session| session.id)
    }

    pub fn is_active(&self, session_id: u64) -> bool {
        self.session
            .lock_recover()
            .as_ref()
            .is_some_and(|session| session.id == session_id)
    }

    /// Clone the image only while holding the session guard, so an old OCR
    /// request cannot pass validation and then read a newer session's image.
    pub fn image_for_session(&self, session_id: u64) -> Option<image::DynamicImage> {
        let session = self.session.lock_recover();
        if session.as_ref().map(|active| active.id) != Some(session_id) {
            return None;
        }
        self.image.lock_recover().as_ref().cloned()
    }

    pub fn cancel(&self, session_id: u64) -> Option<ScreenshotWindowState> {
        self.end_session(session_id)
    }

    pub fn complete(&self, session_id: u64) -> Option<ScreenshotWindowState> {
        self.end_session(session_id)
    }

    fn end_session(&self, session_id: u64) -> Option<ScreenshotWindowState> {
        let mut session = self.session.lock_recover();
        if session.as_ref().map(|active| active.id) != Some(session_id) {
            return None;
        }
        let windows = session.take().map(|active| active.windows);
        *self.payload.lock_recover() = None;
        *self.image.lock_recover() = None;
        windows
    }
}
