use super::completion::parse_chat_translation;

#[test]
fn non_stream_stop_finish_reason_returns_translation() {
    let body = r#"{"choices":[{"message":{"content":" 你好 "},"finish_reason":"stop"}]}"#;
    assert_eq!(parse_chat_translation(body.as_bytes()).unwrap(), "你好");

    let bare = r#"{"choices":[{"finish_reason":"stop"}]}"#;
    assert!(parse_chat_translation(bare.as_bytes()).is_err());
}

#[test]
fn non_stream_length_finish_reason_reports_truncation() {
    let body = r#"{"choices":[{"message":{"content":"部分译文"},"finish_reason":"length"}]}"#;
    let error = parse_chat_translation(body.as_bytes()).unwrap_err();
    assert!(error.contains("截断"));

    let bare = r#"{"choices":[{"finish_reason":"length"}]}"#;
    let bare_error = parse_chat_translation(bare.as_bytes()).unwrap_err();
    assert!(bare_error.contains("截断"));
}

#[test]
fn non_stream_content_filter_reports_filtering() {
    let body = r#"{"choices":[{"message":{"content":null},"finish_reason":"content_filter"}]}"#;
    let error = parse_chat_translation(body.as_bytes()).unwrap_err();
    assert!(error.contains("过滤"));
}

#[test]
fn non_stream_missing_or_null_finish_reason_keeps_existing_behavior() {
    let missing = r#"{"choices":[{"message":{"content":"你好"}}]}"#;
    assert_eq!(parse_chat_translation(missing.as_bytes()).unwrap(), "你好");

    let null_reason = r#"{"choices":[{"message":{"content":"你好"},"finish_reason":null}]}"#;
    assert_eq!(
        parse_chat_translation(null_reason.as_bytes()).unwrap(),
        "你好"
    );
}

#[test]
fn non_stream_unknown_finish_reason_keeps_existing_behavior() {
    let body = r#"{"choices":[{"message":{"content":"你好"},"finish_reason":"end_turn"}]}"#;
    assert_eq!(parse_chat_translation(body.as_bytes()).unwrap(), "你好");
}

#[test]
fn non_stream_rejects_empty_and_whitespace_content() {
    for content in ["", " ", "\r\n\t", "\u{3000}"] {
        let body = serde_json::json!({
            "choices": [{"message": {"content": content}, "finish_reason": "stop"}]
        });
        let error = parse_chat_translation(&serde_json::to_vec(&body).unwrap()).unwrap_err();
        assert_eq!(error, "API 返回了空翻译结果");
    }
}

#[test]
fn non_stream_rejects_null_or_missing_content() {
    for message in [serde_json::json!({}), serde_json::json!({"content": null})] {
        let body = serde_json::json!({
            "choices": [{"message": message, "finish_reason": "stop"}]
        });
        assert!(parse_chat_translation(&serde_json::to_vec(&body).unwrap()).is_err());
    }
}
