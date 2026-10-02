pub(crate) const DEFAULT_OCR_MAX_DIMENSION: u32 = 4200;
const OCR_MAX_UPSCALE: f64 = 4.0;
pub(crate) const OCR_PADDING: u32 = 16;

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
