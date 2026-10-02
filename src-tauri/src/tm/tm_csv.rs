//! Versioned CSV escaping keeps spreadsheet protection reversible.
//! Unmarked legacy exports are ambiguous: import them literally, never guess.

/// v1 exports mark each row at column 5; kept for import-side decoding only.
pub(super) const ENCODING: &str = "vanishtrans-csv-v1";

/// `vanishtrans-csv-v2` rows additionally carry `context_hash`, `created_at`
/// and `hit_count`, so a re-import restores per-context rows and can keep the
/// newer translation instead of letting file order pick a winner.
pub(super) const HEADER_V2: [&str; 8] = [
    "source",
    "target",
    "source_lang",
    "target_lang",
    "context_hash",
    "created_at",
    "hit_count",
    "vanishtrans_encoding",
];
pub(super) const ENCODING_V2: &str = "vanishtrans-csv-v2";

/// Row metadata that only `vanishtrans-csv-v2` records carry. `None` means the
/// importer falls back to the caller's context and plain upsert ordering.
pub(super) struct RowMeta {
    pub context_hash: String,
    pub created_at: i64,
    pub hit_count: i64,
}

pub(super) struct DecodedRecord {
    pub fields: [String; 4],
    pub meta: Option<RowMeta>,
}

fn needs_escape(value: &str) -> bool {
    value
        .chars()
        .next()
        .is_some_and(|character| matches!(character, '\'' | '=' | '+' | '-' | '@' | '\t' | '\r'))
}

pub(super) fn escape_spreadsheet_formula(value: &str) -> String {
    if needs_escape(value) {
        format!("'{value}")
    } else {
        value.to_string()
    }
}

fn decode_field(value: &str, encoded: bool) -> String {
    if encoded {
        if let Some(rest) = value.strip_prefix('\'') {
            if needs_escape(rest) {
                return rest.to_string();
            }
        }
    }
    value.to_string()
}

/// A marked row carries its version in the last column. v1 marks index 4 of a
/// 5-column record; v2 marks index 7 of an 8-column record.
fn record_version(record: &csv::StringRecord) -> Option<u8> {
    if record.get(7) == Some(ENCODING_V2) {
        Some(2)
    } else if record.get(4) == Some(ENCODING) {
        Some(1)
    } else {
        None
    }
}

/// Every export header starts with `source,target,source_lang`; requiring the
/// third cell keeps a legitimate `source,target` data row importable.
fn looks_like_header(record: &csv::StringRecord, index: usize) -> bool {
    index == 0
        && record.len() >= 4
        && record[0].eq_ignore_ascii_case("source")
        && record[1].eq_ignore_ascii_case("target")
        && record[2].eq_ignore_ascii_case("source_lang")
}

/// Decode one CSV record. `None` means "not a data row" (header, too few
/// cells, empty source) — the caller decides whether skipping is acceptable.
pub(super) fn decode_record(record: &csv::StringRecord, index: usize) -> Option<DecodedRecord> {
    if record.len() < 2 {
        return None;
    }
    // Each record carries its marker, so removing the optional header is safe.
    // Unknown markers are not interpreted as either known encoding.
    let version = record_version(record);
    if version.is_none() && looks_like_header(record, index) {
        return None;
    }
    // csv::Reader consumes the file BOM; a BOM inside a field is actual data.
    let fields = std::array::from_fn(|index| {
        decode_field(record.get(index).unwrap_or(""), version.is_some())
    });
    if fields[0].is_empty() {
        return None;
    }
    let meta = if version == Some(2) {
        // A v2 row with unusable metadata still imports under the caller's
        // context, like an unmarked row.
        let created_at = record.get(5).unwrap_or("").parse::<i64>();
        let hit_count = record.get(6).unwrap_or("").parse::<i64>();
        match (created_at, hit_count) {
            (Ok(created_at), Ok(hit_count)) => Some(RowMeta {
                context_hash: decode_field(record.get(4).unwrap_or(""), true),
                created_at,
                hit_count,
            }),
            _ => None,
        }
    } else {
        None
    };
    Some(DecodedRecord { fields, meta })
}
