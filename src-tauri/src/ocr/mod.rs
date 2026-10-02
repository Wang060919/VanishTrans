//! Screenshot capture, image preparation, and Windows OCR behind a
//! session-scoped buffer shared by the overlay, commands and shortcuts.
mod capture;
mod image;
mod native;
mod session;

pub use capture::{capture_screenshot, sweep_stale_ocr_temp_files};
pub use image::{encode_ocr_png, prepare_enhanced_ocr_image, prepare_original_ocr_image};
pub use native::{native_ocr_on_png, ocr_max_image_dimension};
pub use session::{
    OcrOutput, ScreenshotBuffer, ScreenshotPayload, ScreenshotWindowState, SmartSelectionRegion,
};

#[cfg(test)]
mod image_tests;

#[cfg(test)]
mod session_tests;
