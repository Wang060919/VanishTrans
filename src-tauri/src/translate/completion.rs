use super::{
    http::{map_http_error, read_response_body_limited, TIMEOUT_SECS},
    request::{
        build_chat_request, build_translation_prompt, check_finish_reason, validate_and_get_config,
        ChatResponse, TranslationPrompt, BASE_SYSTEM_PROMPT,
    },
};
use crate::config::ApiConfig;
use crate::lock::LockRecover;
use std::time::Duration;

pub async fn do_translate_async(
    state: &ApiConfig,
    snapshot: &crate::config::TranslationConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, String> {
    // Use the same immutable settings for credentials, model and glossary.
    let config = validate_and_get_config(snapshot, text)?;
    let prompt = build_translation_prompt(snapshot, text, source_lang, target_lang);

    // 3. Build request body
    let body = build_chat_request(config.model, prompt, false);

    // 4. Send request
    let client = state.client.lock_recover().clone();
    let resp = client
        .post(&config.chat_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .send()
        .await
        .map_err(map_http_error(&config.base_url))?;

    // 5. Handle response
    let status = resp.status();
    if !status.is_success() {
        // Surface a failed/truncated error-body read like the streaming path's
        // read_error_response instead of masking it behind an empty message.
        let bytes = match read_response_body_limited(resp).await {
            Ok(bytes) => bytes,
            Err(error) => return Err(error),
        };
        let b = String::from_utf8_lossy(&bytes).to_string();
        return Err(match status.as_u16() {
            401 => "API Key 无效或已过期，请在设置中更新".into(),
            429 => "API 请求频率超限，请稍后重试".into(),
            500..=599 => format!("API 服务内部错误 ({})，请稍后重试", status.as_u16()),
            _ => format!("API 错误 ({}): {}", status.as_u16(), b),
        });
    }

    let bytes = read_response_body_limited(resp).await?;
    parse_chat_translation(&bytes)
}

/// Parse a chat completion body, rejecting truncated or filtered output
/// before any partial content can reach the caller.
pub(super) fn parse_chat_translation(bytes: &[u8]) -> Result<String, String> {
    let cr: ChatResponse =
        serde_json::from_slice(bytes).map_err(|e| format!("解析响应 JSON 失败: {}", e))?;
    let choice = cr
        .choices
        .first()
        .ok_or_else(|| String::from("API 返回了空翻译结果"))?;
    check_finish_reason(choice.finish_reason.as_deref())?;
    choice
        .message
        .as_ref()
        .and_then(|message| message.content.as_deref())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
        .ok_or_else(|| String::from("API 返回了空翻译结果"))
}

pub async fn test_connection_async(
    state: &ApiConfig,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("Base URL 不能为空".into());
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("Base URL 必须以 http:// 或 https:// 开头".into());
    }
    if model.trim().is_empty() {
        return Err("模型名称不能为空".into());
    }
    if api_key.trim().is_empty() {
        return Err("请先配置 API Key".into());
    }

    let chat_url = if base_url.ends_with("/v1") {
        format!("{}/chat/completions", base_url)
    } else {
        format!("{}/v1/chat/completions", base_url)
    };
    let body = build_chat_request(
        model.trim().to_string(),
        TranslationPrompt {
            system_prompt: BASE_SYSTEM_PROMPT.to_string(),
            user_content: "你好".to_string(),
        },
        false,
    );
    let client = state.client.lock_recover().clone();
    let resp = client
        .post(&chat_url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .send()
        .await
        .map_err(map_http_error(&base_url))?;

    let status = resp.status();
    if !status.is_success() {
        let bytes = match read_response_body_limited(resp).await {
            Ok(bytes) => bytes,
            Err(error) => return Err(error),
        };
        let b = String::from_utf8_lossy(&bytes).to_string();
        return Err(match status.as_u16() {
            401 => "API Key 无效或已过期".into(),
            404 => "模型名称无效或服务不支持该模型".into(),
            429 => "API 请求频率超限，请稍后重试".into(),
            500..=599 => format!("API 服务内部错误 ({})", status.as_u16()),
            _ => format!("API 错误 ({}): {}", status.as_u16(), b),
        });
    }
    let bytes = read_response_body_limited(resp).await?;
    let cr: ChatResponse =
        serde_json::from_slice(&bytes).map_err(|e| format!("解析响应 JSON 失败: {}", e))?;
    if cr.choices.is_empty() {
        return Err("服务响应格式异常：缺少 choices".into());
    }
    Ok(format!("连接成功：{}（{}）", model.trim(), base_url))
}
