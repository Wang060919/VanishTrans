use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::lock::LockRecover;

/// Maximum width for the preview/OCR image. Larger images are resized to
/// this width before encoding, which dramatically reduces memory usage
/// on 4K/Retina displays while preserving enough detail for OCR.
const MAX_PREVIEW_WIDTH: u32 = 1920;

/// JPEG encoding quality (0-100).
const JPEG_QUALITY: u8 = 85;

const DEFAULT_OCR_MAX_DIMENSION: u32 = 4200;
const OCR_MAX_UPSCALE: f64 = 4.0;
const OCR_PADDING: u32 = 16;

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
        *session = Some(ScreenshotSession { id, windows });
        Some(id)
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

#[cfg(target_os = "windows")]
pub fn ocr_max_image_dimension() -> u32 {
    windows::Media::Ocr::OcrEngine::MaxImageDimension()
        .ok()
        .filter(|dimension| *dimension > OCR_PADDING * 2)
        .unwrap_or(DEFAULT_OCR_MAX_DIMENSION)
}

#[cfg(not(target_os = "windows"))]
pub fn ocr_max_image_dimension() -> u32 {
    DEFAULT_OCR_MAX_DIMENSION
}

fn padding_for(max_dimension: u32) -> u32 {
    OCR_PADDING.min(max_dimension.saturating_sub(1) / 2)
}

fn scaled_dimensions(width: u32, height: u32, max_dimension: u32) -> (u32, u32, u32) {
    let padding = padding_for(max_dimension);
    let content_limit = max_dimension
        .saturating_sub(padding.saturating_mul(2))
        .max(1);
    let width = width.max(1);
    let height = height.max(1);
    let fit_scale = (content_limit as f64 / width as f64).min(content_limit as f64 / height as f64);
    let scale = OCR_MAX_UPSCALE.min(fit_scale);
    let scaled_width = ((width as f64 * scale).round() as u32).clamp(1, content_limit);
    let scaled_height = ((height as f64 * scale).round() as u32).clamp(1, content_limit);
    (scaled_width, scaled_height, padding)
}

fn is_dark_dominant(image: &image::GrayImage) -> bool {
    let total = image.width() as u64 * image.height() as u64;
    if total == 0 {
        return false;
    }
    let dark_pixels = image.pixels().filter(|pixel| pixel[0] < 128).count() as u64;
    dark_pixels.saturating_mul(5) >= total.saturating_mul(3)
}

fn percentile_value(histogram: &[u64; 256], rank: u64) -> u8 {
    let mut seen = 0u64;
    for (value, count) in histogram.iter().enumerate() {
        seen += count;
        if seen > rank {
            return value as u8;
        }
    }
    u8::MAX
}

fn stretch_contrast(image: &mut image::GrayImage) {
    let total = image.width() as u64 * image.height() as u64;
    if total < 2 {
        return;
    }

    let mut histogram = [0u64; 256];
    for pixel in image.pixels() {
        histogram[pixel[0] as usize] += 1;
    }

    // Clip the outer 0.5% so isolated screenshot noise does not define the range.
    let last_rank = total - 1;
    let low = percentile_value(&histogram, last_rank.saturating_mul(5) / 1000);
    let high = percentile_value(&histogram, last_rank.saturating_mul(995) / 1000);
    if high.saturating_sub(low) < 2 {
        return;
    }

    let range = (high - low) as u32;
    for pixel in image.pixels_mut() {
        let value = pixel[0];
        pixel[0] = if value <= low {
            0
        } else if value >= high {
            u8::MAX
        } else {
            (((value - low) as u32 * 255 + range / 2) / range) as u8
        };
    }
}

fn add_gray_padding(image: &image::GrayImage, padding: u32) -> image::GrayImage {
    let mut padded = image::GrayImage::from_pixel(
        image.width().saturating_add(padding.saturating_mul(2)),
        image.height().saturating_add(padding.saturating_mul(2)),
        image::Luma([u8::MAX]),
    );
    image::imageops::replace(&mut padded, image, padding as i64, padding as i64);
    padded
}

fn add_rgb_padding(image: &image::RgbImage, padding: u32) -> image::RgbImage {
    let mut padded = image::RgbImage::from_pixel(
        image.width().saturating_add(padding.saturating_mul(2)),
        image.height().saturating_add(padding.saturating_mul(2)),
        image::Rgb([u8::MAX, u8::MAX, u8::MAX]),
    );
    image::imageops::replace(&mut padded, image, padding as i64, padding as i64);
    padded
}

pub fn prepare_enhanced_ocr_image(
    source: &image::DynamicImage,
    max_dimension: u32,
) -> image::DynamicImage {
    let mut grayscale = source.to_luma8();
    let should_invert = is_dark_dominant(&grayscale);
    stretch_contrast(&mut grayscale);
    if should_invert {
        image::imageops::invert(&mut grayscale);
    }

    let (width, height, padding) =
        scaled_dimensions(grayscale.width(), grayscale.height(), max_dimension);
    let resized = image::imageops::resize(
        &grayscale,
        width,
        height,
        image::imageops::FilterType::Lanczos3,
    );
    let sharpened = image::imageops::unsharpen(&resized, 0.8, 2);
    image::DynamicImage::ImageLuma8(add_gray_padding(&sharpened, padding))
}

pub fn prepare_original_ocr_image(
    source: &image::DynamicImage,
    max_dimension: u32,
) -> image::DynamicImage {
    let rgb = source.to_rgb8();
    let (width, height, padding) = scaled_dimensions(rgb.width(), rgb.height(), max_dimension);
    let resized =
        image::imageops::resize(&rgb, width, height, image::imageops::FilterType::Lanczos3);
    image::DynamicImage::ImageRgb8(add_rgb_padding(&resized, padding))
}

pub fn encode_ocr_png(image: &image::DynamicImage) -> Result<Vec<u8>, String> {
    let mut png = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|error| format!("PNG 编码失败: {error}"))?;
    Ok(png.into_inner())
}

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

#[cfg(target_os = "windows")]
pub fn native_ocr_on_png(png_data: &[u8]) -> Result<OcrOutput, String> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::StorageFile;

    // Unique temp filename: PID + atomic counter to avoid race conditions
    static OCR_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = OCR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp_path = std::env::temp_dir().join(format!("vt_ocr_{}_{}.png", std::process::id(), seq));
    std::fs::write(&tmp_path, png_data).map_err(|e| format!("write tmp: {e}"))?;

    // Drop guard: ensure temp file is cleaned up even on panic
    struct TmpFileGuard(std::path::PathBuf);
    impl Drop for TmpFileGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let _guard = TmpFileGuard(tmp_path.clone());

    let result = (|| -> Result<OcrOutput, String> {
        let tmp_path_str = tmp_path
            .to_str()
            .ok_or_else(|| "临时文件路径包含非法 UTF-8 字符".to_string())?;
        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(tmp_path_str))
            .map_err(|e| format!("StorageFile: {e}"))?
            .get()
            .map_err(|e| format!("StorageFile get: {e}"))?;
        let stream = file
            .OpenReadAsync()
            .map_err(|e| format!("open_read: {e}"))?
            .get()
            .map_err(|e| format!("open_read get: {e}"))?;
        let decoder = BitmapDecoder::CreateWithIdAsync(
            BitmapDecoder::PngDecoderId().map_err(|e| format!("PngDecoderId: {e}"))?,
            &stream,
        )
        .map_err(|e| format!("create decoder: {e}"))?
        .get()
        .map_err(|e| format!("decoder get: {e}"))?;
        let sw_bitmap = decoder
            .GetSoftwareBitmapAsync()
            .map_err(|e| format!("get sw: {e}"))?
            .get()
            .map_err(|e| format!("sw get: {e}"))?;
        let bgra = windows::Graphics::Imaging::SoftwareBitmap::Convert(
            &sw_bitmap,
            BitmapPixelFormat::Bgra8,
        )
        .map_err(|e| format!("Convert: {e}"))?;
        log::info!(
            "[ocr] bitmap ready: {}x{}",
            bgra.PixelWidth().unwrap_or(0),
            bgra.PixelHeight().unwrap_or(0)
        );
        let engine =
            OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| format!("engine: {e}"))?;
        let result = engine
            .RecognizeAsync(&bgra)
            .map_err(|e| format!("recognize_async: {e}"))?
            .get()
            .map_err(|e| format!("OCR: {e}"))?;
        let text = result.Text().map_err(|e| format!("text: {e}"))?.to_string();
        log::info!("[ocr] recognized {} chars", text.chars().count());
        Ok(OcrOutput {
            text: text.trim().to_string(),
        })
    })();

    // _guard handles cleanup via Drop
    result
}

#[cfg(not(target_os = "windows"))]
pub fn native_ocr_on_png(_png_data: &[u8]) -> Result<OcrOutput, String> {
    Err("OCR only supported on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;

    #[test]
    fn prepared_images_stay_within_the_ocr_dimension_limit() {
        let source = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            300,
            200,
            image::Rgb([120, 130, 140]),
        ));

        for prepared in [
            prepare_enhanced_ocr_image(&source, 96),
            prepare_original_ocr_image(&source, 96),
        ] {
            assert!(prepared.width() <= 96);
            assert!(prepared.height() <= 96);
            assert!(prepared.width() > 0);
            assert!(prepared.height() > 0);
        }
    }

    #[test]
    fn enhanced_image_inverts_light_text_on_a_dark_background() {
        let mut source = image::GrayImage::from_pixel(40, 20, image::Luma([20]));
        for y in 6..14 {
            for x in 14..26 {
                source.put_pixel(x, y, image::Luma([220]));
            }
        }

        let prepared =
            prepare_enhanced_ocr_image(&image::DynamicImage::ImageLuma8(source), 72).to_luma8();
        assert!(prepared.get_pixel(18, 18)[0] > 240);
        assert!(prepared.get_pixel(36, 26)[0] < 15);
    }

    #[test]
    fn enhanced_image_stretches_low_contrast_text() {
        let mut source = image::GrayImage::from_pixel(40, 20, image::Luma([170]));
        for y in 4..16 {
            for x in 4..18 {
                source.put_pixel(x, y, image::Luma([150]));
            }
        }

        let prepared =
            prepare_enhanced_ocr_image(&image::DynamicImage::ImageLuma8(source), 72).to_luma8();
        assert!(prepared.get_pixel(22, 22)[0] < 15);
        assert!(prepared.get_pixel(50, 22)[0] > 240);
    }

    #[test]
    fn enhanced_image_has_a_white_border_around_the_content() {
        let source = image::DynamicImage::ImageLuma8(image::GrayImage::from_pixel(
            40,
            20,
            image::Luma([80]),
        ));
        let prepared = prepare_enhanced_ocr_image(&source, 72).to_luma8();

        assert_eq!(prepared.dimensions(), (72, 52));
        assert!(prepared.rows().next().unwrap().all(|pixel| pixel[0] == 255));
        assert!(prepared
            .rows()
            .next_back()
            .unwrap()
            .all(|pixel| pixel[0] == 255));
        assert!(prepared.get_pixel(0, prepared.height() / 2)[0] == 255);
        assert!(prepared.get_pixel(prepared.width() - 1, prepared.height() / 2)[0] == 255);
    }

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
}
