//! SSE decoding only; HTTP lifetime and cancellation live in streaming.rs.
use super::request::check_finish_reason;
use serde::Deserialize;

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: Option<StreamDelta>,
    finish_reason: Option<String>,
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

/// What a processed SSE line observed.
#[derive(Debug, Default)]
pub(super) struct SseOutcome {
    /// The provider sent `data: [DONE]`.
    pub(super) done: bool,
    /// A choice carried a `finish_reason` that passed [`check_finish_reason`].
    pub(super) finish_seen: bool,
}

pub(super) fn process_sse_line(
    line_bytes: &[u8],
    full_text: &mut String,
    on_chunk: &impl Fn(String),
) -> Result<SseOutcome, String> {
    let line = std::str::from_utf8(line_bytes)
        .map_err(|e| format!("流响应包含无效 UTF-8: {}", e))?
        .trim();
    if line.is_empty() || line.starts_with(':') {
        return Ok(SseOutcome::default());
    }

    let Some(data) = line.strip_prefix("data:") else {
        return Ok(SseOutcome::default());
    };
    let data = data.trim_start();
    if data == "[DONE]" {
        return Ok(SseOutcome {
            done: true,
            finish_seen: false,
        });
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
    // Keep-alive and metadata-only frames (usage summaries, Azure
    // `prompt_filter_results` preambles) carry an empty choices array; they
    // cannot complete the stream, so keep waiting for text and completion.
    if choices.is_empty() {
        return Ok(SseOutcome::default());
    }
    let choice = &choices[0];
    check_finish_reason(choice.finish_reason.as_deref())?;
    if choice.delta.is_none() && choice.finish_reason.is_none() {
        return Err("API 流响应格式异常：缺少 delta".to_string());
    }
    if let Some(content) = choice
        .delta
        .as_ref()
        .and_then(|delta| delta.content.as_ref())
    {
        if !content.is_empty() {
            full_text.push_str(content);
            on_chunk(content.clone());
        }
    }
    Ok(SseOutcome {
        done: false,
        finish_seen: choice.finish_reason.is_some(),
    })
}

/// Completion is either `data: [DONE]` or a clean EOF after a terminal chunk
/// that carried a `finish_reason` (Azure/proxies may omit the sentinel). EOF
/// with no `finish_reason` seen means the stream was cut mid-flight.
pub(super) fn finalize_stream_result(
    full_text: String,
    saw_done: bool,
    saw_finish_reason: bool,
) -> Result<String, String> {
    if !saw_done && !saw_finish_reason {
        return Err("流响应在收到 [DONE] 或 finish_reason 前提前结束".into());
    }
    if full_text.trim().is_empty() {
        return Err("API 流响应未返回翻译文本".into());
    }
    Ok(full_text)
}
