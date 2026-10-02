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
    let mut finish_seen = false;
    for line in [
        r#"data:{"choices":[{"delta":{"content":"你好"}}],"usage":null}"#.as_bytes(),
        br#"data:{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        usage_line().as_slice(),
    ] {
        let outcome = process_sse_line(line, &mut text, &on_chunk).unwrap();
        assert!(!outcome.done);
        finish_seen |= outcome.finish_seen;
    }
    assert!(finish_seen);
    assert_eq!(*chunks.lock_recover(), vec!["你好"]);
    let done = process_sse_line(b"data: [DONE]", &mut text, &on_chunk)
        .unwrap()
        .done;
    assert!(done);
    assert_eq!(
        finalize_stream_result(text, done, finish_seen).unwrap(),
        "你好"
    );
}

#[test]
fn sse_usage_chunk_cannot_replace_done() {
    let mut text = String::from("已有译文");
    let outcome =
        process_sse_line(&usage_line(), &mut text, &|_| panic!("usage emitted text")).unwrap();
    assert!(!outcome.done && !outcome.finish_seen);
    assert_eq!(text, "已有译文");
    assert!(
        finalize_stream_result(text, outcome.done, outcome.finish_seen)
            .unwrap_err()
            .contains("[DONE]")
    );
}

#[test]
fn sse_usage_only_stream_cannot_succeed() {
    let mut text = String::new();
    let outcome =
        process_sse_line(&usage_line(), &mut text, &|_| panic!("usage emitted text")).unwrap();
    assert!(!outcome.done);
    let done = process_sse_line(b"data:[DONE]", &mut text, &|_| {})
        .unwrap()
        .done;
    assert!(finalize_stream_result(text, done, outcome.finish_seen)
        .unwrap_err()
        .contains("未返回翻译文本"));
}

#[test]
fn sse_empty_choices_frames_are_tolerated() {
    // Keep-alive and metadata-only frames (bare `{"choices":[]}`, usage of any
    // shape, Azure `prompt_filter_results` preambles) carry no delta content
    // and must not abort the stream.
    for payload in [
        json!({"choices": []}),
        json!({"choices": [], "usage": null}),
        json!({"choices": [], "usage": {}}),
        json!({"choices": [], "usage": []}),
        json!({"choices": [], "usage": "usage"}),
        json!({"choices": [], "usage": {"total_tokens": 12}}),
        json!({"choices": [], "usage": {"prompt_tokens": "10", "completion_tokens": 2, "total_tokens": 12}}),
        json!({"choices": [], "usage": {"prompt_tokens": -1, "completion_tokens": 2, "total_tokens": 1}}),
        json!({"choices": [], "prompt_filter_results": [{"prompt_index": 0, "content_filter_results": {}}]}),
    ] {
        let mut text = String::from("已有译文");
        let outcome = process_sse_line(format!("data:{payload}").as_bytes(), &mut text, &|_| {
            panic!("metadata frame emitted text")
        })
        .unwrap();
        assert!(!outcome.done && !outcome.finish_seen, "{payload}");
        assert_eq!(text, "已有译文");
    }
}

#[test]
fn sse_stream_of_only_empty_choices_frames_cannot_succeed() {
    let mut text = String::new();
    let mut finish_seen = false;
    for payload in [
        json!({"choices": []}),
        json!({"choices": [], "usage": null}),
    ] {
        let outcome =
            process_sse_line(format!("data:{payload}").as_bytes(), &mut text, &|_| {}).unwrap();
        finish_seen |= outcome.finish_seen;
    }
    // EOF with no finish_reason → abrupt-end error; [DONE] → empty-text error.
    assert!(finalize_stream_result(text.clone(), false, finish_seen).is_err());
    let error = finalize_stream_result(text, true, finish_seen).unwrap_err();
    assert!(error.contains("未返回翻译文本"));
}

#[test]
fn sse_empty_choices_does_not_mask_errors_or_missing_choices() {
    for (payload, expected) in [
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
        let error = process_sse_line(
            format!("data:{payload}").as_bytes(),
            &mut String::new(),
            &|_| panic!("error emitted text"),
        )
        .unwrap_err();
        assert!(error.contains(expected), "{payload}: {error}");
    }
}
