use super::*;
use crate::lock::LockRecover;

#[test]
fn failed_config_save_restores_in_memory_state() {
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "vt_config_rollback_{}_{}",
        std::process::id(),
        suffix
    ));
    let _ = std::fs::create_dir_all(&dir);
    let config = ApiConfig::load_or_default(dir.clone());
    let original = config.free_translation();
    let config_path = dir.join("config.json");
    std::fs::remove_file(&config_path).unwrap();
    std::fs::create_dir(&config_path).unwrap();

    let result = config.set_free_translation(!original);
    assert!(result.is_err());
    assert_eq!(config.free_translation(), original);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn saving_config_preserves_ball_position_fields() {
    let dir = std::env::temp_dir().join(format!("vt_config_test_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("config.json");
    std::fs::write(
        &path,
        r#"{"base_url":"https://api.openai.com","model":"test","ball_x":321,"ball_y":654}"#,
    )
    .unwrap();
    let config = ApiConfig::load_or_default(dir.clone());
    *config.model.lock_recover() = "updated".into();
    config.save_to_disk().unwrap();
    let saved: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(saved["ball_x"], 321);
    assert_eq!(saved["ball_y"], 654);
    assert_eq!(saved["model"], "updated");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn translation_context_hash_is_stable_and_tracks_settings() {
    let dir = std::env::temp_dir().join(format!("vt_ctx_hash_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let config = ApiConfig::load_or_default(dir.clone());

    let first = config.translation_context_hash();
    let second = config.translation_context_hash();
    assert_eq!(first, second);
    assert_eq!(first.len(), 16);

    *config.model.lock_recover() = "deepseek-chat".into();
    assert_ne!(first, config.translation_context_hash());

    let _ = std::fs::remove_dir_all(dir);
}
