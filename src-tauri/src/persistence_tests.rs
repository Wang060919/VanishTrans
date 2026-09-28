use super::*;
use crate::persistence_test_support::TempDir;
use serde_json::Value;

#[test]
fn recovery_missing_and_valid_files_are_writable_without_backups() {
    let dir = TempDir::new();
    let path = dir.path().join("config.json");
    let missing = load_json::<Value>(&path, "配置");
    assert!(missing.value.is_none());
    assert!(missing.safety.warning.is_none());
    assert!(missing.safety.ensure_writable().is_ok());
    let bytes = br#"{"model":"test"}"#;
    fs::write(&path, bytes).unwrap();
    let valid = load_json::<Value>(&path, "配置");
    assert_eq!(valid.value.unwrap()["model"], "test");
    assert!(valid.safety.warning.is_none());
    assert!(valid.safety.ensure_writable().is_ok());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert!(dir.backups("config.json").is_empty());
}

#[test]
fn recovery_preserves_invalid_utf8_and_never_reuses_a_backup() {
    let dir = TempDir::new();
    let path = dir.path().join("history.json");
    let bytes = b"[invalid\xff\x00\r\n";
    fs::write(&path, bytes).unwrap();
    for _ in 0..2 {
        let loaded = load_json::<Value>(&path, "历史记录");
        assert!(loaded.value.is_none());
        assert!(loaded.safety.ensure_writable().is_ok());
        assert!(loaded.safety.warning.unwrap().contains("已备份"));
    }
    let backups = dir.backups("history.json");
    assert_eq!(backups.len(), 2);
    assert_ne!(backups[0], backups[1]);
    for backup in backups {
        assert_eq!(fs::read(backup).unwrap(), bytes);
    }
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn recovery_read_failure_does_not_try_backup_and_blocks_writes() {
    let dir = TempDir::new();
    let path = dir.path().join("config.json");
    for kind in [io::ErrorKind::PermissionDenied, io::ErrorKind::Other] {
        let loaded = load_json_with::<Value>(
            &path,
            "配置",
            Err(io::Error::new(kind, "injected read failure")),
            |_, _| panic!("must not back up unreadable data"),
        );
        assert!(loaded.value.is_none());
        assert!(loaded.safety.ensure_writable().is_err());
        assert!(loaded.safety.warning.unwrap().contains("读取失败"));
    }
    assert!(!path.exists());
}

#[test]
fn recovery_backup_failure_keeps_original_and_blocks_writes() {
    let dir = TempDir::new();
    let path = dir.path().join("config.json");
    let bytes = b"broken\xff";
    fs::write(&path, bytes).unwrap();
    let loaded = load_json_with::<Value>(&path, "配置", fs::read(&path), |_, seen| {
        assert_eq!(seen, bytes);
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "injected backup failure",
        ))
    });
    assert!(loaded.safety.ensure_writable().is_err());
    assert!(loaded.safety.warning.unwrap().contains("备份失败"));
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert!(dir.backups("config.json").is_empty());
}

#[test]
fn recovery_real_read_and_backup_errors_are_not_missing_files() {
    let dir = TempDir::new();
    let path = dir.path().join("history.json");
    fs::create_dir(&path).unwrap();
    let loaded = load_json::<Value>(&path, "历史记录");
    assert!(loaded.safety.ensure_writable().is_err());
    assert!(loaded.safety.warning.unwrap().contains("读取失败"));
    let absent_parent = dir.path().join("absent").join("config.json");
    assert!(backup_bytes(&absent_parent, b"broken").is_err());
    assert!(!absent_parent.exists());
}
