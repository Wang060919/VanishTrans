use super::sse::*;
use crate::lock::LockRecover;
use serde_json::json;

fn usage_line() -> Vec<u8> {
    format!(
        "data:{}",
        json!({
            "choices": [],
            "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}
        })
    )
    .into_bytes()
}

#[test]
fn sse_usage_chunk_preserves_translation_until_done() {
    let mut text = String::new();
    let chunks = std::sync::Mutex::new(Vec::new());
    let on_chunk = |chunk| chunks.lock_recover().push(chunk);
    for line in [
        r#"data:{"choices":[{"delta":{"content":"你好"}}],"usage":null}"#.as_bytes(),
        br#"data:{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        usage_line().as_slice(),
    ] {
        assert!(!process_sse_line(line, &mut text, &on_chunk).unwrap());
    }
    assert_eq!(*chunks.lock_recover(), vec!["你好"]);
    let done = process_sse_line(b"data: [DONE]", &mut text, &on_chunk).unwrap();
    assert!(done);
    assert_eq!(finalize_stream_result(text, done).unwrap(), "你好");
}

#[test]
fn sse_usage_chunk_cannot_replace_done() {
    let mut text = String::from("已有译文");
    let done =
        process_sse_line(&usage_line(), &mut text, &|_| panic!("usage emitted text")).unwrap();
    assert!(!done);
    assert_eq!(text, "已有译文");
    assert!(finalize_stream_result(text, done)
        .unwrap_err()
        .contains("[DONE]"));
}

#[test]
fn sse_usage_only_stream_cannot_succeed() {
    let mut text = String::new();
    assert!(
        !process_sse_line(&usage_line(), &mut text, &|_| panic!("usage emitted text")).unwrap()
    );
    let done = process_sse_line(b"data:[DONE]", &mut text, &|_| {}).unwrap();
    assert!(finalize_stream_result(text, done)
        .unwrap_err()
        .contains("未返回翻译文本"));
}

#[test]
fn sse_empty_choices_requires_valid_usage() {
    for payload in [
        json!({"choices": []}),
        json!({"choices": [], "usage": null}),
        json!({"choices": [], "usage": {}}),
        json!({"choices": [], "usage": []}),
        json!({"choices": [], "usage": "usage"}),
        json!({"choices": [], "usage": {"total_tokens": 12}}),
        json!({"choices": [], "usage": {"prompt_tokens": "10", "completion_tokens": 2, "total_tokens": 12}}),
        json!({"choices": [], "usage": {"prompt_tokens": -1, "completion_tokens": 2, "total_tokens": 1}}),
    ] {
        let mut text = String::from("已有译文");
        let error = process_sse_line(format!("data:{payload}").as_bytes(), &mut text, &|_| {
            panic!("invalid usage emitted text")
        })
        .unwrap_err();
        assert!(error.contains("choices 为空"), "{payload}: {error}");
        assert_eq!(text, "已有译文");
    }
}

#[test]
fn sse_usage_does_not_mask_errors_or_missing_choices() {
    for (fields, expected) in [
        (
            json!({"choices": [], "error": {"message": "quota exceeded"}}),
            "quota exceeded",
        ),
        (json!({}), "缺少 choices"),
        (json!({"choices": null}), "缺少 choices"),
        (
            json!({"choices": [{"delta": {}, "finish_reason": "length"}]}),
            "截断",
        ),
    ] {
        let mut payload = fields;
        payload["usage"] = json!({"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12});
        let error = process_sse_line(
            format!("data:{payload}").as_bytes(),
            &mut String::new(),
            &|_| panic!("error emitted text"),
        )
        .unwrap_err();
        assert!(error.contains(expected), "{payload}: {error}");
    }
}
