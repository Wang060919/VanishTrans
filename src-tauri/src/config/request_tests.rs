use super::*;

#[test]
fn request_sequences_are_isolated_by_scope() {
    let dir = std::env::temp_dir().join(format!("vt_request_scope_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let config = ApiConfig::load_or_default(dir.clone());

    let main_request = config.next_request_seq("main");
    let quick_request = config.next_request_seq("quick");
    assert!(config.is_current_request("main", main_request));
    assert!(config.is_current_request("quick", quick_request));

    let next_quick = config.next_request_seq("quick");
    assert!(config.is_current_request("main", main_request));
    assert!(!config.is_current_request("quick", quick_request));
    assert!(config.is_current_request("quick", next_quick));

    config.cancel_current_request("main");
    assert!(!config.is_current_request("main", main_request));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn stale_request_cannot_run_commit_side_effect() {
    let dir = std::env::temp_dir().join(format!("vt_request_commit_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let config = ApiConfig::load_or_default(dir.clone());
    let first = config.next_request_seq("main");
    let second = config.next_request_seq("main");
    let mut committed = false;
    assert!(config
        .with_current_request("main", second, || committed = true)
        .is_some());
    assert!(config
        .with_current_request("main", first, || committed = true)
        .is_none());
    assert!(committed);
    let _ = std::fs::remove_dir_all(dir);
}
