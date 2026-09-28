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
fn csv_v1_roundtrip_preserves_all_four_fields_and_formula_protection() {
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
        &csv::StringRecord::from(tm_csv::HEADER.to_vec())
    );
    for record in reader.records() {
        let record = record.unwrap();
        assert_eq!(record.get(4), Some(tm_csv::ENCODING));
        for field in record.iter().take(4) {
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
    let source = TranslationMemory::open_in_memory().unwrap();
    source.store("'=1", "new", "en", "zh");
    let content = exported(&source);
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
