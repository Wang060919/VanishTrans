use super::language::*;

#[test]
fn zh2en_always_targets_english() {
    assert_eq!(resolve_target_lang("hello", "zh2en"), "English");
    assert_eq!(resolve_target_lang("你好", "zh2en"), "English");
}

#[test]
fn en2zh_always_targets_chinese() {
    assert_eq!(resolve_target_lang("hello", "en2zh"), "Chinese");
    assert_eq!(resolve_target_lang("你好", "en2zh"), "Chinese");
}

#[test]
fn auto2zh_always_targets_chinese() {
    assert_eq!(resolve_target_lang("hello", "auto2zh"), "Chinese");
    assert_eq!(resolve_target_lang("你好", "auto2zh"), "Chinese");
}

#[test]
fn auto2en_always_targets_english() {
    assert_eq!(resolve_target_lang("hello", "auto2en"), "English");
    assert_eq!(resolve_target_lang("你好", "auto2en"), "English");
}

#[test]
fn internal_auto_detects_chinese_and_targets_english() {
    assert_eq!(
        resolve_target_lang("你好世界，这是一段中文文本", "auto"),
        "English"
    );
}

#[test]
fn internal_auto_detects_english_and_targets_chinese() {
    assert_eq!(
        resolve_target_lang("hello world, this is english text", "auto"),
        "Chinese"
    );
}

#[test]
fn empty_auto_text_defaults_to_chinese_target() {
    assert_eq!(resolve_target_lang("", "auto"), "Chinese");
}

#[test]
fn cjk_ratio_is_zero_for_pure_ascii() {
    assert_eq!(cjk_ratio("hello world"), 0.0);
}

#[test]
fn cjk_ratio_is_one_for_pure_chinese() {
    assert_eq!(cjk_ratio("你好世界"), 1.0);
}

#[test]
fn cjk_ratio_handles_mixed_text() {
    let ratio = cjk_ratio("hi你好");
    assert!(ratio > 0.0 && ratio < 1.0);
}

#[test]
fn google_target_lang_maps_resolved_labels() {
    assert_eq!(google_target_lang("English"), "en");
    assert_eq!(google_target_lang("Chinese"), "zh-CN");
    assert_eq!(google_target_lang("anything-else"), "zh-CN");
}
