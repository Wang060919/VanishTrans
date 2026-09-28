use super::*;
use crate::persistence::load_json_with;
use crate::persistence_test_support::TempDir;
use std::{fs, io};

#[test]
fn recovery_history_preserves_corrupt_bytes_before_flush() {
    for bytes in [b"broken\xff\x00\r\n".as_slice(), b"{}", b"[{\"id\":1}]"] {
        let dir = TempDir::new();
        let path = dir.path().join("history.json");
        fs::write(&path, bytes).unwrap();
        let history = HistoryStore::load_or_default_with_max(dir.path().to_path_buf(), 200);
        assert!(history.startup_warning().unwrap().contains("已备份"));
        assert!(history.get_all().is_empty());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        history.add("hello", "你好", "en2zh");
        history.flush().unwrap();
        let backups = dir.backups("history.json");
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read(&backups[0]).unwrap(), bytes);
        let records: Vec<TranslationRecord> =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].original, "hello");
        assert!(!history.dirty.load(Ordering::Relaxed));
    }
}

fn assert_history_blocked(
    dir: &TempDir,
    loaded: LoadedJson<Vec<TranslationRecord>>,
    expected: &str,
) {
    let path = dir.path().join("history.json");
    let bytes = fs::read(&path).unwrap();
    let history = HistoryStore::from_loaded(path.clone(), 200, loaded);
    assert!(history.startup_warning().unwrap().contains(expected));
    history.add("temporary", "临时", "en2zh");
    let id = history.get_all()[0].id;
    for _ in 0..2 {
        assert!(history.flush().is_err());
        assert!(history.dirty.load(Ordering::Relaxed));
        assert!(history.delete(id).is_err());
        assert!(history.clear().is_err());
        assert_eq!(history.get_all().len(), 1);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    assert!(!path.with_extension("json.tmp").exists());
}

#[test]
fn recovery_history_read_failure_never_overwrites_original() {
    let dir = TempDir::new();
    let path = dir.path().join("history.json");
    fs::write(&path, b"unreadable history\xff").unwrap();
    let loaded = load_json_with(
        &path,
        "历史记录",
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "injected read failure",
        )),
        |_, _| panic!("unreadable file must not be backed up"),
    );
    assert_history_blocked(&dir, loaded, "读取失败");
    assert!(dir.backups("history.json").is_empty());
}

#[test]
fn recovery_history_backup_failure_never_overwrites_original() {
    let dir = TempDir::new();
    let path = dir.path().join("history.json");
    fs::write(&path, b"invalid history\xff").unwrap();
    let loaded = load_json_with(&path, "历史记录", fs::read(&path), |_, _| {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "injected backup failure",
        ))
    });
    assert_history_blocked(&dir, loaded, "备份失败");
    assert!(dir.backups("history.json").is_empty());
}

#[test]
fn recovery_history_first_start_saves_on_demand_without_warning() {
    let dir = TempDir::new();
    let path = dir.path().join("history.json");
    let history = HistoryStore::load_or_default_with_max(dir.path().to_path_buf(), 200);
    assert!(history.startup_warning().is_none());
    assert!(!path.exists());
    history.flush().unwrap();
    assert!(!path.exists());
    history.add("first", "首次", "en2zh");
    history.flush().unwrap();
    let reloaded = HistoryStore::load_or_default_with_max(dir.path().to_path_buf(), 200);
    assert_eq!(reloaded.get_all()[0].original, "first");
    assert!(dir.backups("history.json").is_empty());
}

#[test]
fn recovery_history_normal_load_does_not_rewrite_and_keeps_ids() {
    let dir = TempDir::new();
    let path = dir.path().join("history.json");
    let bytes =
        br#"[ {"id":9,"original":"old","translated":"saved","direction":"en2zh","timestamp":1} ]"#;
    fs::write(&path, bytes).unwrap();
    let history = HistoryStore::load_or_default_with_max(dir.path().to_path_buf(), 200);
    assert!(history.startup_warning().is_none());
    history.flush().unwrap();
    assert_eq!(fs::read(&path).unwrap(), bytes);
    history.add("next", "new", "en2zh");
    assert_eq!(history.get_all()[0].id, 10);
    history.flush().unwrap();
    assert!(dir.backups("history.json").is_empty());
}
