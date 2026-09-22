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
