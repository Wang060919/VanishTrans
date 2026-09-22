use futures_util::StreamExt;

pub(super) const MAX_INPUT_CHARS: usize = 10_000;

/// Maximum response body size in bytes (1 MB).
pub(super) const MAX_RESPONSE_BYTES: usize = 1_024 * 1_024;

/// Request timeout in seconds.
pub(super) const TIMEOUT_SECS: u64 = 30;

pub(super) async fn read_response_body_limited(
    response: reqwest::Response,
) -> Result<Vec<u8>, String> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取响应失败: {}", e))?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(format!(
                "API 响应体过大（超过 {} KB）",
                MAX_RESPONSE_BYTES / 1024
            ));
        }
        body.extend_from_slice(&chunk);
    }

    Ok(body)
}

/// Returns a closure that maps reqwest errors to user-friendly messages.
pub(super) fn map_http_error(base_url: &str) -> impl Fn(reqwest::Error) -> String + '_ {
    move |e: reqwest::Error| {
        if e.is_timeout() {
            format!("请求超时（{}秒），请检查网络或稍后重试", TIMEOUT_SECS)
        } else if e.is_connect() {
            format!("无法连接到 {}，请检查 Base URL", base_url)
        } else {
            format!("网络请求失败: {}", e)
        }
    }
}
