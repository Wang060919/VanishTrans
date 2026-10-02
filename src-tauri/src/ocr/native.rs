use super::image::DEFAULT_OCR_MAX_DIMENSION;
use super::session::OcrOutput;

#[cfg(target_os = "windows")]
use super::image::OCR_PADDING;

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
