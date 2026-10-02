use super::{tm_csv, TranslationMemory};
use crate::lock::LockRecover;
use std::sync::atomic::{AtomicU64, Ordering};

fn exported(tm: &TranslationMemory) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "vt_tm_csv_{}_{}.csv",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    tm.export_csv(&path).unwrap();
    let content = std::fs::read_to_string(&path).unwrap();
    std::fs::remove_file(path).unwrap();
    content
}

#[test]
fn csv_v2_roundtrip_preserves_all_fields_and_formula_protection() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    let values = [
        "'=1",
        "=1",
        "'",
        "''",
        "'''=1",
        "'plain",
        "plain",
        "+1",
        "-1",
        "@SUM(A1)",
        "\ttab",
        "\rcarriage",
        "'\ttab",
        "'\rcarriage",
        "'+1",
        "'-1",
        "'@SUM(A1)",
        "comma,quote\"\nline",
        "\u{FEFF}literal BOM",
    ];
    for value in values {
        tm.store(value, value, value, value);
    }
    let content = exported(&tm);
    assert!(content.starts_with('\u{FEFF}'));
    let mut reader = csv::Reader::from_reader(content.as_bytes());
    assert_eq!(
        reader.headers().unwrap(),
        &csv::StringRecord::from(tm_csv::HEADER_V2.to_vec())
    );
    for record in reader.records() {
        let record = record.unwrap();
        assert_eq!(record.get(7), Some(tm_csv::ENCODING_V2));
        for field in record.iter().take(5) {
            assert!(!field.starts_with(['=', '+', '-', '@', '\t', '\r']));
        }
    }
    tm.clear().unwrap();
    assert_eq!(tm.import_csv_content(&content).unwrap(), values.len());
    for value in values {
        assert_eq!(tm.lookup(value, value, value).as_deref(), Some(value));
    }
}

#[test]
fn csv_v2_reimport_never_replaces_a_newer_row() {
    // Re-importing an older export must not regress a fresher target.
    let tm = TranslationMemory::open_in_memory().unwrap();
    tm.store("hello", "你好", "auto", "Chinese");
    let old_export = exported(&tm);

    std::thread::sleep(std::time::Duration::from_millis(1100));
    tm.store("hello", "您好", "auto", "Chinese");
    let newer_created = tm
        .search("hello")
        .into_iter()
        .next()
        .map(|entry| entry.created_at)
        .unwrap();
    assert!(newer_created > 0);

    tm.import_csv_content(&old_export).unwrap();
    assert_eq!(
        tm.lookup("hello", "auto", "Chinese").as_deref(),
        Some("您好"),
        "older export must not overwrite the newer row"
    );

    // And a newer export still updates an older imported row.
    let new_export = exported(&tm);
    let other = TranslationMemory::open_in_memory().unwrap();
    other.store("hello", "旧译", "auto", "Chinese");
    // Backdate the local row so the export is strictly fresher.
    other
        .conn
        .lock_recover()
        .execute(
            "UPDATE translation_memory SET created_at = 1 WHERE source = 'hello'",
            [],
        )
        .unwrap();
    other.import_csv_content(&old_export).unwrap();
    assert_eq!(
        other.lookup("hello", "auto", "Chinese").as_deref(),
        Some("你好")
    );
    other.import_csv_content(&new_export).unwrap();
    assert_eq!(
        other.lookup("hello", "auto", "Chinese").as_deref(),
        Some("您好"),
        "newer export replaces the older row"
    );
}

#[test]
fn csv_v2_roundtrip_restores_per_context_rows() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    tm.store_in_context("hello", "你好A", "auto", "Chinese", "context-a")
        .unwrap();
    tm.store_in_context("hello", "你好B", "auto", "Chinese", "context-b")
        .unwrap();
    let content = exported(&tm);

    let restored = TranslationMemory::open_in_memory().unwrap();
    assert_eq!(restored.import_csv_content(&content).unwrap(), 2);
    assert_eq!(
        restored
            .lookup_in_context("hello", "auto", "Chinese", "context-a")
            .as_deref(),
        Some("你好A")
    );
    assert_eq!(
        restored
            .lookup_in_context("hello", "auto", "Chinese", "context-b")
            .as_deref(),
        Some("你好B")
    );
}

#[test]
fn csv_v1_import_still_decodes_the_old_marker() {
    // Files exported by older versions keep their literal import semantics.
    let tm = TranslationMemory::open_in_memory().unwrap();
    let content = format!(
        "source,target,source_lang,target_lang,vanishtrans_encoding\n''=1,'+1,en,zh,{}\n",
        tm_csv::ENCODING
    );
    assert_eq!(tm.import_csv_content(&content).unwrap(), 1);
    assert_eq!(tm.lookup("'=1", "en", "zh").as_deref(), Some("+1"));
}

#[test]
fn csv_v1_distinct_escaped_keys_do_not_collide_on_reimport() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    let mut keys = Vec::new();
    for position in 0..3 {
        for value in ["=1", "'=1", "''=1"] {
            let mut key = ["source", "en", "zh"];
            key[position] = value;
            tm.store(key[0], value, key[1], key[2]);
            keys.push((key, value));
        }
    }
    let content = exported(&tm);
    tm.clear().unwrap();
    for _ in 0..2 {
        assert_eq!(tm.import_csv_content(&content).unwrap(), keys.len());
        assert_eq!(tm.stats().total_entries, keys.len());
        for (key, value) in &keys {
            assert_eq!(tm.lookup(key[0], key[1], key[2]).as_deref(), Some(*value));
        }
    }
}

#[test]
fn csv_unversioned_third_party_and_legacy_quotes_are_literal() {
    for prefix in [
        "",
        "\u{FEFF}",
        "source,target,source_lang,target_lang\n",
        "\u{FEFF}source,target,source_lang,target_lang\n",
    ] {
        let tm = TranslationMemory::open_in_memory().unwrap();
        let content = format!("{prefix}'=1,'+1,'-1,'@1\n=1,plain,'-1,'@1\n''=1,'plain,'-1,'@1\n");
        assert_eq!(tm.import_csv_content(&content).unwrap(), 3);
        assert_eq!(tm.stats().total_entries, 3);
        for (source, target) in [("'=1", "'+1"), ("=1", "plain"), ("''=1", "'plain")] {
            assert_eq!(tm.lookup(source, "'-1", "'@1").as_deref(), Some(target));
        }
    }
}

#[test]
fn csv_unversioned_two_column_input_keeps_quotes_and_empty_languages() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    assert_eq!(tm.import_csv_content("\u{FEFF}'=1,'+1\n").unwrap(), 1);
    assert_eq!(tm.lookup("'=1", "", "").as_deref(), Some("'+1"));
}

#[test]
fn csv_v1_optional_header_bom_and_header_like_data_are_supported() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    for prefix in ["", "\u{FEFF}"] {
        let content = format!("{prefix}source,target,,,{}\n", tm_csv::ENCODING);
        assert_eq!(tm.import_csv_content(&content).unwrap(), 1);
        assert_eq!(tm.lookup("source", "", "").as_deref(), Some("target"));
        tm.clear().unwrap();
        let content = format!("{prefix}''=1,'+1,'-1,'@1,{}\n", tm_csv::ENCODING);
        assert_eq!(tm.import_csv_content(&content).unwrap(), 1);
        assert_eq!(tm.lookup("'=1", "-1", "@1").as_deref(), Some("+1"));
    }
}

#[test]
fn csv_unknown_or_missing_encoding_marker_never_decodes() {
    for marker in ["", "vanishtrans-csv-v2", "third-party"] {
        let tm = TranslationMemory::open_in_memory().unwrap();
        let content = format!(
            "source,target,source_lang,target_lang,vanishtrans_encoding\n'=1,'+1,en,zh,{marker}\n"
        );
        assert_eq!(tm.import_csv_content(&content).unwrap(), 1);
        assert_eq!(tm.lookup("'=1", "en", "zh").as_deref(), Some("'+1"));
    }
}

#[test]
fn csv_v1_import_is_scoped_and_preserves_existing_upsert_behavior() {
    // v1 rows carry no context, so the importer's context applies to them.
    let content = format!(
        "source,target,source_lang,target_lang,vanishtrans_encoding\n''=1,new,en,zh,{}\n",
        tm_csv::ENCODING
    );
    let tm = TranslationMemory::open_in_memory().unwrap();
    for context in ["a", "b"] {
        tm.store_in_context("'=1", "old", "en", "zh", context)
            .unwrap();
    }
    assert_eq!(tm.import_csv_content_for_context(&content, "b").unwrap(), 1);
    assert_eq!(
        tm.lookup_in_context("'=1", "en", "zh", "a").as_deref(),
        Some("old")
    );
    assert_eq!(
        tm.lookup_in_context("'=1", "en", "zh", "b").as_deref(),
        Some("new")
    );
    assert_eq!(tm.lookup("'=1", "en", "zh"), None);
    assert_eq!(tm.stats().total_entries, 2);
}

#[test]
fn csv_v2_import_restores_the_exported_context_not_the_current_one() {
    // A v2 export keeps per-context rows: re-import lands in the exported
    // context even when the current configuration hash differs.
    let source = TranslationMemory::open_in_memory().unwrap();
    source
        .store_in_context("'=1", "new", "en", "zh", "exported-ctx")
        .unwrap();
    let content = exported(&source);
    let tm = TranslationMemory::open_in_memory().unwrap();
    tm.store_in_context("'=1", "old", "en", "zh", "current-ctx")
        .unwrap();
    assert_eq!(
        tm.import_csv_content_for_context(&content, "current-ctx")
            .unwrap(),
        1
    );
    assert_eq!(
        tm.lookup_in_context("'=1", "en", "zh", "current-ctx")
            .as_deref(),
        Some("old")
    );
    assert_eq!(
        tm.lookup_in_context("'=1", "en", "zh", "exported-ctx")
            .as_deref(),
        Some("new")
    );
    assert_eq!(tm.stats().total_entries, 2);
}

#[test]
fn csv_v1_parse_error_rolls_back_prior_upserts() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    tm.store("'=1", "old", "en", "zh");
    let content = format!("''=1,new,en,zh,{}\nbroken,row\n", tm_csv::ENCODING);
    assert!(tm.import_csv_content(&content).is_err());
    assert_eq!(tm.lookup("'=1", "en", "zh").as_deref(), Some("old"));
    assert_eq!(tm.stats().total_entries, 1);
}

#[test]
fn csv_v1_sql_error_rolls_back_prior_inserts() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    tm.conn
        .lock_recover()
        .execute_batch(
            "CREATE TRIGGER reject_blocked BEFORE INSERT ON translation_memory
             WHEN NEW.source = 'blocked' BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
        )
        .unwrap();
    let content = format!(
        "''=1,new,en,zh,{0}\nblocked,no,en,zh,{0}\n",
        tm_csv::ENCODING
    );
    assert!(tm.import_csv_content(&content).is_err());
    assert_eq!(tm.stats().total_entries, 0);
}

#[test]
fn csv_two_column_source_target_data_row_is_imported() {
    // A legitimate `source,target` data row is data, not a skipped header.
    let tm = TranslationMemory::open_in_memory().unwrap();
    assert_eq!(tm.import_csv_content("source,target\n").unwrap(), 1);
    assert_eq!(tm.lookup("source", "", "").as_deref(), Some("target"));
}

#[test]
fn csv_headers_still_skip_with_and_without_marker() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    // csv::Reader enforces uniform column counts, so each case pads its data
    // row to the header width.
    for (header, data) in [
        (
            "source,target,source_lang,target_lang\n",
            "hello,你好,en,zh\n",
        ),
        (
            "source,target,source_lang,target_lang,vanishtrans_encoding\n",
            "hello,你好,en,zh,\n",
        ),
        (
            "source,target,source_lang,target_lang,context_hash,created_at,hit_count,vanishtrans_encoding\n",
            "hello,你好,en,zh,,,,\n",
        ),
    ] {
        let content = format!("{header}{data}");
        assert_eq!(tm.import_csv_content(&content).unwrap(), 1, "{header}");
        assert_eq!(tm.lookup("source", "", ""), None);
        tm.clear().unwrap();
    }
}

#[test]
fn csv_all_malformed_non_empty_file_errors_instead_of_zero() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    // Blank lines are skipped by the csv reader and count as empty input;
    // a file with only unparseable or header rows must error.
    for content in ["single\n", "source,target,source_lang,target_lang\n"] {
        let error = tm.import_csv_content(content).unwrap_err();
        assert!(
            error.contains("没有可导入的数据行"),
            "{content:?} -> {error}"
        );
    }
}

#[test]
fn csv_import_rejects_replacement_characters_from_lossy_decode() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    let content = "hello,你好\nworld,世界\u{FFFD}\n";
    let error = tm.import_csv_content(content).unwrap_err();
    assert!(error.contains("UTF-8"), "{error}");
    assert_eq!(tm.stats().total_entries, 0);
}

#[test]
fn csv_file_import_rejects_non_utf8_bytes() {
    // GBK-encoded rows arriving via the file path must fail loudly.
    let tm = TranslationMemory::open_in_memory().unwrap();
    let path = std::env::temp_dir().join(format!("vt_tm_gbk_{}.csv", std::process::id()));
    std::fs::write(&path, b"source,target\nhello,\xc4\xe3\xba\xc3\n").unwrap();
    let error = tm.import_csv(&path).unwrap_err();
    assert!(error.contains("UTF-8"), "{error}");
    assert_eq!(tm.stats().total_entries, 0);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn csv_partial_import_reports_committed_prefix() {
    // Chunked commits keep earlier rows; the error must say so.
    let tm = TranslationMemory::open_in_memory().unwrap();
    tm.conn
        .lock_recover()
        .execute_batch(
            "CREATE TRIGGER reject_blocked BEFORE INSERT ON translation_memory
             WHEN NEW.source = 'blocked' BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
        )
        .unwrap();
    let mut rows = String::new();
    for index in 0..(super::csv_io::IMPORT_CHUNK_ROWS + 1) {
        rows.push_str(&format!("s{index},t{index}\n"));
    }
    rows.push_str("blocked,no\n");
    let error = tm.import_csv_content(&rows).unwrap_err();
    assert!(
        error.contains("已提交前 500 条"),
        "expected partial-import note, got: {error}"
    );
    assert_eq!(tm.stats().total_entries, super::csv_io::IMPORT_CHUNK_ROWS);
    assert_eq!(tm.lookup("s0", "", "").as_deref(), Some("t0"));
    assert_eq!(tm.lookup("blocked", "", ""), None);
}

#[test]
fn csv_v2_row_with_bad_metadata_falls_back_to_plain_import() {
    let tm = TranslationMemory::open_in_memory().unwrap();
    let content = format!(
        "hello,你好,en,zh,ctx,notanumber,0,{}\n",
        tm_csv::ENCODING_V2
    );
    assert_eq!(tm.import_csv_content(&content).unwrap(), 1);
    assert_eq!(tm.lookup("hello", "en", "zh").as_deref(), Some("你好"));
}
