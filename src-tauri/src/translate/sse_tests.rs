use super::sse::*;
use crate::lock::LockRecover;

#[test]
fn sse_line_decodes_chinese_and_accepts_missing_space() {
    let mut full_text = String::new();
    let chunks = std::sync::Mutex::new(Vec::new());
    let line = r#"data:{"choices":[{"delta":{"content":"你好"}}]}"#;
    let outcome = process_sse_line(line.as_bytes(), &mut full_text, &|chunk| {
        chunks.lock_recover().push(chunk);
    })
    .unwrap();
    assert!(!outcome.done);
    assert!(!outcome.finish_seen);
    assert_eq!(full_text, "你好");
    assert_eq!(*chunks.lock_recover(), vec!["你好"]);
}

#[test]
fn sse_provider_error_is_returned() {
    let mut full_text = String::new();
    let error = process_sse_line(
        br#"data:{"error":{"message":"quota exceeded"}}"#,
        &mut full_text,
        &|_| {},
    )
    .unwrap_err();
    assert!(error.contains("quota exceeded"));
}

#[test]
fn sse_malformed_json_is_returned() {
    let mut full_text = String::new();
    let error = process_sse_line(b"data:{bad-json}", &mut full_text, &|_| {}).unwrap_err();
    assert!(error.contains("JSON"));
}

#[test]
fn sse_missing_choices_is_returned() {
    let mut full_text = String::new();
    let error = process_sse_line(b"data:{}", &mut full_text, &|_| {}).unwrap_err();
    assert!(error.contains("choices"));
}

#[test]
fn stream_result_requires_done_or_finish_reason_and_text() {
    // Abrupt EOF: neither [DONE] nor a finish_reason was observed.
    assert!(finalize_stream_result("partial".to_string(), false, false).is_err());
    // Clean EOF after a terminal chunk counts as completion.
    assert_eq!(
        finalize_stream_result("done".to_string(), false, true).unwrap(),
        "done"
    );
    // A finish_reason without text still cannot succeed.
    assert!(finalize_stream_result("   ".to_string(), false, true).is_err());
    assert_eq!(
        finalize_stream_result("done".to_string(), true, false).unwrap(),
        "done"
    );
    assert!(finalize_stream_result("   ".to_string(), true, false).is_err());
}

#[test]
fn sse_stop_finish_reason_keeps_success_behavior() {
    let mut full_text = String::new();
    let outcome = process_sse_line(
        r#"data:{"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}"#.as_bytes(),
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    assert!(outcome.finish_seen);
    assert_eq!(
        finalize_stream_result(full_text, true, outcome.finish_seen).unwrap(),
        "你好"
    );
}

#[test]
fn sse_eof_after_finish_reason_stop_completes_without_done() {
    // Proxies/Azure deployments may close the stream right after the terminal
    // chunk without ever sending `data: [DONE]`.
    let mut full_text = String::new();
    process_sse_line(
        r#"data:{"choices":[{"delta":{"content":"你好"}}]}"#.as_bytes(),
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    let outcome = process_sse_line(
        br#"data:{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    assert!(!outcome.done && outcome.finish_seen);
    assert_eq!(
        finalize_stream_result(full_text, false, true).unwrap(),
        "你好"
    );
}

#[test]
fn sse_length_finish_reason_after_partial_content_fails() {
    let mut full_text = String::new();
    process_sse_line(
        r#"data:{"choices":[{"delta":{"content":"部分译文"}}]}"#.as_bytes(),
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    let error = process_sse_line(
        br#"data:{"choices":[{"delta":{},"finish_reason":"length"}]}"#,
        &mut full_text,
        &|_| {},
    )
    .unwrap_err();
    assert!(error.contains("截断"));
    assert_eq!(full_text, "部分译文");
}

#[test]
fn sse_content_filter_finish_reason_fails() {
    let mut full_text = String::new();
    let error = process_sse_line(
        br#"data:{"choices":[{"delta":{"content":null},"finish_reason":"content_filter"}]}"#,
        &mut full_text,
        &|_| {},
    )
    .unwrap_err();
    assert!(error.contains("过滤"));
}

#[test]
fn sse_terminal_chunk_with_only_finish_reason_is_handled() {
    let mut full_text = String::from("已有译文");
    let outcome = process_sse_line(
        br#"data:{"choices":[{"finish_reason":"stop"}]}"#,
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    assert!(!outcome.done && outcome.finish_seen);
    assert_eq!(full_text, "已有译文");
    let error = process_sse_line(
        br#"data:{"choices":[{"finish_reason":"length"}]}"#,
        &mut full_text,
        &|_| {},
    )
    .unwrap_err();
    assert!(error.contains("截断"));
}

#[test]
fn sse_missing_or_null_finish_reason_keeps_existing_behavior() {
    let mut full_text = String::new();
    for line in [
        r#"data:{"choices":[{"delta":{"content":"你好"}}]}"#.as_bytes(),
        r#"data:{"choices":[{"delta":{"content":"世界"},"finish_reason":null}]}"#.as_bytes(),
    ] {
        let outcome = process_sse_line(line, &mut full_text, &|_| {}).unwrap();
        assert!(!outcome.finish_seen);
    }
    assert_eq!(full_text, "你好世界");
    assert!(finalize_stream_result(full_text, false, false).is_err());
}

#[test]
fn sse_unknown_finish_reason_keeps_existing_behavior() {
    let mut full_text = String::new();
    let outcome = process_sse_line(
        r#"data:{"choices":[{"delta":{"content":"你好"},"finish_reason":"end_turn"}]}"#.as_bytes(),
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    assert!(outcome.finish_seen);
    assert_eq!(full_text, "你好");
}
