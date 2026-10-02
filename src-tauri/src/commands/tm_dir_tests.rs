//! set_tm_dir ordering and reset-to-default semantics, driven through
//! `set_tm_dir_to` so no AppHandle is needed.
use super::*;
use crate::persistence_test_support::TempDir;
use crate::tm::TranslationMemory;

#[test]
fn migrate_copies_db_persists_dir_and_repoints_live_connection() {
    let live_dir = TempDir::new();
    let target = TempDir::new();
    let config_dir = TempDir::new();
    let tm = TranslationMemory::open(live_dir.path()).unwrap();
    tm.store("hello", "你好", "auto", "Chinese");
    let config = ApiConfig::load_for_test(config_dir.path().to_path_buf());

    set_tm_dir_to(
        &config,
        &tm,
        target.path().to_str().unwrap(),
        target.path(),
        live_dir.path(),
        true,
    )
    .unwrap();

    assert_eq!(config.tm_dir(), target.path().to_string_lossy());
    assert!(target.path().join("tm.db").exists());
    assert_eq!(tm.db_path().unwrap(), target.path().join("tm.db"));
    // The live connection now reads/writes the moved database.
    assert_eq!(
        tm.lookup("hello", "auto", "Chinese").as_deref(),
        Some("你好")
    );
}

#[test]
fn persist_failure_removes_copied_db_so_retry_works() {
    let live_dir = TempDir::new();
    let target = TempDir::new();
    let config_dir = TempDir::new();
    let tm = TranslationMemory::open(live_dir.path()).unwrap();
    let config = ApiConfig::load_for_test(config_dir.path().to_path_buf());
    // Make the config file unpersistable this run: config.json is a dir.
    std::fs::remove_file(config_dir.path().join("config.json")).unwrap();
    std::fs::create_dir(config_dir.path().join("config.json")).unwrap();

    assert!(set_tm_dir_to(
        &config,
        &tm,
        target.path().to_str().unwrap(),
        target.path(),
        live_dir.path(),
        true,
    )
    .is_err());

    // The copy was rolled back and the in-memory setting restored, so a
    // retry is not blocked by a leftover tm.db.
    assert!(!target.path().join("tm.db").exists());
    assert!(config.tm_dir().is_empty());
    assert_eq!(tm.db_path().unwrap(), live_dir.path().join("tm.db"));
}

#[test]
fn foreign_tm_db_in_custom_dir_is_never_overwritten() {
    let live_dir = TempDir::new();
    let target = TempDir::new();
    let config_dir = TempDir::new();
    let tm = TranslationMemory::open(live_dir.path()).unwrap();
    let config = ApiConfig::load_for_test(config_dir.path().to_path_buf());
    std::fs::write(target.path().join("tm.db"), b"foreign bytes").unwrap();

    assert!(set_tm_dir_to(
        &config,
        &tm,
        target.path().to_str().unwrap(),
        target.path(),
        live_dir.path(),
        true,
    )
    .is_err());

    // Foreign bytes survive untouched and nothing is persisted.
    assert_eq!(
        std::fs::read(target.path().join("tm.db")).unwrap(),
        b"foreign bytes"
    );
    assert!(config.tm_dir().is_empty());
    assert_eq!(tm.db_path().unwrap(), live_dir.path().join("tm.db"));
}

#[test]
fn reset_to_default_quarantines_leftover_db_and_copies_live() {
    let live_dir = TempDir::new();
    let default_dir = TempDir::new();
    let config_dir = TempDir::new();
    let tm = TranslationMemory::open(live_dir.path()).unwrap();
    tm.store("hello", "你好", "auto", "Chinese");
    let config = ApiConfig::load_for_test(config_dir.path().to_path_buf());
    // Stale database left in the default dir by an earlier install.
    std::fs::write(default_dir.path().join("tm.db"), b"stale bytes").unwrap();

    set_tm_dir_to(
        &config,
        &tm,
        "",
        default_dir.path(),
        default_dir.path(),
        true,
    )
    .unwrap();

    // The stale file was moved aside, not overwritten or deleted.
    let backups: Vec<_> = std::fs::read_dir(default_dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("tm.db.bak-"))
        .collect();
    assert_eq!(backups.len(), 1);
    assert_eq!(
        std::fs::read(default_dir.path().join(&backups[0])).unwrap(),
        b"stale bytes"
    );
    // Default dir now holds the live database and the connection repointed.
    let moved = TranslationMemory::open(default_dir.path()).unwrap();
    assert_eq!(
        moved.lookup("hello", "auto", "Chinese").as_deref(),
        Some("你好")
    );
    assert!(config.tm_dir().is_empty());
    assert_eq!(tm.db_path().unwrap(), default_dir.path().join("tm.db"));
}

#[test]
fn reset_without_migrate_does_not_copy_but_still_repoints() {
    let live_dir = TempDir::new();
    let default_dir = TempDir::new();
    let config_dir = TempDir::new();
    let tm = TranslationMemory::open(live_dir.path()).unwrap();
    tm.store("hello", "你好", "auto", "Chinese");
    let config = ApiConfig::load_for_test(config_dir.path().to_path_buf());

    // migrate=false: no copy is made; reopen attaches a fresh empty tm.db.
    set_tm_dir_to(
        &config,
        &tm,
        "",
        default_dir.path(),
        default_dir.path(),
        false,
    )
    .unwrap();

    assert!(config.tm_dir().is_empty());
    assert_eq!(tm.db_path().unwrap(), default_dir.path().join("tm.db"));
    // Entries stay behind in the old location.
    assert_eq!(tm.lookup("hello", "auto", "Chinese"), None);
}

#[test]
fn repeat_set_to_same_dir_skips_copy_and_reopens() {
    let live_dir = TempDir::new();
    let target = TempDir::new();
    let config_dir = TempDir::new();
    let tm = TranslationMemory::open(live_dir.path()).unwrap();
    tm.store("hello", "你好", "auto", "Chinese");
    let config = ApiConfig::load_for_test(config_dir.path().to_path_buf());
    let path = target.path().to_str().unwrap().to_string();

    set_tm_dir_to(&config, &tm, &path, target.path(), live_dir.path(), true).unwrap();
    // The copy already sits at the target and the setting is persisted, so a
    // repeat call must not trip the refuse-to-overwrite guard.
    set_tm_dir_to(&config, &tm, &path, target.path(), live_dir.path(), true).unwrap();

    assert_eq!(tm.db_path().unwrap(), target.path().join("tm.db"));
    assert_eq!(
        tm.lookup("hello", "auto", "Chinese").as_deref(),
        Some("你好")
    );
}
