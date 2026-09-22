use super::http::MAX_INPUT_CHARS;
use crate::config::ApiConfig;
use crate::lock::LockRecover;
use serde::{Deserialize, Serialize};

pub const BASE_SYSTEM_PROMPT: &str = r#"You are a professional translation engine. Your ONLY task is to translate the user's input text.

RULES (violating any will be considered a failure):
1. Output ONLY the translated text. Nothing else.
2. NO explanations, NO notes, NO pinyin, NO romanization, NO greetings, NO disclaimers.
3. If the input is already in the target language, output it unchanged.
4. Preserve the original formatting: line breaks, whitespace style, and punctuation conventions of the source.
5. For code snippets or technical terms in the input, keep them exactly as-is — only translate natural language parts.
6. If the input is ambiguous, pick the most natural reading and translate it. Do NOT ask questions.
7. NEVER prefix with "Translation:", "Here is:", or similar meta-text.
8. NEVER wrap the output in quotes unless the original was quoted.
9. For Chinese output, use simplified Chinese (简体中文).
10. Translate naturally — the result should read as if originally written in the target language."#;

/// Build the system prompt, optionally appending glossary terms.
pub fn build_system_prompt(glossary: &[(String, String)]) -> String {
    if glossary.is_empty() {
        return BASE_SYSTEM_PROMPT.to_string();
    }
    let mut prompt = String::from(BASE_SYSTEM_PROMPT);
    prompt.push_str("\n\nGLOSSARY (use these exact translations when the source term appears):\n");
    for (source, target) in glossary {
        prompt.push_str(&format!("- \"{}\" → \"{}\"\n", source, target));
    }
    prompt
}

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
    pub(super) message: ChatMessageResponse,
}

#[derive(Deserialize)]
pub(super) struct ChatMessageResponse {
    pub(super) content: String,
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

/// Validates input and extracts configuration from ApiConfig.
/// Returns ValidatedConfig with the chat completions URL.
pub(super) fn validate_and_get_config(
    state: &ApiConfig,
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

    // 2. Get configuration
    let (base_url, api_key, model) = {
        (
            state.base_url.lock_recover().clone(),
            state.api_key.lock_recover().clone(),
            state.model.lock_recover().clone(),
        )
    };

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
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> TranslationPrompt {
    let sh = if source_lang == "auto" {
        String::new()
    } else {
        format!(" (source language: {})", source_lang)
    };

    let glossary = state.glossary.lock_recover().clone();
    let system_prompt = build_system_prompt(&glossary);

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
