use super::{protected_spans, validate_protected};

fn literals(text: &str) -> Vec<&str> {
    protected_spans(text)
        .iter()
        .map(|span| &text[span.start..span.end])
        .collect()
}

#[test]
fn preserves_codes_urls_tags_and_placeholders() {
    let source = "Use `x()` at https://example.com/a. <b>Hello</b> {user} ${path} {{name}} %2$s";
    assert_eq!(
        literals(source),
        vec![
            "`x()`",
            "https://example.com/a",
            "<b>",
            "</b>",
            "{user}",
            "${path}",
            "{{name}}",
            "%2$s"
        ]
    );
    assert!(validate_protected(
        source,
        "使用 `x()`，https://example.com/a。<b>你好</b> {user} ${path} {{name}} %2$s"
    )
    .is_ok());
}

#[test]
fn rejects_changes_and_multiplicity_loss() {
    assert!(validate_protected("{x} then {x}", "{x}").is_err());
    assert!(validate_protected("{x} and {{x}}", "{{x}}").is_err());
    assert!(validate_protected("`first()`", "`second()`").is_err());
    assert!(validate_protected("https://example.com/a", "https://example.com/ab").is_err());
}

#[test]
fn prose_percentages_and_malformed_braces_are_not_protected() {
    assert!(literals("Save 50% discount; 20% faster. {{name} {other}} %%s").is_empty());
    assert!(validate_protected("Save 50% discount", "节省五成折扣").is_ok());
    assert_eq!(
        literals("Use %s and %03d and %.2f"),
        vec!["%s", "%03d", "%.2f"]
    );
}

#[test]
fn fence_requires_a_closing_line_and_accepts_longer_closer() {
    let source = "Before\n```js\nconsole.log(\"```\");\n````\nAfter";
    assert_eq!(literals(source), vec!["```js\nconsole.log(\"```\");\n````"]);
    assert_eq!(literals("~~~rs\nx()\n~~~\n"), vec!["~~~rs\nx()\n~~~"]);
    assert_eq!(literals("```rs\nx()"), vec!["```rs\nx()"]);
}

#[test]
fn inline_code_handles_delimiter_lengths_and_unicode() {
    assert_eq!(literals("中文 ``a ` b`` and `c`"), vec!["``a ` b``", "`c`"]);
    assert!(literals("normal ~~text~~ and unmatched `text").is_empty());
}

#[test]
fn urls_keep_balanced_parentheses_but_not_sentence_closers() {
    assert_eq!(
        literals("See (https://example.com/a_(b))."),
        vec!["https://example.com/a_(b)"]
    );
}

#[test]
fn glossary_uses_longest_match_but_keeps_other_short_occurrences() {
    use super::super::terminology::matching_terms;
    let glossary = vec![
        ("agent".into(), "代理".into()),
        ("AI agent".into(), "智能体".into()),
        ("Agent".into(), "智能体".into()),
    ];
    let terms = matching_terms("AI agent and agent, Agent, agents and _agent", &glossary);
    assert_eq!(
        terms.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>(),
        vec!["AI agent", "agent", "Agent"]
    );
}

#[test]
fn glossary_does_not_match_inside_protected_spans() {
    use super::super::terminology::matching_terms;
    let glossary = vec![("agent".into(), "智能体".into())];
    assert!(matching_terms(
        "`agent` {agent} https://example.com/agent <agent>",
        &glossary
    )
    .is_empty());
}

#[test]
fn markup_preserves_quoted_attributes_and_tag_order() {
    let source = "<a title=\"a > b\">Text</a>";
    assert_eq!(literals(source), vec!["<a title=\"a > b\">", "</a>"]);
    assert!(validate_protected(source, "<a title=\"a > b\">文字</a>").is_ok());
    assert!(validate_protected("<b>Text</b>", "</b>文字<b>").is_err());
}

#[test]
fn urls_stop_before_cjk_punctuation_but_keep_unicode_and_encoded_paths() {
    assert!(validate_protected(
        "See https://example.com/a.",
        "见 https://example.com/a。然后继续"
    )
    .is_ok());
    assert_eq!(
        literals("打开（https://example.com/a），然后继续。"),
        vec!["https://example.com/a"]
    );
    assert_eq!(
        literals("见 https://例子.中国/路径?q=%E3%80%82。下一步"),
        vec!["https://例子.中国/路径?q=%E3%80%82"]
    );
    assert!(validate_protected("https://example.com/a", "https://example.com/b。下一步").is_err());
}
