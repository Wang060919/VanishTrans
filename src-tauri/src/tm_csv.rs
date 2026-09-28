//! Versioned CSV escaping keeps spreadsheet protection reversible.
//! Unmarked legacy exports are ambiguous: import them literally, never guess.

pub(super) const HEADER: [&str; 5] = [
    "source",
    "target",
    "source_lang",
    "target_lang",
    "vanishtrans_encoding",
];
pub(super) const ENCODING: &str = "vanishtrans-csv-v1";

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

pub(super) fn decode_record(record: &csv::StringRecord, index: usize) -> Option<[String; 4]> {
    if record.len() < 2 {
        return None;
    }
    // Each record carries its marker, so removing the optional header is safe.
    // Unknown markers are not interpreted as this encoding.
    let encoded = record.get(4) == Some(ENCODING);
    if !encoded
        && index == 0
        && record[0].eq_ignore_ascii_case("source")
        && record[1].eq_ignore_ascii_case("target")
    {
        return None;
    }
    // csv::Reader consumes the file BOM; a BOM inside a field is actual data.
    let fields =
        std::array::from_fn(|index| decode_field(record.get(index).unwrap_or(""), encoded));
    if fields[0].is_empty() {
        None
    } else {
        Some(fields)
    }
}
