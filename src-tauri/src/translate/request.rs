use super::http::MAX_INPUT_CHARS;
use crate::config::TranslationConfig;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    pub(super) content: String,
}

#[derive(Serialize)]
pub(super) struct ChatRequest {
    pub(super) model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    stream: bool,
}

#[derive(Deserialize)]
pub(super) struct ChatChoice {
    pub(super) message: Option<ChatMessageResponse>,
    pub(super) finish_reason: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct ChatMessageResponse {
    pub(super) content: Option<String>,
}

/// Map a choice's `finish_reason` onto the existing error flow.
///
/// "stop", missing and null keep the current behavior for providers that
/// never send the field. Only "length" and "content_filter" are rejected;
/// any other value falls through unchanged, so no value gains a new success
/// path and the rejection scope does not grow.
pub(super) fn check_finish_reason(finish_reason: Option<&str>) -> Result<(), String> {
    match finish_reason {
        Some("length") => Err("译文因输出长度限制被截断，请缩短输入后重试".into()),
        Some("content_filter") => Err("译文被内容过滤拦截，无法完成翻译".into()),
        _ => Ok(()),
    }
}

#[derive(Deserialize)]
pub(super) struct ChatResponse {
    pub(super) choices: Vec<ChatChoice>,
}

// Translation helpers (extracted to reduce duplication)
// -----------------------------------------------------------

/// Validated configuration for a translation request.
pub(super) struct ValidatedConfig {
    pub(super) base_url: String,
    pub(super) api_key: String,
    pub(super) model: String,
    pub(super) chat_url: String,
}

/// Translation prompt with system and user messages.
pub(super) struct TranslationPrompt {
    pub(super) system_prompt: String,
    pub(super) user_content: String,
}

/// Validates input and extracts the immutable request configuration.
/// Returns ValidatedConfig with the chat completions URL.
pub(super) fn validate_and_get_config(
    state: &TranslationConfig,
    text: &str,
) -> Result<ValidatedConfig, String> {
    // 1. Validate input length
    if text.chars().count() > MAX_INPUT_CHARS {
        return Err(format!(
            "输入文本过长（{} 字符），最多支持 {} 字符",
            text.chars().count(),
            MAX_INPUT_CHARS
        ));
    }

    // 2. Use the same snapshot as provider routing and the TM fingerprint.
    //    Trim the key so a whitespace-padded credential can't reach the wire.
    let (base_url, api_key, model) = (
        state.base_url.clone(),
        state.api_key.trim().to_owned(),
        state.model.clone(),
    );

    // 3. Validate API key
    if api_key.is_empty() {
        return Err("请先在设置中配置 API Key".into());
    }

    // 4. Validate Base URL
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("Base URL 必须以 http:// 或 https:// 开头".into());
    }

    // 5. Build chat URL
    let chat_url = if base_url.ends_with("/v1") || base_url.ends_with("/v1/") {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    } else {
        format!("{}/v1/chat/completions", base_url)
    };

    Ok(ValidatedConfig {
        base_url,
        api_key,
        model,
        chat_url,
    })
}

/// Builds the translation prompt with system and user messages.
/// Includes glossary if available.
pub(super) fn build_translation_prompt(
    state: &TranslationConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> TranslationPrompt {
    let sh = if source_lang == "auto" {
        String::new()
    } else {
        format!(" (source language: {})", source_lang)
    };

    let system_prompt = super::prompt::build_prompt(text, &state.glossary);

    let user_content = format!(
        "Translate the following text{} to {}:\n\n{}",
        sh, target_lang, text
    );

    TranslationPrompt {
        system_prompt,
        user_content,
    }
}

/// Builds a ChatRequest with the given parameters.
pub(super) fn build_chat_request(
    model: String,
    prompt: TranslationPrompt,
    stream: bool,
) -> ChatRequest {
    ChatRequest {
        model,
        messages: vec![
            ChatMessage {
                role: "system".into(),
                content: prompt.system_prompt,
            },
            ChatMessage {
                role: "user".into(),
                content: prompt.user_content,
            },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        stream,
    }
}
