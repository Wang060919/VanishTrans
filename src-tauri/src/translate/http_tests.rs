use super::{read_error_response, read_response_body_limited, MAX_RESPONSE_BYTES, TIMEOUT_SECS};
use std::{future::pending, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
    task::JoinHandle,
};

// Always abort on assertion failure too; no background listener survives a test.
struct LocalServer(JoinHandle<()>);

impl Drop for LocalServer {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn response(status: u16, body: Vec<u8>, stall: bool) -> (reqwest::Response, LocalServer) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = LocalServer(tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            request.push(socket.read_u8().await.unwrap());
            assert!(request.len() < 8192, "unexpected request headers");
        }
        let headers = format!(
            "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len() + usize::from(stall)
        );
        socket.write_all(headers.as_bytes()).await.unwrap();
        socket.write_all(&body).await.unwrap();
        socket.flush().await.unwrap();
        if stall {
            pending::<()>().await;
        }
    }));
    // Disable proxy environment variables: every request must stay on loopback.
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        client.get(format!("http://{address}/error")).send(),
    )
    .await
    .expect("local response headers timed out")
    .unwrap();
    (response, server)
}

#[tokio::test]
async fn error_body_can_cancel_after_headers_while_body_stalls() {
    for status in [400, 401, 429, 503] {
        let (response, _server) = response(status, Vec::new(), true).await;
        let (cancel, cancelled) = oneshot::channel::<()>();
        let error = read_error_response(response, Duration::from_secs(TIMEOUT_SECS), async {
            cancelled.await.unwrap()
        });
        tokio::pin!(error);
        // Poll the reader before signalling cancellation, not just a pre-cancelled future.
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut error)
            .await
            .is_err());
        cancel.send(()).unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), error)
                .await
                .expect("error body ignored cancellation"),
            "CANCELLED"
        );
    }
}

#[tokio::test]
async fn error_body_timeout_is_not_swallowed_by_status_mapping() {
    for status in [400, 401, 429, 503] {
        let (response, _server) = response(status, Vec::new(), true).await;
        let timeout = Duration::from_millis(40);
        let error = tokio::time::timeout(
            Duration::from_secs(1),
            read_error_response(response, timeout, pending()),
        )
        .await
        .expect("error body ignored its read deadline");
        assert_eq!(
            error,
            format!("请求超时（{}秒），请检查网络或稍后重试", timeout.as_secs())
        );
    }
}

#[tokio::test]
async fn error_body_preserves_normal_status_messages() {
    for (status, expected) in [
        (400, "API 错误 (400): 错误详情"),
        (401, "API Key 无效或已过期，请在设置中更新"),
        (429, "API 请求频率超限，请稍后重试"),
        (500, "API 服务内部错误 (500)，请稍后重试"),
        (503, "API 服务内部错误 (503)，请稍后重试"),
        (599, "API 服务内部错误 (599)，请稍后重试"),
    ] {
        let (response, mut server) = response(status, "错误详情".as_bytes().to_vec(), false).await;
        assert_eq!(
            read_error_response(response, Duration::from_secs(1), pending()).await,
            expected
        );
        (&mut server.0).await.unwrap();
    }
}

#[tokio::test]
async fn error_body_accepts_exact_response_size_limit() {
    let body = vec![b'x'; MAX_RESPONSE_BYTES];
    let (response, mut server) = response(400, body.clone(), false).await;
    let actual = tokio::time::timeout(Duration::from_secs(2), read_response_body_limited(response))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(actual, body);
    (&mut server.0).await.unwrap();
}

#[tokio::test]
async fn error_body_rejects_response_above_size_limit() {
    let (response, _server) = response(400, vec![b'x'; MAX_RESPONSE_BYTES + 1], false).await;
    let error = tokio::time::timeout(Duration::from_secs(2), read_response_body_limited(response))
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(error, "API 响应体过大（超过 1024 KB）");
}

#[tokio::test]
async fn error_body_preserves_size_errors_instead_of_status_mapping() {
    for status in [400, 401, 429, 503] {
        let (response, _server) = response(status, vec![b'x'; MAX_RESPONSE_BYTES + 1], false).await;
        assert_eq!(
            read_error_response(response, Duration::from_secs(2), pending()).await,
            "API 响应体过大（超过 1024 KB）"
        );
    }
}

#[tokio::test]
async fn error_body_preserves_read_errors_instead_of_status_mapping() {
    for status in [400, 401, 429, 503] {
        let (response, mut server) = response(status, b"partial".to_vec(), true).await;
        // Close before the promised Content-Length is delivered to force a read error.
        server.0.abort();
        assert!((&mut server.0).await.unwrap_err().is_cancelled());
        let error = read_error_response(response, Duration::from_secs(2), pending()).await;
        assert!(
            error.starts_with("读取响应失败: "),
            "unexpected error: {error}"
        );
    }
}
