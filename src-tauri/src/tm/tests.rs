use super::*;
use crate::lock::LockRecover;
use rusqlite::Connection;
use std::sync::atomic::{AtomicU64, Ordering};

fn temp_tm() -> (TranslationMemory, std::path::PathBuf) {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "vt_tm_test_{}_{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    (TranslationMemory::open(&dir).unwrap(), dir)
}

#[test]
fn export_includes_entries_beyond_search_limit() {
    let (tm, dir) = temp_tm();
    for i in 0..205 {
        tm.store(
            &format!("source-{i}"),
            &format!("target-{i}"),
            "auto",
            "Chinese",
        );
    }
    let path = dir.join("export.csv");
    assert_eq!(tm.export_csv(&path).unwrap(), 205);
    let records = csv::Reader::from_path(&path)
        .unwrap()
        .records()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(records.len(), 205);
    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn import_content_accepts_bom_and_optional_header() {
    let (tm, dir) = temp_tm();
    let csv = "\u{FEFF}source,target,source_lang,target_lang\nhello,你好,auto,Chinese\nworld,世界,auto,Chinese\n";
    assert_eq!(tm.import_csv_content(csv).unwrap(), 2);
    assert_eq!(
        tm.lookup("hello", "auto", "Chinese").as_deref(),
        Some("你好")
    );
    assert_eq!(
        tm.lookup("world", "auto", "Chinese").as_deref(),
        Some("世界")
    );
    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn cache_entries_are_scoped_to_the_translation_context() {
    let (tm, dir) = temp_tm();
    tm.store_in_context("hello", "你好", "auto", "Chinese", "provider-a")
        .unwrap();

    assert_eq!(
        tm.lookup_in_context("hello", "auto", "Chinese", "provider-a")
            .as_deref(),
        Some("你好")
    );
    assert_eq!(
        tm.lookup_in_context("hello", "auto", "Chinese", "provider-b"),
        None
    );

    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn empty_cached_translations_are_misses_and_can_be_replaced() {
    let (tm, dir) = temp_tm();
    for target in ["", " ", "\r\n\t\u{3000}"] {
        tm.store_in_context("hello", target, "auto", "Chinese", "context")
            .unwrap();
        assert_eq!(
            tm.lookup_in_context("hello", "auto", "Chinese", "context"),
            None
        );
        let entries = tm.search("hello");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hit_count, 0);
    }
    tm.store_in_context("hello", "你好", "auto", "Chinese", "context")
        .unwrap();
    assert_eq!(
        tm.lookup_in_context("hello", "auto", "Chinese", "context")
            .as_deref(),
        Some("你好")
    );
    assert_eq!(tm.search("hello").len(), 1);
    drop(tm);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn store_reports_sqlite_write_failures() {
    let (tm, dir) = temp_tm();
    tm.conn
        .lock_recover()
        .execute_batch(
            "CREATE TRIGGER block_tm_insert BEFORE INSERT ON translation_memory
                 BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
        )
        .unwrap();

    let error = tm
        .store_in_context("hello", "你好", "auto", "Chinese", "")
        .unwrap_err();
    assert!(error.contains("写入翻译记忆失败"));
    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn search_treats_like_wildcards_as_literals() {
    let (tm, dir) = temp_tm();
    tm.store("100% complete", "百分比", "auto", "Chinese");
    tm.store("under_score", "下划线", "auto", "Chinese");

    assert_eq!(tm.search("100%").len(), 1);
    assert_eq!(tm.search("_").len(), 1);
    assert_eq!(tm.search("under_score").len(), 1);

    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn csv_export_neutralizes_formulas_and_import_restores_text() {
    let (tm, dir) = temp_tm();
    tm.store("=cmd|' /C calc'!A0", "+translated", "auto", "Chinese");
    let path = dir.join("safe-export.csv");
    tm.export_csv(&path).unwrap();

    let exported = std::fs::read_to_string(&path).unwrap();
    assert!(exported.contains("'=cmd"));
    assert!(exported.contains("'+translated"));

    tm.clear().unwrap();
    tm.import_csv(&path).unwrap();
    assert_eq!(
        tm.lookup("=cmd|' /C calc'!A0", "auto", "Chinese")
            .as_deref(),
        Some("+translated")
    );

    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn opening_an_legacy_database_migrates_it_without_losing_entries() {
    let (_, dir) = temp_tm();
    let db_path = dir.join("tm.db");
    let _ = std::fs::remove_file(&db_path);
    let connection = Connection::open(&db_path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE translation_memory (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     source TEXT NOT NULL,
                     target TEXT NOT NULL,
                     source_lang TEXT NOT NULL DEFAULT '',
                     target_lang TEXT NOT NULL DEFAULT '',
                     created_at INTEGER NOT NULL DEFAULT 0,
                     hit_count INTEGER NOT NULL DEFAULT 0,
                     UNIQUE(source, source_lang, target_lang)
                 );
                 INSERT INTO translation_memory
                     (source, target, source_lang, target_lang)
                 VALUES ('legacy', '旧数据', 'auto', 'Chinese');",
        )
        .unwrap();
    drop(connection);

    let tm = TranslationMemory::open(&dir).unwrap();
    assert_eq!(
        tm.lookup("legacy", "auto", "Chinese").as_deref(),
        Some("旧数据")
    );
    tm.store_in_context("legacy", "新数据", "auto", "Chinese", "new-context")
        .unwrap();
    assert_eq!(
        tm.lookup_in_context("legacy", "auto", "Chinese", "new-context")
            .as_deref(),
        Some("新数据")
    );

    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn import_into_one_context_leaves_other_contexts_untouched() {
    let (tm, dir) = temp_tm();
    tm.store_in_context("hello", "你好A", "auto", "Chinese", "context-a")
        .unwrap();

    let csv = "source,target,source_lang,target_lang\nhello,你好B,auto,Chinese\n";
    assert_eq!(
        tm.import_csv_content_for_context(csv, "context-b").unwrap(),
        1
    );

    // 同键记录：A 上下文不被 B 的导入修改，B 上下文可查到导入结果。
    assert_eq!(
        tm.lookup_in_context("hello", "auto", "Chinese", "context-a")
            .as_deref(),
        Some("你好A")
    );
    assert_eq!(
        tm.lookup_in_context("hello", "auto", "Chinese", "context-b")
            .as_deref(),
        Some("你好B")
    );
    assert_eq!(tm.stats().total_entries, 2);

    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn copy_db_to_carries_entries_and_refuses_to_overwrite() {
    let (tm, dir) = temp_tm();
    tm.store("hello", "你好", "auto", "Chinese");
    let dest_dir = dir.join("moved");
    std::fs::create_dir(&dest_dir).unwrap();

    tm.copy_db_to(&dest_dir).unwrap();
    let moved = TranslationMemory::open(&dest_dir).unwrap();
    assert_eq!(
        moved.lookup("hello", "auto", "Chinese").as_deref(),
        Some("你好")
    );

    // An existing database at the destination is never clobbered.
    assert!(tm.copy_db_to(&dest_dir).is_err());
    // Copying onto itself is a no-op, not an error.
    tm.copy_db_to(&dir).unwrap();

    drop(moved);
    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn in_memory_tm_has_nothing_to_migrate() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    assert!(tm.db_path().is_none());
    let dir = std::env::temp_dir().join(format!("vt_tm_mig_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    assert!(tm.copy_db_to(&dir).is_err());
    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn reopen_repoints_the_live_connection_without_restart() {
    let (tm, dir) = temp_tm();
    tm.store("hello", "你好", "auto", "Chinese");
    let dest = dir.join("moved");
    std::fs::create_dir(&dest).unwrap();

    tm.copy_db_to(&dest).unwrap();
    tm.reopen(&dest).unwrap();
    tm.store("world", "世界", "auto", "Chinese");

    // Writes after the swap land only in the new database.
    let moved = TranslationMemory::open(&dest).unwrap();
    assert_eq!(
        moved.lookup("world", "auto", "Chinese").as_deref(),
        Some("世界")
    );
    assert_eq!(
        moved.lookup("hello", "auto", "Chinese").as_deref(),
        Some("你好")
    );
    assert_eq!(tm.db_path().unwrap(), dest.join("tm.db"));
    // Reopening the same directory is a no-op, not an error.
    tm.reopen(&dest).unwrap();
    drop(moved);
    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn reopen_opens_a_fresh_database_when_nothing_to_migrate() {
    let (tm, dir) = temp_tm();
    let dest = dir.join("empty-target");
    std::fs::create_dir(&dest).unwrap();
    tm.reopen(&dest).unwrap();
    tm.store("new", "新", "auto", "Chinese");
    let moved = TranslationMemory::open(&dest).unwrap();
    assert_eq!(
        moved.lookup("new", "auto", "Chinese").as_deref(),
        Some("新")
    );
    assert!(dest.join("tm.db").exists());
    drop(moved);
    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn reimport_same_key_into_same_context_updates_target() {
    let (tm, dir) = temp_tm();
    let first = dir.join("first.csv");
    std::fs::write(
        &first,
        "source,target,source_lang,target_lang\nhello,你好,auto,Chinese\n",
    )
    .unwrap();
    assert_eq!(tm.import_csv_for_context(&first, "ctx").unwrap(), 1);

    let second = dir.join("second.csv");
    std::fs::write(&second, "hello,您好,auto,Chinese\n").unwrap();
    assert_eq!(tm.import_csv_for_context(&second, "ctx").unwrap(), 1);

    // 既定冲突规则：同上下文同键更新 target，不新增重复行。
    assert_eq!(
        tm.lookup_in_context("hello", "auto", "Chinese", "ctx")
            .as_deref(),
        Some("您好")
    );
    assert_eq!(tm.stats().total_entries, 1);

    drop(tm);
    let _ = std::fs::remove_dir_all(dir);
}
