use std::sync::Mutex;

/// Maximum width for the preview/OCR image. Larger images are resized to
/// this width before encoding, which dramatically reduces memory usage
/// on 4K/Retina displays while preserving enough detail for OCR.
const MAX_PREVIEW_WIDTH: u32 = 1920;

/// JPEG encoding quality (0-100).
const JPEG_QUALITY: u8 = 85;

/// Scale factor applied to cropped image before OCR for better accuracy.
pub const OCR_SCALE_FACTOR: u32 = 3;

/// OCR output with text and confidence score.
#[derive(serde::Serialize, Clone, Debug)]
pub struct OcrOutput {
    pub text: String,
    /// Average word-level confidence (0.0 - 1.0).
    pub confidence: f32,
}

pub struct ScreenshotBuffer {
    /// Raw image for OCR crop — avoids re-decoding from JPEG on every crop.
    pub image: Mutex<Option<image::DynamicImage>>,
    /// Pre-encoded JPEG data URI for the frontend preview (generated once on capture).
    pub data_uri: Mutex<Option<String>>,
}

fn preview_text(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

/// Capture the primary monitor, resize to max `MAX_PREVIEW_WIDTH` wide,
/// encode as JPEG85% quality, and return the data URI along with the
/// resized `DynamicImage` (stored as `data_uri` for preview; used directly
/// for OCR crop).
pub fn capture_screenshot_as_data_uri() -> Option<(String, image::DynamicImage)> {
    use xcap::Monitor;

    let monitors = Monitor::all().ok()?;
    // Prefer the primary monitor at (0,0); fall back to the first one.
    let primary = monitors.iter()
        .find(|m| m.x().unwrap_or(-1) == 0 && m.y().unwrap_or(-1) == 0)
        .or_else(|| monitors.first())?;
    let img = primary.capture_image().ok()?;
    let original = image::DynamicImage::ImageRgba8(img);
    let (w, h) = (original.width(), original.height());
    log::info!("[capture] raw: {}x{}", w, h);

    // Resize to max width to save memory — JPEG encoding is much smaller than PNG
    let resized = if w > MAX_PREVIEW_WIDTH {
        let new_h = (h as u64 * MAX_PREVIEW_WIDTH as u64) / w as u64;
        original.resize_exact(
            MAX_PREVIEW_WIDTH,
            new_h.max(1) as u32,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        original
    };
    let (rw, rh) = (resized.width(), resized.height());
    log::info!("[capture] resized to {}x{}", rw, rh);

    // JPEG quality — — much smaller than PNG, sharp enough for OCR
    let mut cursor = std::io::Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, JPEG_QUALITY);
    encoder
        .encode_image(&resized)
        .ok()?;
    let bytes = cursor.into_inner();
    log::info!("[capture] JPEG: {} bytes", bytes.len());
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Some((format!("data:image/jpeg;base64,{}", b64), resized))
}

#[cfg(target_os = "windows")]
pub fn native_ocr_on_png(png_data: &[u8]) -> Result<OcrOutput, String> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::StorageFile;

    let tmp_path = std::env::temp_dir().join(format!("vt_ocr_{}.png", std::process::id()));
    std::fs::write(&tmp_path, png_data).map_err(|e| format!("write tmp: {e}"))?;

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
        let preview = preview_text(&text, 80);
        log::info!(
            "[ocr] raw text chars: {}, preview: {:?}",
            text.chars().count(),
            preview
        );
        // Confidence not available in windows 0.58 OcrWord API
        let confidence = if text.is_empty() { 0.0 } else { 0.85 };
        Ok(OcrOutput { text: text.trim().to_string(), confidence })
    })();

    let _ = std::fs::remove_file(&tmp_path);
    result
}

#[cfg(not(target_os = "windows"))]
pub fn native_ocr_on_png(_png_data: &[u8]) -> Result<OcrOutput, String> {
    Err("OCR only supported on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_text_respects_utf8_character_boundaries() {
        assert_eq!(preview_text("你好世界", 3), "你好世");
    }
}