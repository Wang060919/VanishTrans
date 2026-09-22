pub(super) fn cjk_ratio(text: &str) -> f64 {
    if text.is_empty() {
        return 0.0;
    }
    let cjk = text
        .chars()
        .filter(|&c| {
            let cp = c as u32;
            (0x4E00..=0x9FFF).contains(&cp)
                || (0x3400..=0x4DBF).contains(&cp)
                || (0x20000..=0x2A6DF).contains(&cp)
                || (0x2A700..=0x2B73F).contains(&cp)
                || (0x2B740..=0x2B81F).contains(&cp)
                || (0x2B820..=0x2CEAF).contains(&cp)
                || (0xF900..=0xFAFF).contains(&cp)
                || (0xFE30..=0xFE4F).contains(&cp)
        })
        .count();
    cjk as f64 / text.chars().count() as f64
}

pub fn resolve_target_lang(text: &str, direction: &str) -> &'static str {
    match direction {
        "auto2zh" | "en2zh" => "Chinese",
        "auto2en" | "zh2en" => "English",
        "auto" if cjk_ratio(text) > 0.3 => "English",
        "auto" => "Chinese",
        _ => "Chinese",
    }
}

/// Map a resolved target language ("Chinese" / "English") to the two-letter
/// language code the free Google Translate endpoint expects.
pub fn google_target_lang(target_lang: &str) -> &'static str {
    match target_lang {
        "English" => "en",
        _ => "zh-CN",
    }
}
