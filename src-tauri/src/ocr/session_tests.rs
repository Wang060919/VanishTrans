use super::session::*;
use crate::lock::LockRecover;
use image::GenericImageView;

#[test]
fn screenshot_payload_uses_frontend_camel_case_fields() {
    let payload = ScreenshotPayload {
        session_id: 42,
        data_uri: "data:image/jpeg;base64,AAA".into(),
        image_width: 3840,
        image_height: 2160,
        monitor_x: -1920,
        monitor_y: 0,
        monitor_width: 3840,
        monitor_height: 2160,
        scale_factor: 1.5,
        smart_regions: vec![SmartSelectionRegion {
            x: 120,
            y: 80,
            width: 800,
            height: 600,
        }],
    };
    let value = serde_json::to_value(payload).unwrap();
    assert_eq!(value["imageWidth"], 3840);
    assert_eq!(value["monitorX"], -1920);
    assert_eq!(value["scaleFactor"], 1.5);
    assert_eq!(value["smartRegions"][0]["width"], 800);
}

fn window_state() -> ScreenshotWindowState {
    ScreenshotWindowState {
        ball_was_visible: true,
    }
}

fn payload() -> ScreenshotPayload {
    ScreenshotPayload {
        session_id: 0,
        data_uri: "data:image/jpeg;base64,AAA".into(),
        image_width: 1,
        image_height: 1,
        monitor_x: 0,
        monitor_y: 0,
        monitor_width: 1,
        monitor_height: 1,
        scale_factor: 1.0,
        smart_regions: Vec::new(),
    }
}

#[test]
fn screenshot_buffer_allows_only_one_active_session() {
    let buffer = ScreenshotBuffer::new();
    let session = buffer.begin(window_state()).unwrap();
    assert!(buffer.begin(ScreenshotWindowState::default()).is_none());
    assert!(buffer.store(session, payload(), image::DynamicImage::new_rgba8(1, 1)));
    assert_eq!(buffer.complete(session), Some(window_state()));
    assert!(buffer.payload.lock_recover().is_none());
    assert!(buffer.image.lock_recover().is_none());
}

#[test]
fn cancelled_capture_cannot_store_a_late_screenshot() {
    let buffer = ScreenshotBuffer::new();
    let session = buffer.begin(window_state()).unwrap();
    assert_eq!(buffer.cancel(session), Some(window_state()));
    assert!(!buffer.store(session, payload(), image::DynamicImage::new_rgba8(1, 1)));
}

#[test]
fn stale_session_cannot_complete_or_clear_new_capture() {
    let buffer = ScreenshotBuffer::new();
    let first = buffer.begin(window_state()).unwrap();
    assert_eq!(buffer.cancel(first), Some(window_state()));
    let second = buffer.begin(window_state()).unwrap();

    assert_eq!(buffer.complete(first), None);
    assert!(!buffer.store(first, payload(), image::DynamicImage::new_rgba8(1, 1)));
    assert!(buffer.store(second, payload(), image::DynamicImage::new_rgba8(1, 1)));
    assert_eq!(buffer.complete(first), None);
    assert_eq!(buffer.complete(second), Some(window_state()));
}

#[test]
fn image_lookup_rejects_stale_session_ids() {
    let buffer = ScreenshotBuffer::new();
    let first = buffer.begin(window_state()).unwrap();
    assert!(buffer.store(first, payload(), image::DynamicImage::new_rgba8(1, 1)));
    assert!(buffer.image_for_session(first).is_some());
    assert_eq!(buffer.cancel(first), Some(window_state()));

    let second = buffer.begin(window_state()).unwrap();
    assert!(buffer.store(second, payload(), image::DynamicImage::new_rgba8(2, 3)));
    assert!(buffer.image_for_session(first).is_none());
    assert_eq!(
        buffer.image_for_session(second).unwrap().dimensions(),
        (2, 3)
    );
}

#[test]
fn window_events_only_end_their_own_session() {
    let buffer = ScreenshotBuffer::new();
    let first = buffer.begin(window_state()).unwrap();
    assert!(buffer.bind_window(first, 0x111));

    // A destroyed/hidden event carries the overlay's native token; a stale
    // overlay's token must not cancel a newer session.
    assert_eq!(buffer.session_id_for_window(0x111), Some(first));
    assert_eq!(buffer.session_id_for_window(0x999), None);

    assert_eq!(buffer.cancel(first), Some(window_state()));
    let second = buffer.begin(window_state()).unwrap();
    assert!(buffer.bind_window(second, 0x222));
    assert_eq!(buffer.session_id_for_window(0x111), None);
    assert_eq!(buffer.session_id_for_window(0x222), Some(second));
}

#[test]
fn unbound_session_reports_no_window_and_bind_fails_after_end() {
    let buffer = ScreenshotBuffer::new();
    assert!(!buffer.session_has_window());

    let session = buffer.begin(window_state()).unwrap();
    assert!(!buffer.session_has_window());

    assert!(buffer.bind_window(session, 0x42));
    assert!(buffer.session_has_window());

    assert_eq!(buffer.cancel(session), Some(window_state()));
    assert!(!buffer.bind_window(session, 0x43));
    assert!(!buffer.session_has_window());
}
