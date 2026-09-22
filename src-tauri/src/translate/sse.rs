//! SSE decoding only; HTTP lifetime and cancellation live in streaming.rs.
use serde::Deserialize;

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Deserialize)]
struct StreamErrorInfo {
    message: Option<String>,
}

#[derive(Deserialize)]
struct StreamEnvelope {
    choices: Option<Vec<StreamChoice>>,
    error: Option<StreamErrorInfo>,
}

pub(super) fn process_sse_line(
    line_bytes: &[u8],
    full_text: &mut String,
    on_chunk: &impl Fn(String),
) -> Result<bool, String> {
    let line = std::str::from_utf8(line_bytes)
        .map_err(|e| format!("流响应包含无效 UTF-8: {}", e))?
        .trim();
    if line.is_empty() || line.starts_with(':') {
        return Ok(false);
    }

    let Some(data) = line.strip_prefix("data:") else {
        return Ok(false);
    };
    let data = data.trim_start();
    if data == "[DONE]" {
        return Ok(true);
    }

    let envelope = serde_json::from_str::<StreamEnvelope>(data)
        .map_err(|e| format!("流响应 JSON 格式异常: {}", e))?;
    if let Some(error) = envelope.error {
        return Err(format!(
            "API 流式响应错误: {}",
            error
                .message
                .unwrap_or_else(|| "provider 返回未知错误".to_string())
        ));
    }

    let choices = envelope
        .choices
        .ok_or_else(|| "API 流响应格式异常：缺少 choices".to_string())?;
    let choice = choices
        .first()
        .ok_or_else(|| "API 流响应格式异常：choices 为空".to_string())?;
    if let Some(content) = choice.delta.content.as_ref() {
        if !content.is_empty() {
            full_text.push_str(content);
            on_chunk(content.clone());
        }
    }
    Ok(false)
}

pub(super) fn finalize_stream_result(full_text: String, saw_done: bool) -> Result<String, String> {
    if !saw_done {
        return Err("流响应在收到 [DONE] 前提前结束".into());
    }
    if full_text.trim().is_empty() {
        return Err("API 流响应未返回翻译文本".into());
    }
    Ok(full_text)
}
