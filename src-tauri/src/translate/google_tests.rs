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
