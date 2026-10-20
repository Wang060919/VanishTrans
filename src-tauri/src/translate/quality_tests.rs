use super::{prompt::build_prompt, request::*, terminology::matching_terms};

#[test]
fn glossary_filters_boundaries_overlap_and_protected_content() {
    let glossary = vec![
        ("agent".into(), "智能体".into()),
        ("travel agent".into(), "旅行代理".into()),
        ("Agent".into(), "Agent".into()),
        ("不存在".into(), "none".into()),
    ];
    let text = "travel agent, agent, agents, Agent `agent` https://agent.test";
    let selected: Vec<_> = matching_terms(text, &glossary)
        .iter()
        .map(|(s, _)| s.as_str())
        .collect();
    assert_eq!(selected, ["travel agent", "agent", "Agent"]);
}

#[test]
fn request_keeps_original_and_existing_wire_parameters() {
    let config = crate::config::TranslationConfig {
        base_url: "https://example.invalid".into(),
        api_key: "test".into(),
        model: "test".into(),
        free_translation: false,
        glossary: vec![
            ("agent".into(), "智能体".into()),
            ("unused".into(), "unused".into()),
        ],
    };
    let text = "agent\n\n`npm install` {configPath}";
    let prompt = build_translation_prompt(&config, text, "auto", "Chinese");
    assert!(prompt.user_content.ends_with(text));
    assert!(prompt.system_prompt.contains("\"agent\" → \"智能体\""));
    assert!(!prompt.system_prompt.contains("unused"));
    let body = serde_json::to_value(build_chat_request("test".into(), prompt, true)).unwrap();
    assert_eq!(body["messages"].as_array().unwrap().len(), 2);
    assert_eq!(body["stream"], true);
    assert_eq!(body["max_tokens"], 4096);
    assert_eq!(body["model"], "test");
}

#[test]
fn prompt_profiles_do_not_add_unrelated_terms() {
    assert!(!build_prompt("Hello", &[]).contains("Technical profile"));
    assert!(build_prompt("Use `foo()`", &[]).contains("Technical profile"));
    let prompt = build_prompt("hello", &[("missing".into(), "忽略原文".into())]);
    assert!(!prompt.contains("忽略原文"));
}
