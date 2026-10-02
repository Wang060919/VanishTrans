use super::session::ScreenshotPayload;

/// Maximum width for the preview/OCR image. Larger images are resized to
/// this width before encoding, which dramatically reduces memory usage
/// on 4K/Retina displays while preserving enough detail for OCR.
const MAX_PREVIEW_WIDTH: u32 = 1920;

/// JPEG encoding quality (0-100).
const JPEG_QUALITY: u8 = 85;

/// Capture the monitor containing the cursor and return a lightweight preview,
/// monitor metadata, and the original full-resolution image for OCR cropping.
pub fn capture_screenshot() -> Option<(ScreenshotPayload, image::DynamicImage)> {
    use xcap::Monitor;

    let monitor = crate::cursor::get_cursor_position()
        .and_then(|cursor| Monitor::from_point(cursor.x, cursor.y).ok())
        .or_else(|| {
            let monitors = Monitor::all().ok()?;
            monitors
                .iter()
                .find(|monitor| monitor.is_primary().unwrap_or(false))
                .cloned()
                .or_else(|| monitors.into_iter().next())
        })?;

    let img = monitor.capture_image().ok()?;
    let original = image::DynamicImage::ImageRgba8(img);
    let (w, h) = (original.width(), original.height());
    let monitor_x = monitor.x().unwrap_or(0);
    let monitor_y = monitor.y().unwrap_or(0);
    let monitor_width = monitor.width().unwrap_or(w);
    let monitor_height = monitor.height().unwrap_or(h);
    let scale_factor = monitor.scale_factor().unwrap_or(1.0);
    let smart_regions = crate::window_regions::visible_window_regions(
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
    );
    log::info!(
        "[capture] monitor: ({}, {}) {}x{} @{}, raw: {}x{}, smart regions: {}",
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
        scale_factor,
        w,
        h,
        smart_regions.len()
    );

    // Build preview JPEG from a resized copy (for display only)
    let resized = if w > MAX_PREVIEW_WIDTH {
        let new_h = (h as u64 * MAX_PREVIEW_WIDTH as u64) / w as u64;
        original.resize_exact(
            MAX_PREVIEW_WIDTH,
            new_h.max(1) as u32,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        original.clone()
    };
    log::info!(
        "[capture] preview resized to {}x{}",
        resized.width(),
        resized.height()
    );

    let mut cursor = std::io::Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, JPEG_QUALITY);
    encoder.encode_image(&resized).ok()?;
    let bytes = cursor.into_inner();
    log::info!("[capture] JPEG: {} bytes", bytes.len());
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    let payload = ScreenshotPayload {
        session_id: 0,
        data_uri: format!("data:image/jpeg;base64,{}", b64),
        image_width: w,
        image_height: h,
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
        scale_factor,
        smart_regions,
    };
    Some((payload, original))
}

/// Best-effort cleanup of OCR temp PNGs left behind by a crashed run.
/// `native_ocr_on_png` deletes its `vt_ocr_{pid}_{seq}.png` via a drop guard,
/// but a crash cannot run it — screenshots would linger as plaintext in %TEMP%.
/// Called once at startup; also removes files from the current pid since a
/// single-instance app has no other live producer at that point.
pub fn sweep_stale_ocr_temp_files() {
    let temp_dir = std::env::temp_dir();
    let Ok(entries) = std::fs::read_dir(&temp_dir) else {
        return;
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if name.starts_with("vt_ocr_")
            && name.ends_with(".png")
            && std::fs::remove_file(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    if removed > 0 {
        log::info!("[ocr] removed {removed} stale temp screenshot file(s)");
    }
}
