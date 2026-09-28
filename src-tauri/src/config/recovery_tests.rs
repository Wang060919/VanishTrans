use super::*;
use crate::lock::LockRecover;
use crate::persistence::{load_json_with, LoadedJson};
use crate::persistence_test_support::TempDir;
use std::{fs, io};

fn load_without_credentials(dir: &TempDir) -> ApiConfig {
    ApiConfig::load_for_test(dir.path().to_path_buf())
}

#[test]
fn recovery_config_preserves_corrupt_original_bytes_before_default_save() {
    for bytes in [b"broken\xff\x00\r\n".as_slice(), b"{}", b"[]"] {
        let dir = TempDir::new();
        let path = dir.path().join("config.json");
        fs::write(&path, bytes).unwrap();
        let config = load_without_credentials(&dir);
        assert!(config.startup_warning().unwrap().contains("已备份"));
        assert!(!dir.backups("config.json").is_empty());
        for backup in dir.backups("config.json") {
            assert_eq!(fs::read(backup).unwrap(), bytes);
        }
        let defaults: PersistedConfig = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(defaults.model, ApiConfig::defaults().2);
        config.set_free_translation(true).unwrap();
        for backup in dir.backups("config.json") {
            assert_eq!(fs::read(backup).unwrap(), bytes);
        }
    }
}

fn assert_config_blocked(dir: &TempDir, loaded: LoadedJson<PersistedConfig>, expected: &str) {
    let path = dir.path().join("config.json");
    let bytes = fs::read(&path).unwrap();
    let config = ApiConfig::from_loaded(dir.path().to_path_buf(), loaded, String::new());
    assert!(config.startup_warning().unwrap().contains(expected));
    assert_eq!(fs::read(&path).unwrap(), bytes);
    for _ in 0..2 {
        assert!(config.save_to_disk().is_err());
        assert!(config.save_ball_position_fields(100, 200).is_err());
        assert!(config.set_free_translation(true).is_err());
        assert!(!config.free_translation());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    assert!(!path.with_extension("json.tmp").exists());
}

#[test]
fn recovery_config_read_failure_never_overwrites_original() {
    let dir = TempDir::new();
    let path = dir.path().join("config.json");
    fs::write(&path, b"unreadable original\xff").unwrap();
    let loaded = load_json_with(
        &path,
        "配置",
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "injected read failure",
        )),
        |_, _| panic!("unreadable file must not be backed up"),
    );
    assert_config_blocked(&dir, loaded, "读取失败");
    assert!(dir.backups("config.json").is_empty());
}

#[test]
fn recovery_config_backup_failure_never_overwrites_original() {
    let dir = TempDir::new();
    let path = dir.path().join("config.json");
    fs::write(&path, b"invalid original\xff").unwrap();
    let loaded = load_json_with(&path, "配置", fs::read(&path), |_, _| {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "injected backup failure",
        ))
    });
    assert_config_blocked(&dir, loaded, "备份失败");
    assert!(dir.backups("config.json").is_empty());
}

#[test]
fn recovery_config_first_start_saves_defaults_without_warning() {
    let dir = TempDir::new();
    let config = load_without_credentials(&dir);
    assert!(config.startup_warning().is_none());
    let saved: PersistedConfig =
        serde_json::from_slice(&fs::read(dir.path().join("config.json")).unwrap()).unwrap();
    assert_eq!(saved.model, ApiConfig::defaults().2);
    assert_eq!(saved.max_records, default_max_records());
    assert!(dir.backups("config.json").is_empty());
}

#[test]
fn recovery_config_normal_load_does_not_rewrite_and_save_preserves_extra_fields() {
    let dir = TempDir::new();
    let path = dir.path().join("config.json");
    let bytes = br#"{ "base_url": "https://example.invalid", "model": "test", "ball_x": 42 }"#;
    fs::write(&path, bytes).unwrap();
    let config = load_without_credentials(&dir);
    assert_eq!(config.model.lock_recover().as_str(), "test");
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert!(config.startup_warning().is_none());
    config.set_free_translation(true).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved["ball_x"], 42);
    config.save_ball_position_fields(100, 200).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved["ball_x"], 100);
    assert_eq!(saved["ball_y"], 200);
    assert_eq!(saved["model"], "test");
    assert_eq!(saved["free_translation"], true);
    assert!(dir.backups("config.json").is_empty());
}

#[test]
fn recovery_config_save_time_read_failure_does_not_overwrite() {
    let dir = TempDir::new();
    let config = load_without_credentials(&dir);
    let path = dir.path().join("config.json");
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    let marker = path.join("must-survive");
    fs::write(&marker, b"original").unwrap();
    assert!(config.save_to_disk().is_err());
    assert!(config.save_ball_position_fields(100, 200).is_err());
    assert_eq!(fs::read(marker).unwrap(), b"original");
    assert!(!path.with_extension("json.tmp").exists());
}
