use super::sse::*;
use crate::lock::LockRecover;

#[test]
fn sse_line_decodes_chinese_and_accepts_missing_space() {
    let mut full_text = String::new();
    let chunks = std::sync::Mutex::new(Vec::new());
    let line = r#"data:{"choices":[{"delta":{"content":"你好"}}]}"#;
    let done = process_sse_line(line.as_bytes(), &mut full_text, &|chunk| {
        chunks.lock_recover().push(chunk);
    })
    .unwrap();
    assert!(!done);
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
fn stream_result_requires_done_and_text() {
    assert!(finalize_stream_result("partial".to_string(), false).is_err());
    assert!(finalize_stream_result("   ".to_string(), true).is_err());
    assert_eq!(
        finalize_stream_result("done".to_string(), true).unwrap(),
        "done"
    );
}

#[test]
fn sse_stop_finish_reason_keeps_success_behavior() {
    let mut full_text = String::new();
    process_sse_line(
        r#"data:{"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}"#.as_bytes(),
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    assert_eq!(finalize_stream_result(full_text, true).unwrap(), "你好");
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
    let done = process_sse_line(
        br#"data:{"choices":[{"finish_reason":"stop"}]}"#,
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    assert!(!done);
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
    process_sse_line(
        r#"data:{"choices":[{"delta":{"content":"你好"}}]}"#.as_bytes(),
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    process_sse_line(
        r#"data:{"choices":[{"delta":{"content":"世界"},"finish_reason":null}]}"#.as_bytes(),
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    assert_eq!(full_text, "你好世界");
    assert!(finalize_stream_result(full_text, false).is_err());
}

#[test]
fn sse_unknown_finish_reason_keeps_existing_behavior() {
    let mut full_text = String::new();
    process_sse_line(
        r#"data:{"choices":[{"delta":{"content":"你好"},"finish_reason":"end_turn"}]}"#.as_bytes(),
        &mut full_text,
        &|_| {},
    )
    .unwrap();
    assert_eq!(full_text, "你好");
}
