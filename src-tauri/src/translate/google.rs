use super::{
    http::{map_http_error, read_response_body_limited, MAX_INPUT_CHARS, TIMEOUT_SECS},
    language::google_target_lang,
};
use crate::config::ApiConfig;
use crate::lock::LockRecover;
use std::time::Duration;

// -----------------------------------------------------------

/// Public, keyless Google Translate endpoint (the same one used by the web
/// client). Not an official API — no SLA, may change or be rate-limited.
const FREE_TRANSLATE_URL: &str = "https://translate.googleapis.com/translate_a/single";

/// Parse a `translate_a/single` response into the joined translation text.
pub(super) fn parse_google_response(bytes: &[u8]) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("解析免费翻译响应失败: {}", e))?;

    // The response is `[[["译文","原文",...], ...], null, "detected-lang", ...]`.
    // Join every segment's first element to preserve line breaks exactly.
    let segments = value
        .get(0)
        .and_then(|v| v.as_array())
        .ok_or("免费翻译响应格式异常")?;
    let mut translated = String::new();
    for segment in segments {
        if let Some(text) = segment.get(0).and_then(|v| v.as_str()) {
            translated.push_str(text);
        }
    }
    let translated = translated.trim().to_string();
    if translated.is_empty() {
        return Err("免费翻译返回了空结果".into());
    }
    Ok(translated)
}

/// Translate `text` via the free Google Translate endpoint.
/// `target_lang` is the resolved "Chinese" / "English" label from
/// [`super::resolve_target_lang`]; source language is auto-detected server-side.
pub async fn do_free_translate_async(
    state: &ApiConfig,
    text: &str,
    target_lang: &str,
) -> Result<String, String> {
    // 1. Validate input length (mirrors the API path).
    if text.chars().count() > MAX_INPUT_CHARS {
        return Err(format!(
            "输入文本过长（{} 字符），最多支持 {} 字符",
            text.chars().count(),
            MAX_INPUT_CHARS
        ));
    }
    if text.trim().is_empty() {
        return Err("请输入要翻译的文本".into());
    }

    let target = google_target_lang(target_lang);
    let client = state.client.lock_recover().clone();

    // 2. Send the keyless request. `query` percent-encodes `text` for us.
    let resp = client
        .get(FREE_TRANSLATE_URL)
        .query(&[
            ("client", "gtx"),
            ("sl", "auto"),
            ("tl", target),
            ("dt", "t"),
            ("q", text),
        ])
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .send()
        .await
        .map_err(map_http_error(FREE_TRANSLATE_URL))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            429 => "免费翻译请求过于频繁，请稍后重试".into(),
            _ => format!("免费翻译服务错误 ({})", status.as_u16()),
        });
    }

    let bytes = read_response_body_limited(resp).await?;
    parse_google_response(&bytes)
}
