use super::image::*;

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
    let source =
        image::DynamicImage::ImageLuma8(image::GrayImage::from_pixel(40, 20, image::Luma([80])));
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
