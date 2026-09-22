use super::{
    http::{map_http_error, read_response_body_limited, MAX_RESPONSE_BYTES, TIMEOUT_SECS},
    request::{build_chat_request, build_translation_prompt, validate_and_get_config},
    sse::{finalize_stream_result, process_sse_line},
    wait_for_request_superseded,
};
use crate::config::ApiConfig;
use crate::lock::LockRecover;
use futures_util::StreamExt;
use std::time::Duration;

pub async fn do_translate_stream_async(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    scope: &str,
    seq: u64,
    on_chunk: impl Fn(String),
) -> Result<String, String> {
    // 1. Validate and get configuration
    let config = validate_and_get_config(state, text)?;

    // 2. Build translation prompt
    let prompt = build_translation_prompt(state, text, source_lang, target_lang);

    // 3. Build request body (with stream: true)
    let body = build_chat_request(config.model, prompt, true);

    // 4. Send streaming request
    let client = state.client.lock_recover().clone();
    let resp = tokio::select! {
        result = tokio::time::timeout(
            Duration::from_secs(TIMEOUT_SECS),
            client
                .post(&config.chat_url)
                .header("Authorization", format!("Bearer {}", config.api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send(),
        ) => {
            result
                .map_err(|_| format!("请求超时（{}秒），请检查网络或稍后重试", TIMEOUT_SECS))?
                .map_err(map_http_error(&config.base_url))?
        }
        _ = wait_for_request_superseded(state, scope, seq) => {
            return Err("CANCELLED".into());
        }
    };

    // 5. Handle response status
    let status = resp.status();
    if !status.is_success() {
        let b =
            String::from_utf8_lossy(&read_response_body_limited(resp).await.unwrap_or_default())
                .to_string();
        return Err(match status.as_u16() {
            401 => "API Key 无效或已过期，请在设置中更新".into(),
            429 => "API 请求频率超限，请稍后重试".into(),
            500..=599 => format!("API 服务内部错误 ({})，请稍后重试", status.as_u16()),
            _ => format!("API 错误 ({}): {}", status.as_u16(), b),
        });
    }

    // 6. Process streaming response
    let mut stream = resp.bytes_stream();
    let mut full_text = String::new();
    let mut buffer: Vec<u8> = Vec::new();
    let mut response_bytes = 0usize;

    let mut saw_done = false;
    'stream: loop {
        // Check if a newer request has superseded this one — abort early to free the connection
        if !state.is_current_request(scope, seq) {
            return Err("CANCELLED".into());
        }

        let next_chunk = tokio::select! {
            result = tokio::time::timeout(Duration::from_secs(TIMEOUT_SECS), stream.next()) => {
                result.map_err(|_| {
                    format!(
                        "流式响应空闲超时（{}秒），请检查网络或 API 服务状态",
                        TIMEOUT_SECS
                    )
                })?
            }
            _ = wait_for_request_superseded(state, scope, seq) => {
                return Err("CANCELLED".into());
            }
        };
        let Some(chunk_result) = next_chunk else {
            break;
        };
        let chunk = chunk_result.map_err(|e| format!("流读取失败: {}", e))?;
        response_bytes = response_bytes.saturating_add(chunk.len());
        if response_bytes > MAX_RESPONSE_BYTES {
            return Err(format!(
                "API 流响应体过大（{} KB），超过限制（{} KB）",
                response_bytes / 1024,
                MAX_RESPONSE_BYTES / 1024
            ));
        }
        buffer.extend_from_slice(&chunk);

        while let Some(line_end) = buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=line_end).collect();
            if process_sse_line(&line, &mut full_text, &on_chunk)? {
                saw_done = true;
                break 'stream;
            }
        }
    }

    if !saw_done && !buffer.is_empty() {
        saw_done = process_sse_line(&buffer, &mut full_text, &on_chunk)?;
    }
    finalize_stream_result(full_text, saw_done)
}
