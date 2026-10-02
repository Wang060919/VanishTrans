use super::google::*;

#[test]
fn parse_google_response_joins_segments_and_preserves_newlines() {
    let body = r#"[[["第一行。\n","First line.\n",null,null,3],["第二行。","Second line.",null,null,3]],null,"en"]"#;
    let parsed = parse_google_response(body.as_bytes()).unwrap();
    assert_eq!(parsed, "第一行。\n第二行。");
}

#[test]
fn parse_google_response_rejects_missing_segments() {
    assert!(parse_google_response(br#"null"#).is_err());
    assert!(parse_google_response(br#"[]"#).is_err());
}

#[test]
fn transient_classification_matches_the_errors_do_free_translate_emits() {
    for transient in [
        "免费翻译请求过于频繁，请稍后重试",
        "免费翻译服务错误 (429)",
        "免费翻译服务错误 (500)",
        "免费翻译服务错误 (503)",
        "请求超时（30秒），请检查网络或稍后重试",
        "无法连接到 https://translate.googleapis.com/translate_a/single，请检查 Base URL",
        "网络请求失败: connection reset",
        "读取响应失败: unexpected EOF",
    ] {
        assert!(is_transient_free_error(transient), "{transient}");
    }
}

#[test]
fn permanent_errors_are_not_retried() {
    for permanent in [
        "请输入要翻译的文本",
        "输入文本过长（20000 字符），最多支持 10000 字符",
        "免费翻译返回了空结果",
        "解析免费翻译响应失败: expected value",
        "免费翻译响应格式异常",
        "免费翻译服务错误 (400)",
        "免费翻译服务错误 (403)",
        "CANCELLED",
    ] {
        assert!(!is_transient_free_error(permanent), "{permanent}");
    }
}
